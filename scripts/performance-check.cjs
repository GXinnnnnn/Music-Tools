'use strict';
// Synthetic renderer benchmark; never reads/writes user audio. Run sequentially:
// node scripts/performance-check.cjs --label baseline
// node scripts/performance-check.cjs --label optimized --verify
// node scripts/performance-check.cjs --executable C:\\path\\MusicTools.exe --label packaged
const { _electron } = require(process.env.MUSIC_TOOLS_PLAYWRIGHT || '@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf('--' + name);
  if (index < 0) return fallback;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Missing --' + name + ' value');
  return argv[index + 1];
}
const label = option('label', 'baseline');
assert.match(label, /^[a-zA-Z0-9_-]+$/, 'Use a filesystem-safe label');
const executable = option('executable', process.env.MUSIC_TOOLS_ELECTRON);
const launches = Number(option('startup-launches', '1'));
const repeats = Number(option('repeats', '5'));
assert.ok(Number.isInteger(launches) && launches >= 1 && launches <= 3);
assert.ok(Number.isInteger(repeats) && repeats >= 3 && repeats <= 20);
const verify = argv.includes('--verify');
const output = path.join(root, 'artifacts', 'performance-' + label + '.json');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-performance-'));
const lockPath = path.join(os.tmpdir(), 'music-tools-performance-ui.lock');
let lockOwned = false;
const report = {
  schemaVersion: 1, label, startedAt: new Date().toISOString(), passed: false,
  workload: 'SYNTHETIC renderer queue derived from the original eight demo records; not real-audio processing speed',
  configuration: { sizes: [1000, 5000], pageSize: 100, repeats, warmup: 1, editsPerSample: 10, startupLaunches: launches, verify, executable: executable || 'development Electron', viewport: { width: 1440, height: 1000 } },
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model },
  timing: 'Renderer performance.now(), synchronous operation including DOM mutations; excludes subsequent layout/paint, IPC and persistence debounce. Search separately measures event-to-next-frame latency.',
  startup: [], workloads: [], pageErrors: [], blockedNetworkRequests: [], cleanup: {},
};
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samplesMs: samples, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], minMs: sorted[0], maxMs: sorted.at(-1) };
}
async function launch(profile) {
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], env, timeout: 60000 });
}
async function main() {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: report.startedAt }), { flag: 'wx' });
    lockOwned = true;
    for (let launchIndex = 0; launchIndex < launches; launchIndex++) {
      let application;
      const start = performance.now();
      try {
        const profile = path.join(tempRoot, 'launch-' + launchIndex);
        application = await launch(profile);
        const page = await application.firstWindow();
        page.on('pageerror', error => report.pageErrors.push(error.message));
        await application.context().route(/^https?:\/\//, route => {
          report.blockedNetworkRequests.push(route.request().url());
          return route.abort();
        });
        await page.waitForFunction(() => typeof renderCounts === 'function' && document.querySelector('.version')?.textContent.includes('v'));
        await page.evaluate(() => api('session-load'));
        report.startup.push(performance.now() - start);
        await page.setViewportSize(report.configuration.viewport);
        const info = await page.evaluate(() => api('get-info'));
        assert.equal(path.resolve(info.dataDir), path.resolve(profile), 'App must use the isolated temporary data directory');
        report.appVersion = info.version;
        if (launchIndex !== launches - 1) continue;
        const demo = await page.evaluate(() => api('demo'));
        assert.equal(demo.files.length, 8, 'Expected original eight demo records');
        const sharedCover = demo.files.find(file => /^data:image\//.test(file.cover || ''))?.cover || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
        report.demo = { records: demo.files.length, coverBytes: Buffer.byteLength(sharedCover), sameCoverForAllSyntheticRecords: true };
        await page.evaluate(({ demo, sharedCover, fakeRoot }) => {
          window.__performanceCheck = {
            build(size) {
              return Array.from({ length: size }, (_, index) => {
                const source = demo[index % demo.length];
                const id = String(index).padStart(5, '0');
                return { ...source, path: fakeRoot + '/synthetic-' + id + '.mp3', filename: 'Synthetic ' + id + '.mp3', cover: sharedCover,
                  tags: { ...source.tags, title: 'Synthetic ' + id + ' ' + (source.tags.title || ''), comment: 'synthetic-queue-group-' + (index % 10) } };
              });
            },
            install(records) {
              clearTimeout(persistTimer);
              if (typeof replaceFiles === 'function') replaceFiles(records);
              else if (typeof setFiles === 'function') setFiles(records);
              else files = records;
              drafts = {}; done = new Set(); selected = new Set(); active = records[0]?.path || null;
              filter = 'all'; query = ''; sort = 'import'; pageSize = 100; undoQueue = null; matches = {};
              document.querySelector('#library-search').value = '';
              document.querySelector('#sort').value = 'import';
              updateNav(); render(); clearTimeout(persistTimer);
            },
            sample(operation, repeatCount) {
              operation(-1); // warmup, excluded
              const values = [];
              for (let i = 0; i < repeatCount; i++) {
                const before = performance.now(); operation(i); values.push(performance.now() - before);
              }
              clearTimeout(persistTimer);
              return values;
            },
          };
        }, { demo: demo.files, sharedCover, fakeRoot: path.join(profile, 'nonexistent-synthetic-audio') });
        for (const size of report.configuration.sizes) {
          console.log('Synthetic workload: ' + size + ' records');
          await page.evaluate(size => __performanceCheck.install(__performanceCheck.build(size)), size);
          const workload = { size, metrics: {}, correctness: {}, diagnostics: {} };
          report.workloads.push(workload);
          const raw = await page.evaluate(repeats => {
            const sample = __performanceCheck.sample;
            const counts = sample(() => renderCounts(), repeats);
            const grid = sample(() => renderGrid(), repeats);
            const picks = sample(i => pick(files[files.length - 1 - ((i + 1) % 10)].path), repeats);
            const patches = sample(i => {
              for (let j = 0; j < 10; j++) patch([files[files.length - 1].path], { title: 'Synthetic edited ' + i + '-' + j });
            }, repeats);
            return { renderCounts: counts, renderGrid: grid, pick: picks, patch10DraftEdits: patches };
          }, repeats);
          for (const [metric, samples] of Object.entries(raw)) workload.metrics[metric] = summarize(samples);
          workload.metrics.patchPerEdit = summarize(raw.patch10DraftEdits.map(time => time / 10));
          // Timing queue search through the actual input handler, including any new debounce.
          const searchSamples = [];
          for (let i = -1; i < repeats; i++) {
            const needle = 'synthetic-queue-group-' + ((i + 10) % 10);
            const startSearch = performance.now();
            await page.locator('#library-search').fill(needle);
            await page.waitForFunction(({ needle, expected }) => query === needle && visibleFiles().length === expected && document.querySelectorAll('.audio-tile').length === Math.min(100, expected) && [...document.querySelectorAll('.audio-tile')].every(tile => tags(tile.dataset.path).comment.includes(needle)), { needle, expected: size / 10 });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
            if (i >= 0) searchSamples.push(performance.now() - startSearch);
          }
          workload.metrics.queueSearchToFrame = summarize(searchSamples);
          await page.locator('#library-search').fill('');
          await page.waitForFunction(() => query === '' && visibleFiles().length === files.length);
          await page.evaluate(() => __performanceCheck.install([...files]));
          workload.correctness = await page.evaluate(() => {
            const check = (condition, message) => { if (!condition) throw new Error(message); };
            const cards = () => [...document.querySelectorAll('.audio-tile')];
            check(cards().length === 100, 'Initial page must render exactly 100 cards');
            pick(files[0].path); pick(files[2].path, { ctrlKey: true });
            check(selected.size === 2 && selected.has(files[0].path) && selected.has(files[2].path), 'Ctrl selection');
            pick(files[5].path, { shiftKey: true });
            check(selected.size === 4 && selected.has(files[2].path) && selected.has(files[5].path), 'Shift range selection');
            patch([files.at(-1).path], { title: 'Synthetic draft preserved', comment: 'Edited draft comment' });
            check(drafts[files.at(-1).path].tags.title === 'Synthetic draft preserved', 'Draft correctness');
            document.querySelector('[data-filter="draft"]').click();
            check(visibleFiles().length === 1 && cards().length === 1 && cards()[0].dataset.path === files.at(-1).path, 'Draft filter');
            document.querySelector('[data-filter="all"]').click();
            const sortControl = document.querySelector('#sort');
            sortControl.value = 'title'; sortControl.dispatchEvent(new Event('change', { bubbles: true }));
            const expected = [...files].sort((a, b) => String(tags(a.path).title || a.filename).localeCompare(String(tags(b.path).title || b.filename), 'zh-CN')).map(file => file.path);
            check(JSON.stringify(cards().map(card => card.dataset.path)) === JSON.stringify(expected.slice(0, 100)), 'Title sorting order');
            sortControl.value = 'import'; sortControl.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('#load-more').click();
            check(cards().length === 200 && pageSize === 200, 'Load more must render 200 cards');
            const selectAll = document.querySelector('#select-all'); selectAll.checked = true;
            selectAll.dispatchEvent(new Event('change', { bubbles: true }));
            check(selected.size === files.length && selectAll.checked, 'Select all includes unloaded records');
            const before = { paths: files.map(file => file.path), drafts: JSON.stringify(drafts), selected: [...selected], active };
            document.querySelector('[data-action="clear"]').click();
            check(files.length === 0 && cards().length === 0 && Object.keys(drafts).length === 0, 'Clear queue');
            document.querySelector('.toast-action').click();
            check(JSON.stringify(files.map(file => file.path)) === JSON.stringify(before.paths), 'Undo restores all queue paths');
            check(JSON.stringify(drafts) === before.drafts && selected.size === before.selected.length && active === before.active, 'Undo restores drafts, selection and active record');
            check(current(files.at(-1).path)?.path === files.at(-1).path, 'Lookup valid after undo');
            clearTimeout(persistTimer);
            return { initialCards: 100, afterLoadMoreCards: cards().length, ctrlSelection: true, shiftSelection: true, draft: true, filter: true, titleSort: true, loadMore: true, selectAllIncludesUnloaded: true, clearUndo: true, lookupAfterUndo: true };
          });
          workload.diagnostics = await page.evaluate(() => {
            pick(files[0].path);
            const input = document.querySelector('[data-tag="title"]');
            input.focus(); input.setSelectionRange(2, 5);
            const scrollers = [document.querySelector('#library-body'), document.querySelector('.preview-content')].filter(Boolean);
            scrollers.forEach(element => { element.scrollTop = 120; });
            const before = scrollers.map(element => element.scrollTop);
            input.value = 'Synthetic focus diagnostic'; input.setSelectionRange(2, 5);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const inputFocusPreserved = document.activeElement === input;
            const caretPreserved = input.selectionStart === 2 && input.selectionEnd === 5;
            const scrollAfter = scrollers.map(element => element.scrollTop);
            const scrollPreserved = before.every((value, index) => Math.abs(value - scrollAfter[index]) <= 1);
            const card = document.querySelector('.audio-tile'); card.focus({ preventScroll: true });
            const scrollBeforeGridPatch = document.querySelector('#library-body').scrollTop;
            patch([files[0].path], { artist: 'Synthetic focus patch artist' });
            const gridFocusPreserved = document.activeElement?.dataset.path === files[0].path;
            const gridScrollPreserved = Math.abs(document.querySelector('#library-body').scrollTop - scrollBeforeGridPatch) <= 1;
            clearTimeout(persistTimer);
            return { inputFocusPreserved, caretPreserved, scrollPreserved, scrollBefore: before, scrollAfter, gridFocusPreserved, gridScrollPreserved, note: 'Baseline diagnostics are informational; --verify requires all preservation checks.' };
          });
          if (verify) for (const key of ['inputFocusPreserved', 'caretPreserved', 'scrollPreserved', 'gridFocusPreserved', 'gridScrollPreserved']) assert.equal(workload.diagnostics[key], true, size + ' records: ' + key);
          // Persist only to this temporary profile, verify isolated fake queue, then remove it before close.
          await page.evaluate(async () => { clearTimeout(persistTimer); await api('session-save', { paths: files.map(file => file.path), drafts, done: [...done] }); });
          const saved = JSON.parse(fs.readFileSync(path.join(profile, 'session.json'), 'utf8'));
          assert.equal(saved.paths.length, size);
          assert.ok(saved.paths.every(value => path.resolve(value).startsWith(path.resolve(profile) + path.sep)), 'Only temporary fake paths may be persisted');
          workload.correctness.isolatedPersistence = true;
          await page.evaluate(async () => { clearTimeout(persistTimer); __performanceCheck.install([]); await api('session-save', { paths: [], drafts: {}, done: [] }); });
          console.log(JSON.stringify({ size, medianMs: Object.fromEntries(Object.entries(workload.metrics).map(([key, value]) => [key, Number(value.medianMs.toFixed(3))])), diagnostics: workload.diagnostics }));
        }
        assert.deepEqual(report.pageErrors, [], 'Renderer must have no uncaught errors');
        assert.deepEqual(report.blockedNetworkRequests, [], 'Workload must not attempt network requests');
      } finally {
        if (application) {
          await application.evaluate(async ({ BrowserWindow }) => {
            for (const win of BrowserWindow.getAllWindows()) {
              await win.webContents.executeJavaScript('typeof persistTimer !== "undefined" && clearTimeout(persistTimer)').catch(() => {});
            }
          }).catch(() => {});
          await application.close();
        }
      }
    }
    report.startupTiming = summarize(report.startup);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    // Only remove the exact directory allocated by mkdtemp in this process.
    const resolved = path.resolve(tempRoot);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('music-tools-performance-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); report.cleanup.temporaryProfileRemoved = !fs.existsSync(resolved); }
    catch (error) { report.cleanup.error = error.message; process.exitCode = 1; report.passed = false; }
    if (lockOwned) fs.rmSync(lockPath, { force: true });
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, output, error: report.error, cleanup: report.cleanup }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

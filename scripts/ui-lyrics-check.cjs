'use strict';
const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-lyrics-ui-'));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.MUSIC_TOOLS_EXECUTABLE;
  const app = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const api = (name, ...args) => page.evaluate(({ name, args }) => window.music.invoke(name, ...args), { name, args });
  const setting = key => page.locator(`[data-lyric-setting="${key}"]`);
  const action = key => page.locator(`[data-lyric-action="${key}"]`);
  const acknowledgeResult = async kind => {
    const result = page.locator('#lyric-result-dialog');
    await expect(result).toHaveAttribute('data-result-kind', kind);
    await result.locator('[data-lyric-result-confirm]').click();
    await expect(result).toHaveCount(0);
  };
  try {
    await page.locator('[data-action="demo"]').click(); await expect(page.locator('.audio-tile')).toHaveCount(8);
    const records = await page.evaluate(() => files);
    const before = new Map(records.map(record => [record.path, hash(record.path)]));
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const providers = req('./source/core/providers.cjs'); globalThis.lyricTestCalls = [];
      providers.search = async (query, options) => {
        globalThis.lyricTestCalls.push({ query, fields: options.fields, sources: options.sources, artwork: options.artwork });
        const title = options.local.title || '未命名片段', artist = options.local.title === '未命名的旋律' ? '需人工校验的不同作者' : options.local.artist || 'Music Tools';
        return { candidates: [{ id: 'qq:ui123', source: 'qq', title, artist, duration: options.local.duration, album: '演示专辑', score: 99 },
          { id: 'netease:123', source: 'netease', title, artist: '不同作者', duration: options.local.duration, album: '不同录音', score: 70 }], errors: [] };
      };
      providers.enrich = async (candidate, options) => {
        if (options.lyricsFallback !== false) throw new Error('unexpected fallback');
        if (globalThis.lyricTestSlow) await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')); }, { once: true });
        });
        return { ...candidate, syncedLyrics: '[00:01.00]First line\n[00:03.00]Second line\n[00:05.00]', translatedLyrics: '[00:01.00]第一句\n[00:03.00]第二句', errors: [] };
      };
    });
    await page.locator('.audio-tile').first().click();
    await page.locator('.queue-actions [data-action="extract-lyrics"]').click();
    await expect(page.locator('[data-lyric-candidate]')).toHaveCount(2);
    await expect(setting('format')).toHaveValue('srt');
    await page.locator('[data-lyric-candidate="0"]').click();
    await expect(page.locator('[data-lyric-preview]')).toContainText('00:00:01,000 --> 00:00:03,000');
    await expect(page.locator('[data-lyric-preview]')).toContainText('第一句');
    await expect(action('export')).toBeEnabled();
    await page.locator('.lyric-settings summary').click();
    await setting('bilingualMode').selectOption('inline');
    await setting('separator').fill(' · ');
    await expect(page.locator('[data-lyric-preview]')).toContainText('First line · 第一句');
    await setting('bilingualMode').selectOption('cues');
    await expect(page.locator('[data-lyric-preview-meta]')).toContainText('4 条字幕');
    await expect(page.locator('[data-lyric-warnings]')).toContainText('重叠');
    await page.locator('[data-lyric-name-preset]').selectOption('custom');
    await setting('filenameTemplate').fill('{invalid}'); await expect(action('export')).toBeDisabled();
    await expect(page.locator('[data-lyric-filename]')).toContainText('文件名需调整');
    await setting('filenameTemplate').fill('{title} - {artist}');
    await setting('bilingualMode').selectOption('separate');
    await expect(page.locator('[data-lyric-filename]')).toContainText('.translation.srt');
    await expect(action('export')).toBeEnabled();
    await action('export').click(); await expect(page.locator('[data-lyric-notice]')).toContainText('2 个文件'); await acknowledgeResult('success');
    const firstFiles = fs.readdirSync(path.dirname(records[0].path)).filter(name => /\.srt$/.test(name));
    assert.equal(firstFiles.length, 2); assert.ok(firstFiles.some(name => /\.original\.srt$/.test(name)));
    await action('export').click(); await expect(page.locator('[data-lyric-notice]')).toContainText('(1).srt'); await acknowledgeResult('success');
    assert.equal(fs.readdirSync(path.dirname(records[0].path)).filter(name => /\.srt$/.test(name)).length, 4);
    await setting('format').selectOption('txt'); await setting('bilingualMode').selectOption('inline');
    await page.locator('[data-lyric-text="original"]').fill('Plain <img src=x> original');
    await page.locator('[data-lyric-tab="translated"]').click();
    await page.locator('[data-lyric-text="translated"]').fill('纯文本译文');
    await expect(page.locator('[data-lyric-preview]')).toContainText('Plain <img src=x> original');
    await expect(page.locator('[data-lyric-preview] img')).toHaveCount(0);
    await expect(action('export')).toBeEnabled(); await action('export').click();
    await expect(page.locator('[data-lyric-notice]')).toContainText('.txt'); await acknowledgeResult('success');
    await action('close').click(); await expect(page.locator('#modal')).not.toBeVisible();
    await page.locator('#select-all').check(); await page.locator('.queue-actions [data-action="extract-lyrics"]').click();
    await expect(page.locator('.lyric-settings')).toHaveAttribute('open', '');
    await expect(setting('format')).toHaveValue('txt');
    await setting('format').selectOption('lrc'); await setting('bilingualMode').selectOption('separate');
    await page.locator('[data-lyric-name-preset]').selectOption('{artist} - {title}');
    await expect(action('start')).toBeEnabled(); await action('start').click();
    await expect(page.locator('[data-lyric-progress-label]')).toHaveText('本次提取结束', { timeout: 30000 });
    await acknowledgeResult('warning');
    await expect(page.locator('#lyric-ui [data-lyric-result-summary]')).toContainText('7 首已导出');
    const lrc = fs.readdirSync(path.dirname(records[0].path)).filter(name => /\.lrc$/.test(name)); assert.equal(lrc.length, 14);
    for (const name of lrc) { const text = fs.readFileSync(path.join(path.dirname(records[0].path), name), 'utf8'); assert.match(text, /\[00:01\.000\]/); }
    const dimensions = await page.evaluate(() => ({ dialog: document.querySelector('#modal').getBoundingClientRect().width, progress: document.querySelector('.lyric-batch-progress').getBoundingClientRect().width }));
    assert.ok(dimensions.dialog <= 1042 && dimensions.progress <= 562, JSON.stringify(dimensions));
    await page.screenshot({ path: path.join(root, 'artifacts/lyrics-batch-options.png') });
    await page.locator('[data-lyric-review="6"]').click(); await expect(page.locator('[data-lyric-candidate]')).toHaveCount(2);
    await page.locator('[data-lyric-candidate="0"]').click(); await expect(action('export')).toBeEnabled();
    await action('export').click(); await expect(page.locator('[data-lyric-notice]')).toContainText('2 个文件'); await acknowledgeResult('success');
    await action('back-batch').click(); await expect(page.locator('[data-lyric-result-summary]')).toContainText('8 首已导出');
    await action('close').click();
    await page.locator('.audio-tile').first().click(); await page.locator('[data-preview-action="extract-lyrics"]').click();
    await expect(page.locator('[data-lyric-candidate]')).toHaveCount(2);
    await app.evaluate(() => { globalThis.lyricTestSlow = true; });
    await page.locator('[data-lyric-candidate="0"]').click(); await expect(action('stop')).toBeVisible();
    await action('stop').click(); await expect(page.locator('[data-lyric-notice]')).toContainText('已停止');
    await expect(action('export')).toBeDisabled(); await action('close').click();
    await app.evaluate(() => { globalThis.lyricTestSlow = false; });
    // Reopen for screenshot and check actual theme-button animation after app rendering.
    await page.locator('[data-action="theme"]').click(); await page.waitForFunction(() => !document.documentElement.classList.contains('music-theme-revealing'));
    await page.locator('.queue-actions [data-action="extract-lyrics"]').click(); await expect(page.locator('[data-lyric-candidate]')).toHaveCount(2);
    await page.locator('[data-lyric-candidate="0"]').click(); await expect(action('export')).toBeEnabled();
    await page.screenshot({ path: path.join(root, 'artifacts/lyrics-single-dark.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 740));
    await page.waitForFunction(() => innerWidth <= 1000);
    assert.equal(await page.evaluate(() => document.querySelector('#lyric-ui').scrollWidth > document.querySelector('#lyric-ui').clientWidth + 2), false);
    await action('close').click();
    for (const record of records) assert.equal(hash(record.path), before.get(record.path));
    const calls = await app.evaluate(() => globalThis.lyricTestCalls);
    for (const call of calls) { assert.deepEqual(call.fields, ['lyrics']); assert.deepEqual(call.sources, ['qq', 'netease']); assert.equal(call.artwork, false); assert.ok(!call.query.includes(data)); }
    assert.deepEqual(errors, []);
    const result = { passed: true, version: require('../package.json').version, executable: executable || 'development Electron', data,
      checks: ['single candidate and bilingual real SRT preview', 'inline/cues/separate options', 'invalid template blocks export', 'two-file export and numbered collisions', 'plain TXT and safe text preview', 'persistent batch options LRC plus metadata filenames', 'seven robust identities exported and one manual review recovered', 'cancel fetch then reopen', 'dark theme and 1000px layout', 'all eight audio files byte-identical', 'lyric-only requests without cover/fallback'], rendererErrors: errors };
    fs.writeFileSync(path.join(root, 'artifacts/ui-lyrics-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) { await page.screenshot({ path: path.join(root, 'artifacts/lyrics-ui-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

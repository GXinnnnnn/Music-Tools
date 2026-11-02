'use strict';
// Real Electron/IPC checks. All audio writes target temporary demo copies only.
const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-workspace-'));
const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const customExecutable = process.env.MUSIC_TOOLS_ELECTRON;
const report = { passed: false, data, executable: customExecutable || 'development Electron', checks: [], geometry: {}, rendererErrors: [], screenshots: [] };
const output = path.join(artifacts, 'workspace-check.json');
let app, page, step = 'launch';
fs.mkdirSync(artifacts, { recursive: true });
const sha = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const api = (name, ...args) => page.evaluate(({ name, args }) => window.music.invoke(name, ...args), { name, args });
async function shot(name) {
  const filename = path.join(artifacts, `workspace-${name}.png`);
  await page.screenshot({ path: filename });
  report.screenshots.push(filename);
}
async function launch() {
  app = await _electron.launch({ executablePath: customExecutable || require('electron'), args: customExecutable ? [] : [root], env, timeout: 60000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  await page.waitForFunction(() => typeof settings !== 'undefined' && typeof render === 'function');
  const runtime = await api('get-info');
  report.version = runtime.version;
  report.runtime = runtime;
}
async function size(width, height) {
  // Chromium viewport emulation allows a real 2560px layout even on a smaller test display.
  await page.setViewportSize({ width, height });
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height });
}
async function previewStructure() {
  return page.evaluate(() => {
    const card = document.querySelector('#preview-card');
    const rect = selector => { const r = card.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return {
      fieldKeys: [...card.querySelectorAll('[data-tag]')].map(element => element.dataset.tag),
      tabs: [...card.querySelectorAll('[data-tab]')].map(element => element.dataset.tab),
      actions: [...card.querySelectorAll('[data-preview-action]')].map(element => element.dataset.previewAction),
      art: rect('.preview-art'), tabsRect: rect('.preview-tabs'), footer: rect('.preview-footer'),
    };
  });
}
async function checkFooter(backupEnabled) {
  report.geometry.footer ||= [];
  for (const width of [1460, 980]) {
    await size(width, 900);
    const footer = await page.evaluate(() => {
      const measure = selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element), rect = element.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        return { font: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, x: rect.x, y: rect.y, width: rect.width, height: rect.height, textBottom: text.bottom };
      };
      return { width: innerWidth, clear: measure('.clear-all-tags-link'), discard: measure('.discard-draft-link'), hintHidden: document.querySelector('.backup-hint').hidden, sameLinkRow: document.querySelector('.clear-all-tags-link').parentElement === document.querySelector('.discard-draft-link').parentElement };
    });
    assert.equal(footer.sameLinkRow, true, 'clear and discard share one footer link row');
    for (const value of [footer.clear, footer.discard]) {
      assert.equal(value.fontSize, '9px');
      assert.ok(Math.abs(parseFloat(value.lineHeight) - 14.4) < 0.05, 'footer links use a 14.4px line height');
    }
    assert.equal(footer.clear.font, footer.discard.font, 'footer links use identical fonts');
    assert.equal(footer.clear.fontWeight, footer.discard.fontWeight);
    assert.ok(Math.abs(footer.clear.textBottom - footer.discard.textBottom) <= 0.5, 'footer text baselines align');
    assert.ok(Math.abs(footer.clear.y - footer.discard.y) <= 0.5, 'footer links stay on one row');
    assert.ok(footer.discard.x > footer.clear.x + footer.clear.width, 'footer links do not overlap');
    assert.equal(footer.hintHidden, !backupEnabled);
    report.geometry.footer.push({ backupEnabled, ...footer });
    await shot(`footer-${backupEnabled ? 'on' : 'off'}-${width}`);
  }
  await size(1460, 900);
}
async function geometry() {
  return page.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const preview = rect(document.querySelector('#preview-card'));
    const queue = document.querySelector('#library-body');
    const navigation = [...document.querySelectorAll('.nav-item')].map(element => {
      const icon = element.querySelector('[data-icon],svg');
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange(); if (text) range.selectNodeContents(text);
      return { label: element.textContent.trim(), button: rect(element), icon: icon && rect(icon), text: text && rect(range) };
    });
    return { viewport: { width: innerWidth, height: innerHeight }, preview, queue: { ...rect(queue), scrollHeight: queue.scrollHeight, clientHeight: queue.clientHeight, scrollTop: queue.scrollTop, overflowY: getComputedStyle(queue).overflowY }, bodyOverflow: document.documentElement.scrollWidth > innerWidth, navigation };
  });
}
function validateNavigation(value) {
  assert.equal(value.bodyOverflow, false, 'window must not scroll horizontally');
  for (const item of value.navigation) {
    assert.ok(item.icon && item.icon.width >= 14 && item.icon.height >= 14, item.label + ' has a visible icon');
    assert.ok(item.text && item.text.width > 0, item.label + ' has visible text');
    assert.ok(item.text.x >= item.icon.right + 4, item.label + ' icon/text must not overlap');
    assert.ok(Math.abs((item.icon.y + item.icon.height / 2) - (item.text.y + item.text.height / 2)) <= 5, item.label + ' icon/text center alignment');
  }
}
function pcmHash(filename) {
  return JSON.parse(execFileSync(path.join(root, 'source/vendor/python/python.exe'), [path.join(root, 'scripts/engine-fixtures.py'), 'pcmHash', filename], { encoding: 'utf8', windowsHide: true, timeout: 60000 }).trim());
}
async function installScanGate() {
  await app.evaluate(_electron => {
    const req = process.getBuiltinModule('module').createRequire(_electron.app.getAppPath() + '/package.json');
    const audio = req('./source/core/audio.cjs');
    globalThis.workspaceScanOriginal = audio.scan;
    globalThis.workspaceScanGate = { calls: [], waiting: [] };
    audio.scan = async paths => {
      globalThis.workspaceScanGate.calls.push([...paths]);
      await new Promise(resolve => globalThis.workspaceScanGate.waiting.push(resolve));
      return globalThis.workspaceScanOriginal(paths);
    };
  });
}
async function scanCalls(count) {
  await expect.poll(() => app.evaluate(() => globalThis.workspaceScanGate.calls.length)).toBe(count);
}
async function releaseScan() {
  await app.evaluate(() => { const resolve = globalThis.workspaceScanGate.waiting.shift(); if (!resolve) throw new Error('No pending scan gate'); resolve(); });
}
async function restoreScan() {
  await app.evaluate(_electron => {
    const req = process.getBuiltinModule('module').createRequire(_electron.app.getAppPath() + '/package.json');
    req('./source/core/audio.cjs').scan = globalThis.workspaceScanOriginal;
  });
}
async function installSearchGate() {
  await app.evaluate(_electron => {
    const req = process.getBuiltinModule('module').createRequire(_electron.app.getAppPath() + '/package.json');
    const providers = req('./source/core/providers.cjs');
    const gate = globalThis.workspaceSearchGate = { calls: 0, active: 0, maxActive: 0 };
    gate.promise = new Promise(resolve => gate.release = resolve);
    providers.search = async (query, options) => {
      gate.calls++; gate.active++; gate.maxActive = Math.max(gate.maxActive, gate.active);
      try {
        await gate.promise;
        return { candidates: [{ id: 'qq:workspace-' + gate.calls, source: 'qq', title: options.local.title || '工作区测试候选', artist: '工作区测试作者', album: options.local.album || '工作区测试专辑', duration: options.local.duration, score: 99 }], errors: [] };
      } finally { gate.active--; }
    };
  });
}

(async () => {
  try {
    await launch();
    await size(1460, 900);
    step = 'persistent empty preview';
    await expect(page.locator('.audio-tile')).toHaveCount(0);
    await expect(page.locator('#preview-card')).toBeVisible();
    await expect(page.locator('#preview-card')).toHaveAttribute('data-empty', 'true');
    await expect(page.locator('.preview-art .fallback-cover')).toBeVisible();
    await expect(page.locator('.preview-title')).toHaveText('—');
    await expect(page.locator('.preview-subtitle')).toHaveText('—');
    for (const tab of ['file', 'lyrics', 'tags']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
      const disabled = await page.locator('#preview-card').evaluate(card => ({
        actions: [...card.querySelectorAll('[data-preview-action]')].map(element => ({ action: element.dataset.previewAction, disabled: element.disabled })),
        fields: [...card.querySelectorAll('[data-tag]')].map(element => ({ disabled: element.disabled, value: element.value, placeholder: element.placeholder })),
      }));
      assert.ok(disabled.actions.length >= 7 && disabled.actions.every(element => element.disabled), 'all empty-preview actions remain disabled on every tab');
      assert.ok(disabled.fields.every(element => element.disabled && element.value === '' && element.placeholder === '—'), 'empty fields remain blank and disabled');
    }
    assert.ok(await page.locator('#preview-card [data-tag]').count() >= 10, 'full editable metadata structure is retained');
    await page.locator('.preview-content').evaluate(element => element.scrollTop = 0);
    report.geometry.empty = await geometry(); validateNavigation(report.geometry.empty);
    report.geometry.emptyStructure = await previewStructure();
    assert.equal(await page.locator('[data-action="refresh"] svg').count(), 1, 'refresh uses one icon');
    report.refreshIcon = await page.locator('[data-action="refresh"] svg path').evaluateAll(paths => paths.map(element => element.getAttribute('d')));
    assert.equal(report.refreshIcon.reduce((count, d) => count + (d.match(/[aA]/g) || []).length, 0), 1, 'refresh depicts one circular arrow rather than two opposing arcs');
    await shot('empty-1460');
    assert.deepEqual(await api('preferences-get'), { backupEnabled: true });
    report.checks.push('Empty workspace retains the full shared artwork/fields/tabs/actions structure, neutral artwork and blank disabled fields/actions; all three tabs work without renderer errors');

    step = 'first import and deselection';
    await page.locator('[data-action="demo"]').click();
    await expect(page.locator('.audio-tile')).toHaveCount(8);
    const originals = await page.evaluate(() => files.map(f => ({ path: f.path, tags: f.tags, cover: f.cover, stamp: f.stamp })));
    assert.ok(originals.every(f => path.resolve(f.path).startsWith(path.resolve(data) + path.sep)), 'all demo audio must be inside the disposable profile');
    const first = originals[0].path;
    assert.equal(await page.evaluate(() => active), first);
    assert.deepEqual(await page.evaluate(() => [...selected]), [first]);
    report.geometry.imported = await geometry();
    report.geometry.importedStructure = await previewStructure();
    assert.deepEqual(report.geometry.importedStructure.fieldKeys, report.geometry.emptyStructure.fieldKeys, 'empty and loaded previews expose exactly the same metadata fields');
    assert.deepEqual(report.geometry.importedStructure.tabs, report.geometry.emptyStructure.tabs, 'empty and loaded previews expose the same tabs');
    assert.deepEqual(report.geometry.importedStructure.actions, report.geometry.emptyStructure.actions, 'empty and loaded previews expose the same actions');
    for (const section of ['art', 'tabsRect', 'footer']) {
      for (const dimension of ['width', 'height']) {
        assert.ok(Math.abs(report.geometry.emptyStructure[section][dimension] - report.geometry.importedStructure[section][dimension]) <= 1, `empty/loaded ${section} ${dimension} stays consistent`);
      }
    }
    assert.ok(Math.abs(report.geometry.empty.preview.width - report.geometry.imported.preview.width) <= 1, 'preview width stays reserved after import');
    await page.locator('#select-all').check();
    await expect(page.locator('[data-preview-action="clear-all-tags"]')).toBeDisabled();
    await page.locator('[data-preview-action="close"]').click();
    assert.equal(await page.evaluate(() => active), first);
    assert.equal(await page.evaluate(() => selected.size), 0);
    await expect(page.locator('[data-preview-action="clear-all-tags"]')).toBeEnabled();
    await page.locator('.audio-tile').nth(5).click();
    await page.locator('#select-all').check();
    await page.locator('#select-all').uncheck();
    assert.equal(await page.evaluate(() => active), first, 'unchecking all resets preview to first audio');
    assert.equal(await page.evaluate(() => selected.size), 0);
    await shot('imported-1460');
    report.checks.push('First import previews first audio; multi-selection disables clear; both deselection controls restore first preview without collapsing its column');

    step = 'backup setting geometry, save, generic dialog caps';
    await checkFooter(true);
    const modalMeasurements = [];
    for (const viewport of [{ width: 1460, height: 900 }, { width: 2560, height: 1440 }]) {
      await size(viewport.width, viewport.height);
      await page.locator('.nav-item[data-action="settings"]').click();
      await expect(page.locator('#setting-backup')).toBeChecked();
      const measured = await page.evaluate(() => {
        const r = document.querySelector('#modal').getBoundingClientRect(), input = document.querySelector('#setting-backup'), c = input.getBoundingClientRect(), label = input.parentElement.querySelector('span').getBoundingClientRect();
        return { width: r.width, height: r.height, x: r.x, y: r.y, viewport: { width: innerWidth, height: innerHeight }, checkbox: { width: c.width, height: c.height, right: c.right }, text: { x: label.x, width: label.width } };
      });
      assert.ok(measured.width <= 880 && measured.height <= 761, 'ordinary dialog remains capped');
      assert.ok(measured.x >= 0 && measured.y >= 0, 'dialog stays within viewport');
      assert.ok(measured.checkbox.width >= 14 && measured.checkbox.width <= 24 && measured.checkbox.height >= 14 && measured.checkbox.height <= 24, 'checkbox must retain native square geometry');
      assert.ok(measured.text.x > measured.checkbox.right && measured.text.width > 100, 'checkbox label does not overlap the control');
      modalMeasurements.push(measured);
      await shot(`settings-${viewport.width}`);
      await page.locator('#modal-close').click();
    }
    assert.ok(Math.abs(modalMeasurements[0].width - modalMeasurements[1].width) <= 1, 'ordinary dialog does not grow on large displays');
    report.geometry.settings = modalMeasurements;
    await size(1460, 900);
    await page.locator('.nav-item[data-action="settings"]').click();
    await page.locator('#setting-backup').uncheck();
    await page.locator('#save-settings').click();
    await expect(page.locator('#modal')).not.toBeVisible();
    assert.deepEqual(await api('preferences-get'), { backupEnabled: false });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'preferences.json'), 'utf8')), { backupEnabled: false });
    await expect(page.locator('.backup-hint')).toBeHidden();
    await expect(page.locator('.clear-all-tags-link')).toBeVisible();
    await checkFooter(false);
    await shot('backup-disabled');
    report.checks.push('Backup checkbox has native geometry; saving updates real preferences IPC/file and hides the preview backup hint; generic dialogs stay capped at 1460/2560; clear/discard footer links use matching 9px/14.4px typography and baseline at 1460/980 with backup both on and off');

    step = 'immediate clear of one actual audio file with backups off';
    const othersBefore = originals.slice(1).map(f => ({ path: f.path, sha: sha(f.path) }));
    const beforeStat = fs.statSync(first, { bigint: true }), beforePcm = pcmHash(first);
    assert.ok(Object.values(originals[0].tags).some(Boolean), 'clear fixture has tags before action');
    assert.ok(originals[0].cover, 'clear fixture has a cover before action');
    await page.locator('[data-preview-action="clear-all-tags"]').click();
    await page.waitForFunction(() => !busy && document.querySelector('#operation-status').textContent.includes('已清空'), null, { timeout: 60000 });
    await expect(page.locator('#modal')).not.toBeVisible();
    const cleared = (await api('refresh', [first])).files[0];
    assert.ok(cleared, 'cleared file remains readable');
    assert.ok(Object.values(cleared.tags).every(value => value === '' || value == null), 'all ordinary tags are empty');
    assert.ok(!cleared.cover, 'cover is removed');
    assert.equal(cleared.path, first, 'filename preserved');
    const afterStat = fs.statSync(first, { bigint: true });
    assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs, 'exact modification time preserved');
    assert.equal(afterStat.birthtimeNs, beforeStat.birthtimeNs, 'exact creation time preserved');
    assert.deepEqual(pcmHash(first), beforePcm, 'decoded audio bytes preserved');
    for (const other of othersBefore) assert.equal(sha(other.path), other.sha, 'other demo file unchanged: ' + path.basename(other.path));
    assert.equal(fs.existsSync(path.join(data, 'backups')), false, 'disabled backups must not create a backup directory');
    report.clear = { filename: first, tags: cleared.tags, cover: !!cleared.cover, mtimeNs: String(afterStat.mtimeNs), birthtimeNs: String(afterStat.birthtimeNs), decodedAudio: beforePcm, otherFilesUnchanged: othersBefore.length };
    report.checks.push('One click immediately clears tags/cover only on the first demo audio through real IPC/backend; filename, exact creation/modification times, PCM and seven other files stay intact; no backup directory is created');

    step = 'scrollable queue and refresh chunks';
    const copies = path.join(data, 'workspace-extra'); fs.mkdirSync(copies);
    const extraPaths = Array.from({ length: 32 }, (_, index) => path.join(copies, 'copy-' + String(index + 1).padStart(2, '0') + path.extname(originals[1].path)));
    for (const filename of extraPaths) fs.copyFileSync(originals[1].path, filename);
    const imported = await api('import-paths', extraPaths);
    assert.equal(imported.errors.length, 0); assert.equal(imported.files.length, 32);
    await page.evaluate(result => addResult(result), imported);
    await expect(page.locator('.audio-tile')).toHaveCount(40);
    report.geometry.queue40 = await geometry(); validateNavigation(report.geometry.queue40);
    assert.ok(report.geometry.queue40.queue.scrollHeight > report.geometry.queue40.queue.clientHeight, 'queue has independent scrollable content');
    assert.ok(['auto', 'scroll'].includes(report.geometry.queue40.queue.overflowY));
    await page.locator('#library-body').evaluate(element => element.scrollTop = 300);
    const stableBefore = await geometry();
    await installScanGate();
    await page.locator('[data-action="refresh"]').click();
    await scanCalls(1);
    await expect(page.locator('#background-task')).toBeVisible();
    await expect(page.locator('#background-task-count')).toHaveText('0 / 40');
    await expect(page.locator('#background-task-stop')).toBeEnabled();
    await expect(page.locator('#background-task-view')).toBeHidden();
    assert.deepEqual(await page.evaluate(() => ({ busy, kind: backgroundTask?.kind })), { busy: false, kind: 'refresh' });
    const whileRefreshing = await geometry();
    assert.ok(Math.abs(whileRefreshing.preview.width - stableBefore.preview.width) <= 1, 'background task does not resize preview');
    assert.equal(whileRefreshing.queue.scrollTop, stableBefore.queue.scrollTop, 'showing task does not jump the queue');
    await page.locator('.audio-tile').nth(4).click();
    for (const tab of ['file', 'tags']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
      for (const action of ['match', 'clear-all-tags', 'save']) {
        await expect(page.locator(`[data-preview-action="${action}"]`)).toBeDisabled();
      }
      await expect(page.locator('.backup-hint')).toBeHidden();
    }
    await expect(page.locator('[data-tag="title"]')).toBeEnabled();
    await page.locator('[data-tag="title"]').fill('刷新时仍可编辑草稿');
    await page.locator('[data-tag="title"]').dispatchEvent('change');
    const editedPath = await page.evaluate(() => active);
    assert.equal(await page.evaluate(p => drafts[p]?.tags.title, editedPath), '刷新时仍可编辑草稿');
    await expect(page.locator('[data-preview-action="save"]')).toBeDisabled();
    await expect(page.locator('.backup-hint')).toBeHidden();
    await shot('refresh-editable');
    await releaseScan(); await scanCalls(2);
    await expect(page.locator('#background-task-count')).toHaveText('16 / 40');
    await releaseScan(); await scanCalls(3);
    await expect(page.locator('#background-task-count')).toHaveText('32 / 40');
    await releaseScan();
    await page.waitForFunction(() => backgroundTask === null, null, { timeout: 60000 });
    const chunks = await app.evaluate(() => globalThis.workspaceScanGate.calls.map(group => group.length));
    assert.deepEqual(chunks, [16, 16, 8]);
    assert.equal(await page.evaluate(p => drafts[p]?.tags.title, editedPath), '刷新时仍可编辑草稿', 'refresh preserves edits made while scanning');
    report.refresh = { chunks, draftPreserved: true, tabRerenderLocksPreserved: true, backupHintRemainsHidden: true };
    await restoreScan();
    report.checks.push('40-file refresh uses real scan chunks 16/16/8, exposes count/progress/stop, preserves preview width/queue position, and allows selecting/editing a draft while running');

    step = 'refresh stop';
    await installScanGate();
    await page.locator('[data-action="refresh"]').click(); await scanCalls(1);
    await page.locator('#background-task-stop').click();
    await expect(page.locator('#background-task-stop')).toBeDisabled();
    await releaseScan();
    await page.waitForFunction(() => backgroundTask === null, null, { timeout: 60000 });
    assert.equal(await app.evaluate(() => globalThis.workspaceScanGate.calls.length), 1, 'stop prevents scheduling the second scan chunk');
    assert.equal(await page.evaluate(() => files.length), 40, 'stopping a refresh does not remove unprocessed audio from the queue');
    await restoreScan();
    report.checks.push('Stopping refresh completes only the in-flight group and keeps all 40 queue records');

    step = 'three-worker background match and return to results';
    await installSearchGate();
    await page.locator('#select-all').check();
    await page.locator('[data-preview-action="match"]').click();
    await page.locator('[data-policy-preset="all"]').click();
    await page.locator('[data-policy-all-overwrite]').check();
    await page.locator('#start-batch').click();
    await expect.poll(() => app.evaluate(() => globalThis.workspaceSearchGate.calls)).toBe(3);
    await expect(page.locator('#background-task')).toBeVisible();
    await expect(page.locator('#background-task-count')).toHaveText('0 / 40');
    await page.locator('[data-modal-action="background-task"]').click();
    await expect(page.locator('#modal')).not.toBeVisible();
    await page.locator('.audio-tile').nth(3).click();
    await expect(page.locator('[data-tag="artist"]')).toBeEnabled();
    await page.locator('[data-tag="artist"]').fill('后台匹配时的本地草稿');
    await page.locator('[data-tag="artist"]').dispatchEvent('change');
    const matchEditedPath = await page.evaluate(() => active);
    await shot('match-background');
    await page.locator('[data-action="task-view"]').click();
    await expect(page.locator('#modal')).toBeVisible();
    await expect(page.locator('#batch-progress')).toContainText('0 / 40');
    await page.locator('[data-modal-action="background-task"]').click();
    await app.evaluate(() => globalThis.workspaceSearchGate.release());
    await page.waitForFunction(() => backgroundTask === null && batchSession?.items.length === 40, null, { timeout: 60000 });
    const searchStats = await app.evaluate(() => ({ calls: globalThis.workspaceSearchGate.calls, maxActive: globalThis.workspaceSearchGate.maxActive }));
    assert.deepEqual(searchStats, { calls: 40, maxActive: 3 });
    assert.equal(await page.evaluate(p => drafts[p]?.tags.artist, matchEditedPath), '后台匹配时的本地草稿');
    await page.locator('[data-action="task-view"]').click();
    await expect(page.locator('[data-batch-row]')).toHaveCount(40);
    await expect(page.locator('#batch-summary')).toContainText('40 首已搜索');
    const batchDialog = await page.locator('#modal').boundingBox();
    assert.ok(batchDialog.width <= 1041 && batchDialog.height <= 761, 'batch review also retains capped bounds');
    await shot('match-results');
    await page.locator('#modal-close').click();
    report.match = { ...searchStats, results: 40, draftPreserved: true, dialog: batchDialog };
    report.checks.push('Actual batch IPC limits gated provider searches to three workers; modal can be hidden while browsing/editing; task-view restores running state and all 40 completed candidates without losing local drafts');

    step = 'preference persists across actual Electron restart';
    // Flush through the real session IPC so restart does not depend on debounce timing.
    await page.evaluate(() => api('session-save', { paths: files.map(f => f.path), drafts, done: [...done] }));
    await app.close(); app = null;
    await launch(); await size(1460, 900);
    assert.deepEqual(await api('preferences-get'), { backupEnabled: false });
    await page.locator('.nav-item[data-action="settings"]').click();
    await expect(page.locator('#setting-backup')).not.toBeChecked();
    await shot('preferences-relaunched');
    await page.locator('#modal-close').click();
    await expect(page.locator('.backup-hint')).toBeHidden();
    assert.equal(fs.existsSync(path.join(data, 'backups')), false);
    report.checks.push('A fresh Electron process using the same temporary profile loads backup-disabled through real IPC and displays the unchecked preference/hidden preview hint');
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.failure = { step, message: error.message, stack: error.stack };
    if (page && !page.isClosed()) await shot('failure').catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (app) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

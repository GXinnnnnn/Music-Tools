'use strict';
// Reproducible public screenshots of the real Electron UI, using only the eight
// original synthesized demos and a disposable profile. No personal music,
// network requests, audio edits, lyric exports, or UI/CSS replacements are needed.
const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'docs', 'images');
  const version = require('../package.json').version;
  assert.equal(version, '1.0.0', 'Update the public release screenshot expectations when the version changes.');
  fs.mkdirSync(output, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-shots-'));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const captures = [];
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], env, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    const rendererErrors = [];
    page.on('pageerror', error => rendererErrors.push(error.message));
    // Match the app's intended release frame regardless of desktop display size.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1460, 940));
    await page.waitForFunction(() => innerWidth === 1460 && innerHeight === 940);
    await expect(page.locator('.version span')).toHaveText(`v${version}`);
    await expect(page.locator('#preview-card')).toBeVisible();
    await expect(page.locator('[data-preview-action="clear-all-tags"]')).toBeVisible();
    await expect(page.locator('[data-preview-action="discard"]')).toBeVisible();
    await expect(page.locator('.demo-button svg')).toHaveCount(1);
    assert.equal(await page.locator('.demo-button').innerText(), '先试试演示音频');

    async function settled() {
      await page.waitForFunction(() => !document.documentElement.classList.contains('music-theme-revealing'));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.mouse.move(730, 14);
      await expect(page.locator('#toasts .toast')).toHaveCount(0);
    }
    async function capture(name) {
      await settled();
      // Fail on a leak instead of replacing real interface content with mock text.
      const publicText = await page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('input,textarea')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
        .map(element => element.value)].join('\n'));
      assert.doesNotMatch(publicText, /\b[A-Z]:[\\/]|\\\\[^\\\s]+\\|\/(?:Users|home|tmp|var\/folders)\//i, `${name}: visible host path`);
      assert.doesNotMatch(publicText, /\bv0\.2(?:\.|\b)/i, `${name}: stale release version`);
      await expect(page.locator('.version span')).toHaveText(`v${version}`);
      const image = await page.screenshot({ path: path.join(output, name), animations: 'disabled', caret: 'hide', scale: 'css' });
      assert.equal(image.readUInt32BE(16), 1460);
      assert.equal(image.readUInt32BE(20), 940);
      captures.push(name);
    }
    async function theme(value) {
      await page.locator('[data-action="theme"]').click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value &&
        !document.documentElement.classList.contains('music-theme-revealing'), value);
    }

    // The empty queue deliberately retains the complete disabled detail pane.
    await expect(page.locator('#preview-card')).toHaveAttribute('data-empty', 'true');
    await expect(page.locator('#preview-card [data-tag="title"]')).toBeDisabled();
    await capture('empty.png');

    await page.locator('[data-action="demo"]').click();
    await expect(page.locator('.audio-tile')).toHaveCount(8);
    await expect(page.locator('#preview-card')).toHaveAttribute('data-empty', 'false');
    const records = await page.evaluate(() => files.map(record => ({ path: record.path, filename: record.filename })));
    const digest = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    const originals = new Map();
    for (const record of records) {
      assert.equal(path.dirname(record.path), path.join(data, 'demo'), 'Only the disposable demo copies may be imported.');
      const hash = digest(path.join(root, 'source', 'demo', record.filename));
      assert.equal(digest(record.path), hash);
      originals.set(record.path, hash);
    }
    await capture('library.png');

    await page.locator('#select-all').check();
    await page.locator('[data-preview-action="match"]').click();
    await expect(page.locator('[data-source]')).toHaveCount(6);
    await expect(page.locator('.sync-policy')).toHaveAttribute('open', '');
    await capture('batch.png');
    await page.locator('#modal-close').click();
    await page.locator('.audio-tile').first().click();
    await theme('dark');
    await capture('dark.png');
    await theme('light');

    // Exercise the actual lyric IPC, editor, and formatter. Only the remote
    // provider boundary is substituted, just as in ui-lyrics-check.cjs. The
    // title/artist are the original demos; all example lyric lines are original.
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const providers = req('./source/core/providers.cjs');
      providers.search = async (_query, options) => ({ candidates: [
        { id: 'qq:publicdemo', source: 'qq', title: options.local.title, artist: options.local.artist,
          album: options.local.album, duration: options.local.duration, score: 99 },
        { id: 'netease:10000001', source: 'netease', title: options.local.title, artist: options.local.artist,
          album: options.local.album, duration: options.local.duration, score: 96 },
      ], errors: [] });
      providers.enrich = async candidate => ({ ...candidate,
        syncedLyrics: '[00:00.00]晚风把信轻轻送来\n[00:01.00]落在窗边那片星海\n[00:02.00]让每段旋律都有归属\n[00:03.00]',
        translatedLyrics: '[00:00.00]The evening breeze brings a letter\n[00:01.00]To the starlight by the window\n[00:02.00]Every melody finds its home\n[00:03.00]',
        errors: [],
      });
    });
    const lyricAction = name => page.locator(`[data-lyric-action="${name}"]`);
    await page.locator('[data-preview-action="extract-lyrics"]').click();
    await expect(page.locator('[data-lyric-candidate]')).toHaveCount(2);
    await page.locator('[data-lyric-candidate="0"]').click();
    await expect(page.locator('[data-lyric-preview]')).toContainText('00:00:00,000 --> 00:00:01,000');
    await expect(page.locator('[data-lyric-preview]')).toContainText('晚风把信轻轻送来');
    await expect(page.locator('[data-lyric-preview]')).toContainText('The evening breeze brings a letter');
    await expect(lyricAction('export')).toBeEnabled();
    await capture('lyrics.png');
    await lyricAction('close').click();

    await page.locator('#select-all').check();
    await page.locator('.queue-actions [data-action="extract-lyrics"]').click();
    await expect(page.locator('.lyric-settings')).toHaveAttribute('open', '');
    await expect(page.locator('[data-lyric-setting="format"]')).toHaveValue('srt');
    await expect(page.locator('[data-lyric-filename]')).toContainText('晚风来信');
    await expect(lyricAction('start')).toBeEnabled();
    await capture('lyrics-batch.png');
    await lyricAction('close').click();

    for (const record of records) assert.equal(digest(record.path), originals.get(record.path), 'Demo audio must remain unchanged.');
    assert.deepEqual(rendererErrors, []);
    console.log(JSON.stringify({ version, frame: '1460x940', captures, privacy: 'isolated temporary profile; eight original synthetic demos; no host paths in rendered content', lyrics: 'real UI and SRT formatter; original sample lyrics with in-memory provider fixtures; no network or exports' }, null, 2));
  } finally {
    if (app) await app.close();
    // The absolute target came directly from mkdtemp above, never from app/user input.
    assert.equal(path.dirname(data), path.resolve(os.tmpdir()));
    assert.ok(path.basename(data).startsWith('music-tools-shots-'));
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

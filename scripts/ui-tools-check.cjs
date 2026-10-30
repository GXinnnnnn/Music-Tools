'use strict';

// Run with: node scripts/ui-tools-check.cjs
// Real Electron + real disposable audio copies. No application sources are patched.
const { _electron: electron, expect } = require(process.env.MUSIC_TOOLS_PLAYWRIGHT || '@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const timeout = 30000;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-ui-tools-'));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath: process.env.MUSIC_TOOLS_ELECTRON,
    args: [root], env, timeout: 60000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(timeout);
  const errors = [];
  const results = [];
  page.on('pageerror', error => errors.push(error.message));
  const invoke = (name, ...args) => page.evaluate(({ name, args }) => window.music.invoke(name, ...args), { name, args });
  const paths = () => page.locator('.audio-tile').evaluateAll(tiles => tiles.map(tile => tile.dataset.path));
  const idle = () => expect(page.locator('#operation-status .busy-indicator')).toHaveCount(0, { timeout });
  const closeModal = async () => {
    if (await page.locator('#modal').evaluate(dialog => dialog.open)) await page.locator('#modal-close').click();
  };
  const select = async index => {
    await closeModal();
    await page.locator('.audio-tile').nth(index).click();
    await expect(page.locator('.audio-tile.selected')).toHaveCount(1);
    await expect(page.locator('#preview-card')).toBeVisible();
  };
  const tool = async name => {
    await page.locator('[data-action="tools"]').first().click();
    await page.locator(`[data-tool-tab="${name}"]`).click();
  };
  const session = () => invoke('session-load');
  const record = async file => {
    const response = await invoke('refresh', [file]);
    assert.deepEqual(response.errors, [], JSON.stringify(response.errors));
    assert.equal(response.files.length, 1);
    return response.files[0];
  };
  const dimensions = value => page.evaluate(async value => {
    const image = new Image(); image.src = value; await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, value);
  const check = async (name, task) => {
    try {
      await task();
      results.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.stack || String(error) });
      console.error(`FAIL ${name}: ${error.message}`);
      await page.screenshot({ path: path.join(data, `${name}-failure.png`) }).catch(() => {});
      await closeModal().catch(() => {});
    }
  };

  try {
    await page.waitForSelector('[data-action="demo"]');
    await expect(page.locator('#count-all')).toHaveText('0');
    assert.equal(await invoke('session-load'), null, 'Test must start with a fresh workspace');
    assert.equal(path.resolve((await invoke('get-info')).dataDir), path.resolve(data));
    await page.locator('[data-action="demo"]').click();
    await expect(page.locator('.audio-tile')).toHaveCount(8, { timeout });
    await idle();
    const originals = await paths();
    const expected = {};
    assert.ok(originals.every(file => path.resolve(file).startsWith(path.resolve(data) + path.sep)), 'Only disposable audio may be edited');

    await check('rename-restore-selection', async () => {
      await select(0);
      const original = originals[0], before = hash(original);
      await tool('rename');
      await page.locator('#tool-pattern').fill('UI-tools-{track:02}-{title}');
      await page.locator('#tool-run').click();
      await expect(page.locator('#tool-run')).toContainText('确认重命名 1 首');
      await page.locator('#tool-run').click();
      await expect(page.locator('#modal')).not.toHaveAttribute('open', '');
      await idle();
      const renamedPaths = await paths(), renamed = renamedPaths[0];
      assert.notEqual(renamed, original);
      assert.equal(new Set(renamedPaths).size, 8);
      assert.equal(renamedPaths.length, 8);
      assert.equal(fs.existsSync(original), false);
      assert.equal(hash(renamed), before, 'Rename must not change audio bytes');
      await expect(page.locator('.audio-tile.selected')).toHaveAttribute('data-path', renamed);
      await expect(page.locator('#selection-count')).toHaveText('已选 1');
      const entry = (await invoke('history')).find(item => item.action === 'rename');
      assert.ok(entry, 'Rename must create a backup');
      await page.locator('[data-action="history"]').click();
      await expect.poll(() => page.locator('[data-restore]').evaluateAll(buttons => buttons.map(button => button.dataset.restore)), { timeout }).toContain(entry.id);
      await page.locator('[data-restore]').evaluateAll((buttons, id) => {
        const button = buttons.find(button => button.dataset.restore === id);
        if (!button) throw new Error('Rename backup is absent from history');
        button.click();
      }, entry.id);
      await expect.poll(() => fs.existsSync(original), { timeout }).toBe(true);
      await idle();
      await closeModal();
      const restoredPaths = await paths();
      assert.deepEqual(restoredPaths, originals, 'Restore must replace the renamed row without duplicates');
      assert.equal(new Set(restoredPaths).size, 8);
      assert.equal(fs.existsSync(renamed), false);
      assert.equal(hash(original), before, 'Restore must recover exact original bytes');
      await expect(page.locator('.audio-tile.selected')).toHaveAttribute('data-path', original);
      await expect(page.locator('#selection-count')).toHaveText('已选 1');
      await page.locator('[data-tag="comment"]').fill('Restored selection is live');
      await expect.poll(async () => (await session())?.drafts?.[original]?.tags?.comment).toBe('Restored selection is live');
      assert.equal((await session()).drafts[renamed], undefined, 'No stale renamed-path draft');
      await page.locator('[data-preview-action="discard"]').click();
      await expect(page.locator('#count-draft')).toHaveText('0');
    });

    await check('chinese-conversion-draft', async () => {
      await select(0);
      const file = (await paths())[0];
      const before = await record(file);
      await page.locator('[data-tag="title"]').fill('音乐与头发');
      await tool('chinese');
      await expect(page.locator('#chinese-from')).toBeVisible({ timeout: 3000 });
      await page.locator('#chinese-from').selectOption('cn');
      await page.locator('#chinese-to').selectOption('tw');
      for (const checkbox of await page.locator('[data-chinese-field]').all()) await checkbox.uncheck();
      await page.locator('[data-chinese-field="title"]').check();
      await page.locator('#tool-run').click();
      await expect(page.locator('#modal')).not.toHaveAttribute('open', '');
      await expect(page.locator('[data-tag="title"]')).toHaveValue('音樂與頭髮');
      await expect(page.locator('[data-tag="artist"]')).toHaveValue(before.tags.artist || '');
      await expect.poll(async () => (await session())?.drafts?.[file]?.tags?.title).toBe('音樂與頭髮');
      assert.equal((await record(file)).tags.title, before.tags.title, 'Conversion must remain a draft');
      expected[file] = { title: '音樂與頭髮', artist: before.tags.artist };
    });

    await check('lyric-cleanup-draft', async () => {
      await select(1);
      const file = (await paths())[1], before = await record(file);
      await page.locator('[data-tab="lyrics"]').click();
      await page.locator('[data-tag="lyrics"]').fill('[ar:测试歌手]\r\n[offset:250]\r\n\r\n[0:01.2]第一行\r\n[00:02,50]第二行\r\n');
      await page.locator('[data-preview-action="lyrics-tools"]').click();
      await page.locator('#strip-metadata').check();
      await page.locator('#remove-blank').check();
      await page.locator('#format-times').check();
      await page.locator('#offset-ms').fill('500');
      await page.locator('#tool-run').click();
      await expect(page.locator('#modal')).not.toHaveAttribute('open', '');
      const lyrics = '[00:01.950]第一行\n[00:03.250]第二行';
      await expect(page.locator('[data-tag="lyrics"]')).toHaveValue(lyrics);
      await expect.poll(async () => (await session())?.drafts?.[file]?.tags?.lyrics).toBe(lyrics);
      assert.equal((await record(file)).tags.lyrics, before.tags.lyrics, 'Cleanup must remain a draft');
      expected[file] = { lyrics };
    });

    await check('cover-datauri-resize-and-clear', async () => {
      await select(2);
      const file = (await paths())[2];
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 480;
        const context = canvas.getContext('2d'); context.fillStyle = '#5566cc'; context.fillRect(0, 0, 960, 480);
        return canvas.toDataURL('image/png');
      });
      const png = await invoke('transform-cover', image, { maxSize: 300, format: 'png' });
      assert.match(png, /^data:image\/png;base64,/);
      assert.deepEqual(await dimensions(png), { width: 300, height: 150 });
      const jpeg = await invoke('transform-cover', image, { maxSize: 600, format: 'jpeg' });
      assert.match(jpeg, /^data:image\/jpeg;base64,/);
      assert.deepEqual(await dimensions(jpeg), { width: 600, height: 300 });
      // Install a generated image through the production IPC, avoiding a native picker.
      const before = await record(file);
      const written = await invoke('write', [{ path: file, tags: {}, cover: png, stamp: before.stamp }], {});
      assert.deepEqual(written.errors, []);
      await page.locator('[data-action="refresh"]').first().click();
      await idle();
      await expect(page.locator('#preview-card .preview-art img')).toBeVisible();
      assert.deepEqual(await dimensions((await record(file)).cover), { width: 300, height: 150 });
      await page.locator('[data-preview-action="cover"]').click();
      await page.locator('#cover-remove').click();
      await page.locator('#cover-apply').click();
      await expect(page.locator('#modal')).not.toHaveAttribute('open', '');
      await expect.poll(async () => (await session())?.drafts?.[file]?.cover).toBe('');
      await expect(page.locator('#preview-card .preview-art img')).toHaveCount(0);
      assert.ok((await record(file)).cover, 'Cover clear must remain a draft before saving');
      expected[file] = { cover: '' };
    });

    await check('save-all-refresh-and-reload', async () => {
      await closeModal();
      const state = await session();
      const pending = Object.keys(state?.drafts || {}).length;
      assert.ok(pending >= 2, 'Prior tool checks must create multiple drafts');
      await page.locator('[data-action="save-all"]').first().click();
      await expect(page.locator('#operation-status')).toContainText(`已写入 ${pending} 首`, { timeout });
      await idle();
      await expect(page.locator('#count-draft')).toHaveText('0');
      await expect(page.locator('#count-done')).toHaveText(String(pending));
      const all = await paths();
      assert.equal(all.length, 8); assert.equal(new Set(all).size, 8);
      for (const [file, values] of Object.entries(expected)) {
        const actual = await record(file);
        for (const [field, value] of Object.entries(values)) assert.equal(field === 'cover' ? actual.cover : actual.tags[field], value, `${path.basename(file)} ${field}`);
      }
      for (const file of all) {
        const actual = await record(file);
        const displayed = await page.locator('.audio-tile').evaluateAll((tiles, file) => {
          const tile = tiles.find(tile => tile.dataset.path === file);
          return { title: tile.querySelector('.tile-title').textContent, cover: tile.querySelector('.tile-cover img')?.getAttribute('src') || '' };
        }, file);
        assert.equal(displayed.title, actual.tags.title || actual.filename, 'All displayed titles must reflect disk');
        assert.equal(displayed.cover, actual.cover || '', 'All displayed covers must reflect disk');
      }
      await expect.poll(async () => Object.keys((await session())?.drafts || {}).length).toBe(0);
      await page.reload();
      await expect(page.locator('.audio-tile')).toHaveCount(8, { timeout });
      await idle();
      await expect(page.locator('#count-draft')).toHaveText('0');
      assert.deepEqual(await paths(), all, 'Saved workspace must reload without stale or duplicate paths');
    });
    await check('renderer-errors', async () => assert.deepEqual(errors, []));
    const passed = results.every(result => result.passed);
    console.log(JSON.stringify({ passed, data, results }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await application.close();
    console.log(`Disposable test data retained: ${data}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

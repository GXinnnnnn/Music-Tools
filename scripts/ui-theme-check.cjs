'use strict';
const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'artifacts');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-theme-ui-'));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.MUSIC_TOOLS_EXECUTABLE;
  const app = await _electron.launch({ executablePath: executable || require('electron'), args: executable ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = [], audits = [], checks = []; page.on('pageerror', e => errors.push(e.message));
  const screenshot = name => page.screenshot({ path: path.join(artifacts, `theme-${name}.png`) });
  const close = async () => { await page.locator('#modal-close').click(); await expect(page.locator('#modal')).not.toBeVisible(); };
  const auditPicker = async (picker, view, image) => {
    await picker.scrollIntoViewIfNeeded(); await picker.click();
    assert.ok(await picker.evaluate(el => el.matches(':open')), `${view}: picker did not open`);
    const result = await picker.evaluate((el, view) => {
      const s = getComputedStyle(el), popup = getComputedStyle(el, '::picker(select)'), root = getComputedStyle(document.documentElement);
      const color = token => { const span = document.createElement('span'); span.style.color = root.getPropertyValue(token); document.body.append(span); const value = getComputedStyle(span).color; span.remove(); return value; };
      const box = el.getBoundingClientRect(), issues = [];
      if (s.appearance !== 'base-select' || popup.appearance !== 'base-select') issues.push('system popup instead of themed picker');
      if (popup.backgroundColor !== color('--solid') || popup.color !== color('--text')) issues.push('popup does not follow theme');
      if (box.left < 0 || box.right > innerWidth + 1) issues.push('closed control outside viewport');
      const selected = el.selectedOptions[0];
      if (selected && getComputedStyle(selected).backgroundColor !== color('--accent-soft')) issues.push('selected option not themed');
      const visible = [...el.options].filter(o => { const r = o.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height > 0; });
      if (!visible.length) issues.push('no visible options');
      for (const option of visible) {
        const r = option.getBoundingClientRect();
        if (r.left < 0 || r.right > innerWidth + 1) issues.push('option clipped at viewport side');
      }
      // A real option must receive a pointer hit even outside an overflow-clipped dialog body.
      const option = visible.find(o => o === selected) || visible[0], r = option?.getBoundingClientRect();
      if (r) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
        if (hit !== option && !option.contains(hit)) issues.push('picker option covered by another layer');
      }
      return { view, control: el.id || el.getAttribute('aria-label') || el.outerHTML.slice(0, 70), options: el.options.length, issues };
    }, view);
    audits.push(result); assert.deepEqual(result.issues, [], JSON.stringify(result));
    if (image) await screenshot(image);
    const value = await picker.inputValue(); await page.keyboard.press('Escape');
    assert.equal(await picker.inputValue(), value, 'Escape changed selection');
    assert.equal(await picker.evaluate(el => el.matches(':open')), false);
  };
  const auditView = async view => {
    await page.locator('#modal-body details').evaluateAll(els => els.forEach(el => { el.open = true; }));
    const pickers = page.locator('#modal-body select');
    for (let i = 0; i < await pickers.count(); i++) if (await pickers.nth(i).isVisible() && await pickers.nth(i).isEnabled()) await auditPicker(pickers.nth(i), view);
  };
  try {
    assert.ok(await page.evaluate(() => CSS.supports('appearance', 'base-select')));
    await page.locator('[data-action="demo"]').click(); await expect(page.locator('.audio-tile')).toHaveCount(8);
    await page.locator('.audio-tile').first().click();
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json'), p = req('./source/core/providers.cjs');
      globalThis.themeGate = { held: false, waiters: [] };
      p.search = async (_, options) => {
        if (globalThis.themeGate.held) await new Promise(resolve => globalThis.themeGate.waiters.push(resolve));
        return { candidates: ['A', 'B'].map(id => ({ id, source: 'qq', title: '主题核对歌曲 ' + id, artist: '演示歌手', album: '较长专辑名称 · 现场录音与发行版本信息，用来核对菜单换行以及边缘显示 ' + id, duration: options.local?.duration || 120, score: 99 })), errors: [] };
      };
    });
    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: width === 1000 ? 740 : 920 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const view = `${width}-${theme}`;
        if (await page.locator('#sort').isVisible()) await auditPicker(page.locator('#sort'), `${view} queue sorting`);
        await page.evaluate(() => showSettings()); await expect(page.locator('#setting-country')).toBeVisible(); await auditView(`${view} preferences`); await close();
        for (const tool of ['lyrics', 'chinese']) { await page.evaluate(tool => tools(tool), tool); await auditView(`${view} ${tool} tools`); await close(); }
        await page.evaluate(() => coverManager()); await auditView(`${view} cover manager`); await close();
        await page.locator('.sidebar [data-action="extract-lyrics"]').click(); await expect(page.locator('[data-lyric-reference-source]')).toBeVisible();
        await auditView(`${view} lyric source and export settings`);
        await auditPicker(page.locator('[data-lyric-setting="format"]'), `${view} lyric formats`, `lyrics-${view}`); await close();
        await page.locator('#select-all').check(); await page.evaluate(() => batchMatch()); await page.locator('#start-batch').click();
        await page.waitForFunction(() => !backgroundTask && !busy); await expect(page.locator('[data-batch-row]')).toHaveCount(8);
        await auditPicker(page.locator('#batch-filter'), `${view} batch filter`, `batch-filter-${view}`);
        await auditPicker(page.locator('[data-batch-choice="7"]'), `${view} long candidate at bottom edge`, `candidate-${view}`);
        // Exercise keyboard traversal and actual native change events, not just programmatic selectOption.
        await page.locator('#batch-filter').focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
        await expect(page.locator('#batch-filter')).toHaveValue('unchanged'); await expect(page.locator('[data-batch-row]:visible')).toHaveCount(0);
        await page.keyboard.press('Space'); await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await expect(page.locator('#batch-filter')).toHaveValue('all');
        await expect(page.locator('[data-batch-row]:visible')).toHaveCount(8);
        await page.locator('[data-batch-choice="0"]').focus(); await page.keyboard.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
        await expect(page.locator('[data-batch-choice="0"]')).toHaveValue('1');
        assert.equal(await page.evaluate(() => batchSession.items[0].choice), 1);
        // Focus a row that was above the current viewport. Its full focus indicator must clear the sticky toolbar.
        await page.locator('#batch-filter').focus();
        await page.locator('#modal-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.locator('[data-batch-choice="0"]').focus();
        const clearance = await page.locator('[data-batch-choice="0"]').evaluate(el => {
          const r = el.getBoundingClientRect(), t = document.querySelector('#batch-toolbar').getBoundingClientRect();
          return { top: r.top, toolbarBottom: t.bottom, left: r.left, right: r.right, width: innerWidth };
        });
        assert.ok(clearance.top >= clearance.toolbarBottom - 1 && clearance.left >= 0 && clearance.right <= clearance.width, JSON.stringify(clearance));
        await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement.matches(':focus-visible')));
        checks.push(`${view}: all menus themed, top-layer options reachable, keyboard selection and sticky focus clearance`);
        await close(); await page.locator('.audio-tile').first().click();
      }
    }
    // The reported popup is also usable while search remains held, and does not reset when results arrive.
    await app.evaluate(() => { globalThis.themeGate.held = true; });
    await page.locator('#select-all').check(); await page.evaluate(() => batchMatch()); await page.locator('#start-batch').click();
    await expect(page.locator('#batch-filter')).toBeVisible(); await auditPicker(page.locator('#batch-filter'), 'search still pending', 'searching-dark');
    await app.evaluate(() => { globalThis.themeGate.held = false; globalThis.themeGate.waiters.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => !backgroundTask); checks.push('filter remains themed and operable during pending search');
    assert.deepEqual(errors, []);
    const report = { passed: true, version: require('../package.json').version, executable: executable || 'development Electron', views: checks, menus: audits.length, audits, rendererErrors: errors };
    fs.writeFileSync(path.join(artifacts, executable ? 'ui-theme-portable.json' : 'ui-theme-check.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, audits: undefined }, null, 2));
  } catch (error) { await screenshot('failure').catch(() => {}); throw error; }
  finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), baseline = process.env.MUSIC_TOOLS_FOCUS_BASELINE === '1';
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-focus-ui-'));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.MUSIC_TOOLS_EXECUTABLE;
  const app = await _electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = [], audits = []; page.on('pageerror', e => errors.push(e.message));
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const audit = async name => {
    if (!name.includes('library, player, tag editor')) await expect(page.locator('#modal')).toBeVisible();
    if (!baseline && !name.startsWith('empty')) await page.locator('dialog[open] details').evaluateAll(els => els.forEach(el => { el.open = true; }));
    await page.keyboard.press('Tab');
    const result = await page.evaluate(name => {
      const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
      const scope = modal || document;
      const controls = [...scope.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')].filter(el => !el.matches(':disabled') && el.tabIndex >= 0 && el.checkVisibility({ visibilityProperty: true }) && ![...el.closest('dialog')?.querySelectorAll('details:not([open])') || []].some(d => d.contains(el) && !d.querySelector(':scope > summary')?.contains(el)));
      const issues = [], checked = [];
      for (const el of controls) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); el.focus({ preventScroll: true });
        const target = el.closest('.search-box') || el;
        const s = getComputedStyle(target), r = target.getBoundingClientRect();
        const desc = el.id || [...el.attributes].filter(a => /^data-/.test(a.name)).map(a => `${a.name}=${a.value}`).join(' ') || el.getAttribute('aria-label') || `${el.tagName}.${el.className}`;
        const visibleFocus = el.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        if (!visibleFocus || parseFloat(s.opacity) === 0) { issues.push({ control: desc, reason: 'missing visible keyboard focus' }); continue; }
        const spread = Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
        const ring = { left: r.left - spread, right: r.right + spread, top: r.top - spread, bottom: r.bottom + spread };
        for (let p = target.parentElement; p; p = p.parentElement) {
          const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
          const clipX = /hidden|auto|scroll|clip/.test(ps.overflowX), clipY = /hidden|auto|scroll|clip/.test(ps.overflowY);
          const left = pr.left + p.clientLeft, top = pr.top + p.clientTop;
          if (clipX && (ring.left < left - .75 || ring.right > left + p.clientWidth + .75) || clipY && (ring.top < top - .75 || ring.bottom > top + p.clientHeight + .75)) {
            issues.push({ control: desc, reason: 'focus clipped', ancestor: p.id || p.className || p.tagName, ring, clip: { left, top, width: p.clientWidth, height: p.clientHeight } }); break;
          }
        }
        checked.push({ control: desc, type: el.type || el.tagName, outline: s.outline, offset: s.outlineOffset });
      }
      return { name, count: controls.length, issues, checked };
    }, name);
    audits.push(result); console.log(`${result.issues.length ? 'FAIL' : 'PASS'} ${name}: ${result.count} controls, ${result.issues.length} focus issues`);
    if (!baseline) fs.writeFileSync(path.join(artifacts, 'ui-focus-progress.json'), JSON.stringify(audits, null, 2));
  };
  const close = async () => { if (await page.locator('#modal').evaluate(el => el.open)) await page.locator('#modal-close').click(); await expect(page.locator('#modal')).not.toBeVisible(); };
  const screenshot = async name => page.screenshot({ path: path.join(artifacts, `focus-${baseline ? 'before' : 'after'}-${name}.png`) });
  try {
    await page.locator('.sidebar [data-action="extract-lyrics"]').click();
    await expect(page.locator('[data-lyric-reference]')).toBeFocused();
    await screenshot('lyrics-link');
    await page.locator('[data-lyric-query="title"]').focus(); await screenshot('lyrics-title');
    await audit('empty lyrics dialog');
    if (!baseline) {
      await close();
      await app.evaluate(({ app }) => {
        const req = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
        const p = req('./source/core/providers.cjs');
        p.search = async (_query, options) => ({ candidates: [{ source: 'netease', id: 'netease:123', title: '焦点检查歌曲', artist: '演示歌手', album: '演示专辑', duration: options.local?.duration || 120, score: 99 }], errors: [] });
        p.enrich = async c => ({ ...c, syncedLyrics: '[00:01.00]歌词第一句\n[00:03.00]歌词第二句', translatedLyrics: '[00:01.00]Translation one\n[00:03.00]Translation two', errors: [] });
      });
      await page.locator('[data-action="demo"]').click(); await expect(page.locator('.audio-tile')).toHaveCount(8);
      await page.locator('.audio-tile').first().click();
      for (const [width, height] of [[1440, 920], [1000, 740]]) {
        await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]);
        await page.waitForFunction(width => innerWidth <= width, width);
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          const label = `${width}px ${theme}`;
          await audit(`${label}: library, player, tag editor`);
          await page.locator('.search-box input').focus(); await screenshot(`${width}-${theme}-search`);
          await page.locator('[data-action="settings"]').click(); await audit(`${label}: preferences`); await close();
          for (const tool of ['edit', 'rename', 'filename', 'replace', 'lyrics', 'chinese', 'clear', 'export']) {
            await page.evaluate(tool => tools(tool), tool);
            await page.locator('#modal-body details').evaluateAll(els => els.forEach(el => { el.open = true; }));
            await audit(`${label}: tools/${tool}`); await close();
          }
          await page.evaluate(() => coverManager()); await audit(`${label}: cover manager`); await close();
          await page.evaluate(() => openMatch()); await expect(page.locator('#match-results .match-item')).toHaveCount(1);
          await audit(`${label}: online matching and field policy`); await close();
          await page.locator('.queue-actions [data-action="extract-lyrics"]').click();
          await expect(page.locator('[data-lyric-candidate]')).toHaveCount(1); await page.locator('[data-lyric-candidate]').first().click();
          await expect(page.locator('[data-lyric-text="original"]')).toBeEnabled();
          await page.locator('.lyric-settings').evaluate(el => { el.open = true; });
          await page.locator('[data-lyric-name-preset]').selectOption('custom');
          await audit(`${label}: lyrics settings, candidates, tabs, editors and preview`);
          await page.locator('[data-lyric-reference]').focus(); await screenshot(`${width}-${theme}-lyrics`); await close();
          await page.locator('#select-all').check();
          await page.locator('.queue-actions [data-action="extract-lyrics"]').click();
          await audit(`${label}: batch lyrics`); await close();
          await page.evaluate(() => batchMatch()); await audit(`${label}: batch matching`); await close();
          await page.locator('.audio-tile').first().click();
          await page.locator('[data-action="history"]').click(); await audit(`${label}: history`); await close();
          await page.locator('[data-action="help"]').click(); await audit(`${label}: help`); await close();
        }
      }
      // Exercise actual keyboard navigation without clicking or changing values.
      await page.locator('.search-box input').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id !== 'library-search' && document.activeElement.tagName !== 'BODY' && document.activeElement.matches(':focus-visible')), true);
    }
    const issues = audits.flatMap(a => a.issues.map(issue => ({ view: a.name, ...issue })));
    const report = { passed: issues.length === 0 && errors.length === 0, baseline, version: require('../package.json').version, executable: packaged || 'development Electron', data, views: audits.length, controls: audits.reduce((sum, a) => sum + a.count, 0), issues, rendererErrors: errors, audits };
    fs.writeFileSync(path.join(artifacts, `ui-focus-${baseline ? 'before' : 'check'}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, audits: undefined }, null, 2));
    if (!baseline) { assert.deepEqual(issues, []); assert.deepEqual(errors, []); }
  } catch (error) { await screenshot('failure').catch(() => {}); throw error; }
  finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

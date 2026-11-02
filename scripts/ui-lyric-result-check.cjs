'use strict';
const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-lyric-result-'));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [root], env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const action = name => page.locator(`[data-lyric-action="${name}"]`);
  const result = page.locator('#lyric-result-dialog');
  const confirm = result.locator('[data-lyric-result-confirm]');
  const mode = value => app.evaluate(({ app }, value) => {
    globalThis.lyricResultMode = value;
  }, value);
  const openSingle = async () => {
    await page.locator('.audio-tile').first().click();
    await page.locator('[data-preview-action="extract-lyrics"]').click();
    await expect(page.locator('[data-lyric-candidate]')).toHaveCount(1);
    await page.locator('[data-lyric-candidate="0"]').click();
    await expect(action('export')).toBeEnabled();
  };
  const exportResult = async kind => {
    await action('export').click();
    await expect(result).toHaveAttribute('data-result-kind', kind);
    await expect(confirm).toHaveText('确认（3）');
  };
  const startBatch = async () => {
    if (await action('start').isVisible()) { await expect(action('start')).toBeEnabled(); await action('start').click(); }
    else { await expect(action('retry')).toBeEnabled(); await action('retry').click(); }
  };
  try {
    await page.locator('[data-action="demo"]').click(); await expect(page.locator('.audio-tile')).toHaveCount(8);
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const service = req('./source/core/lyric-service.cjs');
      const actualExport = service.exportLyrics;
      service.search = async (query, options) => ({ candidates: [{ id: 'qq:result', source: 'qq', title: options.local.tags?.title || options.local.title || '歌曲', artist: '测试艺术家', duration: 180, score: 99 }], errors: [] });
      service.fetchLyrics = async () => ({ original: '[00:01]Original\n[00:03]Second', translated: '[00:01]译文\n[00:03]第二句', source: 'qq' });
      globalThis.lyricResultMode = 'success';
      const waitForAbort = signal => new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('Canceled', 'AbortError'));
        signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
      });
      service.exportLyrics = async (job, options) => {
        if (globalThis.lyricResultMode === 'fail') throw new Error('保存目录不可写 <img src=x>');
        if (globalThis.lyricResultMode === 'hold') return waitForAbort(options.signal);
        return actualExport(job, options);
      };
      service.batch = async (items, options) => {
        const mode = globalThis.lyricResultMode;
        if (mode === 'hold') { try { await waitForAbort(options.signal); } catch {} return { results: items.map(item => ({ path: item.path, status: 'canceled', message: '已取消' })), canceled: true }; }
        if (mode === 'throw') throw new Error('歌词服务暂时不可用');
        return { results: items.map((item, index) => ({ path: item.path,
          status: mode === 'success' || mode === 'partial' && index === 0 ? 'exported' : mode === 'partial' ? 'review' : 'error',
          ...(mode === 'success' || mode === 'partial' && index === 0 ? { output: item.path + '.srt' } : {}),
          message: mode === 'partial' && index > 0 ? '歌曲版本需要核对' : mode === 'fail' ? '来源没有歌词' : '完成' })), errors: [], canceled: false };
      };
    });
    await openSingle();
    // Control only renderer time: IPC still crosses the real preload/main boundary.
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));
    const original = await page.locator('[data-lyric-text="original"]').inputValue();
    await exportResult('success');
    await expect(result.locator('[data-lyric-result-title]')).toHaveText('歌词导出成功');
    assert.equal(await page.locator('#modal').getAttribute('open'), '');
    assert.equal(await page.locator('[data-lyric-text="original"]').inputValue(), original);
    await page.clock.runFor(999); await expect(confirm).toHaveText('确认（3）');
    await page.clock.runFor(1); await expect(confirm).toHaveText('确认（2）');
    await page.clock.runFor(1000); await expect(confirm).toHaveText('确认（1）');
    await page.clock.runFor(999); await expect(result).toBeVisible();
    await page.clock.runFor(1); await expect(result).toHaveCount(0);
    await expect(action('export')).toBeFocused();
    await page.clock.resume();
    await exportResult('success'); await confirm.click(); await expect(result).toHaveCount(0);
    await page.clock.runFor(3100); await expect(action('export')).toBeFocused();
    await mode('fail'); await exportResult('failure');
    await expect(result.locator('[data-lyric-result-summary]')).toContainText('保存目录不可写 <img src=x>');
    await expect(result.locator('img')).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(result).toHaveCount(0);
    await expect(page.locator('[data-lyric-error]')).toContainText('保存目录不可写');
    await expect(page.locator('#modal')).toBeVisible();
    await mode('success'); await exportResult('success');
    await page.evaluate(() => document.querySelector('#modal').close());
    await expect(result).toHaveCount(0); await page.clock.runFor(4000);
    await openSingle(); await page.clock.runFor(1000); await expect(result).toHaveCount(0);
    await mode('success'); await exportResult('success');
    await page.evaluate(() => document.querySelector('#modal-body').innerHTML = '<p>另一个工具</p>');
    await expect(result).toHaveCount(0); await page.clock.runFor(4000);
    await page.evaluate(() => document.querySelector('#modal').close());
    await page.locator('#select-all').check();
    await page.locator('.queue-actions [data-action="extract-lyrics"]').click();
    await mode('partial'); await startBatch();
    await expect(result).toHaveAttribute('data-result-kind', 'warning');
    await expect(result.locator('[data-lyric-result-summary]')).toContainText('已导出 1 首 · 需核对 7 首 · 未完成 0 首');
    await expect(result.locator('[data-lyric-result-detail]')).toContainText('歌曲版本需要核对');
    await confirm.click(); await expect(page.locator('.lyric-result.is-success')).toHaveCount(1);
    await mode('fail'); await startBatch(); await expect(result).toHaveAttribute('data-result-kind', 'failure');
    await expect(result.locator('[data-lyric-result-summary]')).toContainText('本次 7 首 · 已导出 0 首');
    await page.keyboard.press('Escape');
    await mode('throw'); await startBatch(); await expect(result).toHaveAttribute('data-result-kind', 'failure');
    await expect(page.locator('[data-lyric-error]')).toContainText('歌词服务暂时不可用'); await confirm.click();
    await mode('hold'); await startBatch(); await expect(action('stop')).toBeVisible();
    await action('stop').click(); await expect(page.locator('[data-lyric-progress-label]')).toHaveText('提取已停止');
    await page.clock.runFor(4000); await expect(result).toHaveCount(0);
    await mode('success'); await startBatch(); await expect(result).toHaveAttribute('data-result-kind', 'success');
    await expect(result.locator('[data-lyric-result-summary]')).toContainText('本次 7 首 · 已导出 7 首');
    for (const width of [2560, 1460, 980, 375]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setMinimumSize(320, 480), width);
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width);
      const box = await result.boundingBox(); const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(box.width <= 460 && box.width <= viewport.width, JSON.stringify({ box, viewport }));
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 2, 'result centered');
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'result fits');
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1460, 1000));
    await page.screenshot({ path: path.join(root, 'artifacts/lyric-result-success.png') });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    const theme = await result.evaluate(dialog => ({ background: getComputedStyle(dialog).backgroundColor, color: getComputedStyle(dialog).color, token: getComputedStyle(dialog).getPropertyValue('--text').trim() }));
    assert.ok(theme.token && theme.background !== 'rgba(0, 0, 0, 0)', 'result inherits dark theme');
    await page.screenshot({ path: path.join(root, 'artifacts/lyric-result-dark.png') });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await confirm.click(); await action('close').click();
    await openSingle(); await mode('hold'); await action('export').click();
    await expect(action('export')).toBeDisabled(); await action('close').click();
    await page.clock.runFor(4000); await expect(result).toHaveCount(0);
    await mode('success'); await openSingle(); await expect(result).toHaveCount(0);
    assert.deepEqual(errors, []);
    const report = { passed: true, checks: ['real IPC single file export', 'exact 3000ms countdown with controlled clock', 'click and Escape dismiss', 'focus restore and workspace retained', 'specific failure safely escaped and inline retained', 'parent close and shared replacement cleanup', 'partial batch warning and current-run counts', 'zero-export failure', 'batch rejection failure', 'canceled batch no alert', 'batch success', '375/980/1460/2560 centered sizing and dark theme', 'canceled export no stale alert'], data, rendererErrors: errors };
    fs.writeFileSync(path.join(root, 'artifacts/ui-lyric-result-check.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(root, 'artifacts/lyric-result-failure.png') }).catch(() => {}); throw error;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

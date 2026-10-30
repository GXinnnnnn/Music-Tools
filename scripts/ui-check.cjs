'use strict';
const { _electron: electron } = require(process.env.MUSIC_TOOLS_PLAYWRIGHT || '@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const data=path.join(root,'artifacts','ui-test-data-'+Date.now());fs.mkdirSync(data,{recursive:true});
 const launchEnv={...process.env,MUSIC_TOOLS_DATA_DIR:data};delete launchEnv.ELECTRON_RUN_AS_NODE;
 const application=await electron.launch({executablePath:process.env.MUSIC_TOOLS_ELECTRON,args:[root],env:launchEnv,timeout:60000});
 const page=await application.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.waitForSelector('[data-action="demo"]');await page.locator('[data-action="demo"]').click();await page.waitForFunction(()=>document.querySelectorAll('.audio-tile').length===8,{timeout:30000});
  await page.waitForSelector('#preview-card:not([hidden])');
  await page.screenshot({path:path.join(root,'artifacts','01-library-light.png')});
  assert.equal(await page.locator('.audio-tile').count(),8);
  await page.locator('[data-tag="title"]').fill('界面联调 · 已修改');
  await page.locator('[data-tag="title"]').dispatchEvent('change');
  await page.locator('[data-preview-action="save"]').click();
  await page.waitForFunction(()=>document.querySelector('#operation-status').textContent.includes('已写入 1 首'),{timeout:30000});
  assert.equal(await page.locator('.audio-tile').first().locator('.tile-title').textContent(),'界面联调 · 已修改');
  const original=await page.evaluate(()=>window.music.invoke('history'));assert.equal(original.length,1);
  await page.locator('[data-action="history"]').click();await page.waitForSelector('[data-restore]');await page.locator('[data-restore]').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-restore]').length===2,{timeout:30000});
  await page.locator('[data-modal-action="close"]').click();
  assert.equal(await page.locator('.audio-tile').first().locator('.tile-title').textContent(),'晚风来信');
  await page.locator('#select-all').check();await page.locator('[data-action="tools"]').first().click();
  await page.locator('[data-tool-field="genre"]').check();await page.locator('[data-tool-value="genre"]').fill('UI test');await page.locator('#tool-run').click();
  assert.equal(await page.locator('#count-draft').textContent(),'8');
  await page.locator('[data-action="clear"]').click();assert.equal(await page.locator('.audio-tile').count(),0);
  await page.locator('.toast-action').last().click();assert.equal(await page.locator('.audio-tile').count(),8);assert.equal(await page.locator('#count-draft').textContent(),'8');
  await page.locator('.audio-tile').nth(2).click();await page.locator('[data-preview-action="discard"]').click();
  await page.locator('[data-preview-action="match"]').click();await page.waitForSelector('#match-form');assert.equal(await page.locator('#modal-title').textContent(),'补全这首音频');
  await page.locator('[data-modal-action="cancel-search"]').click();await page.locator('#modal-close').click();
  await page.locator('[data-action="theme"]').click();await page.screenshot({path:path.join(root,'artifacts','02-library-dark.png')});
  await page.setViewportSize({width:1024,height:720});await page.screenshot({path:path.join(root,'artifacts','03-compact.png')});
  const overflow=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,view:innerWidth,card:document.querySelector('#preview-card').getBoundingClientRect().right}));assert.ok(overflow.doc<=overflow.view+1,JSON.stringify(overflow));assert.ok(overflow.card<=overflow.view+1,JSON.stringify(overflow));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,tiles:8,writeRestore:true,batchDrafts:true,clearUndo:true,singleMatch:true,themes:true,compact:true,data},null,2));
 }finally{await application.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

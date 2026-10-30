'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),executable=path.join(root,'release/Music Tools/Music Tools.exe');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'music-tools-release-'));
 const env={...process.env,MUSIC_TOOLS_DATA_DIR:data,PATH:'C:\\Windows\\System32;C:\\Windows'};
 for(const name of ['ELECTRON_RUN_AS_NODE','MUSIC_TOOLS_PYTHON','MUSIC_TOOLS_TEST_PYTHON','MUSIC_TOOLS_ELECTRON'])delete env[name];
 const application=await electron.launch({executablePath:executable,env,timeout:60000});
 const page=await application.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const invoke=(name,...args)=>page.evaluate(({name,args})=>window.music.invoke(name,...args),{name,args});
 try{
  const runtime=await application.evaluate(({app})=>({packaged:app.isPackaged,execPath:process.execPath,appPath:app.getAppPath()}));assert.equal(runtime.packaged,true);assert.equal(runtime.execPath,executable);
  const icon=await application.evaluate(async({app})=>(await app.getFileIcon(process.execPath,{size:'large'})).toPNG().toString('base64'));
  fs.writeFileSync(path.join(root,'artifacts/06-executable-icon.png'),Buffer.from(icon,'base64'));
  await page.locator('[data-action="demo"]').click();await expect(page.locator('.audio-tile')).toHaveCount(8);await expect(page.locator('#preview-card')).toBeVisible();
  const records=(await invoke('demo')).files;assert.equal(records.length,8);assert.ok(records.every(f=>f.duration>0&&f.stamp.sha256));
  await page.screenshot({path:path.join(root,'artifacts/04-portable-release.png')});
  // Real music-local protocol playback, with no Node.js/Python on PATH.
  await page.locator('[data-preview-action="play"]').click();await page.waitForFunction(()=>document.querySelector('#player').currentTime>0.1);await page.locator('[data-preview-action="play"]').click();
  const file=records[0];await page.locator('[data-tag="title"]').fill('便携包实际写入验证');await page.locator('[data-tag="title"]').dispatchEvent('change');await page.locator('[data-preview-action="save"]').click();await page.waitForFunction(()=>document.querySelector('#operation-status').textContent.includes('已写入 1 首'));
  const history=await invoke('history');assert.equal(history.length,1);const after=(await invoke('refresh',[file.path])).files[0];assert.equal(after.tags.title,'便携包实际写入验证');assert.notEqual(after.stamp.sha256,file.stamp.sha256);
  const restored=await invoke('restore',history[0].id);assert.equal(restored.record.stamp.sha256,file.stamp.sha256);
  // Validate translation layout through the shipped tool controls.
  await invoke('refresh',[file.path]);await page.locator('[data-action="refresh"]').click();await expect(page.locator('[data-tag="title"]')).toHaveValue('晚风来信');
  await page.locator('[data-action="tools"]').first().click();await page.locator('[data-tool-tab="lyrics"]').click();await page.locator('#modal-body details summary').click();
  await page.locator('#translated-lyrics').fill('[00:00.00]Original synthetic demo\n[00:02.00]For metadata editing');await page.locator('#lyrics-layout').selectOption('inline');await page.locator('#tool-run').click();
  await page.locator('[data-tab="lyrics"]').click();const lyrics=await page.locator('[data-tag="lyrics"]').inputValue();assert.match(lyrics,/Original synthetic demo/);assert.match(lyrics,/这是原创合成演示音频/);
  const trans=await invoke('text-tools','chinese',[{path:file.path,tags:{title:'音乐与头发'}}],{from:'cn',to:'tw',fields:['title']});assert.equal(trans[0].tags.title,'音樂與頭髮');
  assert.deepEqual(errors,[]);
  const result={passed:true,version:require('../package.json').version,runtime,restrictedPath:true,embeddedPython:true,coverRead:true,localPlayback:true,realWriteAndByteExactRestore:true,translationLayoutControls:true,offlineChinese:true,rendererErrors:errors,data};
  fs.writeFileSync(path.join(root,'artifacts/release-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await application.close();}
 // Fresh default portable data path check, with no testing override.
 delete env.MUSIC_TOOLS_DATA_DIR;const clean=await electron.launch({executablePath:executable,env,timeout:60000});
 try{const cleanPage=await clean.firstWindow();const info=await cleanPage.evaluate(()=>window.music.invoke('get-info'));assert.equal(info.dataDir,path.join(path.dirname(executable),'data'));console.log('Default portable data folder verified: '+info.dataDir);}finally{await clean.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

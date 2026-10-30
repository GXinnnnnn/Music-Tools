'use strict';
const {_electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const env={...process.env,MUSIC_TOOLS_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'music-batch-ui-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],env});const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.locator('[data-action="demo"]').click();await expect(page.locator('.audio-tile')).toHaveCount(8);
  await page.locator('[data-tag="title"]').fill('用户保留的标题草稿');
  await page.locator('[data-tag="title"]').dispatchEvent('change');
  await app.evaluate(({app},root)=>{
   const req=process.getBuiltinModule('module').createRequire(root+'/package.json');const p=req(root+'/source/core/providers.cjs');
   p.search=async(query,options)=>({candidates:['A','B'].map(id=>({id,source:'itunes',title:options.local.title,artist:options.local.artist,album:'候选专辑'+id,year:2025,duration:options.local.duration,score:99,coverUrl:''})),errors:[{source:'itunes',message:'可见的搜索来源提示'}]});
   p.enrich=async(candidate,options)=>({...candidate,composer:'作曲-'+candidate.id,errors:[{source:'lrclib',message:'可见的歌词获取提示'}]});
  },root);
  await page.locator('#select-all').check();await page.locator('[data-preview-action="match"]').click();await page.locator('#start-batch').click();await expect(page.locator('[data-batch-row]')).toHaveCount(8);
  await page.locator('#batch-unselect').click();await expect(page.locator('#apply-batch')).toBeDisabled();
  await page.locator('[data-batch-choice="0"]').selectOption('1');await expect(page.locator('[data-batch-check="0"]')).not.toBeChecked();await page.locator('[data-batch-check="0"]').check();
  await expect(page.locator('#apply-batch')).toBeEnabled();await page.locator('#apply-batch').click();
  await page.waitForFunction(()=>document.querySelector('#batch-progress').textContent.includes('本次 1 首'),null,{timeout:30000});
  const state=await page.evaluate(()=>({drafts,paths:files.map(f=>f.path),items:batchSession.items,localTitle:tags(files[0].path).title}));
  assert.equal(state.localTitle,'用户保留的标题草稿');assert.equal(state.drafts[state.paths[0]].tags.composer,'作曲-B');assert.equal(Object.keys(state.drafts).length,1);assert.ok(state.items[0].staged);assert.ok(!state.items[1].staged);assert.ok(state.items[0].errors.some(e=>e.message==='可见的歌词获取提示'));
  await page.locator('#batch-filter').selectOption('staged');await expect(page.locator('[data-batch-row]:visible')).toHaveCount(1);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,'artifacts/07-batch-review.png')});
  console.log(JSON.stringify({passed:true,manuallySelectedCandidate2:true,uncheckedFilesUntouched:true,existingDraftPreserved:true,fillOnly:true,sourceWarningsVisible:true,filter:true,errors},null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

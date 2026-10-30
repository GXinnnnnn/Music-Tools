'use strict';
const {_electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'music-tools-policy-'));
 const env={...process.env,MUSIC_TOOLS_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.MUSIC_TOOLS_EXECUTABLE;
 const app=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:[root],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=(name,...args)=>page.evaluate(({name,args})=>window.music.invoke(name,...args),{name,args});
 try{
  await page.locator('[data-action="demo"]').click();await expect(page.locator('.audio-tile')).toHaveCount(8);
  const before=(await api('refresh',await page.locator('.audio-tile').evaluateAll(els=>els.map(el=>el.dataset.path)))).files;
  assert.deepEqual(await page.evaluate(()=>settings.sources),['qq','netease']);
  // Only disposable demo copies are used. Mocks exercise IPC and real audio writes without network instability.
  await app.evaluate((_electron,root)=>{
   root=_electron.app.getAppPath();
   const req=process.getBuiltinModule('module').createRequire(root+'/package.json');
   const p=req(root+'/source/core/providers.cjs'),d=req(root+'/source/core/downloads.cjs');
   globalThis.policyCalls={search:[],enrich:[],images:0};
   globalThis.policyOriginalSearch=p.search;
   const image=_electron.nativeImage.createFromPath(root+'/source/ui/assets/icon.png').toDataURL();
   p.search=async(query,options)=>{globalThis.policyCalls.search.push({query,fields:options.fields,local:options.local,sources:options.sources});return {candidates:[{id:'qq:policy',source:'qq',title:'候选标题',artist:'联网作者',album:'联网专辑',duration:options.local.duration,coverUrl:'https://artwork.invalid/shared.jpg',score:99}],errors:[]};};
   p.enrich=async(c,options)=>{globalThis.policyCalls.enrich.push({fields:options.fields});return {...c,year:'2040',lyrics:'不应写入的歌词',comment:'不应写入的注释',errors:[]};};
   d.downloadCover=async()=>{globalThis.policyCalls.images++;return image;};
  },root);
  await page.locator('#select-all').check();await page.locator('[data-preview-action="match"]').click();
  assert.deepEqual(await page.locator('[data-source]:checked').evaluateAll(els=>els.map(el=>el.dataset.source)),['qq','netease']);
  await expect(page.locator('[data-source]')).toHaveCount(6);
  await page.locator('[data-policy-preset="album"]').click();await page.locator('[data-policy-all-overwrite]').check();
  await page.screenshot({path:path.join(root,'artifacts/09-platform-field-policy.png')});
  await page.locator('#start-batch').click();await expect(page.locator('[data-batch-row]')).toHaveCount(8);
  await page.locator('#batch-select-all').click();await page.locator('#apply-batch').click();
  await page.waitForFunction(()=>document.querySelector('#batch-progress').textContent.includes('本次 8 首'));
  const state=await page.evaluate(()=>({drafts,files}));assert.equal(Object.keys(state.drafts).length,8);
  for(const record of before){const draft=state.drafts[record.path];assert.deepEqual(Object.keys(draft.tags).sort(),['album','artist']);assert.equal(draft.tags.artist,'联网作者');assert.equal(draft.tags.album,'联网专辑');assert.match(draft.cover,/^data:image/);}
  const calls=await app.evaluate(()=>globalThis.policyCalls);assert.equal(calls.images,1,'same cover URL downloaded once per batch');
  for(const call of calls.search){assert.deepEqual(call.fields,['cover','artist','album']);assert.equal(call.local.title,undefined);assert.equal(call.local.year,undefined);assert.equal(call.local.lyrics,undefined);assert.equal(call.local.comment,undefined);assert.deepEqual(call.sources,['qq','netease']);}
  await page.locator('#modal-close').click();await page.locator('[data-action="save-all"]').click();
  await page.waitForFunction(()=>document.querySelector('#operation-status').textContent.includes('已写入 8 首'),null,{timeout:60000});
  const after=(await api('refresh',before.map(f=>f.path))).files;
  for(const record of before){const actual=after.find(f=>f.path===record.path);assert.equal(actual.tags.artist,'联网作者');assert.equal(actual.tags.album,'联网专辑');assert.notEqual(actual.cover,record.cover);for(const [key,value]of Object.entries(record.tags)){if(!['artist','album'].includes(key))assert.deepEqual(actual.tags[key],value,key+' must remain unchanged');}}
  // Fill-only must skip fully populated records without even querying a provider.
  await page.locator('[data-preview-action="match"]').click();await page.locator('[data-policy-all-overwrite]').uncheck();await page.locator('#start-batch').click();await expect(page.locator('[data-batch-row]')).toHaveCount(8);
  assert.equal((await app.evaluate(()=>globalThis.policyCalls.search.length)),8);await page.locator('#modal-close').click();
  // Explicitly clearing every field blocks network activity.
  await page.locator('[data-preview-action="match"]').click();await page.locator('[data-policy-preset="none"]').click();await page.locator('#start-batch').click();await expect(page.locator('#batch-progress')).toContainText('未发送联网请求');assert.equal(await app.evaluate(()=>globalThis.policyCalls.search.length),8);
  await page.locator('#modal-close').click();await page.locator('.audio-tile').first().click();
  // Existing automatically generated keywords are rebuilt when an unchecked field changes eligibility.
  await page.evaluate(()=>{settings.fields=['title','artist'];settings.overwriteFields=['title','artist'];persistSettings();});
  await page.locator('[data-preview-action="match"]').click();await expect(page.locator('#match-results .match-item')).toHaveCount(1);
  await page.locator('[data-policy-field="artist"]').uncheck();assert.ok(!(await page.locator('#match-query').inputValue()).includes('联网作者'));
  await page.locator('#match-query').fill('用户自定义检索');await page.locator('[data-policy-field="artist"]').check();await expect(page.locator('#match-query')).toHaveValue('用户自定义检索');
  await page.locator('#modal-close').click();
  // Exercise the real adapter, not the mocked search, so browser image loads are gated too.
  let previewCoverRequests=0;await page.route('https://image.invalid/**',route=>{previewCoverRequests++;return route.abort();});
  await app.evaluate((_electron)=>{
   const req=process.getBuiltinModule('module').createRequire(_electron.app.getAppPath()+'/package.json');
   req('./source/core/providers.cjs').search=(query,options)=>globalThis.policyOriginalSearch(query,{...options,sources:['itunes'],throttleMs:0,fetch:async()=>new Response(JSON.stringify({results:[{trackId:1,trackName:'Song',artistName:'Artist',collectionName:'Album',artworkUrl100:'https://image.invalid/100x100bb.jpg'}]}),{status:200,headers:{'content-type':'application/json'}})});
  });
  await page.evaluate(()=>{settings.fields=['artist'];settings.overwriteFields=['artist'];persistSettings();});
  await page.locator('[data-preview-action="match"]').click();await expect(page.locator('#match-results .match-item')).toHaveCount(1);await expect(page.locator('#match-results .match-item img')).toHaveCount(0);assert.equal(previewCoverRequests,0);
  assert.deepEqual(errors,[]);
  const result={passed:true,version:require('../package.json').version,executable:packaged||'development Electron',data,checks:['QQ and NetEase defaults; six platform controls','cover+artist+album-only overwrite staged and written to eight real audio copies','every other existing metadata field unchanged','one cover download per batch URL','unchecked metadata excluded from search conditions','fill-only completed rows skipped without requests','empty field selection makes no requests','single-track auto query refresh preserves explicit manual query','real provider candidate preview makes zero image requests when cover is unchecked'],rendererErrors:errors};
  fs.writeFileSync(path.join(root,'artifacts/ui-policy-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(e){await page.screenshot({path:path.join(root,'artifacts/ui-policy-failure.png')}).catch(()=>{});throw e;}
 finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

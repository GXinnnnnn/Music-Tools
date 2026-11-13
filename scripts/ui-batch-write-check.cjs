'use strict';
const {_electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'music-batch-write-'));
 const env={...process.env,MUSIC_TOOLS_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.MUSIC_TOOLS_EXECUTABLE;
 const app=await _electron.launch({executablePath:executable||require('electron'),args:executable?[]:[root],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const api=(name,...args)=>page.evaluate(({name,args})=>window.music.invoke(name,...args),{name,args});
 const idle=()=>page.waitForFunction(()=>!backgroundTask&&!busy,null,{timeout:60000});
 const open=async()=>{await page.locator('[data-preview-action="match"]').click();await page.locator('#start-batch').click();await expect(page.locator('[data-batch-row]')).toHaveCount(8);await idle();};
 const choose=async indexes=>{await page.locator('#batch-unselect').click();for(const i of indexes)await page.locator(`[data-batch-check="${i}"]`).check();};
 try{
  await page.locator('[data-action="demo"]').click();await expect(page.locator('.audio-tile')).toHaveCount(8);
  const paths=await page.evaluate(()=>files.map(f=>f.path)),before=(await api('refresh',paths)).files,beforeHashes=paths.map(hash);
  await page.evaluate(()=>{settings.fields=['cover','artist','album','year'];settings.overwriteFields=[...settings.fields];persistSettings();});
  await app.evaluate(({app,nativeImage},paths)=>{
   const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
   const p=req('./source/core/providers.cjs'),audio=req('./source/core/audio.cjs'),downloads=req('./source/core/downloads.cjs');
   const image=nativeImage.createFromPath(app.getAppPath()+'/source/ui/assets/icon.png').toDataURL();
   globalThis.batchWriteTest={enrich:[],writes:[],failStage:true,failWrite:true,empty:true,gate:false};
   p.search=async(query,options)=>({candidates:['A','B'].map(id=>({id,source:'qq',title:options.local.title||'匹配歌曲',artist:options.local.artist||'匹配作者',album:'待审核专辑'+id,duration:options.local.duration,coverUrl:'https://art.invalid/album.png',score:99})),errors:[]});
   p.enrich=async(candidate,options)=>{
    const state=globalThis.batchWriteTest;state.enrich.push(options.local.filename);
    if(state.gate)return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('test canceled')),{once:true});});
    if(state.failStage&&options.local.filename===req('node:path').basename(paths[2]))throw Error('测试：来源暂时不可用');
    if(state.empty&&options.local.filename===req('node:path').basename(paths[3]))return {errors:[]};
    return {...candidate,artist:'审核作者'+candidate.id,album:'审核专辑'+candidate.id,year:'',errors:[]};
   };
   downloads.downloadCover=async()=>{if(globalThis.batchWriteTest.failCover)throw Error('测试：封面下载失败');return image;};
   const write=audio.writeBatch;
   audio.writeBatch=async(jobs,options)=>{
    const state=globalThis.batchWriteTest;state.writes.push(jobs.map(j=>j.path));
    if(state.holdWrite)await new Promise(resolve=>{state.releaseWrite=resolve;});
    const failed=state.failWrite?jobs.filter(j=>j.path===paths[1]):[];
    const result=await write(jobs.filter(j=>!failed.includes(j)),options);
    return {...result,errors:[...result.errors,...failed.map(j=>({path:j.path,message:'测试：文件暂时被占用'}))]};
   };
  },paths);
  // A selected file's existing manual edit is included; an unrelated unchecked draft stays untouched.
  await page.evaluate(paths=>{patch([paths[0]],{comment:'选中音频的手动草稿'});patch([paths[7]],{comment:'未勾选音频的独立草稿'});},paths);
  await page.locator('#select-all').check();await open();
  await page.locator('#batch-unselect').click();await expect(page.locator('#write-batch')).toBeDisabled();await expect(page.locator('#apply-batch')).toBeDisabled();
  await page.locator('[data-batch-choice="0"]').selectOption('1');await expect(page.locator('[data-batch-check="0"]')).not.toBeChecked();
  await choose([0,1,2,3]);await expect(page.locator('#write-batch')).toHaveText('审核并覆盖 4 首');
  await page.screenshot({path:path.join(root,'artifacts/batch-write-ready.png')});
  await page.locator('#write-batch').click();await idle();
  await expect(page.locator('#batch-progress')).toContainText('本次已写入 1 首');
  await expect(page.locator('[data-batch-row="0"]')).toHaveAttribute('data-state','written');
  await expect(page.locator('[data-batch-row="1"]')).toHaveAttribute('data-state','error');
  await expect(page.locator('[data-batch-row="2"]')).toHaveAttribute('data-state','error');
  await expect(page.locator('[data-batch-row="3"]')).toHaveAttribute('data-state','unchanged');
  let actual=(await api('refresh',paths)).files;
  assert.equal(actual[0].tags.artist,'审核作者B');assert.equal(actual[0].tags.album,'审核专辑B');assert.equal(actual[0].tags.comment,'选中音频的手动草稿');assert.equal(actual[0].tags.year,before[0].tags.year);
  for(let i=1;i<8;i++)assert.equal(hash(paths[i]),beforeHashes[i],'unchecked, failed and empty-result audio bytes unchanged: '+i);
  let state=await page.evaluate(()=>({drafts,items:batchSession.items}));assert.ok(state.drafts[paths[1]]);assert.ok(state.drafts[paths[7]]);assert.ok(!state.drafts[paths[2]]);
  checks.push('one click enriches, reviews and writes selected candidate B; unselected audio is byte-identical','partial provider/write failures remain distinct; failed writes retain retryable drafts','empty provider result skips writing; missing remote year preserves the existing year','selected manual draft is preserved in the write; unrelated draft is not written');
  // Retry an existing staged write without fetching again; failed lookups are re-fetched.
  const countBefore=await app.evaluate(()=>globalThis.batchWriteTest.enrich.length);
  await app.evaluate(()=>{globalThis.batchWriteTest.failWrite=false;globalThis.batchWriteTest.failStage=false;});
  await choose([1,2]);await page.locator('#write-batch').click();await idle();
  assert.equal(await app.evaluate(()=>globalThis.batchWriteTest.enrich.length),countBefore+1);
  await expect(page.locator('#batch-progress')).toContainText('本次已写入 2 首');
  actual=(await api('refresh',paths)).files;for(const i of [1,2])assert.equal(actual[i].tags.album,'审核专辑A');
  checks.push('one-click retry writes saved failed draft and refetches only the failed lookup');
  await page.locator('#batch-filter').selectOption('written');await expect(page.locator('[data-batch-row]:visible')).toHaveCount(3);
  await page.setViewportSize({width:1000,height:740});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:path.join(root,'artifacts/batch-write-result-dark.png')});
  const bounds=await page.locator('#write-batch').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1000&&bounds.y+bounds.height<=740);
  checks.push('written filter and footer remain reachable in the narrow dark theme');
  // Backups are produced by the existing write path, and restore exact original bytes.
  const history=await api('history');assert.equal(history.length,3);
  const backup=history.find(h=>(h.originalPath||h.path)===paths[0]);assert.ok(backup);await api('restore',backup.id);assert.equal(hash(paths[0]),beforeHashes[0]);
  checks.push('existing automatic backup and byte-exact restoration work with the combined operation');
  await page.locator('#modal-close').click();await open();
  // Stop while fetching must not silently continue with writes.
  await choose([4,5]);await app.evaluate(()=>{globalThis.batchWriteTest.gate=true;});
  const writesBefore=await app.evaluate(()=>globalThis.batchWriteTest.writes.length);
  await page.locator('#write-batch').click();await expect(page.locator('#stop-stage')).toBeVisible();await page.locator('#stop-stage').click();await idle();
  assert.equal(await app.evaluate(()=>globalThis.batchWriteTest.writes.length),writesBefore);for(const i of [4,5])assert.equal(hash(paths[i]),beforeHashes[i]);
  await expect(page.locator('#batch-progress')).toContainText('未自动写入');checks.push('cancel during enrichment prevents automatic writes');
  await app.evaluate(()=>{globalThis.batchWriteTest.gate=false;globalThis.batchWriteTest.empty=false;});
  // A previously staged result becomes stale after the user discards or edits the draft.
  await choose([4]);await page.locator('#apply-batch').click();await idle();assert.equal(hash(paths[4]),beforeHashes[4]);
  await page.locator('#modal-close').click();await page.evaluate(p=>{delete drafts[p];patch([p],{album:'后来另改的草稿'});showBatchResults();},paths[4]);
  await choose([4]);await page.locator('#write-batch').click();await idle();
  actual=(await api('refresh',paths)).files;assert.equal(actual[4].tags.album,'审核专辑A');checks.push('secondary draft mode still works; a changed/discarded staged draft is revalidated before writing');
  // Hold the actual write to exercise close/reopen and duplicate-click protection.
  await choose([5]);await app.evaluate(()=>{globalThis.batchWriteTest.holdWrite=true;});
  await page.locator('#write-batch').click();await page.waitForFunction(()=>batchSession.pending==='write');
  await page.evaluate(()=>stageBatch(true));await expect(page.locator('#background-task-stop')).toBeDisabled();
  await page.locator('[data-modal-action="background-task"]').click();await expect(page.locator('[data-tag="title"]')).toBeDisabled();await expect(page.locator('[data-action="tools"]').first()).toBeDisabled();await expect(page.locator('[data-preview-action="cover"]')).toBeDisabled();
  await page.locator('#background-task-view').click();await expect(page.locator('#batch-toolbar')).toBeHidden();await expect(page.locator('[data-modal-action="cancel-search"]')).toHaveCount(0);
  await app.evaluate(()=>{globalThis.batchWriteTest.holdWrite=false;globalThis.batchWriteTest.releaseWrite();});await idle();
  actual=(await api('refresh',paths)).files;assert.equal(actual[5].tags.album,'审核专辑A');
  const finalCalls=await app.evaluate(()=>globalThis.batchWriteTest.writes);assert.equal(finalCalls.filter(j=>j.includes(paths[5])).length,1);
  checks.push('write phase blocks edits, survives background/reopen and rejects duplicate submissions');
  for(const i of [6,7])assert.equal(hash(paths[i]),beforeHashes[i]);assert.ok((await page.evaluate(()=>drafts))[paths[7]]);
  await page.locator('#modal-close').click();
  await page.evaluate(()=>{settings.fields=['cover'];settings.overwriteFields=['cover'];persistSettings();});
  await app.evaluate(()=>{globalThis.batchWriteTest.failCover=true;});await open();await choose([6]);
  const writesBeforeCover=await app.evaluate(()=>globalThis.batchWriteTest.writes.length);
  await page.locator('#write-batch').click();await idle();
  await expect(page.locator('[data-batch-row="6"]')).toHaveAttribute('data-state','error');
  await expect(page.locator('[data-batch-check="6"]')).toBeEnabled();
  assert.equal(hash(paths[6]),beforeHashes[6]);assert.equal(await app.evaluate(()=>globalThis.batchWriteTest.writes.length),writesBeforeCover);
  await app.evaluate(()=>{globalThis.batchWriteTest.failCover=false;});await page.locator('#write-batch').click();await idle();
  await expect(page.locator('[data-batch-row="6"]')).toHaveAttribute('data-state','written');
  checks.push('cover-only download failure is retryable rather than being called unchanged; retry writes the cover');
  await page.locator('#modal-close').click();await page.evaluate(()=>{settings.fields=['artist','cover'];settings.overwriteFields=[...settings.fields];persistSettings();});
  await app.evaluate(()=>{globalThis.batchWriteTest.failCover=true;});await open();await choose([7]);
  await page.locator('#write-batch').click();await idle();assert.equal(hash(paths[7]),beforeHashes[7]);
  await expect(page.locator('[data-batch-row="7"]')).toHaveAttribute('data-state','error');
  assert.equal((await page.evaluate(()=>drafts))[paths[7]].tags.artist,'审核作者A');
  await expect(page.locator('[data-batch-choice="7"]')).toBeDisabled();await expect(page.locator('[data-batch-retry="7"]')).toBeDisabled();
  await app.evaluate(()=>{globalThis.batchWriteTest.failCover=false;});await page.locator('#write-batch').click();await idle();
  actual=(await api('refresh',paths)).files;assert.equal(actual[7].tags.artist,'审核作者A');assert.equal(actual[7].tags.comment,'未勾选音频的独立草稿');
  checks.push('partial enrichment keeps the draft and error until all requested data is fetched, then succeeds in one retry');
  assert.deepEqual(errors,[]);
  const result={passed:true,version:require('../package.json').version,executable:executable||'development Electron',checks,rendererErrors:errors};
  fs.writeFileSync(path.join(root,executable?'artifacts/ui-batch-write-portable.json':'artifacts/ui-batch-write-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(error){await page.screenshot({path:path.join(root,'artifacts/batch-write-failure.png')}).catch(()=>{});throw error;}
 finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

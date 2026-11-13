'use strict';
const {_electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'music-batch-stream-')),env={...process.env,MUSIC_TOOLS_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.MUSIC_TOOLS_EXECUTABLE,app=await _electron.launch({executablePath:executable||require('electron'),args:executable?[]:[root],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const api=(name,...args)=>page.evaluate(({name,args})=>window.music.invoke(name,...args),{name,args});
 const idle=()=>page.waitForFunction(()=>!backgroundTask&&!busy,null,{timeout:60000});
 const release=async(index,fail=false)=>{
   try{await expect.poll(()=>app.evaluate((_,i)=>globalThis.streamTest.waiters.has(i),index)).toBe(true);}catch(error){console.error(await app.evaluate(()=>globalThis.streamTest.calls));throw error;}
   await app.evaluate((_,{index,fail})=>{const w=globalThis.streamTest.waiters.get(index);globalThis.streamTest.waiters.delete(index);fail?w.reject(Error('测试：来源不可用')):w.resolve();},{index,fail});
 };
 try{
  await page.locator('[data-action="demo"]').click();await expect(page.locator('.audio-tile')).toHaveCount(8);
  const paths=await page.evaluate(()=>files.map(f=>f.path)),before=paths.map(hash);
  await page.evaluate(()=>{settings.fields=['title','artist','album','year'];settings.overwriteFields=[...settings.fields];persistSettings();});
  await app.evaluate(({app},paths)=>{
   const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),p=req('./source/core/providers.cjs'),audio=req('./source/core/audio.cjs');
   const state=globalThis.streamTest={waiters:new Map(),calls:[],scans:0,writes:[]};
   p.search=async(query,options)=>{
    const index=paths.findIndex(p=>req('node:path').basename(p)===options.local.filename);state.calls.push(index);
    await new Promise((resolve,reject)=>{state.waiters.set(index,{resolve,reject});options.signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true});});
    return {candidates:['A','B'].map(id=>({id,source:'qq',title:options.local.title,artist:options.local.artist,album:'流式候选'+id,duration:options.local.duration,score:99})),errors:[]};
   };
   p.enrich=async c=>({...c,album:'流式已写入'+c.id,errors:[]});
   const scan=audio.scan;audio.scan=async(...args)=>{state.scans++;return scan(...args);};
   const write=audio.writeBatch;audio.writeBatch=async(...args)=>{state.writes.push(args[0].map(j=>j.path));return write(...args);};
  },paths);
  await page.locator('#select-all').check();await page.locator('[data-preview-action="match"]').click();await page.locator('#start-batch').click();
  await expect.poll(()=>app.evaluate(()=>globalThis.streamTest.calls.length)).toBe(6);
  await release(2);await expect(page.locator('[data-batch-row]')).toHaveCount(1);
  assert.equal(await page.evaluate(()=>batchSession.pending),'match');await expect(page.locator('#write-batch')).toBeDisabled();
  await expect(page.locator('[data-batch-retry="2"]')).toBeDisabled();await expect(page.locator('[data-batch-query="2"]')).toBeDisabled();
  await page.locator('[data-batch-choice="2"]').selectOption('1');await page.locator('[data-batch-check="2"]').check();
  await page.locator('[data-batch-row="2"] summary').click();
  await page.evaluate(()=>{window.keptStreamRow=document.querySelector('[data-batch-row="2"]');document.querySelector('#modal-body').scrollTop=90;});
  const scroll=await page.locator('#modal-body').evaluate(e=>e.scrollTop);
  await app.evaluate(({BrowserWindow},p)=>BrowserWindow.getAllWindows()[0].webContents.send('task-progress',{kind:'match',operationId:'stale-test-id',done:8,total:8,result:{path:p,candidates:[]}}),paths[0]);
  await release(0);await expect(page.locator('[data-batch-row]')).toHaveCount(2);
  assert.deepEqual(await page.locator('[data-batch-row]').evaluateAll(rows=>rows.map(r=>Number(r.dataset.batchRow))),[2,0]);
  assert.ok(await page.evaluate(()=>window.keptStreamRow===document.querySelector('[data-batch-row="2"]')));
  assert.equal(await page.locator('#modal-body').evaluate(e=>e.scrollTop),scroll);
  await expect(page.locator('[data-batch-row="2"] details')).toHaveAttribute('open','');await expect(page.locator('[data-batch-choice="2"]')).toHaveValue('1');await expect(page.locator('[data-batch-check="2"]')).toBeChecked();
  checks.push('first completed recording appears before the batch finishes; six lookups overlap','results append in completion order without replacing reviewed rows, expanded details, scroll, candidate or checks','stale operation events are ignored; retries cannot abort the running batch');
  await page.locator('#batch-select-all').click();await page.locator('[data-batch-check="2"]').uncheck();
  await release(4);await expect(page.locator('[data-batch-check="4"]')).toBeChecked();await expect(page.locator('[data-batch-check="2"]')).not.toBeChecked();
  await page.locator('#batch-unselect').click();await release(1);await expect(page.locator('[data-batch-check="1"]')).not.toBeChecked();
  await page.locator('[data-batch-check="2"]').check();
  checks.push('select all includes subsequent arrivals while individual exclusions persist; unselect also applies to subsequent arrivals');
  await page.screenshot({path:path.join(root,'artifacts/batch-stream-searching.png')});
  await page.locator('[data-modal-action="background-task"]').click();await page.locator('#background-task-view').click();
  await expect(page.locator('[data-batch-check="2"]')).toBeChecked();await expect(page.locator('[data-batch-choice="2"]')).toHaveValue('1');await expect(page.locator('#batch-toolbar')).toBeVisible();
  await page.locator('[data-batch-row="2"] summary').click();await page.evaluate(()=>window.keptStreamRow=document.querySelector('[data-batch-row="2"]'));
  await release(3,true);await release(5);await release(6);await release(7);await idle();
  await expect(page.locator('[data-batch-row]')).toHaveCount(8);await expect(page.locator('[data-batch-row="3"]')).toHaveAttribute('data-state','error');
  await expect(page.locator('[data-batch-check="2"]')).toBeChecked();await expect(page.locator('[data-batch-choice="2"]')).toHaveValue('1');
  assert.ok(await page.evaluate(()=>window.keptStreamRow===document.querySelector('[data-batch-row="2"]')));
  await expect(page.locator('[data-batch-row="2"] details')).toHaveAttribute('open','');await expect(page.locator('#write-batch')).toBeEnabled();
  checks.push('background/reopen keeps streamed results and choices; final response does not reset manual review; row failures stay distinct');
  await page.setViewportSize({width:1000,height:740});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:path.join(root,'artifacts/batch-stream-ready-dark.png')});
  const bounds=await page.locator('#write-batch').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1000&&bounds.y+bounds.height<=740);
  const scanCount=await app.evaluate(()=>globalThis.streamTest.scans);
  await page.locator('#write-batch').click();await idle();
  const after=await page.evaluate(()=>files.map(f=>({path:f.path,tags:f.tags})));
  assert.equal(after[2].tags.album,'流式已写入B');for(let i=0;i<8;i++)if(i!==2)assert.equal(hash(paths[i]),before[i]);
  assert.equal(await app.evaluate(()=>globalThis.streamTest.scans),scanCount);
  const calls=await app.evaluate(()=>globalThis.streamTest.writes);assert.deepEqual(calls,[[paths[2]]]);
  const history=await api('history');await api('restore',history.find(h=>(h.path||h.originalPath)===paths[2]).id);assert.equal(hash(paths[2]),before[2]);
  checks.push('direct real write uses manually selected B; unchecked recordings are byte-identical','fresh written records update the UI without re-reading the entire queue; backup restores exact original bytes','footer remains reachable in narrow dark theme');
  // A second run is stopped with only one result; arrived choices survive, unscheduled rows are retryable.
  await page.locator('#modal-close').click();await page.locator('[data-preview-action="match"]').click();await page.locator('#start-batch').click();
  await release(0);await expect(page.locator('[data-batch-row]')).toHaveCount(1);await page.locator('[data-batch-check="0"]').check();
  await page.locator('[data-modal-action="cancel-search"]').click();await idle();
  await expect(page.locator('[data-batch-row]')).toHaveCount(8);await expect(page.locator('[data-batch-check="0"]')).toBeChecked();
  await expect(page.locator('[data-batch-retry="1"]')).toBeEnabled();assert.ok(await page.evaluate(()=>batchSession.canceled));
  checks.push('stopping search retains completed selections and enables retry for unsearched recordings without writing');
  await page.locator('#modal-close').click();
  await page.evaluate(p=>{selected=new Set([p]);removeQueue(false);showBatchResults();},paths[1]);
  await expect(page.locator('[data-batch-row]')).toHaveCount(7);await expect(page.locator('[data-batch-row="7"]')).toHaveCount(0);
  await expect(page.locator('[data-batch-check="0"]')).toBeChecked();
  await expect(page.locator('[data-batch-row="1"] strong')).toHaveText(path.basename(paths[2]));
  await page.locator('#modal-close').click();await page.evaluate(()=>removeQueue(true));
  assert.equal(await page.evaluate(()=>batchSession),null);
  checks.push('removing a queued recording remaps retained completion order and choices; clearing the queue clears retained results');
  assert.deepEqual(errors,[]);const result={passed:true,version:require('../package.json').version,executable:executable||'development Electron',checks,rendererErrors:errors};
  fs.writeFileSync(path.join(root,executable?'artifacts/ui-batch-stream-portable.json':'artifacts/ui-batch-stream-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(error){await page.screenshot({path:path.join(root,'artifacts/batch-stream-failure.png')}).catch(()=>{});throw error;}
 finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

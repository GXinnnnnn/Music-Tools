'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../source/main.cjs'),'utf8');
function harness(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-policy-main-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const handlers=new Map(),calls=[],downloads=[];
 const records=[1,2,3,4].map(i=>({path:path.join(dir,`Recording${i}-Composer.mp3`),filename:`Recording${i}-Composer.mp3`,duration:120,tags:{title:'PRIVATE_TITLE',artist:'Existing artist',album:'Existing album',lyrics:'PRIVATE_LYRICS'},cover:'old-cover'}));
 const electron={app:{isPackaged:false,setPath(){},getPath:()=>dir,requestSingleInstanceLock:()=>false,quit(){},getVersion:()=> 'test'},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},protocol:{registerSchemesAsPrivileged(){}},nativeImage:{createFromDataURL:()=>({isEmpty:()=>false})}};
 const provider={lookupQuery:local=>local.filename,search:async(q,opt)=>{calls.push({kind:'search',q,opt});return {candidates:[{title:'Remote title',artist:'Remote artist',album:'Remote album',source:'qq',score:100}],errors:[]};},rankCandidates:(_l,c)=>c,isRecommendedCandidate:()=>true,enrich:async(c,opt)=>{calls.push({kind:'enrich',c,opt});return {...c,title:'Remote title',artist:'Remote artist',album:'Remote album',lyrics:'WRONG_LYRICS',year:'2026',coverUrl:'https://cover.invalid/a.jpg',errors:[]};}};
 const audio={setDataDir(){},scan:async()=>({files:records,errors:[]})};
 const load=name=>name==='electron'?electron:name==='./core/preferences.cjs'?require('../source/core/preferences.cjs'):name==='./core/audio.cjs'?audio:name==='./core/providers.cjs'?provider:name==='./core/sync-policy.cjs'?require('../source/core/sync-policy.cjs'):name==='./core/downloads.cjs'?{downloadCover:async(url)=>{downloads.push(url);return 'data:image/jpeg;base64,AA==';}}:require(name);
 vm.runInNewContext(source,{require:load,process:{...process,env:{...process.env,MUSIC_TOOLS_DATA_DIR:dir}},__dirname:path.join(__dirname,'../source'),AbortController,Buffer,URL,Response,console});
 const invoke=async(name,...args)=>{const r=await handlers.get(name)({},...args);if(!r.ok)throw new Error(r.error);return r.value;};
 return {invoke,records,calls,downloads};
}
test('main excludes unselected metadata and skips already complete fill-only rows',async t=>{
 const h=harness(t);await h.invoke('import-paths',[]);
 const selected={fields:['cover','artist','album'],overwriteFields:['cover']};
 const r=await h.invoke('batch-match',[{path:h.records[0].path,local:h.records[0]}],selected);
 assert.equal(r.results.length,1);assert.equal(h.calls.length,1);
 assert.deepEqual([...h.calls[0].opt.fields],['cover']);
 assert.equal(h.calls[0].opt.local.title,undefined);assert.equal(h.calls[0].opt.local.lyrics,undefined);
 assert.doesNotMatch(h.calls[0].q,/PRIVATE_/);
 await h.invoke('batch-match',[{path:h.records[0].path,local:h.records[0]}],{fields:['album'],overwriteFields:[]});
 assert.equal(h.calls.length,1,'filled album does not trigger another request');
 await h.invoke('batch-match',[{path:h.records[0].path,local:h.records[0]}],{fields:[]});
 assert.equal(h.calls.length,1,'empty selection does not search');
});
test('main enforces selected fields on candidate staging and uses one image per URL',async t=>{
 const h=harness(t);await h.invoke('import-paths',[]);
 const options={fields:['cover','artist','album'],overwriteFields:['cover','artist']};
 const r=await h.invoke('batch-stage',h.records.slice(0,2).map(local=>({path:local.path,local,candidate:{source:'qq',id:'1'}})),options);
 assert.equal(r.errors.length,0);assert.equal(r.results.length,2);
 for(const row of r.results){assert.deepEqual({...row.tags},{artist:'Remote artist'});assert.match(row.cover,/^data:image/);}
 assert.equal(h.downloads.length,1);assert.equal(h.calls.filter(c=>c.kind==='enrich').length,2);
 for(const c of h.calls)assert.deepEqual([...c.opt.fields],['cover','artist']);
});
test('main does not download unchecked covers or request unchecked lyrics',async t=>{
 const h=harness(t);await h.invoke('import-paths',[]);
 const r=await h.invoke('batch-stage',[{path:h.records[0].path,candidate:{source:'qq'}}],{fields:['artist'],overwriteFields:['artist']});
 assert.equal(h.downloads.length,0);assert.equal(r.results[0].cover,undefined);
 assert.deepEqual({...r.results[0].tags},{artist:'Remote artist'});assert.equal(h.calls[0].opt.lyrics,false);assert.equal(h.calls[0].opt.artwork,false);
});
test('unimported paths are rejected before any requests',async t=>{
 const h=harness(t);const r=await h.invoke('batch-stage',[{path:path.join(os.tmpdir(),'unimported.mp3'),candidate:{source:'qq'}}],{fields:['artist'],overwriteFields:['artist']});
 assert.equal(r.errors.length,1);assert.equal(h.calls.length,0);assert.equal(h.downloads.length,0);
});

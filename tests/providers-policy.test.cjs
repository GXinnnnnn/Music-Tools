'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../source/core/providers.cjs');
const response=data=>new Response(typeof data==='string'?data:JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const options=fetch=>({fetch,throttleMs:0,retries:0,timeoutMs:500});
const qqSong={songmid:'song01',songname:'A &amp; B',singer:[{name:'Singer'}],albumname:'Album',albummid:'album01',interval:200};

test('new defaults are QQ then NetEase, all six platforms are explicit opt-ins',async()=>{
 assert.deepEqual(p.DEFAULT_SOURCES,['qq','netease']);assert.deepEqual(p.SOURCE_NAMES,['qq','netease','itunes','kuwo','musicbrainz','vgmdb']);
 const hosts=[];await p.search('Song',options(async url=>{hosts.push(new URL(url).hostname);return response(url.includes('qq.com')?{code:0,data:{song:{list:[]}}}:{code:200,result:{songs:[],songCount:0}});}));
 assert.deepEqual(hosts.sort(),['c.y.qq.com','music.163.com']);
});
test('QQ maps recording fields and fetches native lyrics only when selected',async()=>{
 const urls=[];const opt=options(async url=>{urls.push(url);return response(url.includes('/lyric/')?{code:0,lyric:'[00:01.00]A &amp; B',trans:'[00:01.00]译文'}:{code:0,data:{song:{list:[qqSong]}}});});
 const result=await p.search('Singer A B',{...opt,sources:['qq'],fields:['artist','album','cover']});
 const c=result.candidates[0];assert.equal(c.title,'A & B');assert.equal(c.artist,'Singer');assert.equal(c.duration,200);assert.match(c.coverUrl,/album01/);
 const tags=await p.enrich(c,{...opt,fields:['artist','album','cover']});assert.equal(urls.length,1);assert.equal(tags.title,undefined);assert.equal(tags.lyrics,undefined);assert.equal(tags.artist,'Singer');
 const lyric=await p.enrich(c,{...opt,fields:['lyrics']});assert.equal(urls.length,2);assert.match(lyric.lyrics,/A & B/);assert.ok(lyric.translatedLyrics);assert.equal(lyric.coverUrl,undefined);
});
test('Kuwo parses safe single-quoted data without evaluating remote code',async()=>{
 const urls=[];const opt=options(async url=>{urls.push(url);if(url.includes('getlyric'))return response({code:200,data:{lrclist:[{time:'61.23',lineLyric:'Text'}]}});return response("{'abslist':[{'MUSICRID':'MUSIC_12','SONGNAME':'Song','ARTIST':'Artist','ALBUM':'Album','DURATION':'200','web_albumpic_short':'120/a.jpg'}]}");});
 const c=(await p.search('Song Artist',{...opt,sources:['kuwo'],fields:['artist','lyrics']})).candidates[0];assert.equal(c.id,'kuwo:12');assert.equal(c.coverUrl,'');
 const tags=await p.enrich(c,{...opt,fields:['lyrics']});assert.equal(tags.lyrics,'[01:01.23]Text');assert.equal(tags.artist,undefined);
 const bad=await p.search('Song',{...options(async()=>response("{'abslist':[]};globalThis.compromised=true")),sources:['kuwo']});assert.equal(bad.errors[0].code,'INVALID_RESPONSE');assert.equal(globalThis.compromised,undefined);
});
test('NetEase artist-only makes no detail, cover or lyric requests',async()=>{
 const calls=[];const opt=options(async url=>{calls.push(url);throw new Error('Unexpected detail request');});
 const tags=await p.enrich({id:'netease:1',source:'netease',title:'Song',artist:'Artist'},{...opt,fields:['artist']});assert.deepEqual(calls,[]);assert.equal(tags.artist,'Artist');assert.equal(tags.title,undefined);
});
test('unchecked covers cannot trigger candidate preview image requests for legacy providers',async()=>{
 const opt=options(async url=>response(url.includes('itunes.apple.com')
  ?{results:[{trackId:1,trackName:'Song',artistName:'Artist',collectionName:'Album',artworkUrl100:'https://image.invalid/100x100bb.jpg'}]}
  :url.includes('musicbrainz.org')
   ?{recordings:[{id:'r1',title:'Song','artist-credit':[{name:'Artist'}],releases:[{id:'album1',title:'Album'}]}]}
   :{code:200,result:{songs:[{id:1,name:'Song',artists:[{name:'Artist'}],album:{name:'Album',picUrl:'https://image.invalid/netease.jpg'},duration:200000}]}}));
 for(const source of ['itunes','netease','musicbrainz']){
  const unchecked=await p.search('Song',{...opt,sources:[source],fields:['artist']});
  assert.equal(unchecked.candidates.length,1,source);assert.equal(unchecked.candidates[0].coverUrl,'',source+' must not expose a browser-loadable cover');
  const selected=await p.search('Song',{...opt,sources:[source],fields:['artist','cover']});
  assert.ok(selected.candidates[0].coverUrl,source+' still returns explicitly requested covers');
 }
});
test('explicit empty fields make no requests across search and enrichment',async()=>{
 let count=0;const opt={...options(async()=>{count++;throw Error('No calls allowed');}),fields:[]};
 assert.deepEqual(await p.search('',opt),{candidates:[],errors:[]});
 const result=await p.enrich({title:'Song',id:'qq:1',source:'qq'},opt);assert.equal(count,0);assert.equal(result.title,undefined);
});
test('VGMdb requires album fields and never treats album composer as track artist',async()=>{
 const calls=[];const opt=options(async url=>{calls.push(url);return response(url.includes('/search/')?{results:{albums:[{link:'album/10'}]}}:{names:{English:'Album'},release_date:'2020-01-01',composers:[{names:{English:'Album Composer'}}],picture_full:'https://image.invalid/a.jpg',discs:[{tracks:[{names:{English:'Song'},track_length:'3:20'}]}]});});
 const refused=await p.search('Song',{...opt,sources:['vgmdb'],fields:['artist']});assert.equal(refused.errors[0].code,'UNSUPPORTED_FIELDS');assert.equal(calls.length,0);
 const result=await p.search('Album',{...opt,sources:['vgmdb'],fields:['album','cover','composer']});assert.equal(calls.length,2);assert.equal(result.candidates[0].artist,'');assert.equal(result.candidates[0].composer,'Album Composer');assert.equal(result.candidates[0].duration,200);
});
test('source priority breaks equivalent evidence ties without promoting a weaker QQ match',()=>{
 const local={title:'Song',artist:'Artist',duration:200};
 const common={title:'Song',artist:'Artist',duration:200,album:'Album'};
 assert.equal(p.rankCandidates(local,[{...common,id:'netease:1',source:'netease'},{...common,id:'qq:1',source:'qq'}])[0].source,'qq');
 assert.equal(p.rankCandidates(local,[{...common,title:'Wrong',id:'qq:1',source:'qq'},{...common,id:'netease:1',source:'netease'}])[0].source,'netease');
});
test('cache deduplicates requests, isolates fetchers and keys selected fields',async()=>{
 let calls=0;const opt={...options(async()=>{calls++;return response({code:0,data:{song:{list:[qqSong]}}});}),sources:['qq'],fields:['artist']};
 await Promise.all([p.search('Song',opt),p.search('Song',opt)]);assert.equal(calls,1);
 await p.search('Song',opt);assert.equal(calls,1);
 await p.search('Song',{...opt,fields:['cover']});assert.equal(calls,2);
 let other=0;await p.search('Song',{...opt,fetch:async()=>{other++;return response({code:0,data:{song:{list:[]}}});}});assert.equal(other,1);
});
test('one cancelled shared-cache caller does not cancel remaining subscribers',async()=>{
 let calls=0;const opt={...options(async(_url,{signal})=>{calls++;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,35);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('cancel','AbortError'));});});return response({code:0,data:{song:{list:[qqSong]}}});}),sources:['qq'],fields:['artist']};
 const controller=new AbortController();const first=p.search('Song',{...opt,signal:controller.signal});const second=p.search('Song',opt);controller.abort();
 await assert.rejects(first,{name:'AbortError'});assert.equal((await second).candidates.length,1);assert.equal(calls,1);
});

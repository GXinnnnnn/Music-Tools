'use strict';
const fs=require('node:fs'),path=require('node:path');
const p=require('../source/core/providers.cjs');
(async()=>{
 const tasks=[['qq','周杰伦 晴天'],['netease','宇多田ヒカル First Love'],['itunes','宇多田ヒカル First Love'],['kuwo','周杰伦 晴天'],['musicbrainz','宇多田ヒカル First Love'],['vgmdb','FINAL FANTASY VII']];
 const results=await Promise.all(tasks.map(async([source,query])=>{
  const start=Date.now();const options={sources:[source],fields:['cover','title','artist','album','year','lyrics'],country:'JP',limit:3,retries:0,timeoutMs:8000};
  try{
   const result=await p.search(query,options),candidate=result.candidates[0];
   const row={source,query,count:result.candidates.length,elapsedMs:Date.now()-start,errors:result.errors};
   if(candidate){row.candidate=candidate;const enriched=await p.enrich(candidate,{...options,timeoutMs:8000});row.enriched={title:enriched.title,artist:enriched.artist,album:enriched.album,coverUrl:enriched.coverUrl,lyricsCharacters:enriched.lyrics?.length||0,errors:enriched.errors};}
   console.log(JSON.stringify(row));return row;
  }catch(e){const row={source,query,error:e.message,elapsedMs:Date.now()-start};console.log(JSON.stringify(row));return row;}
 }));
 const report={testedAt:new Date().toISOString(),version:require('../package.json').version,results};
 fs.writeFileSync(path.join(__dirname,'../artifacts/providers-live-check.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

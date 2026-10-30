'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {downloadCover,imageMime}=require('../source/core/downloads.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('music CDN image/jpg header is normalized by JPEG bytes',async()=>{
 const jpeg=Buffer.from([255,216,255,224,0,16]);
 assert.equal(await downloadCover('https://p2.music.126.net/test.jpg',{fetch:async()=>new Response(jpeg,{headers:{'content-type':'image/jpg'}})}),'data:image/jpeg;base64,'+jpeg.toString('base64'));
});
test('generic or incorrect image headers cannot prevent genuine PNG or accept HTML',async()=>{
 assert.equal(await downloadCover('https://example.test/cover',{fetch:async()=>new Response(png,{headers:{'content-type':'application/octet-stream'}})}),'data:image/png;base64,'+png.toString('base64'));
 await assert.rejects(downloadCover('https://example.test/cover',{fetch:async()=>new Response('<html>login</html>',{headers:{'content-type':'image/jpeg'}})}),/来源没有返回支持的图片/);
 assert.equal(imageMime(Buffer.from('RIFF0000WEBP','ascii')),'image/webp');
});
test('artwork streaming limit rejects oversized bodies and declared lengths',async()=>{
 await assert.rejects(downloadCover('https://example.test/cover',{maxBytes:10,fetch:async()=>new Response(png)}),/封面大于20MB/);
 let canceled=false;
 await assert.rejects(downloadCover('https://example.test/cover',{maxBytes:10,fetch:async()=>({ok:true,headers:new Headers({'content-length':'100'}),body:{cancel:async()=>{canceled=true}},arrayBuffer:()=>{throw Error('must not read')}})}),/封面大于20MB/);
 assert.ok(canceled);
});
test('artwork downloader rejects local schemes and HTTP failures',async()=>{
 await assert.rejects(downloadCover('file:///C:/private'),/封面地址无效/);
 await assert.rejects(downloadCover('https://example.test/cover',{fetch:async()=>new Response('limit',{status:429})}),/封面下载失败 429/);
});

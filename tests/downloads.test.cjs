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

// Exercise native fetch and its response stream, rather than an abort-aware mock.
async function stalledCoverServer(t,phase){
 const http=require('node:http');
 let received;
 const requestReceived=new Promise(resolve=>{received=resolve;});
 const server=http.createServer((_request,response)=>{
  if(phase==='body'){
   response.writeHead(200,{'content-type':'image/png'});
   response.write(png.subarray(0,8));
  }
  received(); // Deliberately never finish the headers or body.
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise((resolve,reject)=>{
  server.close(error=>error?reject(error):resolve());
  server.closeAllConnections();
 }));
 return {url:`http://127.0.0.1:${server.address().port}/cover`,requestReceived};
}

test('cover deadline remains active with a caller signal before headers and during the body',async t=>{
 for(const phase of ['headers','body'])await t.test(phase,{timeout:3000},async t=>{
  const {url}=await stalledCoverServer(t,phase),controller=new AbortController();
  let transportSignal,headersReceived=false;
  await assert.rejects(downloadCover(url,{
   signal:controller.signal,timeoutMs:500,
   fetch:async(input,options)=>{
    transportSignal=options.signal;
    const response=await fetch(input,options);headersReceived=true;return response;
   }
  }),error=>error.name==='TimeoutError'||error.name==='AbortError');
  assert.equal(headersReceived,phase==='body','body case must reach the streaming response before its deadline');
  assert.equal(transportSignal.aborted,true);
  assert.equal(transportSignal.reason.name,'TimeoutError');
  assert.equal(controller.signal.aborted,false,'deadline must not abort the caller-owned controller');
 });
});

test('caller cancellation interrupts cover fetch and stalled response body',async t=>{
 for(const phase of ['headers','body'])await t.test(phase,{timeout:3000},async t=>{
  const {url,requestReceived}=await stalledCoverServer(t,phase),controller=new AbortController();
  let transportSignal,headersReceived;
  const responseReceived=new Promise(resolve=>{headersReceived=resolve;});
  const pending=downloadCover(url,{
   signal:controller.signal,timeoutMs:5000,
   fetch:async(input,options)=>{
    transportSignal=options.signal;
    const response=await fetch(input,options);headersReceived();return response;
   }
  });
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await(phase==='body'?responseReceived:requestReceived);
  const reason=new DOMException('Cancelled by the caller','AbortError');
  controller.abort(reason);
  await rejected;
  assert.equal(transportSignal.aborted,true);
  assert.equal(transportSignal.reason,reason,'preserve the supplied cancellation reason');
 });
});

test('cover deadline also works without a caller signal',{timeout:3000},async t=>{
 const {url}=await stalledCoverServer(t,'headers');
 await assert.rejects(downloadCover(url,{timeoutMs:100}),{name:'TimeoutError'});
});

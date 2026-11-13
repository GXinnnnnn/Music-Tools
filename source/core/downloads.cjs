'use strict';
// Determine embedded cover MIME from bytes: some music CDNs return image/jpg.
function imageMime(bytes){
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 throw new Error('来源没有返回支持的图片');
}
async function downloadCover(url,options={}){
 const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error('封面地址无效');
 const maxBytes=options.maxBytes??20*1024*1024;
 const deadline=AbortSignal.timeout(options.timeoutMs??20000);
 const signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
 const response=await (options.fetch||globalThis.fetch)(parsed,{signal});
 if(!response.ok)throw new Error('封面下载失败 '+response.status);
 const tooLarge=()=>new Error('封面大于20MB');
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw tooLarge();}
 let buf;
 if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>maxBytes){await reader.cancel();throw tooLarge();}chunks.push(Buffer.from(r.value));}}finally{reader.releaseLock();}buf=Buffer.concat(chunks,size);}
 else{buf=Buffer.from(await response.arrayBuffer());if(buf.length>maxBytes)throw tooLarge();}
 return `data:${imageMime(buf)};base64,${buf.toString('base64')}`;
}
module.exports={imageMime,downloadCover};

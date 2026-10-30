'use strict';
const {_electron}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const root=path.resolve(__dirname,'..');const env={...process.env,MUSIC_TOOLS_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'music-icon-'))};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.MUSIC_TOOLS_ELECTRON||require('electron');
 const app=await _electron.launch({executablePath,args:[root],env});
 try{const page=await app.firstWindow();await page.waitForSelector('.brand-mark');const svg=fs.readFileSync(path.join(root,'source/ui/assets/icon.svg'),'utf8');
 const data=await page.evaluate(async svg=>{const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.getContext('2d').drawImage(image,0,0,512,512);return canvas.toDataURL('image/png').split(',')[1];},svg);
 fs.writeFileSync(path.join(root,'source/ui/assets/icon.png'),Buffer.from(data,'base64'));
 // ICO directory with PNG payload per size; accepted by Windows Vista+ and rcedit.
 const images=[];for(const size of [16,24,32,48,64,128,256]){const png=await app.evaluate(({nativeImage},{data,size})=>nativeImage.createFromBuffer(Buffer.from(data,'base64')).resize({width:size,height:size,quality:'best'}).toPNG().toString('base64'),{data,size});images.push({size,buffer:Buffer.from(png,'base64')});}
 const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
 images.forEach(({size,buffer},index)=>{const start=6+16*index;header[start]=header[start+1]=size===256?0:size;header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);header.writeUInt32LE(buffer.length,start+8);header.writeUInt32LE(offset,start+12);offset+=buffer.length;});
 fs.writeFileSync(path.join(root,'source/ui/assets/icon.ico'),Buffer.concat([header,...images.map(x=>x.buffer)]));console.log('Rendered SVG to PNG512 and ICO16/24/32/48/64/128/256.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

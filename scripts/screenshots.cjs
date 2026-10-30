'use strict';
// Capture only the app's original synthesized demos; never import the user's music.
const {_electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const root=path.resolve(__dirname,'..'),output=path.join(root,'docs','images');fs.mkdirSync(output,{recursive:true});
 const env={...process.env,MUSIC_TOOLS_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'music-tools-shots-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],env,timeout:60000});
 try{const page=await app.firstWindow();await page.locator('[data-action="demo"]').click();await expect(page.locator('.audio-tile')).toHaveCount(8);await page.waitForSelector('#preview-card:not([hidden])');
 // Hide host filesystem paths in public screenshots while retaining actual UI content.
 await page.evaluate(()=>{for(const el of document.querySelectorAll('input,textarea'))if(/^[A-Z]:[\\/]/i.test(el.value))el.value='演示音频 / '+el.value.split(/[\\/]/).pop();for(const el of document.querySelectorAll('*'))if(el.childElementCount===0&&/C:\\|[A-Z]:\\Users\\/.test(el.textContent))el.textContent=el.textContent.replace(/[A-Z]:\\[^\n]*/g,'原创演示音频');});
 await page.screenshot({path:path.join(output,'library.png')});
 await page.locator('#select-all').check();await page.locator('[data-preview-action="match"]').click();await expect(page.locator('[data-source]')).toHaveCount(6);await page.screenshot({path:path.join(output,'batch.png')});
 await page.locator('#modal-close').click();await page.locator('[data-action="theme"]').click();await page.screenshot({path:path.join(output,'dark.png')});
 console.log('Captured original-demo library, batch settings, and dark theme.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

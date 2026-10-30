const { contextBridge, ipcRenderer, webUtils } = require('electron');
const channels = new Set(['choose-import','import-paths','refresh','write','history','restore','rename-preview','rename','export-sidecars','search','enrich','cancel-search','batch-match','batch-stage','sync-filter','choose-cover','choose-lyrics','download-cover','transform-cover','show-file','open-data','window','demo','get-info','text-tools','session-load','session-save']);
contextBridge.exposeInMainWorld('music', {
  invoke: async (name,...args) => { if(!channels.has(name)) throw new Error('未知操作');const r=await ipcRenderer.invoke(name,...args);if(!r.ok)throw new Error(r.error);return r.value; },
  filePath: file => webUtils.getPathForFile(file),
  mediaUrl: file => 'music-local://audio/'+btoa(unescape(encodeURIComponent(file))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),
  onProgress: callback => {const listener=(_e,data)=>callback(data);ipcRenderer.on('match-progress',listener);return ()=>ipcRenderer.removeListener('match-progress',listener);}
});

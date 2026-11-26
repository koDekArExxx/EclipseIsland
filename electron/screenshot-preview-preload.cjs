const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('screenshotPreview',{onTheme:callback=>{ipcRenderer.on('preview:theme',(_,value)=>callback(value));},frame:()=>ipcRenderer.invoke('screenshot-preview:frame'),action:action=>ipcRenderer.invoke('screenshot-preview:action',action),close:()=>ipcRenderer.send('screenshot-preview:close')});

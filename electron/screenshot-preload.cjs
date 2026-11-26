const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('screenshot',{ready:()=>ipcRenderer.send('screenshot:ready'),frame:()=>ipcRenderer.invoke('screenshot:frame'),finish:rect=>ipcRenderer.send('screenshot:finish',rect)});

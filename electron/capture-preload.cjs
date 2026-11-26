const {contextBridge,ipcRenderer}=require('electron');
const prefix=process.argv.includes('--eclipse-replay')?'replay-worker':'capture-worker';
contextBridge.exposeInMainWorld('captureWorker',{
 format:value=>ipcRenderer.invoke(prefix+':format',value),
 segment:value=>ipcRenderer.invoke(prefix+':segment',value),
 init:()=>ipcRenderer.invoke(prefix+':init'),
 chunk:bytes=>ipcRenderer.invoke(prefix+':chunk',bytes),
 report:state=>ipcRenderer.send(prefix+':state',state),
 finish:state=>ipcRenderer.invoke(prefix+':finish',state),
 on:callback=>{ipcRenderer.on(prefix+':command',(_event,value)=>callback(value));}
});

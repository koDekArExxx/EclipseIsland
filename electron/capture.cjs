const {setupPreview,clipPreview}=require('./window-style.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const {CaptureStore}=require('./capture-store.cjs');
const {exportMP4,verifyEncoder}=require('./mp4-export.cjs');
class CaptureController{
 constructor(electron,directory,onUpdate,onProtection,options={}){
  this.exportMP4=options.exportMP4||exportMP4;this.verifyEncoder=options.verifyEncoder||verifyEncoder;this.e=electron;this.onUpdate=onUpdate;this.onProtection=onProtection;this.getTheme=options.getTheme||(()=>({}));this.store=new CaptureStore(directory,electron.app.getPath('videos'));
  this.state={status:'idle',elapsed:0,bytes:0};this.recent=this.store.items;this.writes=Promise.resolve();this.saves=Promise.resolve();this.previews=new Set();this.recovery=this.store.recover().catch(()=>{this.state.warnings=['Не удалось восстановить прошлый фрагмент. Проверьте папку записей'];});
  const worker=event=>!!this.window&&!this.window.isDestroyed()&&event.sender===this.window.webContents;
  electron.ipcMain.handle('capture-worker:init',event=>{if(!worker(event)||!this.current)throw Error('Unknown recorder');return this.current.config;});
  electron.ipcMain.handle('capture-worker:format',async(event,value)=>{if(!worker(event)||!this.current||this.finishing)throw Error('Recording closed');await this.store.setFormat(this.current,value?.mimeType);return {ok:true};});
  electron.ipcMain.handle('capture-worker:chunk',async(event,data)=>{
   if(!worker(event)||!this.current)throw Error('Recording closed');const current=this.current;
   this.writes=this.writes.then(()=>this.store.append(current,data));try{await this.writes;}catch(error){throw Error(error.code==='ENOSPC'?'На диске закончилось место. Сохранён доступный фрагмент':error.code==='EACCES'?'Нет доступа к файлу записи':error.code==='EIO'?'Диск для записи недоступен':'Не удалось записать видеоданные на диск');}
   if(current.config.maxSizeMB&&current.bytes>=current.config.maxSizeMB*1024*1024)this.stop();
   return {ok:true};
  });
  electron.ipcMain.on('capture-worker:state',(event,patch)=>{
   if(!worker(event)||!this.current||this.finishing)return;
   if(['countdown','recording','paused'].includes(patch.status))this.state={...this.state,...patch,bytes:this.current.bytes};
   if(patch.status==='recording'||patch.status==='paused'){this.current.started=true;clearTimeout(this.startTimer);}
   this.publish();
  });
  electron.ipcMain.handle('capture-worker:finish',async(event,result)=>{if(!worker(event))throw Error('Unknown recorder');await this.finish(result);return {ok:true};});
  electron.ipcMain.handle('capture-preview:info',event=>{const window=[...this.previews].find(w=>!w.isDestroyed()&&w.webContents===event.sender);if(!window)throw Error('Unknown preview');const item=this.store.get(window.captureId);return item?{...item,url:'eclipse-recording://video/'+item.id,theme:this.getTheme()}:null;});
  electron.ipcMain.handle('capture-preview:action',async(event,action)=>{
   const window=[...this.previews].find(w=>!w.isDestroyed()&&w.webContents===event.sender);if(!window)throw Error('Unknown preview');
   const state=()=>({fullscreen:!!window.isFullScreen(),maximized:!!window.isMaximized()});
   if(action==='fullscreen')window.setFullScreen(!window.isFullScreen());
   else if(action==='exit-fullscreen')window.setFullScreen(false);
   else if(action==='maximize'){if(window.isMaximized())window.unmaximize();else window.maximize();}
   else if(action==='close'){window.close();return {ok:true};}
   else if(action==='open'||action==='reveal'){const item=this.store.get(window.captureId);if(!item)throw Error('Файл не найден');await fs.stat(item.file);if(action==='open'){const error=await this.e.shell.openPath(item.file);if(error)throw Error(error);}else this.e.shell.showItemInFolder(item.file);}
   else throw Error('Unknown action');return {ok:true,...state()};
  });
  electron.protocol.handle('eclipse-recording',request=>{const url=new URL(request.url);if(url.hostname!=='video'||!/^\/[a-f0-9]{32}$/.test(url.pathname))return new Response('Not found',{status:404});return this.store.response(url.pathname.slice(1),request.headers.get('range'),{method:request.method,signal:request.signal});});
 }
 updatePreviewTheme(){for(const window of this.previews)if(!window.isDestroyed()){clipPreview(window,this.getTheme());window.webContents.send('preview:theme',this.getTheme());}}
 snapshot(){return {...this.state,settings:this.store.settings,recent:this.recent.slice(0,24),active:!!this.current};}
 publish(){this.onUpdate(this.snapshot());}
 async refresh(){await this.recovery;this.recent=await this.store.list();this.publish();return this.snapshot();}
 save(patch){this.saves=this.saves.catch(()=>{}).then(async()=>{if(this.current)throw Error('Настройки можно менять после остановки записи');await this.store.saveSettings({...this.store.settings,...patch});this.publish();return this.snapshot();});return this.saves;}
 async folder(parent){if(this.current)throw Error('Сначала остановите запись');const result=await this.e.dialog.showOpenDialog(parent,{title:'Папка для видеозаписей',defaultPath:this.store.settings.folder,properties:['openDirectory','createDirectory']});if(!result.canceled)await this.save({folder:result.filePaths[0]});return this.snapshot();}
 async sources(){const own=new Set(this.e.BrowserWindow.getAllWindows().map(w=>w.getMediaSourceId?.()));return (await this.e.desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:192,height:108},fetchWindowIcons:false})).filter(x=>!own.has(x.id)).map(x=>({id:x.id,name:x.name,displayId:x.display_id,thumbnail:x.thumbnail.toDataURL()}));}
 async start(){
  if(this.current||this.starting)return this.snapshot();this.starting=true;this.state={status:'starting',elapsed:0,bytes:0,error:null};this.publish();
  try{
   await this.recovery;await this.verifyEncoder();
   const sources=await this.e.desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}});
   const requested=this.store.settings.source;const source=requested?sources.find(x=>x.id===requested):(sources.find(x=>x.id.startsWith('screen:')&&x.display_id===String(this.e.screen?.getPrimaryDisplay?.()?.id))||sources.find(x=>x.id.startsWith('screen:')));
   if(!source)throw Error('Источник недоступен. Выберите экран или окно заново');
   this.current=await this.store.create();this.current.config={...this.store.settings,sourceId:source.id};this.writes=Promise.resolve();this.source=source;
   this.state={...this.state,name:path.basename(this.current.file),source:source.name};
   this.onProtection(this.current.config);
   const window=new this.e.BrowserWindow({width:360,height:180,show:false,skipTaskbar:true,title:'EclipseIsland — запись',webPreferences:{preload:path.join(__dirname,'capture-preload.cjs'),partition:'eclipse-recorder',contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
   this.window=window;
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
   const allowed=contents=>this.window===window&&!!this.current&&!window.isDestroyed()&&contents===window.webContents;
   window.webContents.session.setPermissionCheckHandler((contents,permission)=>allowed(contents)&&['media','display-capture'].includes(permission));
   window.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>callback(allowed(contents)&&['media','display-capture'].includes(permission)));
   window.webContents.session.setDisplayMediaRequestHandler((request,callback)=>{
    if(this.window!==window||!this.current||request.frame!==window.webContents.mainFrame)return callback(null);
    callback({video:this.source,...(this.current.config.systemAudio?{audio:'loopback'}:{})});
   });
   window.webContents.on('render-process-gone',()=>{if(this.current)this.finish({error:'Процесс записи остановился. Сохранён доступный фрагмент',duration:this.state.elapsed});});
   window.on('closed',()=>{if(this.window===window&&this.current)this.finish({error:'Окно записи закрыто',duration:this.state.elapsed});});
   this.startTimer=setTimeout(()=>{if(this.current)this.finish({error:'Не удалось получить кадры экрана за отведённое время',duration:0});},(this.current.config.countdown+30)*1000);this.startTimer.unref?.();
   await window.loadFile(path.join(__dirname,'../src/capture-worker.html'));this.publish();
  }catch(error){if(this.current)await this.finish({error:error.message,duration:0});else{this.state={status:'error',error:error.message,elapsed:0,bytes:0};this.publish();}}finally{this.starting=false;}
  return this.snapshot();
 }
 async stop(){if(!this.current)return this.snapshot();if(this.stopping)return this.stopping;
  let resolve;this.stopping=new Promise(r=>{resolve=r;});this.stopResolve=resolve;const pending=this.stopping;
  if(this.finishing)return pending;
  this.state.status='stopping';this.publish();if(this.window&&!this.window.isDestroyed())this.window.webContents.send('capture-worker:command','stop');else this.finish({error:'Процесс записи недоступен',duration:this.state.elapsed});
  this.stopTimer=setTimeout(()=>this.finish({error:'Запись прервана: процесс не ответил на остановку',duration:this.state.elapsed}),15000);this.stopTimer.unref?.();return pending;
 }
 pause(){if(!this.current||!['recording','paused'].includes(this.state.status))return this.snapshot();this.window?.webContents.send('capture-worker:command',this.state.status==='paused'?'resume':'pause');return this.snapshot();}
 async finish(result={}){
  if(!this.current||this.finishing)return;this.finishing=true;clearTimeout(this.startTimer);clearTimeout(this.stopTimer);
  const current=this.current;let error=typeof result.error==='string'?result.error:null,entry;
  try{await this.writes;}catch(failure){error=error||failure.message;}
  if(current.started&&!current.bytes&&!error)error='Видеоданные не получены. Попробуйте VP8 и меньшую частоту кадров';
  // Release capture tracks/protection before exporting; keep current set so Quit waits for MP4.
  const window=this.window;this.window=null;if(window&&!window.isDestroyed())window.destroy();
  try{this.onProtection(null);}catch{}
  try{
   entry=await this.store.finish(current,result.duration,error!==null);
   if(entry){
    this.state={...this.state,status:'exporting',exportProgress:0};this.publish();
    try{
     const file=await this.exportMP4(entry,current.config,(progress,mode)=>{const rounded=Math.floor(progress);if(rounded!==this.state.exportProgress||mode!==this.state.exportMode){this.state.exportProgress=rounded;this.state.exportMode=mode;this.publish();}});
     entry=await this.store.replaceWithMP4(entry,file);
    }catch(failure){error=(error?error+' · ':'')+'MP4 не сохранён. Исходное видео оставлено в папке. '+failure.message;}
   }
   this.recent=await this.store.list();
  }catch(failure){error=error||'Не удалось завершить файл: '+failure.message;}
  this.current=null;
  try{this.onProtection(null);}catch{}clearTimeout(this.stopTimer);this.state={status:error?'error':'idle',error,elapsed:0,bytes:0,lastSaved:entry?.id||null};this.finishing=false;this.publish();this.stopResolve?.(this.snapshot());this.stopResolve=null;this.stopping=null;
 }
 async action(action,id){
  if(action==='start')return this.start();if(action==='stop')return this.stop();if(action==='pause')return this.pause();
  if(action==='folder'){await fs.mkdir(this.store.settings.folder,{recursive:true});const error=await this.e.shell.openPath(this.store.settings.folder);if(error)throw Error(error);return {ok:true};}
  const item=this.store.get(id||this.state.lastSaved||this.recent[0]?.id);if(!item)throw Error('Запись не найдена');await fs.stat(item.file);
  if(action==='open'){const error=await this.e.shell.openPath(item.file);if(error)throw Error(error);return {ok:true};}
  if(action==='reveal'){this.e.shell.showItemInFolder(item.file);return {ok:true};}
  if(action==='preview'){
   const window=new this.e.BrowserWindow({width:1020,height:720,minWidth:600,minHeight:420,title:'EclipseIsland — '+item.name,frame:false,transparent:true,hasShadow:false,backgroundColor:'#00000000',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preview-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,autoplayPolicy:'no-user-gesture-required'}});
   setupPreview(window,this.getTheme);window.captureId=item.id;this.previews.add(window);window.on('closed',()=>this.previews.delete(window));const sendState=()=>{if(!window.isDestroyed())window.webContents.send('capture-preview:state',{fullscreen:window.isFullScreen(),maximized:window.isMaximized()});};for(const event of ['enter-full-screen','leave-full-screen','maximize','unmaximize'])window.on(event,sendState);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.loadFile(path.join(__dirname,'../src/recording-preview.html'));return {ok:true};
  }
  throw Error('Неизвестное действие записи');
 }
}
module.exports={CaptureController};

const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {CaptureStore}=require('./capture-store.cjs');
const {exportMP4,verifyEncoder}=require('./mp4-export.cjs');
function replayConfig(settings){
 const pick=(key,base,fallback)=>settings[key]??settings[base]??fallback;
 return {mode:'replay',height:settings.replayHeight,fps:settings.replayFPS,bitrate:settings.replayBitrate,codec:'auto',countdown:0,maxMinutes:0,maxSizeMB:0,source:settings.source||'',excludeIsland:settings.excludeIsland,
 microphone:pick('replayMicrophone','microphone',false),noiseSuppression:pick('replayNoiseSuppression','noiseSuppression',true),echoCancellation:pick('replayEchoCancellation','echoCancellation',true),autoGainControl:pick('replayAutoGainControl','autoGainControl',false),micHighPass:!!settings.replayMicHighPass,micCompressor:!!settings.replayMicCompressor,
 systemAudio:pick('replaySystemAudio','systemAudio',true),systemVolume:pick('replaySystemVolume','systemVolume',100),micVolume:pick('replayMicVolume','micVolume',100),audioBitrate:pick('replayAudioBitrate','audioBitrate',192)};
}
class ReplayController{
 constructor(electron,directory,videoStore,onUpdate,onProtection,options={}){
  Object.assign(this,{e:electron,root:path.join(directory,'replay-buffer'),videoStore,onUpdate,onProtection,exportMP4:options.exportMP4||exportMP4,verifyEncoder:options.verifyEncoder||verifyEncoder});this.state={status:'off',bufferSeconds:0,bytes:0};this.segments=[];this.writes=Promise.resolve();this.lifecycle=Promise.resolve();this.configKey='';
  const trusted=event=>!!this.window&&!this.window.isDestroyed()&&event.sender===this.window.webContents;
  const ipc=electron.ipcMain;
  ipc.handle('replay-worker:init',event=>{if(!trusted(event))throw Error('Unknown replay worker');return this.config;});
  ipc.handle('replay-worker:format',async(event,value)=>{if(!trusted(event)||!this.current)throw Error('Replay closed');await this.store.setFormat(this.current,value?.mimeType);this.format=value.mimeType;return {ok:true};});
  ipc.handle('replay-worker:chunk',async(event,bytes)=>{if(!trusted(event)||!this.current)throw Error('Replay closed');const current=this.current;this.writes=this.writes.then(()=>this.store.append(current,bytes));await this.writes;if(this.settings.replayMaxMB>0&&current.bytes>this.settings.replayMaxMB*1048576/2)this.window?.webContents.send('replay-worker:command','rotate');return {ok:true};});
  ipc.handle('replay-worker:segment',async(event,value)=>{if(!trusted(event))throw Error('Replay closed');this.rotating=this.rotate(value);try{await this.rotating;}finally{this.rotating=null;}return {ok:true};});
  ipc.handle('replay-worker:finish',async(event,value)=>{if(!trusted(event))throw Error('Replay closed');await this.finish(value);return {ok:true};});
  ipc.on('replay-worker:state',(event,value)=>{if(!trusted(event))return;if(value.status==='recording'){clearTimeout(this.startTimer);this.state={...this.state,status:'buffering',codec:value.codec,capturePath:value.capturePath,sourceFPS:value.sourceFPS,warnings:Array.isArray(value.warnings)?value.warnings:[]};this.publish();}});
 }
 snapshot(){return {...this.state,active:!!this.window,saving:!!this.saving||!!this.saveRequested};}
 publish(patch={}){this.state={...this.state,...patch};this.onUpdate(this.snapshot());}
 configure(settings,allowed=true){this.settings={...settings};const key=JSON.stringify(replayConfig(settings));this.lifecycle=this.lifecycle.catch(()=>{}).then(async()=>{if(!settings.replayEnabled||!allowed){await this.stop();this.publish({status:settings.replayEnabled?'suspended':'off'});return;}if(this.window&&this.configKey===key)return;await this.stop();this.configKey=key;try{await this.start(settings);}catch(error){await this.finish({error:error.message});}});return this.lifecycle;}
 suspend(){return this.configure(this.settings||this.videoStore.settings,false);}
 async start(settings){
  this.publish({status:'starting',error:null});await this.verifyEncoder();await fs.rm(this.root,{recursive:true,force:true});await fs.mkdir(this.root,{recursive:true});this.segments=[];
  this.store=new CaptureStore(path.join(this.root,'data'),this.root);this.store.settings={...settings,folder:this.root};
  const sources=await this.e.desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}}),display=String(this.e.screen?.getPrimaryDisplay?.()?.id);
  const source=settings.source?sources.find(x=>x.id===settings.source):sources.find(x=>x.display_id===display&&x.id.startsWith('screen:'))||sources.find(x=>x.id.startsWith('screen:'));
  if(!source)throw Error('Выберите доступный экран для повтора');
  this.config={...replayConfig(settings),sourceId:source.id};
  this.current=await this.store.create();this.onProtection(this.config);
  const window=new this.e.BrowserWindow({width:32,height:32,show:false,skipTaskbar:true,webPreferences:{preload:path.join(__dirname,'capture-preload.cjs'),additionalArguments:['--eclipse-replay'],partition:'eclipse-replay',contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});this.window=window;
  const allowed=contents=>this.window===window&&contents===window.webContents;
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionCheckHandler((contents,type)=>allowed(contents)&&['media','display-capture'].includes(type));window.webContents.session.setPermissionRequestHandler((contents,type,callback)=>callback(allowed(contents)&&['media','display-capture'].includes(type)));
  window.webContents.session.setDisplayMediaRequestHandler((request,callback)=>callback(this.window===window&&request.frame===window.webContents.mainFrame?{video:source,...(this.config.systemAudio?{audio:'loopback'}:{})}:null));
  window.webContents.on('render-process-gone',()=>{if(this.window===window)this.finish({error:'Процесс повтора остановился'});});window.on('closed',()=>{if(this.window===window)this.finish({error:'Окно повтора закрыто'});});
  this.publish({status:'starting',bufferSeconds:0,bytes:0,error:null});this.startTimer=setTimeout(()=>this.finish({error:'Источник повтора не ответил'}),30000);this.startTimer.unref?.();await window.loadFile(path.join(__dirname,'../src/capture-worker.html'));
 }
 async rotate(value){
  await this.writes;const current=this.current;if(!current)throw Error('Replay closed');this.current=null;
  const entry=await this.store.finish(current,Math.max(0,Number(value.duration)||0));if(entry)this.segments.push(entry);
  this.current=await this.store.create();await this.store.setFormat(this.current,this.format);await this.trim();
  if(value.save)this.saveSnapshot().catch(error=>this.publish({error:error.message}));
 }
 async trim(){
  const maxSeconds=this.settings.replaySeconds+5,maxBytes=this.settings.replayMaxMB>0?this.settings.replayMaxMB*1048576:Infinity;
  let seconds=this.segments.reduce((n,x)=>n+x.duration,0),bytes=this.segments.reduce((n,x)=>n+x.bytes,0);
  while(this.segments.length>1&&(seconds-this.segments[0].duration>=maxSeconds||bytes>maxBytes)){
   const first=this.segments[0];if(first.locked)break;this.segments.shift();seconds-=first.duration;bytes-=first.bytes;await fs.unlink(first.file).catch(()=>{});
  }
  this.publish({bufferSeconds:Math.min(seconds,this.settings.replaySeconds),bytes});
 }
 requestSave(){if(this.saving||this.saveRequested)return {ok:false,error:'Предыдущий повтор ещё сохраняется'};if(!this.window||this.state.status!=='buffering')return {ok:false,error:'Сначала включите мгновенный повтор и дождитесь захвата экрана'};this.saveRequested=true;this.publish({saveProgress:0});this.window.webContents.send('replay-worker:command','snapshot');return {ok:true};}
 async saveSnapshot(){
  this.saveRequested=false;if(this.saving)return;if(!this.segments.length)throw Error('Буфер пока пуст');
  const selected=[];let seconds=0;for(const item of [...this.segments].reverse()){selected.unshift(item);seconds+=item.duration;if(seconds>=this.settings.replaySeconds)break;}
  for(const item of selected)item.locked=true;
  const run=async()=>{
   const folder=this.videoStore.settings.folder;await fs.mkdir(folder,{recursive:true});const id=crypto.randomBytes(16).toString('hex'),createdAt=Date.now(),file=path.join(folder,'EclipseIsland-Replay-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+id.slice(0,6)+'.webm');
   const concatFile=path.join(this.root,'replay-'+id+'.ffconcat');const escape=value=>value.replace(/'/g,"'\\''");await fs.writeFile(concatFile,'ffconcat version 1.0\n'+selected.map(x=>"file '"+escape(x.file.replace(/\\/g,'/'))+"'").join('\n')+'\n');
   const duration=Math.min(seconds,this.settings.replaySeconds),entry={id,file,duration,concatFile,startOffset:Math.max(0,seconds-duration),videoCodec:selected.every(x=>x.videoCodec==='h264')?'h264':'other',audioCodec:selected[0].audioCodec};
   try{
    const output=await this.exportMP4(entry,{...this.settings,bitrate:this.settings.replayBitrate,audioBitrate:this.config.audioBitrate},progress=>this.publish({saveProgress:Math.floor(progress)}));const stat=await fs.stat(output);
    await this.videoStore.importVideo({id,file:output,name:path.basename(output),duration,bytes:stat.size,createdAt,format:'mp4',replay:true,indexedDuration:true});this.publish({lastSaved:id,error:null});
   }finally{await fs.unlink(concatFile).catch(()=>{});for(const item of selected)item.locked=false;}
  };
  this.saving=run();this.publish({saveProgress:0});try{await this.saving;}finally{this.saving=null;this.publish();await this.trim();}
 }
 async stop(){
  if(this.window&&!this.stopping){this.stopping=new Promise(resolve=>this.stopResolve=resolve);this.window.webContents.send('replay-worker:command','stop');this.stopTimer=setTimeout(()=>this.finish({error:'Буфер остановлен по таймеру'}),12000);this.stopTimer.unref?.();}
  if(this.stopping)await this.stopping;await this.saving?.catch(()=>{});this.segments=[];await fs.rm(this.root,{recursive:true,force:true}).catch(()=>{});
 }
 async finish(value={}){
  if(this.finishing)return;this.finishing=true;clearTimeout(this.startTimer);clearTimeout(this.stopTimer);
  const window=this.window;this.window=null;if(window&&!window.isDestroyed())window.destroy();
  try{await this.rotating?.catch(()=>{});await this.writes;if(this.current){await this.store.finish(this.current,Number(value.duration)||0,!!value.error);this.current=null;}}catch{}this.onProtection(null);
  this.saveRequested=false;this.publish({status:value.error?'error':'off',error:value.error||null,bufferSeconds:0});this.finishing=false;this.stopResolve?.();this.stopping=null;this.stopResolve=null;
 }
}
module.exports={ReplayController,replayConfig};

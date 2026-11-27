const {setupPreview,clipPreview}=require('./window-style.cjs');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const runFile=promisify(execFile);
const {randomUUID}=require('node:crypto');
function pixelCrop(rect,bounds,size){
 if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k]))||rect.width<3||rect.height<3)throw Error('Выделите область побольше');
 const left=Math.max(0,Math.min(bounds.width,rect.x)),top=Math.max(0,Math.min(bounds.height,rect.y));
 const right=Math.max(left,Math.min(bounds.width,rect.x+rect.width)),bottom=Math.max(top,Math.min(bounds.height,rect.y+rect.height));
 if(right-left<3||bottom-top<3)throw Error('Область находится за пределами экрана');
 const x=Math.floor(left*size.width/bounds.width),y=Math.floor(top*size.height/bounds.height);
 return {x,y,width:Math.min(size.width-x,Math.ceil(right*size.width/bounds.width)-x),height:Math.min(size.height-y,Math.ceil(bottom*size.height/bounds.height)-y)};
}
const shotDefaults=Object.freeze({copy:true,format:'png',quality:90,maxHeight:0,countdown:0,excludeIsland:true,hideSettings:true,notifications:true,openAfter:false,showCursor:true,monitor:'cursor'});
function shotSettings(input={},previous=shotDefaults){
 const out={...shotDefaults,...previous};for(const key of ['copy','excludeIsland','hideSettings','notifications','openAfter','showCursor'])if(typeof input[key]==='boolean')out[key]=input[key];
 if(['png','jpg'].includes(input.format))out.format=input.format;
 if(Number.isFinite(input.quality))out.quality=Math.max(50,Math.min(100,Math.round(input.quality)));
 if([0,720,1080,1440,2160].includes(input.maxHeight))out.maxHeight=input.maxHeight;
 if([0,3,5,10].includes(input.countdown))out.countdown=input.countdown;
 if(['cursor','primary'].includes(input.monitor)||Number.isSafeInteger(input.monitor))out.monitor=input.monitor;
 return out;
}
async function captureWindowsFrame(e,display,showCursor){
 const rect=e.screen.dipToScreenRect(null,display.bounds);
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'eclipse-shot-'));
 try{
  const file=path.join(dir,'frame.png');
  const script=path.join(__dirname,'screenshot-frame.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  await runFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-X',String(rect.x),'-Y',String(rect.y),'-Width',String(rect.width),'-Height',String(rect.height),'-IncludeCursor',showCursor?'1':'0','-OutputFile',file],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  const image=e.nativeImage.createFromBuffer(await fs.promises.readFile(file));
  if(image.isEmpty())throw Error('Не удалось получить изображение выбранного экрана');return image;
 }finally{await fs.promises.rm(dir,{recursive:true,force:true});}
}
class DesktopTools{
 constructor(e,directory,onUpdate,options={}){
  this.e=e;this.captureFrame=options.captureFrame!==undefined?options.captureFrame:(process.platform==='win32'?(display,showCursor)=>captureWindowsFrame(e,display,showCursor):null);this.file=path.join(directory,'desktop-tools.json');this.onUpdate=onUpdate;this.hideSurfaces=options.hideSurfaces||(()=>()=>{});this.wait=options.wait||(ms=>new Promise(r=>setTimeout(r,ms)));this.busy=false;this.error=null;this.remaining=0;this.launchingAll=false;this.viewers=new Map();this.processes=new Map();this.processProvider=options.processProvider;this.restoreOverlay=options.restoreOverlay||(()=>{});this.getTheme=options.getTheme||(()=>({}));
  const folder=path.join(e.app.getPath('pictures'),'EclipseIsland');let saved={};try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{}
  this.config={...shotSettings(saved.config||{}),folder:typeof saved.config?.folder==='string'&&path.isAbsolute(saved.config.folder)?saved.config.folder:folder,copy:saved.config?.copy!==false};
  this.entries=Array.isArray(saved.entries)?saved.entries.filter(x=>typeof x?.id==='string'&&typeof x.name==='string'&&typeof x.target==='string'&&path.isAbsolute(x.target)&&['app','folder'].includes(x.kind)).slice(0,24).map(x=>({...x,icon:/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(x.icon||'')&&(x.icon||'').length<50000?x.icon:''})):[];
  this.recent=Array.isArray(saved.recent)?saved.recent.filter(x=>typeof x?.id==='string'&&typeof x.file==='string'&&path.isAbsolute(x.file)&&['.png','.jpg','.jpeg'].includes(path.extname(x.file).toLowerCase())).slice(0,24):[];
  this.e.ipcMain.handle('screenshot-preview:frame',event=>{const item=this.viewerItem(event.sender);if(!item)throw Error('Unknown sender');return {image:'data:image/'+(path.extname(item.file)==='.png'?'png':'jpeg')+';base64,'+fs.readFileSync(item.file).toString('base64'),name:item.name,width:item.width,height:item.height,theme:this.getTheme()};});
  this.e.ipcMain.handle('screenshot-preview:action',async(event,action)=>{const item=this.viewerItem(event.sender);if(!item)throw Error('Unknown sender');if(!['copy','reveal'].includes(action))throw Error('Unknown action');return this.screenshot(action,item.id);});
  this.e.ipcMain.on('screenshot-preview:close',event=>{for(const [window]of this.viewers)if(!window.isDestroyed()&&window.webContents===event.sender)window.close();});
  this.e.ipcMain.handle('screenshot:frame',event=>{if(!this.selection||this.selection.window.isDestroyed()||event.sender!==this.selection.window.webContents)throw Error('Unknown sender');return this.selection.frame;});
  this.e.ipcMain.on('screenshot:ready',event=>{const selection=this.selection;if(selection&&!selection.window.isDestroyed()&&event.sender===selection.window.webContents){selection.window.show();selection.window.focus();}});
  this.e.ipcMain.on('screenshot:finish',(event,rect)=>{if(this.selection&&!this.selection.window.isDestroyed()&&event.sender===this.selection.window.webContents)this.selection.finish(rect);});
 }
 snapshot(){return {entries:this.entries,settings:this.config,recent:this.recent,busy:this.busy,remaining:this.remaining,launchingAll:this.launchingAll,error:this.error};}
 publish(){this.onUpdate(this.snapshot());}
 persist(){const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify({entries:this.entries,config:this.config,recent:this.recent}));fs.renameSync(temp,this.file);}
 async listProcesses(){
  let rows;if(this.processProvider)rows=await this.processProvider();else{
   if(process.platform!=='win32')throw Error('Список процессов доступен в Windows');
   const script=path.join(__dirname,'process-list.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
   const result=await runFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,timeout:15000,maxBuffer:3*1024*1024,encoding:'utf8'});rows=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  }
  const unique=new Map();for(const row of Array.isArray(rows)?rows:[]){if(typeof row.target!=='string'||!path.isAbsolute(row.target)||path.extname(row.target).toLowerCase()!=='.exe')continue;const key=row.target.toLowerCase();if(unique.has(key)){unique.get(key).pids.push(row.pid);continue;}unique.set(key,{id:randomUUID(),name:String(row.name||path.basename(row.target)).slice(0,120),title:String(row.title||'').slice(0,200),target:row.target,pids:[row.pid]});}
  const items=[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name));this.processes=new Map(items.map(item=>[item.id,{...item,at:Date.now()}]));return {ok:true,items};
 }
 async addTarget(target,kind,name){
  const stat=fs.statSync(target);if(kind==='folder'?!stat.isDirectory():!stat.isFile()||!['.exe','.lnk'].includes(path.extname(target).toLowerCase()))throw Error('Выберите приложение EXE, ярлык LNK или папку');
  if(this.entries.some(x=>x.target.toLowerCase()===target.toLowerCase()))throw Error('Это приложение или папка уже добавлены');
  let icon='';if(kind==='app')try{icon=(await this.e.app.getFileIcon(target,{size:'normal'})).resize({width:32,height:32}).toDataURL();}catch{}
  if(this.entries.length>=24)throw Error('Можно добавить до 24 ярлыков');
  this.entries.push({id:randomUUID(),name:name||path.basename(target).replace(/\.(exe|lnk)$/i,'')||target,target,kind,icon});this.persist();this.publish();return {ok:true};
 }
 updatePreviewTheme(){for(const [window] of this.viewers)if(!window.isDestroyed()){clipPreview(window,this.getTheme());window.webContents.send('preview:theme',this.getTheme());}}
 viewerItem(sender){for(const [window,item]of this.viewers)if(!window.isDestroyed()&&window.webContents===sender)return item;return null;}
 preview(item){
  for(const [window,entry]of this.viewers)if(entry.id===item.id&&!window.isDestroyed()){window.show();window.focus();return {ok:true};}
  const window=new this.e.BrowserWindow({width:1000,height:720,minWidth:600,minHeight:420,frame:false,transparent:true,hasShadow:false,backgroundColor:'#00000000',autoHideMenuBar:true,title:'EclipseIsland — '+item.name,webPreferences:{preload:path.join(__dirname,'screenshot-preview-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  setupPreview(window,this.getTheme);this.viewers.set(window,item);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.on('closed',()=>{this.viewers.delete(window);this.restoreOverlay();});window.loadFile(path.join(__dirname,'../src/screenshot-preview.html')).catch(()=>{if(!window.isDestroyed())window.destroy();});return {ok:true};
 }
 async launcher(action,id,value,parent){
  if(action==='open-all'){
   if(this.launchingAll)return {ok:false,error:'Приложения уже запускаются'};
   const entries=[...this.entries];if(!entries.length)return {ok:false,error:'Сначала добавьте приложения или папки'};
   this.launchingAll=true;this.publish();const failed=[];let launched=0;
   try{for(const entry of entries){try{await this.launcher('open',entry.id);launched++;}catch(error){failed.push(entry.name+': '+error.message);}if(entries.length>1)await this.wait(120);}}finally{this.launchingAll=false;this.publish();}
   return {ok:!failed.length,launched,total:entries.length,error:failed.length?'Запущено '+launched+' из '+entries.length+'. '+failed.join(' · '):null};
  }
  if(action==='add-process'){const item=this.processes.get(id);if(!item||Date.now()-item.at>300000)throw Error('Обновите список процессов');return this.addTarget(item.target,'app',item.name);}
  if(action==='add'){
   if(this.entries.length>=24)throw Error('Можно добавить до 24 ярлыков');
   const folder=value==='folder',options={title:folder?'Добавить папку':'Добавить приложение или ярлык',properties:[folder?'openDirectory':'openFile'],...(!folder?{filters:[{name:'Приложения и ярлыки',extensions:['exe','lnk']}]}:{})};
   const result=await this.e.dialog.showOpenDialog(...(parent?[parent,options]:[options]));if(result.canceled||!result.filePaths.length)return {ok:true,canceled:true};
   return this.addTarget(result.filePaths[0],folder?'folder':'app');
  }else{
   const index=this.entries.findIndex(x=>x.id===id);if(index<0)throw Error('Ярлык не найден');const item=this.entries[index];
   if(action==='open'){const stat=fs.statSync(item.target);if(item.kind==='folder'?!stat.isDirectory():!stat.isFile()||!['.exe','.lnk'].includes(path.extname(item.target).toLowerCase()))throw Error('Приложение или папка больше не доступны');const error=await this.e.shell.openPath(item.target);if(error)throw Error(error);return {ok:true};}
   if(action==='remove')this.entries.splice(index,1);
   else if(action==='rename'){const name=typeof value==='string'?value.trim().slice(0,80):'';if(!name)throw Error('Введите название');item.name=name;}
   else if(action==='move'){const next=index+(value===-1?-1:1);if(next>=0&&next<this.entries.length)[this.entries[index],this.entries[next]]=[this.entries[next],this.entries[index]];}
   else throw Error('Неизвестное действие');
  }
  this.persist();this.publish();return {ok:true};
 }
 async save(patch){const previous=this.config;this.config=shotSettings(patch||{},this.config);try{this.persist();}catch(error){this.config=previous;throw error;}this.publish();return {ok:true};}
 async folder(parent){const options={title:'Папка для скриншотов',defaultPath:this.config.folder,properties:['openDirectory','createDirectory']};const result=await this.e.dialog.showOpenDialog(...(parent?[parent,options]:[options]));if(!result.canceled&&result.filePaths.length){this.config.folder=result.filePaths[0];this.persist();this.publish();}return {ok:true};}
 async writeClipboard(image,png){if(this.e.ClipboardItem&&this.e.clipboard.write)await this.e.clipboard.write([new this.e.ClipboardItem({'image/png':new Blob([png||image.toPNG()],{type:'image/png'})})]);else await this.e.clipboard.writeImage(image);}
 async screenshot(action,id){
  if(['area','screen'].includes(action))return this.take(action);
  if(action==='cancel'){this.canceled=true;this.selection?.finish(null);return {ok:true};}
  if(action==='folder'){fs.mkdirSync(this.config.folder,{recursive:true});const error=await this.e.shell.openPath(this.config.folder);if(error)throw Error(error);return {ok:true};}
  const item=this.recent.find(x=>x.id===id)||(!id?this.recent[0]:null);if(!item)throw Error('Скриншот не найден');fs.statSync(item.file);
  if(action==='open')return this.preview(item);
  else if(action==='reveal')this.e.shell.showItemInFolder(item.file);
  else if(action==='copy'){const image=this.e.nativeImage.createFromPath(item.file);if(image.isEmpty())throw Error('Не удалось открыть изображение');await this.writeClipboard(image);}
  else throw Error('Неизвестное действие');return {ok:true};
 }
 async select(image,display){
  const window=new this.e.BrowserWindow({...display.bounds,frame:false,resizable:false,movable:false,skipTaskbar:true,alwaysOnTop:true,show:false,backgroundColor:'#111018',title:'EclipseIsland — Выделите область',webPreferences:{preload:path.join(__dirname,'screenshot-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.setAlwaysOnTop(true,'screen-saver');window.setMenuBarVisibility(false);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  return new Promise((resolve,reject)=>{
   let done=false;const timer=setTimeout(()=>finish(null),120000);timer.unref?.();
   const finish=rect=>{if(done)return;done=true;clearTimeout(timer);this.selection=null;resolve(rect);if(!window.isDestroyed())window.destroy();};
   this.selection={window,frame:{image:'data:image/jpeg;base64,'+image.toJPEG(92).toString('base64'),width:display.bounds.width,height:display.bounds.height,pixelWidth:image.getSize().width,pixelHeight:image.getSize().height,theme:this.getTheme()},finish};
   window.on('closed',()=>finish(null));window.webContents.on('render-process-gone',()=>finish(null));
   window.loadFile(path.join(__dirname,'../src/screenshot-select.html')).catch(error=>{if(!done){done=true;clearTimeout(timer);this.selection=null;reject(error);if(!window.isDestroyed())window.destroy();}});
  });
 }
 async take(mode){
  if(this.busy)return {ok:false,error:'Скриншот уже создаётся'};this.busy=true;this.canceled=false;this.error=null;this.publish();let restore;const config={...this.config};
  try{
   for(let n=config.countdown;n>0;n--){this.remaining=n;this.publish();await this.wait(1000);if(this.canceled)return {ok:true,canceled:true};}this.remaining=0;
   const display=config.monitor==='primary'?this.e.screen.getPrimaryDisplay():Number.isSafeInteger(config.monitor)?this.e.screen.getAllDisplays().find(x=>x.id===config.monitor):this.e.screen.getDisplayNearestPoint(this.e.screen.getCursorScreenPoint());if(!display)throw Error('Выбранный монитор отключён');
   restore=await this.hideSurfaces(config);await this.wait(100);if(this.canceled)return {ok:true,canceled:true};
   let image;
   if(this.captureFrame)image=await this.captureFrame(display,config.showCursor);
   else{
    const sources=await this.e.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.ceil(display.bounds.width*display.scaleFactor),height:Math.ceil(display.bounds.height*display.scaleFactor)}});
    const source=sources.find(x=>x.display_id===String(display.id))||(sources.length===1&&!sources[0].display_id&&this.e.screen.getAllDisplays().length===1?sources[0]:null);image=source?.thumbnail;
   }
   if(this.canceled)return {ok:true,canceled:true};
   if(!image||image.isEmpty())throw Error('Не удалось получить изображение выбранного экрана');
   restore?.();restore=null;
   if(mode==='area'){const rect=await this.select(image,display);if(!rect)return {ok:true,canceled:true};image=image.crop(pixelCrop(rect,display.bounds,image.getSize()));}
   if(config.maxHeight&&image.getSize().height>config.maxHeight)image=image.resize({height:config.maxHeight,quality:'best'});
   const {width,height}=image.getSize(),id=randomUUID(),name='EclipseIsland-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+id.slice(0,6)+'.'+config.format,file=path.join(config.folder,name);
   const png=config.format==='png'?image.toPNG():null,encoded=png||image.toJPEG(config.quality);fs.mkdirSync(config.folder,{recursive:true});fs.writeFileSync(file,encoded,{flag:'wx'});
   const scale=Math.min(1,240/width,150/height),thumbnail=image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});
   const entry={id,name,file,format:config.format,width,height,createdAt:Date.now(),thumbnail:'data:image/jpeg;base64,'+thumbnail.toJPEG(80).toString('base64')};this.recent=[entry,...this.recent].slice(0,24);this.persist();
   if(config.copy)try{await this.writeClipboard(image,png);}catch{this.error='Снимок сохранён, но не удалось скопировать в буфер';}
   if(config.openAfter)this.preview(entry);
   return {ok:true,id,copied:config.copy&&!this.error,error:this.error};
  }catch(error){this.error=error.message;return {ok:false,error:error.message};}
  finally{try{restore?.();}finally{this.busy=false;this.remaining=0;try{this.publish();}finally{try{this.restoreOverlay();}catch{}}}}
 }
 close(){this.canceled=true;this.selection?.finish(null);for(const [window]of this.viewers)if(!window.isDestroyed())window.destroy();}
}
module.exports={DesktopTools,pixelCrop,shotSettings};

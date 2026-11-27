const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell, clipboard, dialog, net, desktopCapturer, protocol, ClipboardItem } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const appIconPath=path.join(__dirname.replace('app.asar','app.asar.unpacked'),'../src/eclipse.ico');
const identifiedWindows=new WeakSet();
function applyAppIdentity(window){
  if(process.platform!=='win32'||identifiedWindows.has(window))return;
  window.setIcon?.(appIconPath);
  const details={appId:'app.eclipseisland.desktop',appIconPath,appIconIndex:0,relaunchDisplayName:'EclipseIsland'};
  if(process.env.ECLIPSE_LAUNCHER_PATH)details.relaunchCommand='\"'+process.env.ECLIPSE_LAUNCHER_PATH+'\"';
  else if(app.isPackaged)details.relaunchCommand='\"'+process.execPath+'\"';
  window.setAppDetails?.(details);identifiedWindows.add(window);
}
app.on('browser-window-created',(_event,window)=>applyAppIdentity(window));
const { sanitize, migrateLegacySettings } = require('./settings.cjs');
const { configureAutostart } = require('./autostart.cjs');
const { refreshLauncher } = require('./launcher-update.cjs');
const { searchCities, getWeather, useWeatherFetch, configureWeatherCache } = require('./weather.cjs');
const { MediaHub } = require('./media-hub.cjs');
const { registerMediaShortcuts } = require('./media-shortcuts.cjs');
const { CaptureController } = require('./capture.cjs');
const { TransferMonitor } = require('./transfers.cjs');
const { DesktopTools } = require('./desktop-tools.cjs');
const { ReplayController } = require('./replay.cjs');
const { DownloadsMonitor } = require('./downloads-monitor.cjs');
const { CompletionNotices } = require('./completion-notices.cjs');
const { OverlayVisibility } = require('./overlay-visibility.cjs');
protocol?.registerSchemesAsPrivileged([{scheme:'eclipse-recording',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
const { readToken } = require('./spotify-direct.cjs');
const { SpotifySetup } = require('./spotify-setup.cjs');
const { MediaDelivery } = require('./media-delivery.cjs');
const delivery=new MediaDelivery();
// Only the island and recorder opt out of background throttling. Hidden settings sleep.
const { clipDashboard, overlayShape } = require('./window-style.cjs');
const nativeBlur = false; // Use one CSS compositor; mixing DWM Acrylic and backdrop-filter caused flashes.
app.setName('EclipseIsland');
const preferencesDirectory=path.join(app.getPath('appData'),'EclipseIsland');
fs.mkdirSync(preferencesDirectory,{recursive:true});
app.setPath('userData',preferencesDirectory);
const launchedAtLogin=process.argv.includes('--autostart');
let autostart={ok:true,supported:process.platform==='win32',enabled:false,error:null};
let tools, dashboard, overlay, tray, media, settings, settingsPath, weatherTimer, spotifySetup, capture, replay, transfers, downloads, overlayVisibility, activityLeaseTimer;
let transferState={items:[],status:'off',supported:process.platform==='win32'}, downloadsState={items:[],recent:[],status:'ready',supported:true}, overlayHeartbeat=0,overlayTransferIds=[];
let recordWasActive=false;
let waitingForCaptureQuit=false,captureHotkeys=[];
let quitting = false, ignored = false, rect = {x:120,y:24,width:360,height:64};
let weather = {status:'empty'}, mediaState = {available:false,reason:'Подключаем медиасервис…'}, weatherGeneration = 0;
let shortcuts = {expand:false,visibility:false,mediaPrevious:false,mediaNext:false,mediaPause:false};
let mediaShortcuts;
let overlayProtection=false,protectionOverrides=0;
function applyOverlayProtection(value){overlayProtection=!!value;if(overlay&&!overlay.isDestroyed())overlay.setContentProtection(protectionOverrides?false:overlayProtection);}
let lastShape='', shapeAvailable=true, fallbackHitTimer;
const trusted = event => [dashboard,overlay].some(w => w && !w.isDestroyed() && w.webContents === event.sender);
function broadcast(type, value) {for(const w of [dashboard,overlay]) if(w && !w.isDestroyed() && (!['media','capture','transfers','replay','tools','downloads','weather'].includes(type)||(w.isVisible()&&!w.isMinimized?.()&&(w!==overlay||settings?.enabled)))){const sequence=type==='media'&&('title' in value||'artwork' in value||'active' in value)?delivery.sent(w.webContents.id):undefined;w.webContents.send('state',{type,value,sequence});}}
function completionSound(kind){
  if(!settings?.[kind+'Sound']||!settings.completionVolume)return;
  const target=[overlay,dashboard].find(w=>w&&!w.isDestroyed()&&!w.webContents.isLoading());
  if(target)target.webContents.send('state',{type:'completion-sound',value:{kind,tone:settings[kind+'Tone'],volume:settings.completionVolume}});
}
const completionNotices=new CompletionNotices(completionSound);
function saveSettings() {const tmp=settingsPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(settings,null,2));fs.renameSync(tmp,settingsPath);}
function positionOverlay() {
  if(!overlay || overlay.isDestroyed())return;
  const displays = screen.getAllDisplays();
  const display = displays.find(d=>d.id === settings.monitor) || screen.getPrimaryDisplay();
  const {x,y,width,height}=display.bounds;
  const top=Math.min(settings.offset,Math.max(0,height-80));
  const w=Math.min(600,width),h=Math.min(760,height-top);
  const bounds={x:Math.round(x+(width-w)/2),y:y+top,width:w,height:h};
  const previous=overlay.getBounds();
  if(Object.keys(bounds).some(key=>bounds[key]!==previous[key]))overlay.setBounds(bounds);
  lastShape='';clipOverlay();
  overlay.setAlwaysOnTop(settings.topmost,'screen-saver');
  overlayVisibility?.set(settings.enabled,settings.reducedMotion);
}
function applyMaterials(){
  // Never apply a native background material to a transparent window.
  clipDashboard(dashboard,settings);
  // Never set a native background material on the overlay, even to "none".
  // DWM materials paint the whole compositor surface on affected Windows builds.
  clipOverlay();
}
function clipOverlay(){
  if(!overlay||overlay.isDestroyed()||!shapeAvailable)return;
  const key=JSON.stringify(Object.values(rect).map(Math.round));if(lastShape===key)return;
  try{overlay.setShape(overlayShape(rect));lastShape=key;}
  catch{shapeAvailable=false;startHitFallback();}
}
function startHitFallback(){
  if(fallbackHitTimer)return;
  fallbackHitTimer=setInterval(()=>{
    if(!overlay||overlay.isDestroyed()||!overlay.isVisible())return;
    if(!settings.enabled){if(!ignored){overlay.setIgnoreMouseEvents(true,{forward:true});ignored=true;}return;}
    const point=screen.getCursorScreenPoint(),bounds=overlay.getBounds();
    const x=point.x-bounds.x,y=point.y-bounds.y;
    const next=!(x>=rect.x&&x<=rect.x+rect.width&&y>=rect.y&&y<=rect.y+rect.height);
    if(next!==ignored){overlay.setIgnoreMouseEvents(next,{forward:true});ignored=next;}
  },100);
}
function syncView(window){if(window.isDestroyed())return;window.webContents.send('state',{type:'view-visible',value:true});window.webContents.send('state',{type:'snapshot',value:{settings,weather,media:mediaState,autostart,spotifySetup:spotifySetup?.state,capture:capture?.snapshot()||null,transfers:transferState,tools:tools?.snapshot()||null,replay:replay?.snapshot()||null,downloads:downloadsState},sequence:delivery.sent(window.webContents.id)});}
function restoreOverlayInteraction(){
 if(quitting||!settings?.enabled||!overlay||overlay.isDestroyed())return;
 overlay.setAlwaysOnTop(settings.topmost,'screen-saver');
 overlayVisibility?.recover();
 if(settings.topmost)overlay.moveTop?.();
}
function resetOverlayAfterSelection(){
 if(quitting)return;
 // A fresh native input surface avoids reusing Chromium's stale mouse routing
 // after a fullscreen selector owned OS capture. Keep every service running.
 const previous=overlay;overlayVisibility?.dispose();overlayVisibility=null;
 overlayHeartbeat=0;overlayTransferIds=[];transfers?.lease(false);
 if(previous){delivery.views.delete(previous.webContents.id);if(!previous.isDestroyed())previous.destroy();}
 overlay=null;lastShape='';ignored=false;createOverlay();
 applyOverlayProtection(overlayProtection);
}
function configureWindow(window) {
  applyAppIdentity(window);
  window.webContents.setWindowOpenHandler(({url}) => {if(['https://wttr.in/','https://api.met.no/','https://open-meteo.com/','https://github.com/hflabs/city'].includes(url))shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
  const visible=()=>{if(!window.isDestroyed()&&!window.isMinimized?.())syncView(window);};
  window.on('show',visible);window.on('restore',visible);
  for(const event of ['hide','minimize'])window.on(event,()=>{if(!window.isDestroyed())window.webContents.send('state',{type:'view-visible',value:false});});
}
function createDashboard() {
  if(dashboard && !dashboard.isDestroyed()){dashboard.show();dashboard.focus();return;}
  dashboard=new BrowserWindow({width:1180,height:830,minWidth:940,minHeight:720,frame:false,transparent:true,resizable:false,hasShadow:false,backgroundColor:'#00000000',show:false,icon:process.platform==='win32'?appIconPath:path.join(__dirname,'../src/eclipse-logo.png'),title:'EclipseIsland — Настройки',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true,autoplayPolicy:'no-user-gesture-required'}});
  configureWindow(dashboard);
  clipDashboard(dashboard,settings);
  dashboard.on('resize',()=>clipDashboard(dashboard,settings));
  dashboard.loadFile(path.join(__dirname,'../src/index.html'));
  dashboard.webContents.once('dom-ready',()=>{if(!dashboard.isDestroyed()&&!dashboard.isVisible())dashboard.show();});
  dashboard.once('ready-to-show',()=>{applyMaterials();dashboard.show();});
  dashboard.on('close',event=>{if(!quitting){event.preventDefault();dashboard.hide();}});
}
function createOverlay() {
  overlay=new BrowserWindow({width:600,height:760,frame:false,transparent:true,resizable:false,hasShadow:false,skipTaskbar:true,focusable:false,alwaysOnTop:true,show:false,title:'EclipseIsland',backgroundColor:'#00000000',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,focusOnNavigation:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  overlayVisibility=new OverlayVisibility(overlay,{beforeShow:()=>{ignored=false;lastShape='';clipOverlay();syncView(overlay);},afterHide:()=>{ignored=true;overlayHeartbeat=0;overlayTransferIds=[];transfers?.lease(false);}});
  configureWindow(overlay);
  clipOverlay();
  overlay.loadFile(path.join(__dirname,'../src/overlay.html'),{query:{view:'overlay'}});
  overlay.once('ready-to-show',()=>{overlay.setFocusable(false);applyMaterials();positionOverlay();});
  // Native clipping supplies hit-testing too; no global mouse polling is needed.
}
async function refreshWeather(force=false) {
  const generation=++weatherGeneration;
  if(!settings.city){weather={status:'empty'};broadcast('weather',weather);return weather;}
  const city=settings.city;
  weather={...weather,status:'loading'};broadcast('weather',weather);
  try {const result=await getWeather(city,{force});if(generation!==weatherGeneration)return weather;weather={status:'ready',...result};}
  catch(error){if(generation!==weatherGeneration)return weather;weather={...weather,status:'error',error:error.message};}
  broadcast('weather',weather);return weather;
}
function registerIPC() {
  const handle=(channel,fn)=>ipcMain.handle(channel,(event,...args)=>{if(!trusted(event))throw new Error('Unknown sender');return fn(...args);});
  const listen=(channel,fn)=>ipcMain.on(channel,(event,...args)=>{if(trusted(event))fn(event,...args);});
  handle('init',()=>({settings,weather,media:mediaState,nativeBlur,autostart,platform:process.platform,version:app.getVersion(),spotifySetup:spotifySetup?.state,capture:capture?.snapshot()||null,transfers:transferState,tools:tools?.snapshot()||null,replay:replay?.snapshot()||null,downloads:downloadsState,shortcuts,monitors:screen.getAllDisplays().map((d,i)=>({id:d.id,label:d.label || `Экран ${i+1}`}))}));
  handle('settings:save',input=>{
    const next=sanitize(input);const previous=settings;
    const startupChanged=next.autoLaunch!==previous.autoLaunch;
    if(startupChanged){const result=configureAutostart(app,next.autoLaunch,{force:true});if(!result.ok)throw new Error(result.error);autostart=result;}
    settings=next;
    try{saveSettings();}catch{settings=previous;if(startupChanged)autostart=configureAutostart(app,previous.autoLaunch,{force:true});throw new Error('Не удалось сохранить настройки');}
    if(['enabled','topmost','offset','monitor'].some(key=>next[key]!==previous[key]))positionOverlay();
    if(next.uiRenderer!==previous.uiRenderer||next.advancedTheme!==previous.advancedTheme||next.cardRadius!==previous.cardRadius||(next.blur>0)!==(previous.blur>0))applyMaterials();
    if(next.mediaSource!==previous.mediaSource)media?.setSource(next.mediaSource);
    transfers?.configure(settings.showTransfers);
    if(next.showDownloads!==previous.showDownloads){if(next.showDownloads)downloads?.start();else downloads?.stop();}
    if(!settings.replaceTransferWindow||!settings.showTransfers)transfers?.lease(false);
    tools?.updatePreviewTheme();capture?.updatePreviewTheme();broadcast('settings',settings);if(startupChanged)broadcast('autostart',autostart);return settings;
  });
  handle('launcher:processes',()=>tools.listProcesses().catch(error=>({ok:false,error:error.message})));
  listen('island:input-ready',(event,epoch)=>{if(event.sender===overlay?.webContents&&Number.isSafeInteger(epoch))overlayVisibility?.inputReady(epoch);});
  listen('island:focus-input',(event,value)=>{if(event.sender===overlay?.webContents&&settings.enabled){overlay.setFocusable(!!value);if(value)overlay.focus();}});
  handle('launcher:action',async(action,id,value)=>{try{return await tools.launcher(action,id,value,dashboard?.isVisible()?dashboard:undefined);}catch(error){return {ok:false,error:error.message};}});
  handle('screenshot:action',async(action,id)=>tools.screenshot(action,id).catch(error=>({ok:false,error:error.message})));
  handle('desktop-tools:save',patch=>tools.save(patch));
  handle('screenshot:folder',()=>tools.folder(dashboard?.isVisible()?dashboard:undefined));
  handle('downloads:ayu-folder',async()=>{const result=await dialog.showOpenDialog(dashboard,{title:'Папка загрузок AyuGram',defaultPath:settings.ayuDownloadFolder||app.getPath('downloads'),properties:['openDirectory']});if(result.canceled)return {ok:true,canceled:true};const previous=settings;settings=sanitize({...settings,ayuDownloadFolder:result.filePaths[0]});try{saveSettings();}catch(error){settings=previous;throw error;}downloads?.setAyuFolder(settings.ayuDownloadFolder);broadcast('settings',settings);return {ok:true};});
  handle('downloads:action',(action,id)=>downloads?.action(action,id,shell)||{ok:false,error:'Загрузки недоступны'});
  handle('weather:search',async query=>{try{return {ok:true,items:await searchCities(query)};}catch(error){return {ok:false,error:error.message};}});
  handle('weather:select',async city=>{
    const next=sanitize({...settings,city});if(!next.city)throw new Error('Некорректный город');
    const previous=settings;settings=next;try{saveSettings();}catch{settings=previous;throw new Error('Не удалось сохранить город');}
    weather={status:'empty'};broadcast('settings',settings);return refreshWeather();
  });
  handle('weather:refresh',()=>refreshWeather(true));
  handle('media:command',(action,seconds)=>media.command(action,seconds));
  handle('capture:action',recordAction);
  handle('capture:sources',()=>capture?capture.sources():[]);
  handle('capture:save',async patch=>{if(!capture)throw Error('Настройка записи доступна в Windows');const value=await capture.save(patch);await replay?.configure(capture.store.settings,!capture.current);configureCaptureShortcuts();return value;});
  handle('transfers:action',(action,id)=>{const result=transfers?.command(action,id)||{ok:false,error:'Операция недоступна'};if(action==='cancel'&&result.ok)completionNotices.cancel(id);return result;});
  listen('activities:heartbeat',(event,ids)=>{if(event.sender===overlay?.webContents){overlayHeartbeat=performance.now();overlayTransferIds=Array.isArray(ids)?ids.filter(x=>typeof x==='string'&&/^\d+$/.test(x)).slice(0,12):[];transfers?.lease(!!settings.showTransfers&&!!settings.replaceTransferWindow&&settings.enabled&&!!overlay?.isVisible()&&transferState.status==='ready',overlayTransferIds);}});
  handle('capture:folder',()=>capture?.folder(dashboard));
  handle('spotify:setup',()=>spotifySetup.run(true));
  handle('spotify:setup-log',async()=>{const error=await shell.openPath(path.join(preferencesDirectory,'spotify-setup.log'));return {ok:!error,error:error||null};});
  handle('media:diagnostics',async()=>{await clipboard.writeText(JSON.stringify({version:app.getVersion(),...media.getDiagnostics(),spotifySetup:spotifySetup?.state,renderer:delivery.snapshot(),fileOperations:transfers?.diagnostics()},null,2));return {ok:true};});
  listen('media:applied',(event,sequence)=>delivery.applied(event.sender.id,sequence));
  listen('settings:show',(_event,page)=>page==='capture'?showCaptureDashboard():['launcher','launcher-processes','screenshots'].includes(page)?showToolsDashboard(page):createDashboard());
  listen('window:minimize',event=>BrowserWindow.fromWebContents(event.sender)?.minimize());
  listen('window:close',event=>{if(event.sender===dashboard?.webContents)dashboard.hide();});
  listen('app:quit',()=>app.quit());
  listen('island:bounds',(event,r)=>{
    if(event.sender!==overlay?.webContents || !r || !['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.width<=0||r.height<=0)return;
    const bounds=overlay.getBounds();
    rect={x:Math.max(0,Math.min(bounds.width-1,r.x)),y:Math.max(0,Math.min(bounds.height-1,r.y)),width:Math.min(bounds.width,Math.max(1,r.width)),height:Math.min(bounds.height,Math.max(1,r.height)),radius:Number.isFinite(r.radius)?Math.max(0,Math.min(80,r.radius)):28};
    clipOverlay();
  });
}
async function recordAction(action,id){
 if(action==='replay-save')return replay?.requestSave()||{ok:false,error:'Повтор доступен в Windows'};
 if(!capture)return {ok:false,error:'Запись доступна в Windows'};
 if(action==='start')await replay?.suspend();
 const result=await capture.action(action,id);if(action==='start'&&!capture.current&&!waitingForCaptureQuit)replay?.configure(capture.store.settings,true);return result;
}
function showCaptureDashboard(){
  createDashboard();const target=dashboard;const send=()=>{if(target&&!target.isDestroyed())target.webContents.send('state',{type:'capture-panel'});};
  if(target.webContents.isLoading?.())target.webContents.once('did-finish-load',send);else send();
}
function configureCaptureShortcuts(){
  if(!capture)return;
  for(const accelerator of captureHotkeys)globalShortcut.unregister(accelerator);captureHotkeys=[];
  const config=capture.store.settings;
  shortcuts.record=globalShortcut.register(config.hotkey,()=>{recordAction(capture.current?'stop':'start').catch(error=>console.error('Capture',error.message));});
  shortcuts.capturePanel=globalShortcut.register(config.panelHotkey,()=>{if(settings.enabled&&overlay&&!overlay.isDestroyed()){positionOverlay();overlay.webContents.send('state',{type:'capture-panel'});}else showCaptureDashboard();});
  shortcuts.replay=globalShortcut.register(config.replayHotkey,()=>{const result=replay?.requestSave();if(result?.ok===false)broadcast('replay',{...replay.snapshot(),error:result.error});});
  if(shortcuts.replay)captureHotkeys.push(config.replayHotkey);
  if(shortcuts.record)captureHotkeys.push(config.hotkey);if(shortcuts.capturePanel)captureHotkeys.push(config.panelHotkey);
  broadcast('shortcuts',shortcuts);
}
function showToolsDashboard(panel){
 createDashboard();const target=dashboard,send=()=>{if(!target.isDestroyed())target.webContents.send('state',{type:'tools-panel',value:panel});};if(target.webContents.isLoading())target.webContents.once('did-finish-load',send);else send();
}
function showToolsPanel(panel){
 if(settings.enabled&&overlay&&!overlay.isDestroyed()){positionOverlay();overlay.webContents.send('state',{type:'tools-panel',value:panel});}
 else showToolsDashboard(panel);
}
const instanceFile=path.join(preferencesDirectory,'active-instance.json');
if(!app.requestSingleInstanceLock()){
  let activeVersion;try{activeVersion=JSON.parse(fs.readFileSync(instanceFile,'utf8')).version;}catch{}
  if(activeVersion!==app.getVersion())dialog?.showErrorBox('Новая версия EclipseIsland не запущена','Уже работает другой экземпляр EclipseIsland. Закройте его через значок в трее → «Выйти», затем снова запустите этот EXE. Открытие старого окна не устанавливает обновление.');
  app.quit();
}else{
  try{fs.writeFileSync(instanceFile,JSON.stringify({version:app.getVersion(),pid:process.pid}));}catch{}
  app.on('second-instance',(_event,argv=[])=>{if(app.isReady()&&!argv.includes('--autostart'))createDashboard();});
  app.whenReady().then(()=>{
    app.setAppUserModelId('app.eclipseisland.desktop');
    if(net?.fetch)useWeatherFetch?.((url,options)=>net.fetch(url,options));
    configureWeatherCache?.(preferencesDirectory);
    refreshLauncher(app).catch(error=>console.error('Launcher update',error.code||error.message));
    settingsPath=path.join(app.getPath('userData'),'settings.json');
    try{settings=sanitize(JSON.parse(fs.readFileSync(settingsPath,'utf8')));}catch{
      try{settings=migrateLegacySettings(JSON.parse(fs.readFileSync(path.join(app.getPath('appData'),'island-pc','settings.json'),'utf8')));}catch{settings=sanitize();}
    }
    autostart=configureAutostart(app,settings.autoLaunch);
    if(process.platform==='win32'){
      capture=new CaptureController({app,BrowserWindow,desktopCapturer,dialog,shell,protocol,ipcMain,screen},preferencesDirectory,value=>{broadcast('capture',value);if(recordWasActive&&!value.active&&!waitingForCaptureQuit)replay?.configure(capture.store.settings,true);recordWasActive=value.active;},config=>{
        applyOverlayProtection(config?.excludeIsland);
        if(config?.hideSettings&&dashboard&&!dashboard.isDestroyed())dashboard.hide();
      },{getTheme:()=>settings,restoreOverlay:restoreOverlayInteraction});
      replay=new ReplayController({app,BrowserWindow,desktopCapturer,dialog,shell,protocol,ipcMain,screen},preferencesDirectory,capture.store,value=>{broadcast('replay',value);if(value.lastSaved&&capture.state.lastSaved!==value.lastSaved){capture.state.lastSaved=value.lastSaved;capture.refresh().catch(()=>{});}},config=>{applyOverlayProtection(config?.excludeIsland);});
      transfers=new TransferMonitor(value=>{transferState=value;completionNotices.transfer(value);broadcast('transfers',value);});
    }
    spotifySetup=new SpotifySetup(preferencesDirectory,value=>broadcast('spotify-setup',value));
    downloads=new DownloadsMonitor(preferencesDirectory,value=>{downloadsState=value;completionNotices.download(value);broadcast('downloads',value);},{folder:app.getPath('downloads'),telegramFolders:process.env.APPDATA?[path.join(process.env.APPDATA,'Telegram Desktop','tdata','temp_data')]:[],ayuFolders:process.env.APPDATA?['AyuGram','AyuGram Desktop','AyuGramDesktop'].map(name=>path.join(process.env.APPDATA,name,'tdata','temp_data')):[]});
    downloads.setAyuFolder(settings.ayuDownloadFolder);downloadsState=downloads.snapshot();
    tools=new DesktopTools({app,BrowserWindow,desktopCapturer,screen,clipboard,ClipboardItem,nativeImage,shell,dialog,ipcMain},preferencesDirectory,value=>broadcast('tools',value),{restoreOverlay:restoreOverlayInteraction,getTheme:()=>settings,resetOverlay:resetOverlayAfterSelection,hideSurfaces:config=>{
      const resume=config.excludeIsland?overlayVisibility?.suspend():null;
      const hiddenDashboard=config.hideSettings&&dashboard&&!dashboard.isDestroyed()&&dashboard.isVisible()?dashboard:null;
      if(hiddenDashboard)try{hiddenDashboard.setOpacity(0);}catch{}
      const includeIsland=!config.excludeIsland;if(includeIsland){protectionOverrides++;try{applyOverlayProtection(overlayProtection);}catch{}}
      let restored=false;return ()=>{if(restored)return;restored=true;try{if(hiddenDashboard&&!hiddenDashboard.isDestroyed())hiddenDashboard.setOpacity(1);}catch{}try{if(includeIsland){protectionOverrides--;applyOverlayProtection(overlayProtection);}}finally{resume?.();}};
    }});
    registerIPC();createOverlay();if(!launchedAtLogin)createDashboard();
    const icon=process.platform==='win32'?appIconPath:nativeImage.createFromPath(path.join(__dirname,'../src/eclipse-logo.png'));
    tray=new Tray(icon);tray.setToolTip('EclipseIsland');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'Открыть настройки',click:createDashboard},
      {label:'Быстрый запуск',click:()=>showToolsPanel('launcher')},
      {label:'Скриншот области',click:()=>tools.screenshot('area')},
      {label:'Скриншот экрана',click:()=>tools.screenshot('screen')},
      ...(capture?[{label:'Запись экрана',click:showCaptureDashboard},{label:'Начать / остановить запись',click:()=>{recordAction(capture.current?'stop':'start').catch(error=>console.error(error.message));}}]:[]),
      {label:'Показать / скрыть остров',click:()=>{settings.enabled=!settings.enabled;saveSettings();positionOverlay();broadcast('settings',settings);}},
      {type:'separator'}, {label:'Выйти из EclipseIsland',click:()=>app.quit()}
    ]));tray.on('double-click',createDashboard);
    shortcuts.expand=globalShortcut.register('CommandOrControl+Alt+Space',()=>{if(!settings.enabled)return;overlay?.webContents.send('state',{type:'expand'});});
    shortcuts.visibility=globalShortcut.register('CommandOrControl+Alt+I',()=>{settings.enabled=!settings.enabled;saveSettings();positionOverlay();broadcast('settings',settings);});
    shortcuts.screenshotArea=globalShortcut.register('CommandOrControl+Alt+S',()=>tools.screenshot('area'));
    shortcuts.screenshotScreen=globalShortcut.register('CommandOrControl+Alt+P',()=>tools.screenshot('screen'));
    shortcuts.launcher=globalShortcut.register('CommandOrControl+Alt+L',()=>showToolsPanel('launcher'));
    media=new MediaHub(value=>{mediaState={...mediaState,...value};mediaShortcuts?.update(media.state);broadcast('media',value);},artwork=>{
      const image=nativeImage.createFromDataURL(artwork);if(image.isEmpty())return null;
      const {width,height}=image.getSize();const small=Math.max(width,height)>320?image.resize(width>=height?{width:320}:{height:320}):image;
      return 'data:image/jpeg;base64,'+small.toJPEG(88).toString('base64');
    },settings.mediaSource,{direct:{token:readToken(path.join(preferencesDirectory,'spotify-bridge.json')),fetch:net?.fetch?((url,options)=>net.fetch(url,options)):undefined}});media.start();
    mediaShortcuts=registerMediaShortcuts(globalShortcut,media,error=>console.error('Media shortcut',error));
    Object.assign(shortcuts,mediaShortcuts.shortcuts);broadcast('shortcuts',shortcuts);
    capture?.refresh().catch(error=>console.error('Recording history',error.code||error.message));
    replay?.configure(capture.store.settings,true);
    configureCaptureShortcuts();transfers?.configure(settings.showTransfers);if(settings.showDownloads)downloads?.start();
    activityLeaseTimer=setInterval(()=>transfers?.lease(!!settings.showTransfers&&!!settings.replaceTransferWindow&&settings.enabled&&!!overlay?.isVisible()&&performance.now()-overlayHeartbeat<2000&&transferState.status==='ready',overlayTransferIds),500);
    spotifySetup.run().catch(error=>console.error('Spotify setup failed',error.code||error.message));
    refreshWeather();weatherTimer=setInterval(refreshWeather,15*60*1000);
    screen.on('display-metrics-changed',positionOverlay);screen.on('display-removed',positionOverlay);screen.on('display-added',positionOverlay);
  });
  app.on('before-quit',event=>{
    if(capture?.current||replay?.window||replay?.saving){event.preventDefault();if(!waitingForCaptureQuit){waitingForCaptureQuit=true;Promise.all([capture?.stop(),replay?.configure(capture.store.settings,false)]).finally(()=>app.quit());}return;}
    quitting=true;tools?.close();clearInterval(activityLeaseTimer);transfers?.stop();downloads?.stop();clearInterval(fallbackHitTimer);clearInterval(weatherTimer);media?.stop();spotifySetup?.stop();globalShortcut.unregisterAll();});
  app.on('window-all-closed',()=>{});
  app.on('activate',()=>{if(app.isReady())createDashboard();});
}

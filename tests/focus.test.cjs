const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
test('island is nonactivating and media updates do not focus or show game-overlay windows',async()=>{
  const windows=[],accelerators=new Map(),startedServices=[];let update,restoreFromPreview,resetFromSelection;
  // Exercise the Windows startup branch on every host without starting native services.
  const testProcess={...process,platform:'win32',env:{},argv:[process.execPath]};
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.shows=0;this.focuses=0;this.visible=false;this.materials=[];this.shapes=[];this.messages=[];this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.session={setPermissionRequestHandler:()=>{}};this.webContents.send=(_,value)=>this.messages.push(value);windows.push(this);}
    isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;this.visible=false;this.emit('closed');}setContentProtection(v){this.protected=v;}isVisible(){return this.visible;}loadFile(file){this.file=file;}setPosition(){}getBounds(){return this.bounds||{x:0,y:0,width:this.options.width,height:this.options.height};}setBounds(bounds){this.bounds={...bounds};}setAlwaysOnTop(){}hide(){this.visible=false;this.emit('hide');}setShape(v){this.shapes.push(v);}setBackgroundMaterial(v){this.materials.push(v);}setIcon(v){this.icon=v;}setAppDetails(v){this.appDetails=v;}setFocusable(v){this.focusable=v;}setIgnoreMouseEvents(v){this.ignored=v;}setOpacity(v){this.opacity=v;}showInactive(){this.visible=true;this.shows++;this.emit('show');}show(){this.visible=true;this.shows++;this.emit('show');}focus(){this.focuses++;}
  }
  class Tray extends EventEmitter{setToolTip(){}setContextMenu(){}}
  const flags=new Map([['disable-features','ExistingFeature']]);
  const app=new EventEmitter();app.commandLine={appendSwitch:(name,value)=>flags.set(name,value||''),getSwitchValue:name=>flags.get(name)||''};Object.assign(app,{requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),isReady:()=>true,setName:()=>{},setPath:()=>{},setAppUserModelId:()=>{},getPath:()=>'/mock',getAppPath:()=>'/mock/project',getLoginItemSettings:()=>({openAtLogin:false,launchItems:[]}),setLoginItemSettings:()=>{},getVersion:()=> '0.3.0'});
  const screen=new EventEmitter();Object.assign(screen,{getAllDisplays:()=>[{id:1,bounds:{x:0,y:0,width:1920,height:1080}}],getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920,height:1080}})});
  const electron={app,BrowserWindow:Window,screen,ipcMain:{on(){},handle(){}},globalShortcut:{register:(key,fn)=>{accelerators.set(key,fn);return true;}},Tray,Menu:{buildFromTemplate:()=>[]},nativeImage:{createFromPath:()=>({})},shell:{}};
  const main=path.join(__dirname,'../electron/main.cjs');
  const requireMock=name=>{
    if(name==='electron')return electron;
    if(name==='node:fs')return {mkdirSync:()=>{},writeFileSync:()=>{},renameSync:()=>{},readFileSync:()=>{throw new Error('No saved settings');}};
    if(name==='./spotify-direct.cjs')return {readToken:()=> 'a'.repeat(64)};
    if(name==='./media-hub.cjs')return {MediaHub:class{constructor(callback){this.state={};update=value=>{this.state={...this.state,...value};callback(value);};}start(){}}};
    if(name==='./capture.cjs')return {CaptureController:class{
      constructor(...args){restoreFromPreview=args[4]?.restoreOverlay;startedServices.push('capture');this.state={status:'idle'};this.store={settings:{...require('../electron/capture-store.cjs').defaults}};}
      snapshot(){return {active:false,status:'idle'};}async refresh(){}async stop(){}
    }};
    if(name==='./replay.cjs')return {ReplayController:class{
      constructor(){startedServices.push('replay');}snapshot(){return {status:'off'};}async configure(){}
    }};
    if(name==='./transfers.cjs')return {TransferMonitor:class{
      constructor(){startedServices.push('transfers');}configure(){}lease(){}stop(){}
    }};
    if(name==='./spotify-setup.cjs')return {SpotifySetup:class{run(){return Promise.resolve();}}};
    if(name==='./downloads-monitor.cjs')return {DownloadsMonitor:class{
      setAyuFolder(){}snapshot(){return {items:[],recent:[],status:'ready'};}start(){}stop(){}
    }};
    if(name==='./desktop-tools.cjs')return {DesktopTools:class extends require('../electron/desktop-tools.cjs').DesktopTools{constructor(...args){super(...args);resetFromSelection=args[3].resetOverlay;}}};
    if(name==='./weather.cjs')return {};
    if(name.startsWith('./'))return require(path.resolve(path.dirname(main),name));
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(main,'utf8'),{require:requireMock,__dirname:path.dirname(main),process:testProcess,setInterval:()=>1,clearInterval:()=>{},setTimeout,console});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(startedServices,['capture','replay','transfers'],'Windows services are isolated while their startup branch is exercised');
  assert.equal(flags.has('disable-background-timer-throttling'),false);assert.equal(flags.has('disable-renderer-backgrounding'),false);assert.equal(flags.get('disable-features'),'ExistingFeature');
  let overlay=windows.find(w=>w.options.skipTaskbar);assert.ok(overlay);assert.equal(overlay.options.focusable,false);assert.equal(overlay.options.type,'toolbar');assert.equal(overlay.options.webPreferences.focusOnNavigation,false);
  overlay.emit('ready-to-show');assert.equal(overlay.focusable,false);const shows=overlay.shows;
  update({available:true,active:true,title:'Track',playing:true});assert.equal(overlay.shows,shows);assert.equal(overlay.focuses,0);
  assert.equal(path.basename(overlay.file),'overlay.html');assert.equal(overlay.options.webPreferences.backgroundThrottling,false);
  assert.deepEqual(overlay.materials,[],'no native background calls, including none, on the transparent overlay');
  assert.ok(overlay.shapes.length>0);assert.ok(overlay.shapes.every(shape=>shape.length>0));
  const hide=accelerators.get('CommandOrControl+Alt+I');assert.equal(typeof hide,'function');hide();assert.equal(overlay.visible,true,'hide animation starts before native Hide');await new Promise(resolve=>setTimeout(resolve,230));assert.equal(overlay.visible,true,'native HWND stays alive');assert.equal(overlay.opacity,0);assert.equal(overlay.ignored,true);
  const original=overlay;hide();assert.equal(original.destroyed,true,'return replaces the native input surface');overlay=windows.at(-1);assert.notEqual(overlay,original);overlay.emit('ready-to-show');assert.equal(overlay.visible,true);assert.equal(overlay.ignored,false);assert.ok(overlay.shapes.length>0);assert.equal(overlay.focuses,0);
  // Repeated hotkey cycles cannot leave old timers or a stale ready callback in charge.
  for(let i=0;i<4;i++){const old=overlay;hide();hide();overlay=windows.at(-1);assert.equal(old.destroyed,true);assert.notEqual(overlay,old);old.emit('ready-to-show');overlay.emit('ready-to-show');assert.equal(overlay.visible,true);assert.equal(overlay.ignored,false);assert.equal(overlay.focuses,0);assert.equal(overlay.options.type,'toolbar');}
  // Hide while the fresh window is still loading, then show again.
  hide();hide();const loading=windows.at(-1);hide();loading.emit('ready-to-show');assert.equal(loading.opacity,0);hide();overlay=windows.at(-1);assert.equal(loading.destroyed,true);overlay.emit('ready-to-show');assert.equal(overlay.ignored,false);assert.equal(overlay.opacity,1);

  const dashboard=windows.find(w=>!w.options.skipTaskbar);assert.equal(dashboard.messages.some(m=>m.type==='media'),false,'hidden settings receive no media ticks');
  dashboard.webContents.emit('dom-ready');assert.equal(dashboard.visible,true,'HTML loader is shown without waiting for media or ready-to-show');
  assert.equal(dashboard.options.webPreferences.backgroundThrottling,true);assert.equal(dashboard.options.type,undefined);assert.equal(dashboard.options.skipTaskbar,undefined);
  assert.match(dashboard.icon,/eclipse\.ico$/);assert.equal(dashboard.appDetails.appId,'app.eclipseisland.desktop');assert.equal(dashboard.appDetails.appIconPath,dashboard.icon);
  dashboard.visible=false;dashboard.emit('minimize');
  update({available:true,active:true,trackKey:'restored-track',title:'Changed while minimized',playing:true});
  dashboard.visible=true;dashboard.emit('restore');
  const fresh=dashboard.messages.filter(m=>m.type==='snapshot').at(-1);
  assert.equal(fresh.value.media.title,'Changed while minimized');assert.ok(Number.isInteger(fresh.sequence));
  assert.equal(dashboard.messages.at(-2).type,'view-visible');assert.equal(dashboard.messages.at(-2).value,true);
  assert.equal(typeof restoreFromPreview,'function');const shapeCount=overlay.shapes.length;overlay.ignored=true;const focusCount=overlay.focuses;
  restoreFromPreview();assert.equal(overlay.ignored,false);assert.ok(overlay.shapes.length>shapeCount);assert.equal(overlay.focuses,focusCount);
  hide();await new Promise(resolve=>setTimeout(resolve,230));const hiddenOpacity=overlay.opacity;restoreFromPreview();assert.equal(overlay.opacity,hiddenOpacity);assert.equal(overlay.ignored,true);
  assert.equal(typeof resetFromSelection,'function');
  resetFromSelection();assert.equal(overlay.destroyed,true);const replacement=windows.at(-1);replacement.emit('ready-to-show');
  assert.equal(replacement.options.skipTaskbar,true);assert.equal(replacement.opacity,0,'manually hidden island remains hidden after replacement');assert.equal(replacement.focuses,0);
  hide();assert.equal(replacement.destroyed,true);const shown=windows.at(-1);shown.emit('ready-to-show');assert.equal(shown.opacity,1);assert.equal(shown.ignored,false);update({available:true,title:'After crop',active:true});assert.equal(shown.messages.at(-1).value.title,'After crop');
  assert.deepEqual(startedServices,['capture','replay','transfers'],'replacing island does not restart services');
  windows.length=0;
  vm.runInNewContext(fs.readFileSync(main,'utf8'),{require:requireMock,__dirname:path.dirname(main),process:{...testProcess,argv:[process.execPath,'--autostart']},setInterval:()=>1,clearInterval:()=>{},setTimeout,console});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(windows.length,1,'login launch creates only the island, without settings');assert.equal(windows[0].options.focusable,false);
  let blockedNotice=false,quit=false;app.requestSingleInstanceLock=()=>false;app.quit=()=>{quit=true;};electron.dialog={showErrorBox:()=>{blockedNotice=true;}};
  vm.runInNewContext(fs.readFileSync(main,'utf8'),{require:requireMock,__dirname:path.dirname(main),process:testProcess,setInterval:()=>1,clearInterval:()=>{},setTimeout,console});
  assert.equal(blockedNotice,true,'starting an update cannot silently show an unknown older instance');assert.equal(quit,true);

});

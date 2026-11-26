const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
test('ordinary recording suspends replay first and quitting cannot restart a background encoder',async()=>{
 const calls=[],windows=[],handlers={};let capture,quit=0;
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.visible=false;this.webContents=new EventEmitter();this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.session={setPermissionRequestHandler:()=>{}};windows.push(this);}isDestroyed(){return false;}isVisible(){return this.visible;}loadFile(){}setPosition(){}setAlwaysOnTop(){}setShape(){}setFocusable(){}setIgnoreMouseEvents(){}showInactive(){this.visible=true;}hide(){this.visible=false;}}
 class Tray extends EventEmitter{setToolTip(){}setContextMenu(){}}
 const app=new EventEmitter();Object.assign(app,{commandLine:{appendSwitch(){},getSwitchValue:()=>''},getPath:()=>'/mock',setName(){},setPath(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),isReady:()=>true,setAppUserModelId(){},getVersion:()=> '0.7.0',quit:()=>quit++});
 const screen=new EventEmitter();Object.assign(screen,{getAllDisplays:()=>[],getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920}})});
 const electron={app,screen,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers[name]=fn,on(){}},Tray,Menu:{buildFromTemplate:()=>[]},globalShortcut:{register:()=>true,unregister(){},unregisterAll(){}},nativeImage:{createFromPath:()=>({})},protocol:{registerSchemesAsPrivileged(){}},dialog:{}};
 const main=path.resolve(__dirname,'../electron/main.cjs');
 const mocked=name=>{
  if(name==='electron')return electron;if(name==='node:fs')return {mkdirSync(){},readFileSync(){throw Error('No settings');},writeFileSync(){},renameSync(){}};
  if(name==='./autostart.cjs')return {configureAutostart:()=>({ok:true})};
  if(name==='./capture.cjs')return {CaptureController:class{constructor(e,d,onUpdate){capture=this;this.callback=onUpdate;this.store={settings:{...require('../electron/capture-store.cjs').defaults,replayEnabled:true}};}snapshot(){return {active:!!this.current};}refresh(){return Promise.resolve();}async action(action){if(action==='start'){calls.push('record-start');this.current={};this.callback({active:true});}}async stop(){calls.push('record-stop');this.current=null;this.callback({active:false});}}};
  if(name==='./replay.cjs')return {ReplayController:class{snapshot(){return {};}async configure(settings,allowed){calls.push('replay-'+allowed);this.window=settings.replayEnabled&&allowed?{}:null;}async suspend(){await this.configure({},false);}}};
  if(name==='./transfers.cjs')return {TransferMonitor:class{configure(){}lease(){}stop(){}}};
  if(name==='./spotify-direct.cjs')return {readToken:()=>''};if(name==='./spotify-setup.cjs')return {SpotifySetup:class{run(){return Promise.resolve();}}};if(name==='./media-hub.cjs')return {MediaHub:class{start(){}}};if(name==='./weather.cjs')return {};
  return name.startsWith('./')?require(path.resolve(path.dirname(main),name)):require(name);
 };
 vm.runInNewContext(fs.readFileSync(main,'utf8'),{require:mocked,__dirname:path.dirname(main),process:{...process,platform:'win32'},setInterval:()=>1,clearInterval(){},setTimeout,console});await new Promise(resolve=>setImmediate(resolve));
 const event={sender:windows[0].webContents};await handlers['capture:action'](event,'start');assert.deepEqual(calls.slice(-2),['replay-false','record-start']);
 app.emit('before-quit',{preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(quit,1);assert.deepEqual(calls.slice(-2),['record-stop','replay-false']);
});

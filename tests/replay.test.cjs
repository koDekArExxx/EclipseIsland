const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{EventEmitter}=require('node:events');
const {ReplayController,replayConfig}=require('../electron/replay.cjs'),{CaptureStore}=require('../electron/capture-store.cjs');
const wait=async condition=>{for(let i=0;i<200;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Replay did not settle');};
test('replay is opt-in, isolates its worker, rotates a bounded disk buffer and preserves saved clips after disabling',async()=>{
 const base=path.resolve(__dirname,'../test-results/tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'replay-')),handlers={},events={},windows=[],states=[];
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.dead=false;this.messages=[];this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.send=(...args)=>this.messages.push(args);this.webContents.setWindowOpenHandler=()=>{};this.webContents.session={setPermissionCheckHandler:fn=>this.check=fn,setPermissionRequestHandler:fn=>this.permission=fn,setDisplayMediaRequestHandler:fn=>this.display=fn};windows.push(this);}
  isDestroyed(){return this.dead;}loadFile(){return Promise.resolve();}destroy(){this.dead=true;this.emit('closed');}
 }
 const e={app:{getPath:()=>root},BrowserWindow:Window,desktopCapturer:{getSources:async()=>[{id:'screen:one',display_id:'1',name:'Screen'}]},screen:{getPrimaryDisplay:()=>({id:1})},ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>events[name]=fn}};
 const store=new CaptureStore(path.join(root,'data'),root);await store.saveSettings({...store.settings,folder:path.join(root,'videos'),replaySeconds:15,replayMaxMB:0});let release;const gate=new Promise(resolve=>release=resolve);
 const replay=new ReplayController(e,root,store,state=>states.push(state),()=>{},{verifyEncoder:async()=>{},exportMP4:async(entry,settings,progress)=>{progress(20);await gate;const output=entry.file.replace(/\.webm$/,'.mp4');await fs.writeFile(output,Buffer.alloc(64));return output;}});
 try{
  await replay.configure(store.settings);assert.equal(windows.length,0);assert.equal(replay.state.status,'off');
  await replay.configure({...store.settings,replayEnabled:true,systemAudio:false,replaySystemAudio:true,microphone:false,replayMicrophone:true,replayAudioBitrate:320});assert.equal(windows.length,1);const w=replay.window,event={sender:w.webContents};assert.equal(w.options.show,false);assert.equal(w.options.skipTaskbar,true);assert.equal(w.options.focusable,false);assert.equal(w.options.type,process.platform==='win32'?'toolbar':undefined);
  assert.throws(()=>handlers['replay-worker:init']({sender:{}}));const config=handlers['replay-worker:init'](event);assert.equal(config.microphone,true);assert.equal(config.systemAudio,true);assert.equal(config.audioBitrate,320);let display;w.display({frame:w.webContents.mainFrame},value=>display=value);assert.equal(display.audio,'loopback');await assert.rejects(handlers['replay-worker:chunk']({sender:{}},new Uint8Array([1])));
  await handlers['replay-worker:format'](event,{mimeType:'video/webm;codecs=h264,opus'});
  events['replay-worker:state'](event,{status:'recording',codec:'h264'});
  const data=Buffer.from('1a45dfa3801853806701ffffffffffffff1549a966872ad7b1830f42401f43b67580','hex');
  for(let i=0;i<5;i++){await handlers['replay-worker:chunk'](event,new Uint8Array(data));await handlers['replay-worker:segment'](event,{duration:5,save:false});}
  assert.equal(w.messages.some(x=>x[1]==='rotate'),false,'unlimited size must not force a rotation after every chunk');
  assert.equal(replay.segments.length,4);assert.equal(replay.state.bufferSeconds,15);assert.equal(replay.current.bytes,0);
  assert.equal(replay.requestSave().ok,true);assert.equal(w.messages.at(-1)[1],'snapshot');assert.equal(replay.requestSave().ok,false);
  await handlers['replay-worker:chunk'](event,new Uint8Array(data));await handlers['replay-worker:segment'](event,{duration:1,save:true});await wait(()=>replay.saving);assert.ok(replay.segments.some(x=>x.locked));
  let disabled=false;const disabling=replay.configure({...store.settings,replayEnabled:false}).then(()=>disabled=true);await wait(()=>w.messages.at(-1)[1]==='stop');
  await handlers['replay-worker:finish'](event,{duration:0});assert.equal(disabled,false,'disable waits for the in-flight save');release();await disabling;
  const saved=(await store.list())[0];assert.equal(saved.replay,true);assert.match(saved.file,/\.mp4$/);assert.ok((await fs.stat(saved.file)).size>0);assert.equal(replay.window,null);assert.equal(replay.state.status,'off');
 }finally{release?.();if(replay.window)await replay.finish({error:'cleanup'});await fs.rm(root,{recursive:true,force:true});}
});

test('unlimited replay size keeps large segments until the ten-minute time window expires',async()=>{
 const root=path.resolve(__dirname,'../test-results/tmp/unlimited-replay');await fs.mkdir(root,{recursive:true});
 try{
  const replay=Object.create(ReplayController.prototype);replay.settings={replaySeconds:600,replayMaxMB:0};replay.onUpdate=()=>{};replay.state={};
  const files=[];for(let i=0;i<122;i++){const file=path.join(root,'segment-'+i);await fs.writeFile(file,'test');files.push(file);}
  replay.segments=files.map((file,i)=>({id:String(i),file,duration:5,bytes:30*1024*1024}));await replay.trim();assert.equal(replay.segments.length,121);assert.equal(replay.state.bufferSeconds,600);assert.equal(await fs.stat(files[0]).catch(()=>null),null);assert.ok(replay.state.bytes>1024*1024*1024);
  replay.settings.replayMaxMB=128;await replay.trim();assert.equal(replay.segments.length,4);assert.equal(replay.state.bufferSeconds,20);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('effective replay configuration ignores changes to ordinary audio when replay settings are set',()=>{
 const {defaults}=require('../electron/capture-store.cjs');const base={...defaults,replayMicrophone:true,replayNoiseSuppression:true,replayMicVolume:130,replaySystemVolume:60,replayMicHighPass:true,replayMicCompressor:true,replayAudioBitrate:256};const cfg=replayConfig(base);assert.equal(cfg.micHighPass,true);assert.equal(cfg.micCompressor,true);assert.equal(cfg.micVolume,130);assert.equal(cfg.systemVolume,60);assert.deepEqual(replayConfig({...base,microphone:false,noiseSuppression:false,micVolume:0,systemVolume:0,audioBitrate:128}),cfg);
});

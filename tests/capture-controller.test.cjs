const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises'),path=require('node:path');const {EventEmitter}=require('node:events');const {CaptureController}=require('../electron/capture.cjs');
test('capture controller validates the worker, selects the primary display, flushes before stop and serves private previews',async()=>{
 const temporary=path.resolve(__dirname,'../test-results/tmp');await fs.mkdir(temporary,{recursive:true});
 const root=await fs.mkdtemp(path.join(temporary,'capture-controller-')),handlers={},listeners={},routes={},windows=[],changes=[],protection=[];let restored=0;
 class Window extends EventEmitter{
  static getAllWindows(){return [{getMediaSourceId:()=> 'window:own'},...windows];}
  constructor(options){super();this.options=options;this.dead=false;this.messages=[];this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.send=(...args)=>this.messages.push(args);this.webContents.setWindowOpenHandler=()=>{};
   this.webContents.session={setPermissionCheckHandler:fn=>this.check=fn,setPermissionRequestHandler:fn=>this.permission=fn,setDisplayMediaRequestHandler:fn=>this.display=fn};windows.push(this);
  }
  isFullScreen(){return !!this.fullscreen;}setFullScreen(value){this.fullscreen=value;this.emit(value?'enter-full-screen':'leave-full-screen');}isMaximized(){return !!this.maximized;}maximize(){this.maximized=true;this.emit('maximize');}unmaximize(){this.maximized=false;this.emit('unmaximize');}close(){this.destroy();}
  getMediaSourceId(){return 'window:worker';}isDestroyed(){return this.dead;}loadFile(){return Promise.resolve();}destroy(){this.dead=true;this.emit('closed');}
 }
 const sources=[{id:'screen:other',name:'Second',display_id:'8',thumbnail:{toDataURL:()=>''}},{id:'screen:primary',name:'Primary',display_id:'7',thumbnail:{toDataURL:()=>''}},{id:'window:own',name:'Island',thumbnail:{toDataURL:()=>''}}];
 const electron={app:{getPath:()=>path.join(root,'videos')},BrowserWindow:Window,screen:{getPrimaryDisplay:()=>({id:7})},desktopCapturer:{getSources:async()=>sources},ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>listeners[name]=fn},protocol:{handle:(name,fn)=>routes[name]=fn},shell:{openPath:async()=>'',showItemInFolder(){}},dialog:{}};
 const c=new CaptureController(electron,path.join(root,'data'),value=>changes.push(value),value=>protection.push(value),{restoreOverlay:()=>restored++,verifyEncoder:async()=>{},exportMP4:async()=>{throw Error('test export unavailable');}});
 try{
  await assert.rejects(c.save({folder:'relative'}));await c.save({folder:path.join(root,'saved'),height:1440,fps:120});
  assert.equal((await c.sources()).some(x=>x.id==='window:own'),false);await c.start();const window=c.window,event={sender:window.webContents};
  assert.equal(window.options.show,false);assert.equal(window.options.skipTaskbar,true);assert.equal(window.options.focusable,false);assert.equal(window.options.type,process.platform==='win32'?'toolbar':undefined);assert.equal(c.source.id,'screen:primary');assert.equal(c.snapshot().active,true);assert.equal(protection.at(-1).height,1440);
  assert.throws(()=>handlers['capture-worker:init']({sender:{}}));assert.equal(handlers['capture-worker:init'](event).sourceId,'screen:primary');
  await assert.rejects(handlers['capture-worker:chunk']({sender:{}},new Uint8Array([1])));
  let allowed;window.display({frame:{}},value=>allowed=value);assert.equal(allowed,null);window.display({frame:window.webContents.mainFrame},value=>allowed=value);assert.equal(allowed.video.id,'screen:primary');assert.equal(allowed.audio,'loopback');assert.equal(window.check({},'media'),false);assert.equal(window.check(window.webContents,'media'),true);
  listeners['capture-worker:state'](event,{status:'recording',elapsed:5});c.pause();assert.equal(window.messages.at(-1)[1],'pause');
  const data=Buffer.from('1a45dfa3801853806701ffffffffffffff1549a966872ad7b1830f42401f43b67580','hex');await handlers['capture-worker:chunk'](event,new Uint8Array(data));
  const pending=c.stop();assert.equal(window.messages.at(-1)[1],'stop');await handlers['capture-worker:finish'](event,{duration:5,error:null});await pending;
  assert.equal(c.snapshot().active,false);assert.equal(protection.at(-1),null);assert.equal(c.recent.length,1);assert.equal(c.recent[0].duration,5);assert.equal(c.recent[0].indexedDuration,true);
  const response=await routes['eclipse-recording'](new Request('eclipse-recording://video/'+c.recent[0].id,{headers:{Range:'bytes=0-3'}}));assert.equal(response.status,206);assert.equal(Buffer.from(await response.arrayBuffer()).toString('hex'),'1a45dfa3');
  assert.equal((await routes['eclipse-recording'](new Request('eclipse-recording://video/unknown'))).status,404);
  assert.match(c.state.error,/видео оставлено/);assert.match(c.recent[0].file,/\.webm$/);
  // Quit/Stop must wait for export rather than killing an unfinished MP4.
  let release;const gate=new Promise(resolve=>release=resolve);
  c.exportMP4=async(entry,config,progress)=>{progress(40);await gate;const file=entry.file.replace(/\.webm$/,'.mp4');await fs.writeFile(file,Buffer.concat([Buffer.from('00000020ftypisom'),Buffer.alloc(64)]));return file;};
  await c.start();const second={sender:c.window.webContents};
  listeners['capture-worker:state'](second,{status:'recording',elapsed:2});await handlers['capture-worker:chunk'](second,new Uint8Array(data));
  const finishing=handlers['capture-worker:finish'](second,{duration:2,error:null});
  for(let i=0;i<100&&c.state.status!=='exporting';i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(c.state.status,'exporting');assert.equal(c.state.exportProgress,40);
  let stopped=false;const stop=c.stop().then(()=>{stopped=true;});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(stopped,false);assert.equal(c.state.status,'exporting');
  release();await finishing;await stop;assert.equal(stopped,true);assert.equal(c.snapshot().active,false);assert.equal(c.state.error,null);assert.match(c.recent[0].file,/\.mp4$/);
  await c.action('preview',c.recent[0].id);const preview=[...c.previews][0],previewEvent={sender:preview.webContents};
  await assert.rejects(handlers['capture-preview:action']({sender:window.webContents},'fullscreen'),/Unknown preview/);
  assert.equal((await handlers['capture-preview:action'](previewEvent,'fullscreen')).fullscreen,true);assert.equal(preview.isFullScreen(),true);assert.equal(preview.messages.at(-1)[0],'capture-preview:state');
  assert.equal(restored,0);assert.equal((await handlers['capture-preview:action'](previewEvent,'exit-fullscreen')).fullscreen,false);assert.equal(restored,1);preview.emit('minimize');assert.equal(restored,2);
  assert.equal((await handlers['capture-preview:action'](previewEvent,'maximize')).maximized,true);assert.equal((await handlers['capture-preview:action'](previewEvent,'maximize')).maximized,false);
  await assert.rejects(handlers['capture-preview:action'](previewEvent,'not-an-action'));
  const beforeClose=restored;await handlers['capture-preview:action'](previewEvent,'close');assert.equal(c.previews.size,0);assert.equal(restored,beforeClose+1);await c.action('preview',c.recent[0].id);const crashed=[...c.previews][0];const beforeCrash=restored;crashed.webContents.emit('render-process-gone');assert.equal(c.previews.size,0);assert.equal(restored,beforeCrash+1);
  const head=await routes['eclipse-recording'](new Request('eclipse-recording://video/'+c.recent[0].id,{method:'HEAD'}));assert.equal(head.status,200);assert.equal(head.body,null);assert.ok(Number(head.headers.get('Content-Length'))>0);
  const abort=new AbortController();abort.abort();assert.equal((await routes['eclipse-recording'](new Request('eclipse-recording://video/'+c.recent[0].id,{signal:abort.signal}))).status,499);
  const mp4=await c.store.response(c.recent[0].id,'bytes=0-15');assert.equal(mp4.headers.get('Content-Type'),'video/mp4');

 }finally{if(c.current)await c.finish({duration:0,error:'test cleanup'});await fs.rm(root,{recursive:true,force:true});}
});

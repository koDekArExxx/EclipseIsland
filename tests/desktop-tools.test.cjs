const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {EventEmitter}=require('node:events');
const {DesktopTools,pixelCrop,shotSettings}=require('../electron/desktop-tools.cjs');
let serial=0;function fixture(){
 const dir=path.join(__dirname,'../../.tmp','tools-test-'+process.pid+'-'+(++serial));fs.mkdirSync(dir,{recursive:true});const handlers={},events={},opened=[],writes=[],states=[],calls=[];let picked;
 const jpeg=[],windows=[];function makeImage(width=2880,height=1800){return {isEmpty:()=>false,getSize:()=>({width,height}),crop:r=>{calls.push(r);return makeImage(r.width,r.height);},toPNG:()=>Buffer.from('PNG'),toJPEG:q=>{jpeg.push(q);return Buffer.from('JPEG');},resize:options=>{const w=options.width||(Math.round(width*options.height/height)),h=options.height||Math.round(height*w/width);return makeImage(w,h);},toDataURL:()=>''};}const image=makeImage();
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler:()=>{}});this.destroyed=false;windows.push(this);}setAlwaysOnTop(){}setMenuBarVisibility(){}loadFile(){return Promise.resolve();}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}close(){this.destroy();}show(){this.shown=true;}focus(){}}
 class ClipboardItem{constructor(items){this.items=items;}}
 const e={BrowserWindow:Window,app:{getPath:()=>dir,getFileIcon:async()=>image},ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>events[name]=fn},dialog:{showOpenDialog:async()=>picked||{canceled:true,filePaths:[]}},screen:{getCursorScreenPoint:()=>({x:-900,y:100}),getDisplayNearestPoint:()=>({id:2,bounds:{x:-1920,y:0,width:1920,height:1200},scaleFactor:1.5})},desktopCapturer:{getSources:async()=>[{display_id:'2',thumbnail:image}]},shell:{openPath:async file=>{opened.push(file);return '';},showItemInFolder:file=>opened.push(file)},nativeImage:{createFromPath:()=>image},ClipboardItem,clipboard:{write:async data=>writes.push(data)}};
 let restored=0,overlayRestored=0;const hidden=[];const tools=new DesktopTools(e,dir,value=>states.push(value),{captureFrame:null,wait:async()=>{},restoreOverlay:()=>overlayRestored++,hideSurfaces:config=>{hidden.push(config);return ()=>restored++;}});
 return {dir,e,tools,image,handlers,events,opened,writes,states,calls,jpeg,windows,hidden,overlayRestored:()=>overlayRestored,pick:file=>{picked={canceled:false,filePaths:[file]};},restored:()=>restored,close:()=>{tools.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('area coordinates map to actual image dimensions with mixed DPI, reversed desktop origins and clamping',()=>{
 assert.deepEqual(pixelCrop({x:100,y:80,width:200,height:100},{x:-1920,y:0,width:1920,height:1200},{width:2880,height:1800}),{x:150,y:120,width:300,height:150});
 assert.deepEqual(pixelCrop({x:-20,y:1190,width:100,height:100},{width:1920,height:1200},{width:2880,height:1800}),{x:0,y:1785,width:120,height:15});
 for(const r of [null,{x:0,y:0,width:NaN,height:50},{x:2000,y:0,width:10,height:10},{x:0,y:0,width:2,height:10}])assert.throws(()=>pixelCrop(r,{width:1920,height:1200},{width:2880,height:1800}));
});
test('launcher persists picked targets, reorders and renames them; removing a pin keeps the original file',async()=>{
 const f=fixture();try{const app=path.join(f.dir,'Player.exe'),folder=path.join(f.dir,'Photos');fs.writeFileSync(app,'exe');fs.mkdirSync(folder);f.pick(app);await f.tools.launcher('add',null,'app');f.pick(folder);await f.tools.launcher('add',null,'folder');const id=f.tools.entries[0].id;
 await f.tools.launcher('rename',id,'<Player>');await f.tools.launcher('move',id,1);assert.equal(f.tools.entries[1].name,'<Player>');await f.tools.launcher('open',id);assert.deepEqual(f.opened,[app]);
 const loaded=new DesktopTools(f.e,f.dir,()=>{});assert.equal(loaded.entries[1].id,id);await loaded.launcher('remove',id);assert.ok(fs.existsSync(app));assert.equal(loaded.entries.length,1);await assert.rejects(()=>loaded.launcher('open','missing'));
 f.pick(path.join(f.dir,'desktop-tools.json'));await assert.rejects(()=>f.tools.launcher('add',null,'app'));
 }finally{f.close();}
});
test('full screenshot writes PNG and copies a Blob using Electron 45 clipboard API, then history can open or copy it',async()=>{
 const f=fixture();try{const r=await f.tools.take('screen');assert.equal(r.ok,true);assert.equal(r.copied,true);assert.equal(f.restored(),1);const shot=f.tools.recent[0];assert.equal(shot.width,2880);assert.ok(fs.existsSync(shot.file));assert.equal(f.writes.length,1);const blob=f.writes[0][0].items['image/png'];assert.equal(blob.type,'image/png');assert.equal(await blob.text(),'PNG');await f.tools.screenshot('open',r.id);assert.equal(f.windows.length,1);assert.equal(f.tools.viewers.size,1);assert.equal(f.opened.length,0);f.windows[0].close();assert.equal(f.overlayRestored(),1);await f.tools.screenshot('copy',r.id);assert.equal(f.writes.length,2);assert.equal(f.tools.busy,false);
 }finally{f.close();}
});
test('area screenshot crops the original frame; cancellation writes nothing and always restores application surfaces',async()=>{
 const f=fixture();try{f.tools.select=async()=>null;assert.equal((await f.tools.take('area')).canceled,true);assert.equal(f.tools.recent.length,0);assert.equal(f.writes.length,0);f.tools.select=async()=>({x:10,y:20,width:400,height:200});const r=await f.tools.take('area');assert.equal(r.ok,true);assert.deepEqual(f.calls[0],{x:15,y:30,width:600,height:300});assert.equal(f.tools.recent[0].width,600);assert.equal(f.restored(),2);
 }finally{f.close();}
});
test('capture failures restore surfaces, do not silently choose a different monitor, and never leave busy set',async()=>{
 const f=fixture();try{f.e.desktopCapturer.getSources=async()=>[{display_id:'3',thumbnail:f.image},{display_id:'4',thumbnail:f.image}];assert.equal((await f.tools.take('screen')).ok,false);assert.equal(f.restored(),1);assert.equal(f.tools.busy,false);assert.equal(f.tools.recent.length,0);
 f.e.desktopCapturer.getSources=async()=>{throw Error('capture failed');};assert.equal((await f.tools.take('screen')).error,'capture failed');assert.equal(f.restored(),2);
 }finally{f.close();}
});
test('clipboard failure preserves the PNG and copy preference persists without altering the folder',async()=>{
 const f=fixture();try{f.e.clipboard.write=async()=>{throw Error('clipboard busy');};const r=await f.tools.take('screen');assert.equal(r.ok,true);assert.match(r.error,/Снимок сохранён/);assert.ok(fs.existsSync(f.tools.recent[0].file));await f.tools.save({copy:false,folder:'untrusted'});assert.equal(f.tools.config.folder,path.join(f.dir,'EclipseIsland'));assert.equal((await f.tools.take('screen')).error,null);assert.equal(new DesktopTools(f.e,f.dir,()=>{}).config.copy,false);
 }finally{f.close();}
});
test('duplicate screenshot requests do not start parallel desktop captures',async()=>{
 const f=fixture();try{let release;f.tools.select=()=>new Promise(r=>release=r);const pending=f.tools.take('area');await new Promise(r=>setImmediate(r));assert.match((await f.tools.take('screen')).error,/уже создаётся/);release(null);await pending;assert.equal(f.restored(),1);
 }finally{f.close();}
});
test('selector IPC rejects other renderers and handles cancellation after the selector closes',async()=>{
 const f=fixture();try{class Win extends EventEmitter{constructor(){super();this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler:()=>{}});this.destroyed=false;}setAlwaysOnTop(){}setMenuBarVisibility(){}loadFile(){return Promise.resolve();}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}show(){this.shown=true;}focus(){}}
 f.e.BrowserWindow=Win;f.tools.getTheme=()=>({accent:'custom',customAccent:'#ffffff',cardRadius:24,uiRenderer:'liquid'});const pending=f.tools.select(f.image,f.e.screen.getDisplayNearestPoint());const win=f.tools.selection.window;assert.throws(()=>f.handlers['screenshot:frame']({sender:{}}));const frame=f.handlers['screenshot:frame']({sender:win.webContents});assert.ok(frame.image);assert.deepEqual(frame.theme,f.tools.getTheme());assert.equal(frame.pixelWidth,f.image.getSize().width);assert.equal(frame.pixelHeight,f.image.getSize().height);f.events['screenshot:finish']({sender:{}},{x:0,y:0,width:20,height:20});assert.ok(f.tools.selection);f.events['screenshot:ready']({sender:win.webContents});assert.equal(win.shown,true);win.destroy();assert.equal(await pending,null);assert.equal(f.tools.selection,null);
 }finally{f.close();}
});

test('screenshot preferences persist and invalid formats or sizes do not bypass their limits',async()=>{
 const f=fixture();try{await f.tools.save({format:'jpg',quality:74,maxHeight:1080,countdown:3,excludeIsland:false,hideSettings:false,notifications:false,openAfter:true});const s=new DesktopTools(f.e,f.dir,()=>{}).config;assert.equal(s.format,'jpg');assert.equal(s.quality,74);assert.equal(s.excludeIsland,false);assert.equal(s.maxHeight,1080);assert.equal(s.openAfter,true);assert.equal(shotSettings({quality:500,format:'exe',maxHeight:-1}).quality,100);assert.equal(shotSettings({quality:1}).quality,50);assert.equal(shotSettings({format:'exe'}).format,'png');}finally{f.close();}
});
test('JPEG quality and downscaling apply to files, and chosen inclusion settings reach surface capture',async()=>{
 const f=fixture();try{await f.tools.save({format:'jpg',quality:74,maxHeight:1080,excludeIsland:false,hideSettings:false,copy:false});const result=await f.tools.take('screen');assert.equal(result.ok,true);const item=f.tools.recent[0];assert.equal(path.extname(item.file),'.jpg');assert.equal(item.height,1080);assert.equal(item.width,1728);assert.equal(f.jpeg[0],74);assert.equal(f.hidden[0].excludeIsland,false);assert.equal(f.hidden[0].hideSettings,false);assert.equal(new DesktopTools(f.e,f.dir,()=>{}).recent[0].id,item.id);}finally{f.close();}
});
test('countdown and capture can be canceled without writing files, and small crops are not upscaled',async()=>{
 const f=fixture();try{await f.tools.save({countdown:3});f.tools.wait=async ms=>{if(ms===1000)await f.tools.screenshot('cancel');};assert.equal((await f.tools.take('screen')).canceled,true);assert.equal(f.tools.recent.length,0);assert.equal(f.tools.remaining,0);assert.equal(f.hidden.length,0);await f.tools.save({countdown:0,maxHeight:1080});f.tools.select=async()=>({x:0,y:0,width:10,height:10});await f.tools.take('area');assert.equal(f.tools.recent[0].height,15);}finally{f.close();}
});
test('process listing deduplicates EXE paths and pinning only accepts a current listed token',async()=>{
 const f=fixture();try{const file=path.join(f.dir,'Running.exe');fs.writeFileSync(file,'exe');f.tools.processProvider=async()=>[{pid:1,name:'Running',target:file,title:'Window'},{pid:2,name:'Running',target:file,title:''},{pid:3,name:'Protected',target:''}];const result=await f.tools.listProcesses();assert.equal(result.items.length,1);assert.deepEqual(result.items[0].pids,[1,2]);await assert.rejects(()=>f.tools.launcher('add-process',file));await f.tools.launcher('add-process',result.items[0].id);assert.equal(f.tools.entries[0].target,file);await assert.rejects(()=>f.tools.launcher('add-process',result.items[0].id));}finally{f.close();}
});
test('launch all continues after one missing target and reports the result',async()=>{
 const f=fixture();try{for(const name of ['A.exe','B.exe','C.exe']){const file=path.join(f.dir,name);fs.writeFileSync(file,'exe');await f.tools.addTarget(file,'app');}fs.unlinkSync(f.tools.entries[1].target);const result=await f.tools.launcher('open-all');assert.equal(result.launched,2);assert.equal(result.total,3);assert.equal(result.ok,false);assert.equal(f.opened.length,2);assert.equal(f.tools.launchingAll,false);assert.ok(f.states.some(x=>x.launchingAll));}finally{f.close();}
});
test('internal photo viewer authorizes only its own renderer and restores the island when closed',async()=>{
 const f=fixture();try{const result=await f.tools.take('screen');await f.tools.screenshot('open',result.id);const window=f.windows[0];assert.throws(()=>f.handlers['screenshot-preview:frame']({sender:{}}));assert.ok(f.handlers['screenshot-preview:frame']({sender:window.webContents}).image.startsWith('data:image/png;'));await f.handlers['screenshot-preview:action']({sender:window.webContents},'copy');assert.equal(f.writes.length,2);f.events['screenshot-preview:close']({sender:{}});assert.equal(window.isDestroyed(),false);f.events['screenshot-preview:close']({sender:window.webContents});assert.equal(f.overlayRestored(),1);assert.equal(f.tools.viewers.size,0);}finally{f.close();}
});

test('cursor preference persists, validates boolean values and reaches full-screen and area capture',async()=>{
 const f=fixture();try{
  const calls=[];f.tools.captureFrame=async(display,showCursor)=>{calls.push([display.id,showCursor]);return f.image;};
  assert.equal(f.tools.config.showCursor,true);
  await f.tools.save({showCursor:false});
  assert.equal(new DesktopTools(f.e,f.dir,()=>{}).config.showCursor,false);
  assert.equal(shotSettings({showCursor:'false'}).showCursor,true);
  assert.equal((await f.tools.take('screen')).ok,true);
  f.tools.select=async()=>({x:10,y:20,width:100,height:100});
  assert.equal((await f.tools.take('area')).ok,true);
  await f.tools.save({showCursor:true});
  assert.equal((await f.tools.take('screen')).ok,true);
  assert.deepEqual(calls,[[2,false],[2,false],[2,true]]);
 }finally{f.close();}
});
test('native screenshot failure restores surfaces and does not silently save a cursor-including fallback',async()=>{
 const f=fixture();try{
  await f.tools.save({showCursor:false});f.tools.captureFrame=async()=>{throw Error('native capture failed');};
  assert.equal((await f.tools.take('screen')).error,'native capture failed');
  assert.equal(f.restored(),1);assert.equal(f.tools.busy,false);assert.equal(f.tools.recent.length,0);
 }finally{f.close();}
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {MediaBridge}=require('../electron/media.cjs');

function fixture(){
  const workers=[];
  function spawn(executable,args){
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.control=args.includes('-ControlOnly');child.writes=[];
    child.stdin.on('data',line=>child.writes.push(JSON.parse(line.toString())));
    child.kill=()=>{child.killed=true;child.emit('exit',0);};
    child.packet=packet=>child.stdout.write(JSON.stringify(packet)+'\n');
    workers.push(child);return child;
  }
  const updates=[],bridge=new MediaBridge(p=>updates.push(p),x=>x,'auto',{spawn,platform:'win32',restartDelay:5});
  bridge.start();
  return {bridge,workers,updates,metadata:workers.find(w=>!w.control),control:workers.find(w=>w.control)};
}
test('skip works through an independent worker even if metadata never answers',async()=>{
  const f=fixture();try{
    f.metadata.packet({type:'media',available:true,active:true,source:'Spotify.exe',trackKey:'a',title:'A'});
    const result=f.bridge.command('next');
    assert.equal(f.control.writes.at(-1).action,'next');assert.equal(f.control.writes.at(-1).sessionSource,'Spotify.exe');assert.equal(f.control.writes.at(-1).sessionTrackKey,'a');
    assert.equal(f.metadata.writes.some(w=>w.action==='next'),false);
    f.control.packet({type:'reply',id:f.control.writes.at(-1).id,ok:true});
    assert.deepEqual(await result,{ok:true,confirmed:false});
    assert.equal(f.bridge.state.title,'A'); // Acceptance cannot invent the next track.
    assert.deepEqual(f.metadata.writes.at(-1),{id:0,action:'refresh',metadataOnly:true});
    f.metadata.packet({type:'media',available:true,active:true,source:'Spotify.exe',trackKey:'b',title:'B'});
    assert.equal(f.bridge.state.title,'B');
  }finally{f.bridge.stop();}
});
test('control failure fails queued commands without replay; next click starts a fresh worker',async()=>{
  const f=fixture();try{
    const first=f.bridge.command('next'),second=f.bridge.command('previous');
    f.control.emit('exit',2);
    assert.equal((await first).ok,false);assert.equal((await second).ok,false);
    assert.equal(f.workers.length,2);assert.equal(f.metadata.killed,undefined);
    const third=f.bridge.command('toggle'),fresh=f.workers.at(-1);
    assert.equal(fresh.control,true);assert.deepEqual(fresh.writes.map(w=>w.action),['toggle']);
    fresh.packet({type:'reply',id:fresh.writes[0].id,ok:true});assert.equal((await third).ok,true);
  }finally{f.bridge.stop();}
});
test('metadata restarts leave transport commands running; stopping closes both workers',async()=>{
  const f=fixture();try{
    const command=f.bridge.command('next');
    f.metadata.packet({type:'health',status:'metadata-timeout'});f.metadata.packet({type:'health',status:'metadata-timeout'});
    assert.equal(f.metadata.killed,true);assert.equal(f.control.killed,undefined);
    f.control.packet({type:'reply',id:f.control.writes.at(-1).id,ok:true});assert.equal((await command).ok,true);
    await new Promise(r=>setTimeout(r,20));assert.equal(f.workers.filter(w=>w.control).length,1);
    f.bridge.stop();assert.equal(f.control.killed,true);assert.equal(f.workers.at(-1).killed,true);
  }finally{f.bridge.stop();}
});
test('unsupported transport actions fail promptly and do not request metadata refresh',async()=>{
  const f=fixture();try{
    const before=f.metadata.writes.length,result=f.bridge.command('previous');
    f.control.packet({type:'reply',id:f.control.writes.at(-1).id,ok:false});
    assert.equal((await result).ok,false);assert.equal(f.metadata.writes.length,before);
  }finally{f.bridge.stop();}
});
test('native diagnostics are bounded and exclude raw media properties',()=>{
 const f=fixture();try{
   for(let i=0;i<45;i++)f.metadata.packet({type:'diagnostic',stage:'metadata',error:'TimeoutException',code:i,title:'private track',artwork:'private image'});
   const diagnostic=f.bridge.getDiagnostics();assert.equal(diagnostic.events.length,30);assert.equal(diagnostic.events[0].code,15);
   assert.equal(JSON.stringify(diagnostic).includes('private'),false);
 }finally{f.bridge.stop();}
});
test('heartbeat and image traffic cannot hide a stalled metadata stream',()=>{
 const f=fixture();let now=0;f.bridge.now=()=>now;f.bridge.backend='native';
 try{
  f.metadata.packet({type:'media',available:true,active:true,source:'Spotify.exe',trackKey:'old',title:'Old'});
  f.metadata.packet({type:'health',status:'metadata-ready'});
  now=2999;f.metadata.packet({type:'heartbeat'});f.bridge.checkHealth();assert.equal(f.metadata.killed,undefined);
  now=3001;f.metadata.packet({type:'heartbeat'});f.metadata.packet({type:'metrics',playbackPendingMs:30000,metadataReadMs:40});f.bridge.checkHealth();
  assert.equal(f.metadata.killed,true);assert.equal(f.control.killed,undefined);
  assert.ok(f.bridge.getDiagnostics().events.some(e=>e.stage==='metadata-watchdog'));
  assert.equal(f.bridge.getDiagnostics().timings.playbackPendingMs,30000);
 }finally{f.bridge.stop();}
});
test('metadata progress keeps native service alive while background lanes are slow',()=>{
 const f=fixture();let now=0;f.bridge.now=()=>now;f.bridge.backend='native';
 try{
  f.metadata.packet({type:'media',available:true,active:true,source:'Spotify.exe',trackKey:'first',title:'First'});
  for(now=1000;now<=30000;now+=1000){
   f.metadata.packet({type:'health',status:'metadata-ready'});f.metadata.packet({type:'metrics',playbackPendingMs:now});f.bridge.checkHealth();
  }
  assert.equal(f.metadata.killed,undefined);
  f.metadata.packet({type:'media',available:true,active:true,source:'Spotify.exe',trackKey:'second',title:'Second'});assert.equal(f.bridge.state.title,'Second');
 }finally{f.bridge.stop();}
});
test('reconnecting and source selection retain the diagnostic event that explains a stall',()=>{
 const f=fixture();try{
  f.metadata.packet({type:'diagnostic',stage:'metadata-stall',error:'TimeoutException'});
  f.bridge.setSource('Spotify.exe');assert.equal(f.bridge.getDiagnostics().events.at(-1).stage,'metadata-stall');
 }finally{f.bridge.stop();}
});

test('diagnostics identify the native helper version independently of the UI version',()=>{
 const f=fixture();try{f.metadata.packet({type:'health',status:'native-ready',version:'0.4.5.0'});assert.equal(f.bridge.getDiagnostics().nativeVersion,'0.4.5.0');}finally{f.bridge.stop();}
});
test('per-session diagnostics preserve duplicate Spotify sessions without exposing song names',()=>{
 const f=fixture();try{
  f.metadata.packet({type:'session-diagnostics',selected:'s2',items:[
   {token:'s1',source:'Spotify.exe',current:true,playing:true,timelineUpdatedMs:1000,trackHash:'AABBCCDDEEFF',title:'private old song'},
   {token:'s2',source:'Spotify.exe',current:false,playing:true,timelineUpdatedMs:30000,trackHash:'112233445566',title:'private new song'}
  ]});
  const data=f.bridge.getDiagnostics();assert.equal(data.sessions.selected,'s2');assert.equal(data.sessions.items.length,2);
  assert.equal(data.sessions.items[0].source,data.sessions.items[1].source);assert.equal(JSON.stringify(data).includes('private'),false);
 }finally{f.bridge.stop();}
});

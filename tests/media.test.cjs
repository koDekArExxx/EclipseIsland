const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MediaBridge}=require('../electron/media.cjs');
test('media rejects arbitrary commands, nonfinite seeks and out-of-bounds positions',async()=>{
  const bridge=new MediaBridge(()=>{});let writes=0;bridge.child={stdin:{writable:true,write:()=>writes++}};
  for(const [action,seconds] of [['exec'],['seek',NaN],['seek',-1],['seek',Infinity],['seek',604801]]){const result=await bridge.command(action,seconds);assert.equal(result.ok,false);}
  assert.equal(writes,0);
});
test('missing media service returns a useful error',async()=>{const bridge=new MediaBridge(()=>{});assert.equal((await bridge.command('toggle')).ok,false);});
test('idle or paused snapshots are deduplicated and only changed fields cross IPC',()=>{
  const updates=[];const bridge=new MediaBridge(value=>updates.push(value));
  const packet={type:'media',available:true,active:true,trackKey:'a',title:'Track',artist:'Artist',playing:false,position:4,duration:120};
  bridge.accept(packet);const count=updates.length;
  for(let i=0;i<20;i++)bridge.accept({...packet});assert.equal(updates.length,count);
  bridge.accept({...packet,position:5});assert.deepEqual(updates.at(-1),{position:5,trackKey:'a'});
  bridge.accept({...packet,position:5.05});assert.equal(updates.length,count+1);
  bridge.accept({...packet,position:5.17});assert.equal(updates.length,count+2);
  bridge.accept({...packet,playing:true,position:5.18});assert.equal(updates.at(-1).playing,true);assert.equal(updates.at(-1).position,5.18);
});
test('late artwork is ignored, metadata stays responsive, and artwork is sent only when changed',()=>{
  const updates=[];const bridge=new MediaBridge(v=>updates.push(v));
  const art='data:image/png;base64,aGVsbG8=';
  bridge.accept({type:'media',available:true,active:true,trackKey:'one',title:'One',position:0});
  bridge.accept({type:'artwork',trackKey:'one',artwork:art});
  assert.equal(updates.at(-1).artwork,art);
  bridge.accept({type:'media',available:true,active:true,trackKey:'one',title:'One',position:1});
  assert.equal('artwork' in updates.at(-1),false);assert.equal(bridge.state.artwork,art);
  bridge.accept({type:'media',available:true,active:true,trackKey:'two',title:'Two',position:0});
  assert.equal(updates.at(-1).artwork,null);assert.equal(updates.at(-1).title,'Two');
  const count=updates.length;bridge.accept({type:'artwork',trackKey:'one',artwork:art});assert.equal(updates.length,count);
  bridge.accept({type:'artwork',trackKey:'two',artwork:'https://tracking.invalid/avatar.png'});assert.equal(bridge.state.artwork,null);
  bridge.accept({type:'media',available:true,active:false});assert.equal(bridge.state.artwork,null);
});
test('artwork decoding failures and cache eviction are bounded',()=>{
  const bridge=new MediaBridge(()=>{},()=>{throw new Error('invalid image');});
  bridge.accept({type:'media',available:true,active:true,trackKey:'a'});assert.doesNotThrow(()=>bridge.accept({type:'artwork',trackKey:'a',artwork:'data:image/png;base64,YQ=='}));assert.equal(bridge.state.artwork,null);
  const cache=new MediaBridge(()=>{});for(let i=0;i<12;i++){cache.accept({type:'media',available:true,active:true,trackKey:String(i)});cache.accept({type:'artwork',trackKey:String(i),artwork:'data:image/png;base64,YQ=='});}assert.equal(cache.artCache.size,8);
});

test('skip targets the displayed player and acknowledges acceptance without waiting for metadata',async()=>{
  const bridge=new MediaBridge(()=>{}),writes=[];
  bridge.child={stdin:{writable:true,write:line=>writes.push(JSON.parse(line))}};
  const packet={type:'media',available:true,active:true,trackKey:'one',title:'One',source:'Spotify.exe',position:45};bridge.accept(packet);
  let resolved=false;const pending=bridge.command('next').then(result=>{resolved=true;return result;});
  assert.equal(writes[0].sessionSource,'Spotify.exe');bridge.reply({id:writes[0].id,ok:true});
  assert.deepEqual(await pending,{ok:true,confirmed:false});assert.equal(resolved,true);assert.equal(bridge.pending.size,0);
  assert.equal(bridge.state.title,'One');
  bridge.accept({...packet,trackKey:'two',title:'Two',position:0});assert.equal(bridge.state.title,'Two');
  const failed=bridge.command('previous');bridge.reply({id:writes.at(-1).id,ok:false});assert.equal((await failed).ok,false);
});
test('source catalog is bounded and selections are sent to the bridge',()=>{
  const updates=[],writes=[],bridge=new MediaBridge(p=>updates.push(p));bridge.child={stdin:{writable:true,write:s=>writes.push(JSON.parse(s))}};
  bridge.accept({type:'sessions',items:[{id:'Spotify.exe',playing:true},{id:3}]});assert.deepEqual(updates[0],{sessions:[{id:'Spotify.exe',playing:true}]});
  assert.equal(bridge.setSource('Spotify.exe'),true);assert.equal(writes[0].action,'source');assert.equal(bridge.setSource('bad\nvalue'),false);
});

test('large Windows thumbnails are decoded before enforcing renderer image limits',()=>{
  const seen=[],updates=[],bridge=new MediaBridge(p=>updates.push(p),raw=>{seen.push(raw.length);return 'data:image/jpeg;base64,YQ==';});
  bridge.accept({type:'media',available:true,active:true,trackKey:'large',title:'Spotify cover'});
  bridge.accept({type:'artwork',trackKey:'large',artwork:'data:image/jpeg;base64,'+'A'.repeat(4000000)});
  assert.ok(seen[0]>3000000);assert.equal(updates.at(-1).artwork,'data:image/jpeg;base64,YQ==');
});
test('a stalled Windows worker reconnects while keeping the selected source',async()=>{
  const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');let now=0;const children=[],updates=[];
  function spawn(executable,args){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;child.emit('exit',0);};if(!args.includes('-ControlOnly'))children.push(child);return child;}
  const bridge=new MediaBridge(p=>updates.push(p),x=>x,'Spotify.exe',{platform:'win32',spawn,now:()=>now,restartDelay:5});
  try{
    bridge.start();assert.equal(children.length,1);children[0].stdout.write(JSON.stringify({type:'heartbeat'})+'\n');
    now=9500;bridge.checkHealth();assert.equal(children[0].killed,false);
    now=11001;bridge.checkHealth();assert.equal(children[0].killed,true);await new Promise(r=>setTimeout(r,15));assert.equal(children.length,2);
    assert.match(children[1].stdin.read().toString(),/Spotify.exe/);
    children[1].stdout.write(JSON.stringify({type:'media',available:true,active:true,trackKey:'new',title:'Recovered',source:'Spotify.exe'})+'\n');
    assert.equal(updates.at(-1).title,'Recovered');assert.equal(updates.at(-1).active,true);
    children[1].stdout.write(JSON.stringify({type:'health',status:'metadata-timeout'})+'\n');
    children[1].stdout.write(JSON.stringify({type:'heartbeat'})+'\n');assert.equal(children[1].killed,false);
    children[1].stdout.write(JSON.stringify({type:'health',status:'metadata-timeout'})+'\n');assert.equal(children[1].killed,true);
    await new Promise(r=>setTimeout(r,20));assert.equal(children.length,3);
  }finally{bridge.stop();}
});

test('an unavailable cover refresh preserves a good image until the track changes',()=>{
 const bridge=new MediaBridge(()=>{}),art='data:image/png;base64,YQ==';
 bridge.accept({type:'media',available:true,active:true,trackKey:'first'});bridge.accept({type:'artwork',trackKey:'first',artwork:art});
 bridge.accept({type:'artwork',trackKey:'first',artwork:null});assert.equal(bridge.state.artwork,art);
 bridge.accept({type:'media',available:true,active:true,trackKey:'second'});assert.equal(bridge.state.artwork,null);
 bridge.accept({type:'artwork',trackKey:'second',artwork:null});assert.equal(bridge.state.artworkStatus,'missing');
});
test('replacement sessions of the same app invalidate old cover and identity even with identical track tags',()=>{
 const updates=[],bridge=new MediaBridge(p=>updates.push(p));const art='data:image/png;base64,YQ==';
 const packet={type:'media',available:true,active:true,source:'Spotify.exe',title:'Song',artist:'Artist'};
 bridge.accept({...packet,trackKey:'Spotify\u001fSong\u001eold'});bridge.accept({type:'artwork',trackKey:bridge.state.trackKey,artwork:art});assert.equal(bridge.state.artwork,art);
 bridge.accept({...packet,trackKey:'Spotify\u001fSong\u001enew'});assert.equal(bridge.state.artwork,null);
 bridge.accept({type:'artwork',trackKey:'Spotify\u001fSong\u001eold',artwork:art});assert.equal(bridge.state.artwork,null);
 assert.equal(bridge.state.title,'Song');
});

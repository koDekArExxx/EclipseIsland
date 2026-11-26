const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {SpotifyDirect,spotifyCover}=require('../electron/spotify-direct.cjs');
const {MediaHub}=require('../electron/media-hub.cjs');
const vm=require('node:vm'),fs=require('node:fs');
const waitFor=async predicate=>{const until=Date.now()+2000;while(!predicate()){if(Date.now()>until)throw Error('condition timed out');await new Promise(r=>setTimeout(r,5));}};
const token='a'.repeat(64);
const packet=(revision,title,uri='spotify:track:'+revision)=>({type:'state',revision,sentAt:Date.now(),uri,title,artist:'Artist',playing:true,duration:180,position:0});
test('direct song event bypasses stale Windows data and commands use the direct player',async()=>{
 let nativeUpdate,nativeCommands=0,direct;
 const updates=[];
 const hub=new MediaHub(p=>updates.push(p),x=>x,'auto',{
  nativeFactory:callback=>{nativeUpdate=callback;return {backend:'native',start(){callback({active:true,available:true,source:'Spotify.exe',title:'Old Windows title',trackKey:'old'});},stop(){},command(){nativeCommands++;return Promise.resolve({ok:true});},setSource:()=>true,getDiagnostics:()=>({backend:'native'})};},
  directFactory:callback=>direct=new SpotifyDirect(callback,x=>x,{port:0,token})
 });
 hub.start();await once(direct.server,'listening');
 const client=new WebSocket(`ws://127.0.0.1:${direct.server.address().port}/spotify?token=${token}`);
 client.on('error',()=>{});await once(client,'open');
 try{
  const start=performance.now();client.send(JSON.stringify(packet(1,'Immediate Spotify title')));
  await waitFor(()=>hub.state.title==='Immediate Spotify title');const elapsed=performance.now()-start;
  assert.ok(elapsed<1000,`direct event took ${elapsed} ms`);
  for(let i=0;i<30;i++)nativeUpdate({title:'Old Windows title',trackKey:'old',position:i,source:'Spotify.exe'});
  assert.equal(hub.state.title,'Immediate Spotify title');assert.equal(hub.getDiagnostics().backend,'direct-spotify');
  client.on('message',raw=>{const command=JSON.parse(raw);if(command.id>0){client.send(JSON.stringify(packet(2,'Next through direct bridge')));client.send(JSON.stringify({type:'reply',id:command.id,ok:true}));}});
  assert.equal((await hub.command('next')).ok,true);await waitFor(()=>hub.state.title==='Next through direct bridge');assert.equal(nativeCommands,0);
  hub.setSource('vlc.exe');assert.equal(hub.usesDirect(),false);await hub.command('next');assert.equal(nativeCommands,1);
  hub.setSource('auto');client.removeAllListeners('message');const interrupted=hub.command('previous');client.terminate();assert.equal((await interrupted).ok,false);assert.equal(nativeCommands,1,'an interrupted direct command must not be replayed through Windows');
 }finally{client.terminate();hub.stop();}
});
test('unauthenticated clients are rejected and no account tokens appear in diagnostics',async()=>{
 const service=new SpotifyDirect(()=>{},x=>x,{port:0,token});service.start();await once(service.server,'listening');
 const bad=new WebSocket(`ws://127.0.0.1:${service.server.address().port}/spotify?token=${'b'.repeat(64)}`);bad.on('error',()=>{});
 try{await new Promise(resolve=>bad.once('close',resolve));assert.equal(service.connected,false);assert.equal(JSON.stringify(service.diagnostics()).includes(token),false);}finally{bad.terminate();service.stop();}
});
test('late artwork cannot cover a newer track and cover URLs are limited to Spotify image CDNs',()=>{
 const updates=[],service=new SpotifyDirect(p=>updates.push(p),x=>x,{token});
 service.accept(packet(1,'First'));const old=service.state.trackKey;service.accept(packet(2,'Second'));
 service.artwork(old,'data:image/jpeg;base64,YQ==');assert.equal(service.state.artwork,null);
 service.artwork(service.state.trackKey,'data:image/jpeg;base64,YQ==');assert.equal(service.state.artworkStatus,'ready');
 service.accept(packet(1,'Stale'));assert.equal(service.state.title,'Second');
 for(const url of ['http://127.0.0.1/','https://example.com/','file:///secret','https://i.scdn.co.evil.example/'])assert.equal(spotifyCover(url),null);
 assert.equal(spotifyCover('spotify:image:abcdef'),'https://i.scdn.co/image/abcdef');
});
test('the actual Spicetify extension forwards songchange and executes local transport methods',async()=>{
 const listeners={},frames=[],sockets=[],calls=[];
 class Socket{static OPEN=1;constructor(url){this.url=url;this.readyState=1;sockets.push(this);}send(value){frames.push(JSON.parse(value));}}
 const player={data:{item:{uri:'spotify:track:first',name:'First',metadata:{artist_name:'Artist'}}},addEventListener:(event,fn)=>listeners[event]=fn,
  isPlaying:()=>true,getProgress:()=>1000,getDuration:()=>180000,next:()=>calls.push('next'),back:()=>calls.push('back'),togglePlay:()=>calls.push('toggle'),seek:ms=>calls.push(ms)};
 const source=fs.readFileSync(require.resolve('../spotify-bridge/eclipse-island.js'),'utf8').replace('__ECLIPSE_PAIR_TOKEN__',token);
 vm.runInNewContext(source,{Spicetify:{Player:player},WebSocket:Socket,Date,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,console});
 sockets[0].onopen();assert.equal(frames.find(p=>p.type==='state').title,'First');
 listeners.songchange({data:{item:{uri:'spotify:track:new',name:'Event payload is fresh',metadata:{artist_name:'Artist'}}}});
 assert.equal(frames.filter(p=>p.type==='state').at(-1).title,'Event payload is fresh');
 await sockets[0].onmessage({data:JSON.stringify({type:'command',id:1,action:'next'})});assert.deepEqual(calls,['next']);assert.equal(frames.filter(p=>p.type==='state').at(-1).title,'Event payload is fresh','an old Player.data getter cannot undo the fresh songchange event');assert.ok(frames.some(p=>p.type==='reply'&&p.id===1&&p.ok));
});

test('title does not wait for image downloads and out-of-order covers are discarded',async()=>{
 const requests=new Map();const service=new SpotifyDirect(()=>{},value=>value,{token,fetch:url=>new Promise(resolve=>requests.set(url,resolve))});
 const first='https://i.scdn.co/image/aaaa',second='https://i.scdn.co/image/bbbb';
 try{
  service.accept({...packet(1,'First'),cover:first});service.accept({...packet(2,'Second'),cover:second});
  assert.equal(service.state.title,'Second');assert.equal(service.state.artwork,null);
  requests.get(second)(new Response(Buffer.from('second-cover'),{headers:{'content-type':'image/jpeg'}}));
  await waitFor(()=>service.state.artworkStatus==='ready');const cover=service.state.artwork;
  requests.get(first)(new Response(Buffer.from('first-cover'),{headers:{'content-type':'image/jpeg'}}));
  await new Promise(r=>setTimeout(r,10));assert.equal(service.state.artwork,cover);assert.equal(service.state.title,'Second');
 }finally{service.stop();}
});

test('song events remain authoritative for minutes through stale caches, pause, refresh and reconnect',async()=>{
 const listeners={},frames=[],sockets=[],ticks=[];let clock=1000;
 class Socket{static OPEN=1;constructor(){this.readyState=1;sockets.push(this);}send(value){frames.push(JSON.parse(value));}}
 const old={item:{uri:'spotify:track:old',name:'Old cached song',metadata:{image_url:'https://i.scdn.co/image/aaaa',duration:'180000'}}};
 const player={data:old,addEventListener:(name,fn)=>listeners[name]=fn,isPlaying:()=>true,getProgress:()=>65000,getDuration:()=>180000,next(){},back(){},togglePlay(){},seek(){}};
 class Image{set src(value){this.url=value;}}
 const source=fs.readFileSync(require.resolve('../spotify-bridge/eclipse-island.js'),'utf8').replace('__ECLIPSE_PAIR_TOKEN__',token);
 vm.runInNewContext(source,{Spicetify:{Player:player},WebSocket:Socket,Image,Date:{now:()=>clock},setTimeout:fn=>{ticks.push(fn);return 1;},clearTimeout(){},setInterval:fn=>{ticks.push(fn);return 1;}});
 const last=()=>frames.filter(p=>p.type==='state').at(-1);
 sockets[0].onopen();
 const fresh={item:{uri:'spotify:track:fresh',name:'Fresh event',metadata:{image_url:'https://i.scdn.co/image/bbbb',duration:'200000'}}};
 listeners.songchange({data:fresh});const freshStart=frames.length;
 // A stale getter must not resurrect the old track at 1 s, 30 s, or minutes later.
 for(const elapsed of [1001,30000,120000]){
  clock=1000+elapsed;ticks[0]();listeners.onplaypause({data:old});listeners.onprogress({data:elapsed});
  await sockets[0].onmessage({data:JSON.stringify({type:'command',id:elapsed,action:'refresh'})});
  assert.equal(last().title,'Fresh event');assert.equal(last().cover,'https://i.scdn.co/image/bbbb');
  assert.equal(last().duration,200);assert.equal(last().position,elapsed/1000,'progress event wins over the stale getter');
 }
 // Mutating an event object after dispatch cannot mutate the stored identity.
 fresh.item.name='Mutated old cache';fresh.item.metadata.image_url='https://i.scdn.co/image/aaaa';ticks[0]();
 assert.equal(last().title,'Fresh event');
 sockets[0].onclose();ticks.at(-1)();sockets.at(-1).onopen();
 assert.equal(last().title,'Fresh event','reconnecting must resend the event track, not Player.data');
 assert.ok(frames.slice(freshStart).filter(p=>p.type==='state').every(p=>p.title==='Fresh event'));
 // Explicitly going back is still a legitimate new event, including to an old URI.
 listeners.songchange({data:old});assert.equal(last().title,'Old cached song');
 listeners.songchange({data:null});assert.equal(last().title,'Old cached song','a transition must not erase the confirmed song');
});

test('all playing Windows sources can take priority over background Spotify and receive their own commands',async()=>{
 for(const source of ['YandexMusic.exe','chrome.exe','vlc.exe','OtherPlayer.exe']){
  let nativeUpdate,directUpdate;const commands=[];
  const hub=new MediaHub(()=>{},x=>x,'auto',{
   nativeFactory:cb=>{nativeUpdate=cb;return {start(){},stop(){},setSource:()=>true,command:action=>{commands.push(source+':'+action);return {ok:true};},getDiagnostics:()=>({backend:'native'})};},
   directFactory:cb=>{directUpdate=cb;return {connected:true,state:{},start(){},stop(){},command:action=>{commands.push('Spotify:'+action);return {ok:true};},diagnostics:()=>({connected:true})};}
  });
  nativeUpdate({active:true,available:true,source:'Spotify.exe',playing:true,trackKey:'native-old',title:'Old'});
  directUpdate({active:true,available:true,source:'Spotify.exe',playing:true,connection:'direct',trackKey:'spotify',title:'Spotify'});
  nativeUpdate({active:true,available:true,source,playing:true,trackKey:source,title:'New player'});
  assert.equal(hub.state.title,'New player');await hub.command('next');assert.deepEqual(commands,[source+':next']);
  directUpdate({playing:true,position:3});assert.equal(hub.state.source,source,'Spotify heartbeat must not steal the player');
  hub.setSource('Spotify.exe');assert.equal(hub.state.source,'Spotify.exe');await hub.command('previous');assert.equal(commands.at(-1),'Spotify:previous');
  hub.setSource(source);assert.equal(hub.state.source,source);
 }
});

test('an empty connected bridge leaves Windows music available until an actual direct track arrives',()=>{
 let nativeUpdate;let direct;
 const hub=new MediaHub(()=>{},x=>x,'auto',{
  nativeFactory:cb=>{nativeUpdate=cb;return {setSource:()=>true};},
  directFactory:cb=>direct=new SpotifyDirect(cb,x=>x,{token})
 });
 direct.connected=true;
 nativeUpdate({active:true,available:true,source:'Spotify.exe',playing:true,trackKey:'windows',title:'Windows song'});
 direct.accept({...packet(1,''),uri:'',playing:false});
 assert.equal(hub.state.title,'Windows song');assert.equal(hub.state.active,true);
 direct.accept(packet(2,'Fresh direct song'));
 assert.equal(hub.state.title,'Fresh direct song');
 direct.accept({...packet(3,''),uri:'',playing:false});
 assert.equal(hub.state.title,'Fresh direct song');assert.equal(hub.state.playing,false);
 nativeUpdate({title:'Old Windows song',position:30});assert.equal(hub.state.title,'Fresh direct song');
 direct.accept(packet(4,'Following song'));assert.equal(hub.state.title,'Following song');
});

test('a null song event at startup recovers from live data without requiring another song event',()=>{
 const listeners={},frames=[],ticks=[];let socket;
 class Socket{static OPEN=1;constructor(){this.readyState=1;socket=this;}send(value){frames.push(JSON.parse(value));}}
 const player={data:null,addEventListener:(name,fn)=>listeners[name]=fn,isPlaying:()=>true,getProgress:()=>1000,getDuration:()=>180000};
 const source=fs.readFileSync(require.resolve('../spotify-bridge/eclipse-island.js'),'utf8').replace('__ECLIPSE_PAIR_TOKEN__',token);
 vm.runInNewContext(source,{Spicetify:{Player:player},WebSocket:Socket,Date,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>ticks.push(fn)});
 socket.onopen();listeners.songchange({data:null});
 player.data={item:{uri:'spotify:track:loaded',name:'Loaded after initialization',metadata:{}}};
 listeners.onprogress({data:1000});
 const last=()=>frames.filter(p=>p.type==='state').at(-1);
 assert.equal(last().title,'Loaded after initialization');assert.equal(last().playing,true);
 listeners.songchange({data:player.data});player.data=null;listeners.songchange({data:null});ticks[0]();
 assert.equal(last().title,'Loaded after initialization','later null transitions do not erase confirmed metadata');
});

test('late same-track artwork and duration update without changing the event title; progress and seek stay live',async()=>{
 const listeners={},frames=[],images=[],ticks=[];let socket,clock=1000,playing=true;
 class Socket{static OPEN=1;constructor(){this.readyState=1;socket=this;}send(value){frames.push(JSON.parse(value));}}
 class Image{constructor(){images.push(this);this.naturalWidth=this.naturalHeight=320;}set src(value){this.url=value;}}
 const player={data:{item:{uri:'spotify:track:old',name:'Old cache',metadata:{duration:'90000'}}},addEventListener:(name,fn)=>listeners[name]=fn,
 isPlaying:()=>playing,getProgress:()=>88000,getDuration:()=>90000,seek(){}};
 const source=fs.readFileSync(require.resolve('../spotify-bridge/eclipse-island.js'),'utf8').replace('__ECLIPSE_PAIR_TOKEN__',token);
 vm.runInNewContext(source,{Spicetify:{Player:player},WebSocket:Socket,Image,document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,YQ=='})},Date:{now:()=>clock},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>ticks.push(fn)});
 const last=()=>frames.filter(p=>p.type==='state').at(-1);
 socket.onopen();listeners.songchange({data:{duration:240000,item:{uri:'spotify:track:new',name:'New title',metadata:{}}}});
 assert.equal(last().duration,240,'top-level event duration is preserved');assert.equal(last().cover,'');assert.equal(last().position,0);
 player.data={duration:250000,item:{uri:'spotify:track:new',name:'Cached title must not win',metadata:{image_large_url:'spotify:image:bbbb'}}};
 ticks[0]();assert.equal(last().title,'New title');assert.equal(last().duration,250);assert.equal(last().cover,'spotify:image:bbbb');
 assert.equal(images.at(-1).url,'https://i.scdn.co/image/bbbb');images.at(-1).onload();
 assert.ok(frames.some(p=>p.type==='artwork'&&p.uri==='spotify:track:new'&&p.artwork==='data:image/jpeg;base64,YQ=='));
 listeners.onprogress({data:12000});assert.equal(last().position,12);
 clock+=1000;ticks[0]();assert.equal(last().position,13,'a stale getter cannot rewind progress at each heartbeat');
 playing=false;listeners.onplaypause();clock+=2000;ticks[0]();assert.equal(last().position,13);
 await socket.onmessage({data:JSON.stringify({type:'command',id:1,action:'seek',seconds:45})});assert.equal(last().position,45);
 listeners.songchange({data:{duration:100000,item:{uri:'spotify:track:next',name:'Next',metadata:{}}}});
 assert.equal(last().position,0);assert.equal(last().duration,100);assert.equal(last().cover,'');
 player.data={item:{uri:'spotify:track:new',metadata:{image_large_url:'spotify:image:cccc',duration:'999000'}}};ticks[0]();
 assert.equal(last().title,'Next');assert.equal(last().duration,100);assert.equal(last().cover,'','old-URI auxiliary metadata is rejected');
});

test('desktop polling refreshes state even when Spotify sends pongs but has no running timers',async()=>{
 let clock=1000,revision=0;const service=new SpotifyDirect(()=>{},x=>x,{port:0,token,now:()=>clock});
 service.start();await once(service.server,'listening');clearInterval(service.health);
 const client=new WebSocket(`ws://127.0.0.1:${service.server.address().port}/spotify?token=${token}`);client.on('error',()=>{});
 client.on('message',raw=>{const request=JSON.parse(raw);if(request.action==='refresh'&&request.poll)client.send(JSON.stringify({...packet(++revision,'Polling track','spotify:track:poll'),bridgeVersion:'0.5.5',position:revision,sentAt:clock}));});
 try{
  await once(client,'open');await waitFor(()=>service.state.title==='Polling track');
  for(let i=0;i<8;i++){const before=revision;clock+=1000;service.poll();await waitFor(()=>revision>before&&service.lastEventAt===clock);}
  assert.equal(service.connected,true);assert.equal(service.diagnostics().lastEventAgeMs,0);assert.ok(service.state.position>=8);assert.equal(service.diagnostics().bridgeVersion,'0.5.5');
 }finally{client.terminate();service.stop();}
});

test('server-initiated snapshots advance repeated zero getters without any Spotify interval or progress callback',async()=>{
 const listeners={},frames=[],images=[];let socket,clock=1000;
 class Socket{static OPEN=1;constructor(){this.readyState=1;socket=this;}send(raw){frames.push(JSON.parse(raw));}}
 class Image{constructor(){images.push(this);}set src(value){this.url=value;}}
 const item={uri:'spotify:track:one',name:'One',metadata:{duration:'180000',image_large_url:'https://i.scdn.co/image/aaaa',image_xlarge_url:'https://i.scdn.co/image/ffff'}};
 const player={data:{item},addEventListener:(name,fn)=>listeners[name]=fn,isPlaying:()=>false,getProgress:()=>0,getDuration:()=>180000};
 const source=fs.readFileSync(require.resolve('../spotify-bridge/eclipse-island.js'),'utf8').replace('__ECLIPSE_PAIR_TOKEN__',token);
 vm.runInNewContext(source,{Spicetify:{Player:player},WebSocket:Socket,Image,Date:{now:()=>clock},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1});
 socket.onopen();listeners.songchange({data:{item,isPaused:false}});
 const request=()=>socket.onmessage({data:JSON.stringify({type:'command',id:0,action:'refresh',poll:true})});
 const last=()=>frames.filter(p=>p.type==='state').at(-1);
 for(let second=1;second<=8;second++){clock+=1000;await request();assert.equal(last().position,second);assert.equal(last().playing,true);}
 assert.equal(images.at(-1).url,'https://i.scdn.co/image/aaaa','regular album image is preferred over the oversized image');
 const requests=images.length;await request();assert.equal(images.length,requests,'polling does not refetch a loaded/requested cover every second');
 listeners.onplaypause({data:{item,isPaused:true}});clock+=2000;await request();assert.equal(last().position,8);assert.equal(last().playing,false);
 player.data={item:{uri:'spotify:track:two',name:'Two',metadata:{duration:'250000'}}};listeners.songchange({data:{...player.data,isPaused:false}});
 assert.equal(last().position,0);clock+=1000;await request();assert.equal(last().position,1);assert.equal(last().duration,250);
});

test('a failed image download retries and recovers; an obsolete retry cannot cover another track',async()=>{
 let requests=0;
 const service=new SpotifyDirect(()=>{},x=>x,{token,retryDelays:[1,1],fetch:async()=>{
  if(++requests===1)throw new TypeError('private network failure');
  return new Response(Buffer.from('cover'),{headers:{'content-type':'image/jpeg'}});
 }});
 try{
  service.accept({...packet(1,'First'),cover:'https://i.scdn.co/image/aaaa'});
  await waitFor(()=>service.state.artworkStatus==='ready');assert.equal(requests,2);assert.equal(service.diagnostics().coverError,null);assert.equal(service.diagnostics().coverAttempts,2);
  service.retryDelays=[100];service.fetch=async()=>{throw new TypeError('private URL must not be in diagnostic');};
  service.accept({...packet(2,'Second'),cover:'https://i.scdn.co/image/bbbb'});
  await waitFor(()=>service.coverRetry);service.accept(packet(3,'Third'));
  await new Promise(r=>setTimeout(r,10));assert.equal(service.state.title,'Third');assert.equal(service.state.artwork,null);assert.equal(service.coverRetry,null);
  assert.equal(JSON.stringify(service.diagnostics()).includes('private'),false);
 }finally{service.stop();}
});

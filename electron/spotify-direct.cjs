const {WebSocketServer,WebSocket}=require('ws');
const crypto=require('node:crypto');
const fs=require('node:fs');
function spotifyCover(value){
  if(typeof value!=='string'||value.length>1000)return null;
  if(/^spotify:image:[a-f0-9]+$/i.test(value))return 'https://i.scdn.co/image/'+value.split(':').at(-1);
  try{const url=new URL(value);return url.protocol==='https:'&&['i.scdn.co','image-cdn-ak.spotifycdn.com','mosaic.scdn.co'].includes(url.hostname)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function readToken(file){
 try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(/^[a-f0-9]{64}$/.test(value.token))return value.token;}catch{}
 const token=crypto.randomBytes(32).toString('hex');fs.writeFileSync(file,JSON.stringify({token},null,2),{mode:0o600});return token;
}
class SpotifyDirect {
 constructor(onUpdate,processArtwork=value=>value,options={}){
  this.onUpdate=onUpdate;this.processArtwork=processArtwork;this.token=options.token;this.port=options.port??43119;this.fetch=options.fetch||fetch;this.now=options.now||Date.now;
  this.state={};this.pending=new Map();this.sequence=0;this.lastRevision=-1;this.cache=new Map();this.connected=false;
  this.retryDelays=options.retryDelays||[1000,3000,8000];this.coverAttempts=0;this.closed=false;
 }
 start(){
  if(this.server)return;this.closed=false;
  this.server=new WebSocketServer({host:'127.0.0.1',port:this.port,maxPayload:1500000,perMessageDeflate:false,verifyClient:info=>{
   try{const url=new URL(info.req.url,'http://localhost');const token=url.searchParams.get('token')||'';
    return url.pathname==='/spotify'&&/^[a-f0-9]{64}$/.test(token)&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(this.token));}catch{return false;}
  }});
  this.server.on('error',error=>{this.error=error.code||'ConnectionError';this.onUpdate({directError:this.error});});
  this.server.on('connection',socket=>{
   const previous=this.client;this.client=socket;this.lastRevision=-1;this.connected=true;this.error=null;this.lastActivity=this.now();previous?.close();
   socket.on('error',()=>{});socket.on('pong',()=>{if(this.client===socket)this.lastActivity=this.now();});
   socket.on('close',()=>{if(this.client===socket){this.client=null;this.disconnect('Прямая связь со Spotify отключена');}});
   socket.on('message',(raw,binary)=>{
    if(socket!==this.client||binary)return;
    let packet;try{packet=JSON.parse(raw.toString());}catch{return;}
    this.lastActivity=this.now();
    if(packet.type==='reply'){if(packet.id===0)this.refreshError=packet.ok===true?null:'SnapshotRejected';this.finish(packet.id,{ok:packet.ok===true,...(packet.ok===true?{}:{error:'Spotify не выполнил команду'})});return;}
    if(packet.type==='state')this.accept(packet);
    if(packet.type==='artwork'&&packet.uri===this.uri&&spotifyCover(packet.cover)===this.coverUrl&&typeof packet.artwork==='string'&&packet.artwork.length<1400000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(packet.artwork))this.artwork(this.state.trackKey,packet.artwork);
   });
   socket.send(JSON.stringify({type:'command',id:0,action:'refresh',poll:true}));
  });
  this.health=setInterval(()=>this.poll(),1000);this.health.unref?.();
 }
 poll(){
  if(this.client&&this.now()-this.lastActivity>6000){const socket=this.client;this.client=null;socket.terminate();this.disconnect('Spotify перестал передавать данные');}
  else if(this.client?.readyState===WebSocket.OPEN){
   this.client.ping();
   // Spotify's background page can suspend timers but still dispatch socket
   // messages. Ask for data from the desktop process, not a Spotify timer.
   this.client.send(JSON.stringify({type:'command',id:0,action:'refresh',poll:true}),()=>{});
  }
 }
 accept(packet){
  if(!Number.isSafeInteger(packet.revision)||packet.revision<=this.lastRevision)return;this.lastRevision=packet.revision;
  this.lastEventAt=this.now();this.lastEventDelayMs=Number.isFinite(packet.sentAt)?Math.max(0,this.now()-packet.sentAt):null;
  this.bridgeVersion=typeof packet.bridgeVersion==='string'?packet.bridgeVersion.slice(0,30):'legacy';
  const title=typeof packet.title==='string'?packet.title.slice(0,2000):'',artist=typeof packet.artist==='string'?packet.artist.slice(0,2000):'';
  const uri=typeof packet.uri==='string'?packet.uri.slice(0,1000):'';
  // Empty initialization/transition packets are not a replacement identity.
  // Keep a known song paused; before the first song, let Windows remain usable.
  if(!title&&!uri&&this.state.active){
   this.state={...this.state,playing:false};this.onUpdate(this.state);return;
  }
  this.uri=uri;
  const key='direct:spotify:'+ (this.uri||title+'\u001f'+artist);
  const changed=key!==this.state.trackKey,cover=spotifyCover(packet.cover),coverChanged=cover!==this.coverUrl;
  if(changed||coverChanged){clearTimeout(this.coverRetry);this.coverRetry=null;this.coverAttempts=0;this.coverError=null;this.coverAbort?.abort();this.coverUrl=cover;}
  const duration=Number.isFinite(packet.duration)?Math.max(0,Math.min(604800,packet.duration)):0;
  this.state={...this.state,available:true,active:!!(title||this.uri),source:'Spotify.exe',title,artist,trackKey:key,playing:packet.playing===true,
   position:Number.isFinite(packet.position)?Math.max(0,Math.min(duration||604800,packet.position)):0,duration,canToggle:true,canNext:true,canPrevious:true,canSeek:duration>0,connection:'direct',
   ...(changed||coverChanged?{artwork:this.cache.get(cover)||null,artworkStatus:this.cache.has(cover)?'ready':cover?'loading':'missing'}:{})};
  this.onUpdate(this.state);
  if(cover&&(changed||coverChanged)&&!this.cache.has(cover))this.loadCover(cover,key);
 }
 artwork(key,raw){
  if(key!==this.state.trackKey)return false;
  let artwork;try{artwork=this.processArtwork(raw);}catch{return false;}if(!artwork)return false;
  this.state={...this.state,artwork,artworkStatus:'ready'};
  clearTimeout(this.coverRetry);this.coverRetry=null;this.coverError=null;
  if(this.coverUrl){this.cache.set(this.coverUrl,artwork);while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);}
  this.onUpdate(this.state);return true;
 }
 async loadCover(url,key){
  if(this.closed||this.cache.has(url)||key!==this.state.trackKey||url!==this.coverUrl)return;
  this.coverAttempts++;
  this.coverAbort?.abort();const abort=this.coverAbort=new AbortController();const timer=setTimeout(()=>abort.abort(),6000);
  try{
   const result=await this.fetch(url,{signal:abort.signal,redirect:'error',credentials:'omit'});if(!result.ok)throw Error('HTTP_'+result.status);
   if(Number(result.headers.get('content-length'))>8000000)throw Error('ImageTooLarge');
   const reader=result.body.getReader();let size=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8000000){abort.abort();throw Error('ImageTooLarge');}chunks.push(value);}}finally{reader.releaseLock();}
   const type=(result.headers.get('content-type')||'').split(';')[0];if(!/^image\/(jpeg|png|webp)$/.test(type))throw Error('Unsupported cover');
   if(!abort.signal.aborted&&key===this.state.trackKey&&!this.artwork(key,`data:${type};base64,${Buffer.concat(chunks).toString('base64')}`))throw Error('DecodeError');
  }catch(error){if(!this.closed&&abort===this.coverAbort&&key===this.state.trackKey&&url===this.coverUrl&&!this.state.artwork){
   this.coverError=abort.signal.aborted?'Timeout':/^HTTP_\d+$|^ImageTooLarge$/.test(error.message)?error.message:error.name||'ImageFetchError';
   this.state={...this.state,artworkStatus:'missing'};this.onUpdate(this.state);
   const delay=this.retryDelays[this.coverAttempts-1];
   if(delay!==undefined){this.coverRetry=setTimeout(()=>{this.coverRetry=null;this.loadCover(url,key);},delay);this.coverRetry.unref?.();}
  }}
  finally{clearTimeout(timer);}
 }
 command(action,seconds){
  if(!['toggle','next','previous','seek','refresh'].includes(action)||action==='seek'&&(!Number.isFinite(seconds)||seconds<0||seconds>604800))return Promise.resolve({ok:false,error:'Некорректная команда'});
  if(this.client?.readyState!==WebSocket.OPEN)return Promise.resolve({ok:false,error:'Прямая связь со Spotify недоступна'});
  const id=++this.sequence;
  return new Promise(resolve=>{const timer=setTimeout(()=>this.finish(id,{ok:false,error:'Spotify не ответил на команду'}),3000);this.pending.set(id,{resolve,timer});
   this.client.send(JSON.stringify({type:'command',id,action,seconds}),error=>{if(error)this.finish(id,{ok:false,error:'Соединение со Spotify прервано'});});
  });
 }
 finish(id,result){const entry=this.pending.get(id);if(!entry)return;clearTimeout(entry.timer);this.pending.delete(id);entry.resolve(result);}
 disconnect(reason){this.connected=false;clearTimeout(this.coverRetry);this.coverRetry=null;this.coverAbort?.abort();this.coverAbort=null;for(const [id]of this.pending)this.finish(id,{ok:false,error:reason});this.onUpdate({directConnected:false});}
 diagnostics(){return {connected:this.connected,bridgeVersion:this.bridgeVersion||'unknown',refreshError:this.refreshError||null,playing:!!this.state.playing,coverAttempts:this.coverAttempts,coverError:this.coverError||null,coverPresent:!!this.coverUrl,artworkStatus:this.state.artworkStatus||'missing',positionSeconds:this.state.position??null,durationSeconds:this.state.duration??null,error:this.error||null,lastEventAgeMs:this.lastEventAt?Math.max(0,this.now()-this.lastEventAt):null,lastEventDelayMs:this.lastEventDelayMs??null,port:this.server?.address()?.port||this.port};}
 stop(){this.closed=true;clearInterval(this.health);clearTimeout(this.coverRetry);this.coverAbort?.abort();const socket=this.client;this.client=null;socket?.terminate();this.disconnect('Прямое подключение закрыто');this.server?.close();this.server=null;}
}
module.exports={SpotifyDirect,spotifyCover,readToken};

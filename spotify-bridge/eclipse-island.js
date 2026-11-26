// EclipseIsland direct Spotify bridge. Installed with a private local token.
(function eclipseIslandBridge(){
 if(!globalThis.Spicetify?.Player?.addEventListener){setTimeout(eclipseIslandBridge,100);return;}
 const token='__ECLIPSE_PAIR_TOKEN__';
 if(!/^[a-f0-9]{64}$/.test(token))return;
 const player=Spicetify.Player;
 let socket,revision=0,retryTimer,currentURI='',coverRequest=0,eventTrack,hasSongEvent=false;
 let anchorPosition=0,anchorAt=Date.now(),wasPlaying=false,hasProgressEvent=false,artIdentity='',getterPosition,playbackOverride=null;
 function send(packet){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(packet));}
 function read(getter,fallback){try{return getter()??fallback;}catch{return fallback;}}
 // Once songchange supplies a track, only another songchange may replace it.
 // Player.data can lag behind events for tens of seconds. A heartbeat, command
 // reply, pause event or reconnect must never turn that cache into a new track.
 function stateWithItem(data){
  const item=data?.item||data?.track;
  return item?{...data,item:{...item,metadata:{...item.metadata}}}:null;
 }
 function milliseconds(...values){
  for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n;}
  return 0;
 }
 function coverOf(item){
  const m=item?.metadata||{};
  return m.image_large_url||m.image_url||m.image_xlarge_url||item?.album?.images?.[0]?.url||item?.images?.[0]?.url||'';
 }
 function playingOf(data){
  if(typeof data?.isPaused==='boolean')return !data.isPaused;
  if(typeof data?.is_paused==='boolean')return !data.is_paused;
  if(typeof data?.isPlaying==='boolean')return data.isPlaying;
  if(typeof data?.is_playing==='boolean')return data.is_playing;
  return null;
 }
 function snapshot(progress){
  const live=stateWithItem(read(()=>player.data,null));
  // Metadata may arrive after songchange. Only enrich the SAME URI; keep the
  // event's title and identity authoritative when the getter still has old data.
  if(hasSongEvent&&live?.item?.uri===eventTrack?.item?.uri){
   for(const field of ['image_xlarge_url','image_large_url','image_url','duration']){
    const value=live.item.metadata[field];if(value)eventTrack.item.metadata[field]=value;
   }
   const cover=coverOf(live.item);if(cover)eventTrack.item.metadata.image_large_url=cover;
   const duration=milliseconds(live.duration,live.item.duration_ms,live.item.metadata.duration);
   if(duration)eventTrack.duration=duration;
  }
  const data=hasSongEvent?eventTrack:live;
  const item=data?.item,metadata=item?.metadata||{};
  const uri=item?.uri||'',changed=uri!==currentURI;currentURI=uri;
  if(changed){hasProgressEvent=false;getterPosition=undefined;}
  const cover=coverOf(item),now=Date.now(),playing=!!item&&(playbackOverride??read(()=>player.isPlaying(),false));
  const sameTrack=!hasSongEvent||live?.item?.uri===uri;
  const estimated=anchorPosition+(wasPlaying?Math.max(0,now-anchorAt)/1000:0);
  if(Number.isFinite(progress)&&progress>=0)hasProgressEvent=true;
  const sampled=sameTrack?read(()=>player.getProgress()/1000,undefined):undefined;
  const sampleChanged=Number.isFinite(sampled)&&sampled!==getterPosition;
  // Repeated cached zeroes must not rewind the local clock on every request.
  const position=Number.isFinite(progress)&&progress>=0?progress/1000:changed?0:!hasProgressEvent&&sampleChanged?sampled:estimated;
  if(Number.isFinite(sampled))getterPosition=sampled;
  anchorPosition=Number.isFinite(position)?Math.max(0,position):0;anchorAt=now;wasPlaying=playing;
  const duration=milliseconds(data?.duration,item?.duration_ms,metadata.duration,sameTrack?read(()=>player.getDuration(),0):0);
  send({type:'state',bridgeVersion:'0.5.5',revision:++revision,sentAt:now,uri,title:item?.name||metadata.title||'',artist:metadata.artist_name||'',album:metadata.album_title||'',cover,
   playing,position:anchorPosition,duration:duration/1000});
  const identity=uri+'|'+cover;
  if(identity!==artIdentity){artIdentity=identity;loadArtwork(uri,cover);}
  return {uri,cover};
 }
 function loadArtwork(uri,cover){
  const request=++coverRequest;
  const url=cover.startsWith('spotify:image:')?'https://i.scdn.co/image/'+cover.split(':').pop():cover;
  if(!/^https:\/\/(i\.scdn\.co|image-cdn-ak\.spotifycdn\.com|mosaic\.scdn\.co)\//i.test(url))return;
  const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{
   if(request!==coverRequest||uri!==currentURI)return;
   try{const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    send({type:'artwork',uri,cover,artwork:canvas.toDataURL('image/jpeg',.9)});
   }catch{}
  };image.src=url;
 }
 function publishTrack(){artIdentity='';snapshot();}

 function connect(){
  socket=new WebSocket('ws://127.0.0.1:43119/spotify?token='+token);
  socket.onopen=()=>publishTrack();socket.onerror=()=>{};
  socket.onclose=()=>{clearTimeout(retryTimer);retryTimer=setTimeout(connect,1000);};
  socket.onmessage=async event=>{
   let packet;try{packet=JSON.parse(event.data);}catch{return;}if(packet.type!=='command')return;
   try{
    switch(packet.action){
     case 'next':await player.next();break;
     case 'previous':await player.back();break;
     case 'toggle':await player.togglePlay();break;
     case 'seek':if(!Number.isFinite(packet.seconds)||packet.seconds<0||packet.seconds>604800)throw Error('invalid seek');await player.seek(packet.seconds*1000);anchorPosition=packet.seconds;anchorAt=Date.now();hasProgressEvent=true;break;
     case 'refresh':if(packet.poll)snapshot();else publishTrack();break;
     default:throw Error('invalid command');
    }
    send({type:'reply',id:packet.id,ok:true});snapshot();
   }catch{send({type:'reply',id:packet.id,ok:false});}
  };
 }
 function songChanged(event){
  // Copy the item: some player integrations reuse and mutate their cached object.
  const data=stateWithItem(event?.data===undefined?read(()=>player.data,null):event.data);
  // Null is emitted during initialization and transitions. It is not a new
  // track identity and must not permanently disable the live-data bootstrap.
  if(data?.item){
   eventTrack=data;
   hasSongEvent=true;playbackOverride=playingOf(data);
  }
  publishTrack();
 }
 player.addEventListener('songchange',songChanged);
 player.addEventListener('onplaypause',event=>{
  const data=event?.data,item=data?.item||data?.track;
  if(!item?.uri||item.uri===currentURI)playbackOverride=playingOf(data);
  snapshot();
 });
 player.addEventListener('onprogress',event=>snapshot(typeof event?.data==='number'?event.data:undefined));
 setInterval(()=>snapshot(),1000);
 connect();
})();

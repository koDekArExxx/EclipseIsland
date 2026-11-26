const {MediaBridge}=require('./media.cjs');
const {SpotifyDirect}=require('./spotify-direct.cjs');
class MediaHub {
 constructor(onUpdate,processArtwork,source='auto',options={}){
  this.onUpdate=onUpdate;this.source=source;this.state={};this.nativeState={};this.directState={};
  this.native=options.nativeFactory?options.nativeFactory(p=>this.nativeUpdate(p)):new MediaBridge(p=>this.nativeUpdate(p),processArtwork,source);
  this.direct=options.directFactory?options.directFactory(p=>this.directUpdate(p)):new SpotifyDirect(p=>this.directUpdate(p),processArtwork,options.direct);
 }
 start(){this.native.start();this.direct.start();}
 nativeUpdate(patch){this.nativeState={...this.nativeState,...patch};this.publish();}
 directUpdate(patch){if(patch.directConnected===false)this.directState={};else this.directState={...this.directState,...patch};this.publish();}
 usesDirect(){
  if(!this.direct.connected||!this.directState.active)return false;
  if(this.source!=='auto')return /spotify/i.test(this.source);
  if(!this.nativeState.active||/spotify/i.test(this.nativeState.source||''))return true;
  // Windows has selected another player. Its active playback wins over Spotify,
  // including when Spotify also reports Playing in an old background session.
  if(this.nativeState.playing)return false;
  if(!this.directState.active)return false;
  return !!this.directState.playing||this.state.connection==='direct';
 }
 publish(){
  const direct=this.usesDirect(),selected=direct?this.directState:{...this.nativeState,connection:'windows'};
  const sessions=[...(this.nativeState.sessions||[])];if(this.direct.connected&&!sessions.some(s=>/spotify/i.test(s.id)))sessions.push({id:'Spotify.exe',playing:!!this.directState.playing});
  const next={...selected,sessions,directConnected:this.direct.connected,directError:this.direct.error||null};
  const changed=next.trackKey!==this.state.trackKey||!!next.active!==!!this.state.active;
  if(changed){next.artwork=selected.artwork||null;next.artworkStatus=selected.artworkStatus||'missing';}
  const patch={};for(const [key,value]of Object.entries(next)){if(key==='sessions'?JSON.stringify(value)!==JSON.stringify(this.state.sessions):!Object.is(value,this.state[key]))patch[key]=value;}
  if(changed)Object.assign(patch,{active:!!next.active,available:!!next.available,trackKey:next.trackKey||'',title:next.title||'',artist:next.artist||'',source:next.source||'',artwork:next.artwork||null,position:next.position||0,duration:next.duration||0,canSeek:!!next.canSeek});
  this.state=next;if(Object.keys(patch).length)this.onUpdate(patch);
 }
 setSource(source){if(!this.native.setSource(source))return false;this.source=source;this.publish();return true;}
 command(action,seconds){return this.usesDirect()?this.direct.command(action,seconds):this.native.command(action,seconds);}
 getDiagnostics(){const native=this.native.getDiagnostics(),direct=this.direct.diagnostics();return {...native,backend:this.usesDirect()?'direct-spotify':native.backend,source:this.state.source||native.source,active:!!this.state.active,artworkStatus:this.state.artworkStatus,...(this.usesDirect()?{metadataAgeMs:direct.lastEventAgeMs,timings:{directEventDelayMs:direct.lastEventDelayMs},native}:{}),direct};}
 stop(){this.direct.stop();this.native.stop();}
}
module.exports={MediaHub};

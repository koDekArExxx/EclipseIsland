const { MediaControl } = require('./media-control.cjs');
const { spawn } = require('node:child_process');
const { mediaWorker } = require('./media-worker.cjs');
const readline = require('node:readline');
class MediaBridge {
  constructor(onUpdate, processArtwork=value=>value, source='auto', dependencies={}) {
    this.spawn=dependencies.spawn||spawn;this.platform=dependencies.platform||process.platform;this.now=dependencies.now||Date.now;this.restartDelay=dependencies.restartDelay??300;this.restartAttempts=0;this.stopped=false; this.onUpdate = onUpdate; this.processArtwork=processArtwork; this.pending = new Map(); this.nextId = 0; this.state={}; this.artCache=new Map(); this.preferredSource=source;this.diagnostics=[]; }
  finish(id,result){const pending=this.pending.get(id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(id);pending.resolve(result);}
  reply(data){
    const pending=this.pending.get(data.id);if(!pending)return;
    if(!data.ok){this.finish(data.id,{ok:false,error:'Плеер не выполнил действие. Возможно, оно не поддерживается.'});return;}
    this.finish(data.id,{ok:true,confirmed:false});
  }
  setSource(source){
    if(typeof source!=='string'||!source.length||source.length>200||/[\x00-\x1f]/.test(source))return false;
    this.preferredSource=source;
    if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify({id:0,action:'source',source})+'\n');
    return true;
  }
  publish(next){
    const previous=this.state,patch={};
    for(const [key,value] of Object.entries(next)){
      if(key==='type')continue;
      const same=key==='position'&&Number.isFinite(value)&&Number.isFinite(this.lastPublishedPosition)?Math.abs(value-this.lastPublishedPosition)<.15:Object.is(value,previous[key]);
      if(!same)patch[key]=value;
    }
    if(('playing' in patch||'trackKey' in patch)&&Number.isFinite(next.position))patch.position=next.position;
    if('trackKey' in patch&&next.active){Object.assign(patch,{active:true,available:true,title:next.title||'',artist:next.artist||'',source:next.source||''});}
    this.state={...previous,...next};
    if(Object.keys(patch).length){if('position' in patch)this.lastPublishedPosition=patch.position;if(next.trackKey)patch.trackKey=next.trackKey;this.onUpdate(patch);}
  }
  accept(data) {
    if(data.type==='sessions'){
      const sessions=(Array.isArray(data.items)?data.items:[]).filter(item=>typeof item.id==='string'&&item.id.length<=200).map(item=>({id:item.id,playing:!!item.playing}));
      if(JSON.stringify(sessions)!==JSON.stringify(this.state.sessions)){this.state.sessions=sessions;this.onUpdate({sessions});}return;
    }
    if(data.type==='media'){
      if(!data.available||!data.active){this.publish({...data,active:false,playing:false,canToggle:false,canNext:false,canPrevious:false,canSeek:false,artwork:null,artworkStatus:'missing',trackKey:''});return;}
      const changed=data.trackKey!==this.state.trackKey;
      const patch={...data};
      if(changed){patch.artwork=this.artCache.get(data.trackKey)||null;patch.artworkStatus=patch.artwork?'ready':data.artworkStatus||'loading';}
      else if(this.state.artwork && data.artworkStatus==='loading')patch.artworkStatus='ready';
      else if(!changed&&!this.state.artwork&&this.state.artworkStatus==='missing'&&data.artworkStatus==='ready')patch.artworkStatus='missing';
      this.publish(patch);return;
    }
    if(data.type==='artwork'){
      if(!this.state.active||data.trackKey!==this.state.trackKey)return;
      let artwork=null;
      if(typeof data.artwork==='string'&&data.artwork.length<=11200000&&/^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(data.artwork)){
        try{artwork=this.processArtwork(data.artwork);}catch{}
      }
      if(!artwork&&this.state.artwork)return; // A failed refresh must not erase a valid cover.
      if(artwork){this.artCache.delete(data.trackKey);this.artCache.set(data.trackKey,artwork);while(this.artCache.size>8)this.artCache.delete(this.artCache.keys().next().value);}
      // Send artwork only once, rather than repeating a large image on every timeline tick.
      if(this.state.artwork!==artwork||this.state.artworkStatus==='loading'){
        this.state={...this.state,artwork,artworkStatus:artwork?'ready':'missing'};
        this.onUpdate({trackKey:data.trackKey,artwork,artworkStatus:this.state.artworkStatus});
      }
    }
  }
  start() {
    if(this.child||this.stopped)return;
    if (this.platform !== 'win32') { this.onUpdate({available:false, reason:'Системная музыка доступна в Windows 10/11'}); return; }
    if(!this.control){
      this.control=new MediaControl(()=>this.refreshMetadata(),{spawn:this.spawn,now:this.now});
      this.control.start();
    }
    const worker=mediaWorker();this.backend=worker.backend;
    const child=this.spawn(worker.executable,worker.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;this.metadataTimeouts=0;this.seenPacket=false;this.startedAt=this.lastActivity=this.now();this.lastMetadataAt=this.now();this.metadataEstablished=false;
    child.stdin.on('error',()=>{});
    child.once('error',()=>{if(this.child===child)this.reconnect('Не удалось запустить медиасервис Windows');});
    child.once('exit',(code)=>{if(this.child===child){this.recordDiagnostic({stage:'worker-exit',error:'WorkerExit',code});this.reconnect('Медиасервис остановился');}});
    child.stderr.on('data',chunk=>this.recordDiagnostic({stage:'worker-stderr',error:chunk.toString().slice(0,100)}));
    this.reader=readline.createInterface({input:child.stdout});
    this.reader.on('line',line=>{
      if(this.child!==child)return;
      try {
        const data=JSON.parse(line.replace(/^\uFEFF/,''));
        if(!['heartbeat','health','media','artwork','sessions','reply','diagnostic','metrics','session-diagnostics'].includes(data.type))return;
        this.lastActivity=this.now();this.seenPacket=true;clearTimeout(this.startTimer);
        if(this.now()-this.startedAt>20000)this.restartAttempts=0;
        if(data.type==='session-diagnostics'){this.sessionDiagnostics={selected:String(data.selected||'').slice(0,40),items:(Array.isArray(data.items)?data.items:[]).slice(0,32).map(item=>({token:String(item.token||'').slice(0,40),source:String(item.source||'').slice(0,200),current:!!item.current,playing:typeof item.playing==='boolean'?item.playing:null,timelineUpdatedMs:Number.isFinite(item.timelineUpdatedMs)?item.timelineUpdatedMs:null,metadataEventAgeMs:Number.isFinite(item.metadataEventAgeMs)?item.metadataEventAgeMs:null,trackHash:typeof item.trackHash==='string'&&/^[A-Fa-f0-9]{12}$/.test(item.trackHash)?item.trackHash:null}))};return;}
        if(data.type==='metrics'){this.metrics=Object.fromEntries(Object.entries(data).filter(([key,value])=>key!=='type'&&Number.isFinite(value)));return;}
        if(data.type==='diagnostic'){this.recordDiagnostic(data);return;}
        if(data.type==='health'){
          if(data.status==='native-ready')this.nativeVersion=String(data.version||'unknown').slice(0,40);
          if(data.status==='metadata-ready'){this.metadataTimeouts=0;this.lastMetadataAt=this.now();this.metadataEstablished=true;}
          if(data.status==='metadata-timeout'&&++this.metadataTimeouts>=2){this.reconnect('Windows задерживает данные плеера');return;}
        }
        if(['media','artwork','sessions'].includes(data.type))this.accept(data);
        else if(data.type==='reply')this.reply(data);
      } catch { /* Ignore diagnostics, never execute them. */ }
    });
    this.setSource(this.preferredSource);
    this.startTimer=setTimeout(()=>this.reconnect('Медиасервис не ответил'),15000);
    this.healthTimer=setInterval(()=>this.checkHealth(),this.backend==='native'?500:2000);
    this.healthTimer.unref?.();
  }
  recordDiagnostic(data){
    this.diagnostics.push({time:new Date(this.now()).toISOString(),stage:String(data.stage||'unknown').slice(0,40),error:String(data.error||'unknown').slice(0,100),code:data.code});
    if(this.diagnostics.length>30)this.diagnostics.shift();
  }
  getDiagnostics(){return {backend:this.backend||'not-started',nativeVersion:this.nativeVersion||'unknown',source:this.state.source||'',preferredSource:this.preferredSource,active:!!this.state.active,artworkStatus:this.state.artworkStatus||'missing',metadataAgeMs:this.metadataEstablished?Math.max(0,this.now()-this.lastMetadataAt):null,timings:this.metrics||{},sessions:this.sessionDiagnostics||null,events:this.diagnostics,control:this.control?.diagnostics||[]};}
  checkHealth(){
    if(!this.child)return;
    if(this.backend==='native'&&this.metadataEstablished&&this.state.active&&this.now()-this.lastMetadataAt>3000){this.recordDiagnostic({stage:'metadata-watchdog',error:'MetadataStopped'});this.reconnect('Плеер задерживает данные трека');return;}
    if(this.now()-this.lastActivity>(this.seenPacket?10000:15000))this.reconnect('Плеер перестал отвечать');
  }
  reconnect(reason){
    if(this.stopped)return;
    const child=this.child;this.child=null;this.reader?.close();this.reader=null;
    clearTimeout(this.startTimer);clearInterval(this.healthTimer);child?.kill();
    const retry=this.restartAttempts++<3;
    this.fail(retry?'Переподключаем медиасервис…':reason+'. Нажмите «Обновить» в разделе музыки.');
    if(retry)this.restartTimer=setTimeout(()=>{this.restartTimer=null;if(!this.stopped)this.start();},this.restartDelay*Math.max(1,this.restartAttempts));
  }
  refreshMetadata(){
    if(this.child?.stdin.writable){try{this.child.stdin.write(JSON.stringify({id:0,action:'refresh',metadataOnly:true})+'\n');}catch{}}
  }
  command(action, seconds) {
    if (!['toggle','next','previous','seek','refresh'].includes(action) || (action === 'seek' && (!Number.isFinite(seconds) || seconds < 0 || seconds > 604800))) return Promise.resolve({ok:false,error:'Некорректная команда'});
    if(action==='refresh'&&!this.child){clearTimeout(this.restartTimer);this.restartTimer=null;this.restartAttempts=0;this.start();}
    if(action!=='refresh'&&this.control)return this.control.command(action,seconds,this.state.source,this.state.trackKey);
    if (!this.child?.stdin.writable) return Promise.resolve({ok:false,error:'Медиасервис недоступен'});
    const id = ++this.nextId;
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(id,{ok:false,error:'Плеер не ответил'}), 6000);
      this.pending.set(id,{resolve,timer});
      try{this.child.stdin.write(JSON.stringify({id,action,seconds,sessionSource:this.state.source})+'\n');}
      catch{this.finish(id,{ok:false,error:'Не удалось отправить команду плееру'});}
    });
  }
  fail(reason) { clearTimeout(this.startTimer);this.publish({available:false,active:false,artwork:null,artworkStatus:'missing',reason});for(const p of this.pending.values()){clearTimeout(p.timer);p.resolve({ok:false,error:reason});}this.pending.clear(); }
  stop() {this.stopped=true;this.control?.stop();clearTimeout(this.startTimer);clearTimeout(this.restartTimer);clearInterval(this.healthTimer);this.reader?.close();const child=this.child;this.child=null;child?.kill();for(const [id] of this.pending)this.finish(id,{ok:false,error:'Медиасервис закрыт'});}
}
module.exports = { MediaBridge };

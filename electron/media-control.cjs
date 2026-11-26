const {spawn}=require('node:child_process');
const {mediaWorker}=require('./media-worker.cjs');
const readline=require('node:readline');

// Keep transport requests out of the metadata worker: a player can stall a
// synchronous GetPlaybackInfo call without preventing Next/Previous from working.
class MediaControl {
  constructor(onAccepted,dependencies={}) {
    this.spawn=dependencies.spawn||spawn;
    this.now=dependencies.now||Date.now;
    this.onAccepted=onAccepted;
    this.diagnostics=[];this.pending=new Map();this.nextId=0;this.stopped=false;
  }
  start() {
    if(this.child||this.stopped)return;
    const worker=mediaWorker(true);
    let child;
    try {
      child=this.spawn(worker.executable,worker.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    }catch {return;}
    this.child=child;this.lastActivity=this.now();this.ready=false;
    const failed=()=>{if(this.child===child)this.disconnect('Медиасервис управления остановился');};
    child.once('error',failed);child.once('exit',failed);
    child.stdin.on('error',failed);child.stderr.on('data',()=>{});
    this.reader=readline.createInterface({input:child.stdout});
    this.reader.on('line',line=>{
      if(this.child!==child)return;
      let data;try{data=JSON.parse(line.replace(/^\uFEFF/,''));}catch{return;}
      if(!['heartbeat','reply','media','diagnostic','health'].includes(data.type))return;
      if(data.type==='diagnostic'){this.diagnostics.push({stage:String(data.stage||'unknown').slice(0,40),error:String(data.error||'unknown').slice(0,100),code:data.code});if(this.diagnostics.length>20)this.diagnostics.shift();}
      this.lastActivity=this.now();this.ready=true;
      if(data.type!=='reply')return;
      const pending=this.pending.get(data.id);if(!pending)return;
      // This confirms Windows accepted the operation, not that metadata changed.
      this.finish(data.id,data.ok?{ok:true,confirmed:false}:{ok:false,error:'Плеер не выполнил действие. Возможно, оно не поддерживается.'});
      if(data.ok)this.onAccepted?.(pending.action);
    });
    this.healthTimer=setInterval(()=>{
      if(this.now()-this.lastActivity>(this.ready?10000:15000))this.disconnect('Плеер не отвечает на управление');
    },2000);
    this.healthTimer.unref?.();
  }
  finish(id,result) {
    const pending=this.pending.get(id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(id);pending.resolve(result);
  }
  command(action,seconds,sessionSource,sessionTrackKey) {
    this.start();
    if(!this.child?.stdin.writable)return Promise.resolve({ok:false,error:'Медиасервис управления недоступен'});
    const id=++this.nextId,child=this.child;
    return new Promise(resolve=>{
      // Include initial worker startup, which may happen on the first click.
      const timer=setTimeout(()=>this.disconnect('Плеер не ответил на команду'),this.ready?6000:15000);
      this.pending.set(id,{resolve,timer,action});
      try {child.stdin.write(JSON.stringify({id,action,seconds,sessionSource,sessionTrackKey})+'\n');}
      catch {this.disconnect('Не удалось отправить команду плееру');}
    });
  }
  disconnect(reason) {
    const child=this.child;this.child=null;
    clearInterval(this.healthTimer);this.reader?.close();this.reader=null;child?.kill();
    for(const [id] of this.pending)this.finish(id,{ok:false,error:reason});
    // Never replay Next/Previous automatically: a delayed command may have run.
    // The next user command starts a fresh worker.
  }
  stop(){this.stopped=true;this.disconnect('Медиасервис закрыт');}
}
module.exports={MediaControl};

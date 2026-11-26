const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const TEMP_EXTS=['.crdownload','.part','.tmp','.download','.tdownload'];
const NOTICE_MS=4500, IDLE_MS=12000, SETTLE_MS=3000;
function formatSize(bytes){if(!Number.isFinite(bytes)||bytes<1024)return Math.max(0,bytes||0)+' Б';const units=['КБ','МБ','ГБ'];let value=bytes/1024,unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return value.toFixed(value>=100||unit===0?0:1)+' '+units[unit];}
class DownloadsMonitor{
 constructor(directory,onUpdate,options={}){this.onUpdate=onUpdate;this.folder=options.folder||path.join(os.homedir(),'Downloads');this.folders=[{dir:this.folder,source:'Загрузки'},{dir:path.join(this.folder,'Telegram Desktop'),source:'Telegram'},...(options.telegramFolders||[]).map(dir=>({dir,source:'Telegram'})),...['AyuGram','AyuGram Desktop','AyuGramDesktop'].map(name=>({dir:path.join(this.folder,name),source:'AyuGram'})),...(options.ayuFolders||[]).map(dir=>({dir,source:'AyuGram'}))];this.folders=[...new Map(this.folders.map(x=>[path.resolve(x.dir).toLowerCase(),x])).values()];this.baseFolders=[...this.folders];this.pollMs=options.pollMs||1000;this.now=options.now||Date.now;this.state={items:[],recent:[],status:'ready',supported:true,folder:this.folder};this.known=new Map();this.initialized=false;this.generation=0;}
 setAyuFolder(dir){this.generation++;this.folders=[...new Map([...this.baseFolders,...(dir?[{dir,source:'AyuGram'}]:[])].map(x=>[path.resolve(x.dir).toLowerCase(),x])).values()];this.known.clear();this.initialized=false;this.key=null;}
 snapshot(){return this.state;} publish(){this.onUpdate(this.state);}
 start(){if(this.timer)return;this.scan();this.timer=setInterval(()=>this.scan(),this.pollMs);this.timer.unref?.();}
 stop(){this.generation++;this.key=null;clearInterval(this.timer);this.timer=null;this.known.clear();this.initialized=false;this.state={...this.state,items:[],recent:[]};this.publish();}
 async scan(){if(this.scanning)return;this.scanning=true;try{const generation=this.generation,now=this.now(),next=new Map(),active=[],done=[];let readable=false;
  for(const {dir,source} of this.folders){let entries;try{entries=await fs.promises.readdir(dir,{withFileTypes:true});readable=true;}catch{continue;}
   for(const entry of entries){if(!entry.isFile()||entry.name.startsWith('.'))continue;const file=path.join(dir,entry.name);let stat;try{stat=await fs.promises.stat(file);}catch{continue;}
    const ext=path.extname(entry.name).toLowerCase(),temp=TEMP_EXTS.includes(ext),base=temp?entry.name.slice(0,-ext.length):entry.name,id=path.join(dir,base).toLowerCase();const prev=this.known.get(id);const changed=!!prev&&(prev.size!==stat.size||prev.mtime!==stat.mtimeMs);const fresh=this.initialized&&!prev;const tracked=!!prev?.tracked||fresh||changed;const lastChange=fresh||changed?now:prev?.lastChange??now;const speed=changed&&prev&&stat.size>prev.size?(stat.size-prev.size)*1000/Math.max(1,now-prev.observed):prev?.speed||0;const info={id,file,title:base,source,temp,size:stat.size,mtime:stat.mtimeMs,observed:now,lastChange,tracked,speed,finished:prev?.finished&&!changed};
    if(next.has(id)&&temp&&!next.get(id).temp)continue;next.set(id,info);
    if(!tracked)continue;
    if(temp){if(now-lastChange<IDLE_MS)active.push({...info,details:source+' · '+formatSize(stat.size)+(now-lastChange<2500&&speed?' · '+formatSize(speed)+'/с':'')});}
    else if((prev?.temp||now-lastChange>=SETTLE_MS)&&!info.finished){info.finished=true;done.push({...info,id:'done:'+id+':'+now,createdAt:now,text:source+' · Файл сохранён'});}
    else if(!info.finished)active.push({...info,details:source+' · '+formatSize(stat.size)+(speed&&now-lastChange<2500?' · '+formatSize(speed)+'/с':'')});
   }
  }
  if(generation!==this.generation)return;this.known=next;this.initialized=true;const items=active.filter(x=>!next.get(x.id)?.finished&&next.get(x.id)?.file===x.file).sort((a,b)=>b.lastChange-a.lastChange).slice(0,6);const recent=[...done,...this.state.recent.filter(x=>now-x.createdAt<NOTICE_MS)].slice(0,8);const updated={...this.state,items,recent,status:readable?'ready':'error'};const key=JSON.stringify([items.map(x=>[x.id,x.details]),recent.map(x=>x.id),updated.status]);if(key!==this.key){this.key=key;this.state=updated;this.publish();}else this.state=updated;
 }finally{this.scanning=false;}}
 async action(action,id,shell){if(action==='open-folder'){const error=await shell.openPath(this.folder);if(error)throw Error(error);return {ok:true};}if(action!=='reveal')throw Error('Неизвестное действие загрузки');const item=[...this.state.items,...this.state.recent].find(x=>x.id===id);if(!item)throw Error('Загрузка уже исчезла');shell.showItemInFolder(item.file);return {ok:true};}
}
module.exports={DownloadsMonitor,NOTICE_MS};

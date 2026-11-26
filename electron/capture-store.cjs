const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {fixDuration}=require('./webm-duration.cjs');
const HEIGHTS=[360,480,720,1080,1440,2160],FPS=[30,60,90,120,144,165,240];
const defaults=Object.freeze({height:1080,fps:60,bitrate:16,codec:'auto',replayEnabled:false,replaySeconds:30,replayHeight:720,replayFPS:30,replayBitrate:6,replayMaxMB:256,replayHotkey:'Alt+F10',replayMicrophone:false,replayNoiseSuppression:true,replayEchoCancellation:true,replayAutoGainControl:false,replayMicHighPass:false,replayMicCompressor:false,replaySystemAudio:true,replaySystemVolume:100,replayMicVolume:100,replayAudioBitrate:192,noiseSuppression:true,echoCancellation:true,autoGainControl:false,systemAudio:true,microphone:false,systemVolume:100,micVolume:100,audioBitrate:192,countdown:3,maxMinutes:0,maxSizeMB:0,excludeIsland:true,hideSettings:true,showRecording:true,source:'',folder:'',hotkey:'Alt+F9',panelHotkey:'Alt+Z'});
function sanitize(input={}){
 const out={...defaults};if(!input||typeof input!=='object')return out;
 for(const key of Object.keys(out))if(typeof out[key]==='boolean'&&typeof input[key]==='boolean')out[key]=input[key];
 for(const [key,base]of [['replayMicrophone','microphone'],['replayNoiseSuppression','noiseSuppression'],['replayEchoCancellation','echoCancellation'],['replayAutoGainControl','autoGainControl'],['replaySystemAudio','systemAudio']])if(typeof input[key]!=='boolean'&&typeof input[base]==='boolean')out[key]=input[base];
 for(const [key,values]of [['replayAudioBitrate',[128,192,256,320]],['replayHeight',[720,1080,1440]],['replayFPS',[30,60,120]],['replaySeconds',[15,30,60,120,180,300,600]],['replayMaxMB',[0,128,256,512,1024,2048,4096]],['replayHotkey',['Alt+F10','Control+Alt+F10','Control+Shift+F10']],['height',HEIGHTS],['fps',FPS],['codec',['auto','h264','vp9','vp8']],['countdown',[0,3,5,10]],['audioBitrate',[128,192,256,320]],['hotkey',['Alt+F9','Control+Alt+R','Control+Shift+F9']],['panelHotkey',['Alt+Z','Control+Alt+Z','Control+Shift+F8']]])if(values.includes(input[key]))out[key]=input[key];
 for(const [key,min,max]of [['replaySystemVolume',0,100],['replayMicVolume',0,200],['replayBitrate',2,40],['bitrate',2,200],['systemVolume',0,100],['micVolume',0,200],['maxMinutes',0,180],['maxSizeMB',0,32768]])if(Number.isFinite(input[key]))out[key]=Math.round(Math.max(min,Math.min(max,input[key])));
 for(const [key,base]of [['replaySystemVolume','systemVolume'],['replayMicVolume','micVolume'],['replayAudioBitrate','audioBitrate']])if(input[key]===undefined)out[key]=out[base];
 for(const key of ['source','folder'])if(typeof input[key]==='string'&&input[key].length<1500&&!/[\x00-\x1f]/.test(input[key]))out[key]=input[key];
 return out;
}
function range(header,size){
 if(!header)return null;const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||!size)throw Error('Range');
 let start,end;if(!match[1]){const suffix=Number(match[2]);if(!suffix)throw Error('Range');start=Math.max(0,size-suffix);end=size-1;}else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw Error('Range');return {start,end};
}
class CaptureStore{
 constructor(directory,videoDirectory){this.directory=directory;this.videoDirectory=videoDirectory;this.pendingFile=path.join(directory,'active-recording.json');this.indexFile=path.join(directory,'recordings.json');this.settingsFile=path.join(directory,'capture-settings.json');this.items=[];try{this.settings=sanitize(JSON.parse(fs.readFileSync(this.settingsFile,'utf8')));}catch{this.settings=sanitize();}if(!this.settings.folder)this.settings.folder=path.join(videoDirectory,'EclipseIsland');try{const items=JSON.parse(fs.readFileSync(this.indexFile,'utf8'));this.items=Array.isArray(items)?items.filter(x=>/^[a-f0-9]{32}$/.test(x.id)&&typeof x.file==='string'&&path.isAbsolute(x.file)&&/^EclipseIsland-.*\.(?:webm|mp4)$/.test(path.basename(x.file))).slice(0,300):[];}catch{}}
 async atomic(file,value){await fsp.mkdir(this.directory,{recursive:true});await fsp.writeFile(file+'.tmp',JSON.stringify(value,null,2));await fsp.rename(file+'.tmp',file);}
 async saveSettings(input){const next=sanitize(input);if(!next.folder||!path.isAbsolute(next.folder))throw Error('Выберите папку для записей');await this.atomic(this.settingsFile,next);this.settings=next;return next;}
 async create(){const folder=this.settings.folder;await fsp.mkdir(folder,{recursive:true});const disk=await fsp.statfs(folder);if(Number(disk.bavail)*Number(disk.bsize)<256*1024*1024)throw Error('В папке записей осталось меньше 256 МБ свободного места');const id=crypto.randomBytes(16).toString('hex'),name='EclipseIsland-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+id.slice(0,6)+'.webm';const file=path.join(folder,name),partial=file+'.part',handle=await fsp.open(partial,'wx');const createdAt=Date.now();try{await this.atomic(this.pendingFile,{id,file,partial,createdAt});}catch(error){await handle.close();await fsp.unlink(partial).catch(()=>{});throw error;}return {id,file,partial,handle,bytes:0,createdAt};}
 commitIndex(update){this.indexWrites=(this.indexWrites||Promise.resolve()).catch(()=>{}).then(async()=>{const next=update(this.items).slice(0,300);await this.atomic(this.indexFile,next);this.items=next;});return this.indexWrites;}
 async importVideo(entry){await this.commitIndex(items=>[entry,...items.filter(x=>x.id!==entry.id)]);return entry;}
 async setFormat(session,mimeType){
  if(session.bytes)throw Error('Формат записи уже выбран');
  if(typeof mimeType!=='string'||!/^video\/(?:mp4|webm|x-matroska)(?:;\s*codecs="?(?:avc1(?:\.[a-f0-9]{6})?|h264|vp8|vp9)(?:,\s*(?:mp4a\.40\.2|opus))?"?)?$/i.test(mimeType))throw Error('Неизвестный формат записи');
  mimeType=mimeType.toLowerCase();session.mimeType=mimeType;session.videoCodec=/avc1|h264/i.test(mimeType)?'h264':'other';session.audioCodec=/mp4a/i.test(mimeType)?'aac':/opus/i.test(mimeType)?'opus':'unknown';
  await this.atomic(this.pendingFile,{id:session.id,file:session.file,partial:session.partial,createdAt:session.createdAt,mimeType,videoCodec:session.videoCodec,audioCodec:session.audioCodec});
 }
 async append(session,data){if(!(data instanceof Uint8Array)||data.byteLength>64*1024*1024)throw Error('Некорректный блок записи');const buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength);let offset=0;while(offset<buffer.length){const result=await session.handle.write(buffer,offset,buffer.length-offset);if(!result.bytesWritten)throw Error('Не удалось сохранить видеоданные');offset+=result.bytesWritten;}session.bytes+=buffer.length;}
 async finish(session,duration,interrupted=false){await session.handle.close();if(!session.bytes){await fsp.unlink(session.partial).catch(()=>{});await fsp.unlink(this.pendingFile).catch(()=>{});return null;}const mp4=session.mimeType?.startsWith('video/mp4'),indexedDuration=mp4?false:await fixDuration(session.partial,Number(duration)).catch(()=>false);const suffix=(interrupted?'.interrupted':'')+(mp4?'.source.mp4':'.webm');const file=session.file.replace(/\.webm$/,suffix);await fsp.rename(session.partial,file);const entry={id:session.id,file,name:path.basename(file),bytes:session.bytes,createdAt:session.createdAt,duration:Math.max(0,Number(duration)||0),interrupted,indexedDuration,mimeType:session.mimeType,videoCodec:session.videoCodec,audioCodec:session.audioCodec};await this.importVideo(entry);await fsp.unlink(this.pendingFile).catch(()=>{});return entry;}
 async recover(){let pending;try{pending=JSON.parse(await fsp.readFile(this.pendingFile,'utf8'));}catch{return;}if(!/^[a-f0-9]{32}$/.test(pending.id)||typeof pending.file!=='string'||!path.isAbsolute(pending.file)||pending.partial!==pending.file+'.part'||!/^EclipseIsland-.*\.webm$/.test(path.basename(pending.file)))return;
  let source,stat;
  for(const candidate of [pending.partial,pending.file,pending.file.replace(/\.webm$/,'.source.mp4'),pending.file.replace(/\.webm$/,'.interrupted.source.mp4'),pending.file.replace(/\.webm$/,'.interrupted.webm')]){try{stat=await fsp.stat(candidate);source=candidate;break;}catch{}}
  if(!source){await fsp.unlink(this.pendingFile).catch(()=>{});return;}
  if(!stat.size){await fsp.unlink(source).catch(()=>{});await fsp.unlink(this.pendingFile).catch(()=>{});return;}
  const file=source===pending.file?source:pending.file.replace(/\.webm$/,pending.mimeType?.startsWith('video/mp4')?'.interrupted.source.mp4':'.interrupted.webm');if(source!==file)await fsp.rename(source,file);
  if(!this.items.some(x=>x.id===pending.id)){this.items=[{id:pending.id,file,name:path.basename(file),bytes:stat.size,createdAt:pending.createdAt,duration:0,interrupted:true,indexedDuration:false,mimeType:pending.mimeType,videoCodec:pending.videoCodec,audioCodec:pending.audioCodec},...this.items].slice(0,300);await this.atomic(this.indexFile,this.items);}await fsp.unlink(this.pendingFile).catch(()=>{});
 }
 async replaceWithMP4(entry,file){
  if(file!==entry.file.replace(/(?:\.webm|\.source\.mp4)$/,'.mp4'))throw Error('Некорректное имя MP4');
  const stat=await fsp.stat(file);if(stat.size<32)throw Error('MP4 пуст');
  const updated={...entry,file,name:path.basename(file),bytes:stat.size,indexedDuration:true,format:'mp4'};
  await this.commitIndex(items=>items.map(x=>x.id===entry.id?updated:x));
  await fsp.unlink(entry.file).catch(()=>{});return updated;
 }
 get(id){return this.items.find(x=>x.id===id);}
 async list(){const valid=[];for(const item of this.items){try{const stat=await fsp.stat(item.file);if(stat.isFile())valid.push({...item,bytes:stat.size});}catch{}}return valid;}
 async response(id,header,options={}){
  const item=this.get(id);if(!item)return new Response('Not found',{status:404});
  const method=options.method||'GET';if(!['GET','HEAD'].includes(method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  let stat;try{stat=await fsp.stat(item.file);if(!stat.isFile())throw Error('Not a file');}catch{return new Response('Not found',{status:404});}
  let part;try{part=range(header,stat.size);}catch{return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+stat.size,'Accept-Ranges':'bytes','Content-Length':'0'}});}
  const headers={'Content-Type':path.extname(item.file).toLowerCase()==='.mp4'?'video/mp4':'video/webm','Accept-Ranges':'bytes','Content-Length':String(part?part.end-part.start+1:stat.size),'Cache-Control':'private, max-age=3600'};
  if(part)headers['Content-Range']=`bytes ${part.start}-${part.end}/${stat.size}`;
  if(method==='HEAD')return new Response(null,{status:part?206:200,headers});
  if(options.signal?.aborted)return new Response(null,{status:499});
  const stream=fs.createReadStream(item.file,{...(part||{}),...(options.signal?{signal:options.signal}:{})});
  return new Response(Readable.toWeb(stream),{status:part?206:200,headers});
 }
}
module.exports={CaptureStore,sanitize,defaults,range,HEIGHTS,FPS};

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createReadStream,constants,existsSync}=require('node:fs');
const os=require('node:os');
const {spawn}=require('node:child_process');
function encoderPath(){const packed=path.join(__dirname.replace('app.asar','app.asar.unpacked'),'encoder','win-x64','ffmpeg.exe');return existsSync(packed)?packed:path.join(process.env.ECLIPSE_COMPONENTS_DIR||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'EclipseIsland','components'),'ffmpeg-win-x64','ffmpeg.exe');}
const verified=new Map(),hardware=new Map();
async function verifyEncoder(file=encoderPath()){
 try{await fs.stat(file);}catch(error){if(error.code!=='ENOENT'||file!==encoderPath())throw error;const metadata=JSON.parse(await fs.readFile(path.join(__dirname.replace('app.asar','app.asar.unpacked'),'encoder','win-x64','build.json'),'utf8'));await require('./encoder-download.cjs').ensureEncoder(file,metadata);}
 const stat=await fs.stat(file),key=file+':'+stat.size+':'+stat.mtimeMs;
 if(!verified.has(key))verified.set(key,(async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(file),'build.json'),'utf8'));
  const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  if(manifest.sha256!==hash.digest('hex'))throw Error('Модуль MP4 повреждён. Переустановите EclipseIsland');return file;
 })().catch(error=>{verified.delete(key);throw error;}));
 return verified.get(key);
}
function encodingArgs(entry,settings,mode){
 const bitrate=Math.max(2,Math.min(200,Number(settings.bitrate)||16)),audio=Math.max(128,Math.min(320,Number(settings.audioBitrate)||192));
 if(mode==='copy')return ['-c:v','copy','-c:a',entry.audioCodec==='aac'?'copy':'aac',...(entry.audioCodec==='aac'?[]:['-b:a',audio+'k'])];
 const video=mode==='h264_nvenc'?['-c:v',mode,'-preset','p2','-rc','vbr','-cq','20','-b:v',bitrate+'M']:mode==='h264_amf'?['-c:v',mode,'-quality','speed','-b:v',bitrate+'M']:mode==='h264_qsv'?['-c:v',mode,'-preset','veryfast','-b:v',bitrate+'M']:['-c:v','libx264','-threads',String(Math.max(1,Math.min(4,(os.availableParallelism?.()||4)-1))),'-preset','ultrafast','-crf','18','-maxrate',bitrate+'M','-bufsize',(bitrate*2)+'M'];
 return [...video,'-pix_fmt','yuv420p','-fps_mode','vfr','-c:a','aac','-b:a',audio+'k'];
}
function argumentsFor(entry,settings,output,mode=entry.videoCodec==='h264'?'copy':'software'){
 return ['-hide_banner','-nostdin','-v','error','-n','-protocol_whitelist','file,pipe',...(entry.concatFile?['-f','concat','-safe','0']:[]),...(entry.startOffset>0?['-ss',String(entry.startOffset)]:[]),'-i',entry.concatFile||entry.file,'-map','0:v:0','-map','0:a:0?','-map_metadata','-1',...encodingArgs(entry,settings,mode),'-progress','pipe:1','-nostats','-f','mp4',output];
}
function lowPriority(child){try{if(child.pid)os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}}
async function detectHardware(binary,spawnProcess=spawn){
 if(!hardware.has(binary))hardware.set(binary,(async()=>{
  for(const codec of ['h264_nvenc','h264_amf','h264_qsv']){
   const supported=await new Promise(resolve=>{
    let settled=false;const done=value=>{if(!settled){settled=true;clearTimeout(timer);resolve(value);}};
    const child=spawnProcess(binary,['-hide_banner','-nostdin','-v','error','-f','lavfi','-i','color=size=128x128:rate=30','-frames:v','1','-an','-c:v',codec,'-f','null','-'],{windowsHide:true,stdio:'ignore',shell:false});lowPriority(child);
    const timer=setTimeout(()=>{child.kill();done(false);},5000);timer.unref?.();child.once('error',()=>done(false));child.once('close',code=>done(code===0));
   });if(supported)return codec;
  }return 'software';
 })());return hardware.get(binary);
}
async function exportMP4(entry,settings,onProgress=()=>{},options={}){
 const binary=options.binary||await verifyEncoder(),output=entry.file.replace(/(?:\.webm|\.source\.mp4)$/,'.mp4');
 if(output===entry.file)throw Error('Неверный формат исходной записи');
 const partial=output+'.part';let completed=false,owned=false;
 // Reserve the temporary file ourselves; FFmpeg may overwrite only this reservation.
 const reservation=await fs.open(partial,'wx');await reservation.close();owned=true;
 try{
  let mode=entry.videoCodec==='h264'?'copy':options.hardware===false?'software':await detectHardware(binary,options.spawn||spawn);
  const run=mode=>new Promise((resolve,reject)=>{
   const args=argumentsFor(entry,settings,partial,mode);args[args.indexOf('-n')]='-y';
   const child=(options.spawn||spawn)(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});lowPriority(child);
   let failure='',lines='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stdout.on('data',chunk=>{lines+=chunk;const parts=lines.split(/\r?\n/);lines=parts.pop().slice(-1024);for(const line of parts){const match=/^out_time_us=(\d+)/.exec(line);if(match&&entry.duration>0)onProgress(Math.min(99,Math.max(0,Number(match[1])/10000/entry.duration)),mode);}});
   child.stderr.on('data',chunk=>failure=(failure+chunk).slice(-4000));child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Не удалось сохранить MP4'+(failure?': '+failure.trim().slice(-700):' (код '+code+')'))));
  });
  onProgress(0,mode);
  try{await run(mode);}catch(error){if(mode==='software')throw error;mode='software';onProgress(0,mode);await run(mode);}
  const stat=await fs.stat(partial);if(stat.size<32)throw Error('Модуль MP4 не создал видео');
  try{await fs.link(partial,output);}catch(error){if(!['EPERM','ENOTSUP','ENOSYS','EXDEV','EOPNOTSUPP'].includes(error.code))throw error;await fs.copyFile(partial,output,constants.COPYFILE_EXCL);}
  completed=true;await fs.unlink(partial).catch(()=>{});onProgress(100,mode);return output;
 }finally{if(!completed&&owned)await fs.unlink(partial).catch(()=>{});}
}
module.exports={exportMP4,verifyEncoder,encoderPath,argumentsFor,detectHardware};

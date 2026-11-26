const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createWriteStream}=require('node:fs'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),{createGunzip}=require('node:zlib');
const pending=new Map();
function ensureEncoder(file,manifest,options={}){
 if(pending.has(file))return pending.get(file);
 const run=(async()=>{
  const url=manifest.downloadUrl||manifest.source.replace('/tag/','/download/')+'/ffmpeg-win32-x64.gz';
  if(!/^https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/download\//.test(url)||! /^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('Некорректный источник модуля MP4');
  await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.part',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);timer.unref?.();
  try{
   const response=await (options.fetch||fetch)(url,{signal:controller.signal});if(!response.ok||!response.body)throw Error('Модуль MP4 недоступен');
   let packed=0,total=0;const hash=crypto.createHash('sha256');
   const limit=new Transform({transform(chunk,encoding,done){packed+=chunk.length;done(packed>120*1048576?Error('Слишком большой архив MP4'):null,chunk);}});
   const verify=new Transform({transform(chunk,encoding,done){total+=chunk.length;if(total>200*1048576)return done(Error('Слишком большой модуль MP4'));hash.update(chunk);done(null,chunk);}});
   await pipeline(Readable.fromWeb(response.body),limit,createGunzip(),verify,createWriteStream(temp,{flags:'wx'}),{signal:controller.signal});
   if(hash.digest('hex')!==manifest.sha256)throw Error('Контрольная сумма модуля MP4 не совпала');
   await fs.rename(temp,file);await fs.writeFile(path.join(path.dirname(file),'build.json'),JSON.stringify(manifest));return file;
  }catch(error){await fs.unlink(temp).catch(()=>{});throw Error('Не удалось подготовить модуль MP4: '+error.message);}finally{clearTimeout(timer);}
 })();pending.set(file,run);run.finally(()=>pending.delete(file)).catch(()=>{});return run;
}
module.exports={ensureEncoder};

const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();});
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// Windows may still be running the previous launcher. Replace it atomically after it exits.
async function replaceLauncher(source,target,expected,{fsOps=fs,wait=sleep,attempts=20}={}){
 if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid launcher checksum');
 const stat=await fsOps.stat(source);if(stat.size<1024||stat.size>4*1024*1024)throw Error('Invalid launcher size');
 const bytes=await fsOps.readFile(source);if(digest(bytes)!==expected)throw Error('Launcher checksum mismatch');
 try{if(digest(await fsOps.readFile(target))===expected)return false;}catch(error){if(error.code!=='ENOENT')throw error;}
 const temp=path.join(path.dirname(target),'.launcher-'+crypto.randomUUID()+'.part');
 try{
  await fsOps.writeFile(temp,bytes,{flag:'wx'});
  for(let n=0;n<attempts;n++){
   try{await fsOps.rename(temp,target);return true;}
   catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code)||n===attempts-1)throw error;await wait(500);}
  }
 }finally{await fsOps.unlink(temp).catch(()=>{});}
}
async function refreshLauncher(app,{env=process.env,execPath=process.execPath,platform=process.platform}={}){
 if(platform!=='win32'||!app.isPackaged||!env.ECLIPSE_LAUNCHER_PATH||!env.LOCALAPPDATA)return false;
 const target=path.resolve(env.LOCALAPPDATA,'EclipseIsland','EclipseIsland.exe');
 if(path.resolve(env.ECLIPSE_LAUNCHER_PATH).toLowerCase()!==target.toLowerCase())throw Error('Unexpected launcher location');
 const root=path.dirname(execPath),file=path.join(root,'bundle.json');
 if((await fs.stat(file)).size>65536)throw Error('Invalid bundle metadata');
 const bundle=JSON.parse(await fs.readFile(file,'utf8'));
 if(bundle.version!==app.getVersion()||bundle.platform!=='win32'||bundle.arch!=='x64')throw Error('Unexpected application bundle');
 if(!bundle.launcher)return false;
 return replaceLauncher(path.join(root,'EclipseIsland-Launcher.exe'),target,bundle.launcher.sha256);
}
module.exports={replaceLauncher,refreshLauncher};

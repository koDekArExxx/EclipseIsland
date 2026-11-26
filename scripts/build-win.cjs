const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
// Level 5 avoids the expensive maximum-compression build and keeps a modest download size.
const arch=process.argv.includes('--arm64')?'--arm64':'--x64';
const nativeArch=arch==='--arm64'?'arm64':'x64';
if(!fs.existsSync(path.join(__dirname,'../electron/native',`win-${nativeArch}`,'EclipseMedia.exe'))){console.error(`Native media service missing. Run npm run build:media${nativeArch==='arm64'?' -- --arm64':''} first (.NET 10 SDK required).`);process.exit(1);}
try{
 const nativeDir=path.join(__dirname,'../electron/native',`win-${nativeArch}`);
 const manifest=JSON.parse(fs.readFileSync(path.join(nativeDir,'build.json'),'utf8'));
 if(manifest.version!==(require('../package.json').nativeMediaVersion||require('../package.json').version) || manifest.deployment!=='folder' || !Array.isArray(manifest.files))throw Error('stale helper');
 for(const entry of manifest.files){const file=path.resolve(nativeDir,entry.name);if(!file.startsWith(nativeDir+path.sep)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)throw Error('invalid native runtime');}
 for(const file of ['EclipseMedia.dll','EclipseMedia.runtimeconfig.json','coreclr.dll','hostpolicy.dll'])if(!manifest.files.some(entry=>entry.name===file))throw Error('incomplete native runtime');
}catch{console.error('Native media service does not match this version. Run npm run build:media first, or extract all files from the current source archive.');process.exit(1);}
try{
 if(nativeArch!=='x64')throw Error('MP4 encoder currently supports the x64 installer.');
 const dir=path.join(__dirname,'../electron/encoder/win-x64');
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'build.json'),'utf8'));
 if(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'ffmpeg.exe'))).digest('hex')!==manifest.sha256)throw Error('MP4 encoder is missing or damaged.');
}catch(error){console.error(error.message);process.exit(1);}
const result=spawnSync(process.execPath,[...(process.platform==='linux'?['--require',path.join(__dirname,'linux-nsis-uninstaller.cjs')]:[]),require.resolve('electron-builder/cli.js'),'--win','nsis',arch],{
  stdio:'inherit',env:{...process.env,ELECTRON_BUILDER_COMPRESSION_LEVEL:process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL||'5'}
});
if(result.error){console.error(result.error.message);process.exitCode=1;}else process.exitCode=result.status??1;

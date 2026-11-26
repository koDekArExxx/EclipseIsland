const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const arch=process.argv.includes('--arm64')?'arm64':'x64';
const output=path.join(__dirname,'../electron/native',`win-${arch}`);
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
const result=spawnSync(process.env.ECLIPSE_DOTNET||'dotnet',['publish',path.join(__dirname,'../native/EclipseMedia.csproj'),'-c','Release','-r',`win-${arch}`,'-o',output],{stdio:'inherit'});
if(result.error){console.error('Install .NET 10 SDK to rebuild the native media service. Run npm run build:media after installing the SDK.');process.exitCode=1;}
else {
 process.exitCode=result.status??1;
 if(result.status===0){
  const files=[];
  function collect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else files.push({name:path.relative(output,file).split(path.sep).join('/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
  collect(output);fs.writeFileSync(path.join(output,'build.json'),JSON.stringify({version:require('../package.json').nativeMediaVersion||require('../package.json').version,deployment:'folder',files},null,2));
 }
}

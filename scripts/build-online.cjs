const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),pkgPath=path.join(root,'package.json'),lockPath=path.join(root,'package-lock.json');
const original=fs.readFileSync(pkgPath,'utf8'),originalLock=fs.readFileSync(lockPath,'utf8'),pkg=JSON.parse(original);
const version=process.env.RELEASE_VERSION||pkg.version,repo=process.env.GITHUB_REPOSITORY||process.env.RELEASE_REPOSITORY;
if(!/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(version)||!repo||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('Set RELEASE_REPOSITORY=OWNER/REPO and a valid RELEASE_VERSION');
if(process.platform!=='win32')throw Error('Build this release on Windows or GitHub Actions');
const output=path.join(root,'release-online');fs.mkdirSync(output,{recursive:true});
function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false});if(result.error)throw result.error;if(result.status!==0)throw Error(command+' exited '+result.status);}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
try{
 pkg.version=version;const lock=JSON.parse(originalLock);lock.version=version;if(lock.packages?.[''])lock.packages[''].version=version;fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2));fs.writeFileSync(lockPath,JSON.stringify(lock,null,2));
 const native=path.join(root,'electron/native/win-x64'),manifest=JSON.parse(fs.readFileSync(path.join(native,'build.json'),'utf8'));if(manifest.version!==pkg.nativeMediaVersion)throw Error('Run npm run build:media first');for(const item of manifest.files)if(hash(path.join(native,item.name))!==item.sha256)throw Error('Native media integrity check failed');
 const config={...pkg.build,files:[...pkg.build.files,'!electron/encoder/**/*.exe'],directories:{output:path.join(output,'app')}};
 const configPath=path.join(output,'builder.json');fs.writeFileSync(configPath,JSON.stringify(config));
 run(process.execPath,[require.resolve('electron-builder/cli.js'),'--win','dir','--x64','--publish','never','--config',configPath]);
 const appDir=path.join(output,'app/win-unpacked');fs.writeFileSync(path.join(appDir,'bundle.json'),JSON.stringify({version,platform:'win32',arch:'x64'}));
 run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'distribution/Build-Launcher.ps1'),'-Repository',repo]);
 run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'distribution/Pack-Payload.ps1'),'-Source',appDir,'-Output',path.join(output,'EclipseIsland-app.zip')]);
 const zip=path.join(output,'EclipseIsland-app.zip'),setup=path.join(output,'EclipseIsland-Setup.exe');
 const update={schema:1,version,launcherVersion:1,url:'https://github.com/'+repo+'/releases/download/v'+version+'/EclipseIsland-app.zip',size:fs.statSync(zip).size,sha256:hash(zip),setupSize:fs.statSync(setup).size,setupSha256:hash(setup)};
 fs.writeFileSync(path.join(output,'update-manifest.json'),JSON.stringify(update,null,2));
 console.log('Setup:',update.setupSize,'bytes. Application:',update.size,'bytes. Encoder downloads only when needed.');
}finally{fs.writeFileSync(pkgPath,original);fs.writeFileSync(lockPath,originalLock);}

// The pinned builder already supports extracting NSIS uninstallers without
// executing a Windows bootstrap (UninstallerReader is used on macOS).
// Use the same reader on Linux, where a Wine server may be unavailable.
if(process.platform==='linux'){
 const path=require('node:path');
 const {WineVmManager}=require('app-builder-lib/out/vm/WineVm');
 const {UninstallerReader}=require('app-builder-lib/out/targets/nsis/nsisUtil');
 WineVmManager.prototype.exec=async function(file,args=[],options={}){
  if(args.length||options.env?.__COMPAT_LAYER!=='RunAsInvoker'||!path.basename(file).startsWith('EclipseIsland-Setup-')){
   throw new Error('The Linux build helper only supports extracting the EclipseIsland NSIS uninstaller.');
  }
  const output=path.join(path.dirname(file),`${path.basename(file,'exe')}__uninstaller.exe`);
  await UninstallerReader.exec(file,output);
 };
}

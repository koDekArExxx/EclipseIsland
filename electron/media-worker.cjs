const fs=require('node:fs');
const path=require('node:path');
function mediaWorker(controlOnly=false,dependencies={}) {
  const arch=dependencies.arch||process.arch;
  const exists=dependencies.existsSync||fs.existsSync;
  const native=path.join(__dirname,'native',`win-${arch}`,'EclipseMedia.exe').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  if(exists(native))return {executable:native,args:controlOnly?['-ControlOnly']:[],backend:'native'};
  const script=path.join(__dirname,'media-bridge.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  return {executable:path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
    args:['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...(controlOnly?['-ControlOnly']:[])],backend:'powershell'};
}
module.exports={mediaWorker};

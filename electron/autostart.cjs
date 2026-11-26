const path = require('node:path');
const ENTRY_NAME = 'EclipseIsland';
function launchSpec({isPackaged,execPath,appPath,portablePath}) {
  const portable=typeof portablePath==='string'&&path.win32.isAbsolute(portablePath)&&/\.exe$/i.test(portablePath);
  return {name:ENTRY_NAME,path:isPackaged&&portable?portablePath:execPath,args:isPackaged?['--autostart']:[`"${appPath}"`,'--autostart']};
}
function configureAutostart(app,desired,{platform=process.platform,env=process.env,execPath=process.execPath,force=false}={}){
  if(platform!=='win32')return {ok:true,supported:false,enabled:false,error:null};
  const spec=launchSpec({isPackaged:!!app.isPackaged,execPath,appPath:app.getAppPath(),portablePath:env.ECLIPSE_LAUNCHER_PATH||env.PORTABLE_EXECUTABLE_FILE});
  try{
    const before=app.getLoginItemSettings({path:spec.path,args:spec.args});
    const existing=before.launchItems?.find(item=>item.name===ENTRY_NAME);
    // Keep an explicit disable made in Task Manager unless the user changes this setting here.
    const disabledByWindows=!!desired&&!force&&existing?.enabled===false;
    app.setLoginItemSettings({...spec,openAtLogin:!!desired,enabled:!!desired&&!disabledByWindows});
    const after=app.getLoginItemSettings({path:spec.path,args:spec.args});
    return {ok:true,supported:true,enabled:!!after.openAtLogin&&after.executableWillLaunchAtLogin!==false,disabledByWindows,error:null};
  }catch{return {ok:false,supported:true,enabled:false,error:'Не удалось изменить автозагрузку Windows. Проверьте разрешения приложения.'};}
}
module.exports={ENTRY_NAME,launchSpec,configureAutostart};

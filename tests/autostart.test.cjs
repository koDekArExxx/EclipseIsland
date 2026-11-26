const {test}=require('node:test');const assert=require('node:assert/strict');
const {launchSpec,configureAutostart}=require('../electron/autostart.cjs');
test('portable startup points at the original EXE, and development paths are quoted',()=>{
  const portable=launchSpec({isPackaged:true,execPath:'C:\\Temp\\unpacked\\EclipseIsland.exe',appPath:'C:\\Temp\\app.asar',portablePath:'C:\\My Apps\\EclipseIsland.exe'});
  assert.equal(portable.path,'C:\\My Apps\\EclipseIsland.exe');assert.deepEqual(portable.args,['--autostart']);
  const dev=launchSpec({isPackaged:false,execPath:'C:\\Node Apps\\electron.exe',appPath:'C:\\My Project',portablePath:'C:\\wrong.exe'});
  assert.equal(dev.path,'C:\\Node Apps\\electron.exe');assert.deepEqual(dev.args,['"C:\\My Project"','--autostart']);
});
function fakeApp(disabled=false){let current={openAtLogin:false,launchItems:disabled?[{name:'EclipseIsland',enabled:false}]:[]};const writes=[];return {writes,isPackaged:true,getAppPath:()=> 'C:\\app',getLoginItemSettings:()=>current,setLoginItemSettings:value=>{writes.push(value);current={openAtLogin:value.openAtLogin,executableWillLaunchAtLogin:value.enabled,launchItems:[{name:value.name,enabled:value.enabled}]};}};}
test('startup can be enabled and removed without admin rights or command shell wrappers',()=>{
  const app=fakeApp();const options={platform:'win32',execPath:'C:\\EclipseIsland.exe',env:{}};
  assert.equal(configureAutostart(app,true,options).enabled,true);assert.equal(app.writes[0].name,'EclipseIsland');
  assert.equal(configureAutostart(app,false,{...options,force:true}).enabled,false);assert.equal(app.writes.at(-1).openAtLogin,false);
});
test('Task Manager disable is preserved until the user explicitly enables startup here',()=>{
  const app=fakeApp(true),opts={platform:'win32',execPath:'C:\\EclipseIsland.exe',env:{}};
  assert.equal(configureAutostart(app,true,opts).disabledByWindows,true);assert.equal(app.writes[0].enabled,false);
  assert.equal(configureAutostart(app,true,{...opts,force:true}).enabled,true);
});
test('unsupported platforms do not touch login settings, and native errors are surfaced',()=>{
  const app=fakeApp();assert.equal(configureAutostart(app,true,{platform:'linux'}).supported,false);assert.equal(app.writes.length,0);
  app.setLoginItemSettings=()=>{throw new Error('Access denied');};assert.equal(configureAutostart(app,true,{platform:'win32',execPath:'C:\\App.exe',env:{}}).ok,false);
});
test('web install autostart always runs the stable updater before the versioned application',()=>{
 const app=fakeApp();configureAutostart(app,true,{platform:'win32',env:{ECLIPSE_LAUNCHER_PATH:'C:\\Users\\Test\\AppData\\Local\\EclipseIsland\\EclipseIsland.exe',PORTABLE_EXECUTABLE_FILE:'C:\\old.exe'}});
 assert.equal(app.writes.at(-1).path,'C:\\Users\\Test\\AppData\\Local\\EclipseIsland\\EclipseIsland.exe');
});

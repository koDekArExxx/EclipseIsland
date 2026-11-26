const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

class SpotifySetup {
 constructor(directory,onUpdate,options={}){
  this.directory=directory;this.onUpdate=onUpdate;this.spawn=options.spawn||spawn;
  this.platform=options.platform||process.platform;this.fs=options.fs||fs;
  this.script=options.script||path.join(__dirname,'../spotify-bridge/Install-Spotify-Bridge.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  this.statusFile=path.join(directory,'spotify-setup-state.json');
  this.state={status:'idle',message:'Spotify будет настроен автоматически, если он установлен.'};
 }
 publish(state){this.state=state;this.onUpdate(state);}
 read(){try{const state=JSON.parse(this.fs.readFileSync(this.statusFile,'utf8').replace(/^\uFEFF/,''));if(typeof state.status==='string'&&typeof state.message==='string'&&JSON.stringify(state)!==JSON.stringify(this.state))this.publish(state);}catch{}}
 run(manual=false){
  if(this.pending)return this.pending;
  if(this.platform!=='win32')return Promise.resolve({ok:false,error:'Автонастройка доступна в Windows'});
  this.publish({status:'checking',message:'Проверяем подключение Spotify…'});
  try{this.fs.unlinkSync(this.statusFile);}catch{}
  let finish;
  const result=new Promise(resolve=>{finish=resolve;});this.pending=result;
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  let child;
  const complete=(error,code)=>{
   if(this.child!==child)return;
   child?.removeListener('error',onError);child?.removeListener('exit',onExit);
   this.child=null;clearInterval(this.poll);this.poll=null;this.read();
   if(error||code!==0||!['installed','absent'].includes(this.state.status)){
    this.publish({status:'error',message:this.state.status==='error'?this.state.message:'Не удалось настроить Spotify. Нажмите «Повторить настройку» или откройте журнал.',logFile:path.join(this.directory,'spotify-setup.log'),failedCommand:this.state.failedCommand||null,error:error?.code||String(code??'unknown')});
   }
   this.pending=null;finish({ok:this.state.status==='installed',...this.state});
  };
  const onError=error=>complete(error),onExit=code=>complete(null,code);
  try{
   child=this.spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.script,'-Auto',...(manual?['-Force']:[])],{windowsHide:true,stdio:'ignore',shell:false});
   this.child=child;
   child.once('error',onError);child.once('exit',onExit);
   this.poll=setInterval(()=>this.read(),500);this.poll.unref?.();
  }catch(error){complete(error);}
  return result;
 }
 stop(){clearInterval(this.poll);this.poll=null;this.child?.unref?.();}
}
module.exports={SpotifySetup};

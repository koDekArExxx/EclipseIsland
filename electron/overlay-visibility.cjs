// Never detach the nonactivating Chromium input surface through native hide/show.
class OverlayVisibility{
 constructor(window,{beforeShow=()=>{},afterHide=()=>{},duration=200,setTimer=setTimeout,clearTimer=clearTimeout}={}){Object.assign(this,{window,beforeShow,afterHide,duration,setTimer,clearTimer});this.visible=null;this.generation=0;}
 recover(){
  if(this.visible!==true||this.suspended||this.window.isDestroyed())return false;
  // Reattach native mouse input after another HWND used fullscreen/video focus.
  // Keep the same nonactivating surface and honor a user's explicit Hide.
  this.window.setFocusable?.(false);this.window.setIgnoreMouseEvents?.(true,{forward:true});
  this.set(true,true);return true;
 }
 suspend(){
  this.suspended=(this.suspended||0)+1;this.generation++;this.clearTimer(this.timer);this.clearTimer(this.inputTimer);
  if(!this.window.isDestroyed()){this.window.setFocusable?.(false);this.window.setIgnoreMouseEvents?.(true,{forward:true});this.window.setOpacity?.(0);}
  let released=false;return ()=>{if(released)return;released=true;this.suspended--;if(!this.suspended)this.set(this.visible===true,true);};
 }
 set(visible,reduced=false){
  this.clearTimer(this.timer);this.clearTimer(this.inputTimer);const generation=++this.generation,w=this.window;if(w.isDestroyed())return;
  const changed=this.visible!==visible;this.visible=visible;if(this.suspended)return;
  if(visible){
   w.setOpacity?.(1);this.beforeShow();if(!w.isVisible())w.showInactive();w.setIgnoreMouseEvents?.(false);
   w.webContents.send('state',{type:'overlay-visibility',value:{visible:true,animate:changed&&!reduced}});
   this.inputTimer=this.setTimer(()=>{if(this.generation===generation&&this.visible&&!w.isDestroyed()){w.setIgnoreMouseEvents?.(false);this.beforeShow();}},this.duration+40);this.inputTimer.unref?.();
  }else{
   w.setFocusable?.(false);w.setIgnoreMouseEvents?.(true,{forward:true});this.afterHide();w.webContents.send('state',{type:'overlay-visibility',value:{visible:false,animate:changed&&!reduced}});
   const finish=()=>{if(this.generation===generation&&!this.visible&&!w.isDestroyed())w.setOpacity?.(0);};
   if(reduced||!w.isVisible()){finish();return;}this.timer=this.setTimer(finish,this.duration);this.timer.unref?.();
  }
 }
}
module.exports={OverlayVisibility};

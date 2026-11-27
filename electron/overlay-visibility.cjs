// Never detach the nonactivating Chromium input surface through native hide/show.
class OverlayVisibility{
 constructor(window,{beforeShow=()=>{},afterHide=()=>{},duration=200,setTimer=setTimeout,clearTimer=clearTimeout}={}){Object.assign(this,{window,beforeShow,afterHide,duration,setTimer,clearTimer});this.visible=null;this.generation=0;}
 clearRepairs(){this.clearTimer(this.inputTimer);this.clearTimer(this.repairTimer);}
 inputReady(epoch){if(epoch===this.generation)this.clearRepairs();}
 resetInput(){if(!this.window.isDestroyed())this.window.webContents.send('state',{type:'input-reset',value:this.generation});}
 recover(){
  if(this.visible!==true||this.suspended||this.window.isDestroyed())return false;
  // Reattach native mouse input after another HWND used fullscreen/video focus.
  // Keep the same nonactivating surface and honor a user's explicit Hide.
  this.window.setFocusable?.(false);this.window.setIgnoreMouseEvents?.(true,{forward:true});
  this.set(true,true);this.resetInput();const generation=this.generation,w=this.window;
  // One bounded second pass covers the late capture/focus messages after the
  // selector closes. A real pointer event cancels it before it can disrupt use.
  this.repairTimer=this.setTimer(()=>{if(this.generation!==generation||!this.visible||this.suspended||w.isDestroyed())return;w.setIgnoreMouseEvents?.(true,{forward:true});this.beforeShow();w.setIgnoreMouseEvents?.(false);this.resetInput();},700);this.repairTimer.unref?.();return true;
 }
 suspend(){
  this.suspended=(this.suspended||0)+1;this.generation++;this.clearTimer(this.timer);this.clearRepairs();this.resetInput();
  if(!this.window.isDestroyed()){this.window.setFocusable?.(false);this.window.setIgnoreMouseEvents?.(true,{forward:true});this.window.setOpacity?.(0);}
  let released=false;return ()=>{if(released)return;released=true;this.suspended--;if(!this.suspended){if(this.visible===true)this.recover();else this.set(false,true);}};
 }
 set(visible,reduced=false){
  this.clearTimer(this.timer);this.clearRepairs();const generation=++this.generation,w=this.window;if(w.isDestroyed())return;
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

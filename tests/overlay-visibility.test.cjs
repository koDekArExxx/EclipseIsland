const {test}=require('node:test'),assert=require('node:assert/strict');const {OverlayVisibility}=require('../electron/overlay-visibility.cjs');
test('Ctrl+Alt+I keeps the HWND alive, animates opacity and restores input without native hide/show',()=>{
 const pending=new Map(),messages=[];let index=0,refresh=0,restored=0;
 const w={visible:true,opacity:1,ignored:true,shows:0,hides:0,isDestroyed:()=>false,isVisible(){return this.visible;},setIgnoreMouseEvents(v){this.ignored=v;},setOpacity(v){this.opacity=v;},hide(){this.hides++;this.visible=false;},showInactive(){this.shows++;this.visible=true;},webContents:{send:(_,v)=>messages.push(v)}};
 const v=new OverlayVisibility(w,{beforeShow:()=>refresh++,afterHide:()=>restored++,setTimer:fn=>{pending.set(++index,fn);return index;},clearTimer:id=>pending.delete(id)});
 v.set(false);assert.equal(w.opacity,1);assert.equal(w.ignored,true);const stale=[...pending.values()][0];v.set(true);assert.equal(w.ignored,false);stale();assert.equal(w.opacity,1);
 v.set(false);[...pending.values()][0]();assert.equal(w.visible,true);assert.equal(w.opacity,0);v.set(true);assert.equal(w.opacity,1);w.ignored=true;[...pending.values()][0]();assert.equal(w.ignored,false);assert.equal(refresh,3);assert.equal(restored,2);
 v.set(false,true);assert.equal(w.opacity,0);assert.equal(w.ignored,true);assert.equal(pending.size,0);assert.equal(w.hides,0);assert.equal(w.shows,0);
});

test('temporary screenshot suspension restores desired visibility, never a stale zero opacity',()=>{
 const pending=new Map();let id=0;const w={opacity:1,ignored:false,isDestroyed:()=>false,isVisible:()=>true,setOpacity(value){this.opacity=value;},setIgnoreMouseEvents(value){this.ignored=value;},webContents:{send:()=>{}}};
 const v=new OverlayVisibility(w,{setTimer:fn=>{pending.set(++id,fn);return id;},clearTimer:key=>pending.delete(key)});v.set(false);const stale=[...pending.values()][0];v.set(true);const resume=v.suspend();assert.equal(w.opacity,0);v.set(true);assert.equal(w.opacity,0);resume();assert.equal(w.opacity,1);assert.equal(w.ignored,false);stale();assert.equal(w.opacity,1);resume();assert.equal(w.opacity,1);
 const restore=v.suspend();v.set(false);restore();assert.equal(w.opacity,0);assert.equal(w.ignored,true);assert.equal(v.visible,false);
 v.set(true);const first=v.suspend(),second=v.suspend();first();assert.equal(w.opacity,0);second();assert.equal(w.opacity,1);
});

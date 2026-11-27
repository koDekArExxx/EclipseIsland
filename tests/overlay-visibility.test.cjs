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


test('preview recovery cycles native input, refreshes the shape and re-arms a delayed repair without focus',()=>{
 const timers=new Map(),calls=[];let id=0,refresh=0;
 const w={dead:false,visible:true,isDestroyed(){return this.dead;},isVisible(){return this.visible;},setFocusable:v=>calls.push(['focusable',v]),setIgnoreMouseEvents:v=>calls.push(['ignore',v]),setOpacity:v=>calls.push(['opacity',v]),webContents:{send:()=>{}}};
 const v=new OverlayVisibility(w,{beforeShow:()=>refresh++,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:key=>timers.delete(key)});
 v.set(true,true);calls.length=0;const before=refresh;
 assert.equal(v.recover(),true);assert.deepEqual(calls.filter(x=>x[0]==='ignore').map(x=>x[1]),[true,false]);assert.equal(refresh,before+1);
 const repair=[...timers.values()][0];repair();assert.equal(refresh,before+2);assert.equal(calls.at(-1)[1],false);assert.ok(calls.filter(x=>x[0]==='focusable').every(x=>x[1]===false));
 v.set(false,true);calls.length=0;assert.equal(v.recover(),false);assert.equal(calls.length,0);
 v.set(true,true);const release=v.suspend();calls.length=0;assert.equal(v.recover(),false);assert.equal(calls.length,0);release();
 w.dead=true;calls.length=0;assert.equal(v.recover(),false);assert.equal(calls.length,0);
});

test('screenshot recovery runs a bounded second pass, cancelled by a current pointer acknowledgement',()=>{
 const timers=new Map(),calls=[];let id=0;
 const w={ignored:false,isDestroyed:()=>false,isVisible:()=>true,setOpacity(){},setFocusable(){},setIgnoreMouseEvents:v=>{w.ignored=v;calls.push(v);},webContents:{send(){}}};
 const v=new OverlayVisibility(w,{setTimer:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimer:key=>timers.delete(key)});v.set(true,true);const release=v.suspend();release();assert.equal(w.ignored,false);
 const late=[...timers.values()].find(x=>x.ms===700);assert.ok(late);w.ignored=true;late.fn();assert.equal(w.ignored,false);
 v.recover();const epoch=v.generation;v.inputReady(epoch-1);assert.ok(timers.size>0,'stale pre-screenshot events cannot cancel repair');v.inputReady(epoch);assert.equal(timers.size,0);
 v.recover();const stale=[...timers.values()].find(x=>x.ms===700);v.set(false,true);stale.fn();assert.equal(w.ignored,true,'late repair never unhides a disabled island');
});

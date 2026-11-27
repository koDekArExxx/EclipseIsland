const {test}=require('node:test');
const assert=require('node:assert/strict');
const {supportsNativeBlur,roundedShape,overlayShape,setMaterial}=require('../electron/window-style.cjs');
test('desktop Acrylic is enabled only on compatible Windows versions',()=>{
  assert.equal(supportsNativeBlur('win32','10.0.19045'),false);assert.equal(supportsNativeBlur('win32','10.0.22621'),true);assert.equal(supportsNativeBlur('linux','6.18.57'),false);
});
test('native blur shape stays inside the pill and follows expanded geometry',()=>{
  for(const r of [{x:100,y:20,width:328,height:57,radius:28},{x:20,y:10,width:540,height:350,radius:40}]){
    const shape=roundedShape(r);assert.ok(shape.length>1);
    for(const box of shape){assert.ok(box.x>=r.x&&box.y>=r.y&&box.width>0&&box.height>0);assert.ok(box.x+box.width<=r.x+r.width);assert.ok(box.y+box.height<=r.y+r.height);}
    assert.ok(shape.find(box=>box.x===r.x&&box.width===r.width));
  }
});
test('liquid never enables Acrylic; matte blur is independent of native overlay clipping',()=>{
  const calls=[];const win={isDestroyed:()=>false,setBackgroundMaterial:v=>calls.push(v),setShape:s=>calls.push(s)};
  assert.equal(setMaterial(win,'liquid',true,{x:0,y:0,width:300,height:60,radius:30}),false);assert.equal(calls[0],'none');assert.ok(calls[1].length);
  assert.equal(setMaterial(win,'modern',true,{x:0,y:0,width:300,height:60}),false);assert.ok(calls.at(-1).length);
  assert.equal(setMaterial(win,'frosted',true),true);assert.equal(calls.at(-1),'acrylic');
  win.setBackgroundMaterial=()=>{throw new Error('not supported');};assert.equal(setMaterial(win,'liquid',true),false);
});

test('native region leaves antialiased CSS edges intact',()=>{
  const rect={x:136,y:20,width:328,height:57,radius:28};const padded=overlayShape(rect);
  assert.equal(Math.min(...padded.map(r=>r.y)),18);assert.equal(Math.max(...padded.map(r=>r.y+r.height)),79);
  assert.equal(Math.min(...padded.map(r=>r.x)),134);assert.equal(Math.max(...padded.map(r=>r.x+r.width)),466);
});

test('dashboard leaves the CSS alpha edge intact without a binary native mask',()=>{
  const {dashboardRadius,clipDashboard}=require('../electron/window-style.cjs');
  assert.equal(dashboardRadius({}),26);assert.equal(dashboardRadius({advancedTheme:true,cardRadius:24}),36);
  let shape;const win={isDestroyed:()=>false,setShape:value=>shape=value};
  assert.equal(clipDashboard(win),true);assert.deepEqual(shape,[]);
  assert.equal(clipDashboard({...win,setShape(){throw Error('unsupported');}}),false);
});


test('Windows utility surfaces use native toolbar classification without disabling selector keyboard input',()=>{
 const {backgroundWindowOptions}=require('../electron/window-style.cjs');
 for(const keyboard of [false,true]){const v=backgroundWindowOptions('win32',{keyboard});assert.equal(v.type,'toolbar');assert.equal(v.skipTaskbar,true);assert.equal(v.show,false);assert.equal(v.focusable,keyboard);assert.equal(v.minimizable,false);assert.equal(v.maximizable,false);}
 assert.equal(backgroundWindowOptions('linux').type,undefined);assert.equal(backgroundWindowOptions('darwin').type,undefined);
});

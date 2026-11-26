const os = require('node:os');
function supportsNativeBlur(platform=process.platform, release=os.release()) {
  return platform === 'win32' && Number(release.split('.')[2]) >= 22621;
}
function roundedShape(rect) {
  const x=Math.max(0,Math.round(rect.x)), y=Math.max(0,Math.round(rect.y));
  const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
  const r=Math.max(0,Math.min(Math.round(rect.radius||0),Math.floor(w/2),Math.floor(h/2)));
  if(!r)return [{x,y,width:w,height:h}];
  const result=[{x,y:y+r,width:w,height:Math.max(1,h-2*r)}];
  for(let row=0;row<r;row++){
    const inset=Math.ceil(r-Math.sqrt(Math.max(0,r*r-(r-row-.5)**2)));
    result.push({x:x+inset,y:y+row,width:Math.max(1,w-2*inset),height:1});
    result.push({x:x+inset,y:y+h-1-row,width:Math.max(1,w-2*inset),height:1});
  }
  return result;
}
function setMaterial(window, mode, enabled, region) {
  if(!window || window.isDestroyed())return false;
  // Clear liquid glass must never receive a system blur. Acrylic belongs to matte panels only.
  const active=enabled && mode==='frosted';
  try {
    if(typeof window.setBackgroundMaterial==='function')window.setBackgroundMaterial(active?'acrylic':'none');
    if(region && typeof window.setShape==='function')window.setShape(roundedShape(region));
    return active;
  }catch {
    try{window.setBackgroundMaterial('none');}catch{}
    return false;
  }
}
function overlayShape(rect){
  // Leave the rasterized CSS edge inside the native binary region, so Windows cannot cut off antialiasing.
  const pad=2;
  return roundedShape({x:Math.max(0,rect.x-pad),y:Math.max(0,rect.y-pad),width:rect.width+pad*2,height:rect.height+pad*2,radius:(rect.radius||0)+pad});
}
function dashboardRadius(settings={}){
  const radius=Number.isFinite(settings.cardRadius)?settings.cardRadius:12;
  return settings.advancedTheme?Math.min(36,Math.max(22,radius+12)):26;
}
function clipDashboard(window){
  // Binary SetWindowRgn cannot represent partial alpha pixels. The transparent
  // frameless window and CSS border-radius already provide antialiased corners.
  if(!window||window.isDestroyed())return false;
  try{window.setShape?.([]);return true;}catch{return false;}
}
function clipPreview(window,settings){if(!window||window.isDestroyed()||typeof window.setShape!=='function')return;try{if(window.isMaximized?.()||window.isFullScreen?.())window.setShape([]);else{const {width,height}=window.getContentBounds?.()||window.getBounds();window.setShape(roundedShape({x:0,y:0,width,height,radius:dashboardRadius(settings)}));}}catch{}}
function setupPreview(window,getTheme){const sync=()=>{clipPreview(window,getTheme());};for(const event of ['resize','maximize','unmaximize','enter-full-screen','leave-full-screen'])window.on(event,sync);sync();}
module.exports={clipPreview,setupPreview,supportsNativeBlur,roundedShape,overlayShape,setMaterial,dashboardRadius,clipDashboard};

import {DEFAULTS, PALETTES, safeColor, colorRGB} from './model.js';
const selection=document.querySelector('#selection'),shade=document.querySelector('#shade'),dimensions=document.querySelector('#dimensions'),sizeValue=document.querySelector('#size-value');
let start=null,rect=null,done=false,pointer=null,frameSize=null;
function applyTheme(input={}){
 const s={...DEFAULTS,...input},root=document.documentElement,accent=s.accent==='custom'?safeColor(s.customAccent,PALETTES.violet):PALETTES[s.accent]||PALETTES.violet;
 const surface=safeColor(s.surfaceColor,DEFAULTS.surfaceColor),text=safeColor(s.textColor,DEFAULTS.textColor);
 const number=(key,min,max)=>Math.min(max,Math.max(min,Number.isFinite(s[key])?s[key]:DEFAULTS[key]));
 const values={'--surface':surface,'--surface-rgb':colorRGB(surface),'--text':text,'--accent':accent,'--accent-rgb':colorRGB(accent),'--radius':(s.advancedTheme?Math.min(36,Math.max(22,number('cardRadius',4,24)+12)):26)+'px','--control-radius':(s.advancedTheme?number('cardRadius',4,24):12)+'px','--blur':number('blur',0,48)+'px','--density':number('opacity',35,100)/100,'--tint':number('tint',0,60)/100,'--glow':number('glow',0,50)/100};
 if(s.advancedTheme)Object.assign(values,{'--card':safeColor(s.cardColor,DEFAULTS.cardColor),'--muted':safeColor(s.mutedColor,DEFAULTS.mutedColor),'--line':safeColor(s.lineColor,DEFAULTS.lineColor)});
 for(const [key,value] of Object.entries(values))root.style.setProperty(key,String(value));
 root.dataset.renderer=['modern','liquid','frosted'].includes(s.uiRenderer)?s.uiRenderer:'modern';root.classList.toggle('reduced-motion',!!s.reducedMotion);
}
function releasePointer(){const id=pointer;pointer=null;if(id!==null){try{if(document.body.hasPointerCapture?.(id))document.body.releasePointerCapture(id);}catch{}}}
function finish(value){if(done)return;done=true;releasePointer();start=null;window.screenshot.finish(value);}
function point(event){return {x:Math.max(0,Math.min(innerWidth,event.clientX)),y:Math.max(0,Math.min(innerHeight,event.clientY))};}
function reset(){releasePointer();start=null;rect=null;selection.hidden=true;dimensions.hidden=true;shade.hidden=false;document.body.classList.remove('selecting');}
function update(event){
 if(!start||event.pointerId!==pointer)return;const end=point(event);rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};
 selection.hidden=false;shade.hidden=true;dimensions.hidden=false;Object.assign(selection.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
 const sx=frameSize?frameSize.width/innerWidth:devicePixelRatio,sy=frameSize?frameSize.height/innerHeight:devicePixelRatio;
 sizeValue.textContent=(Math.ceil((rect.x+rect.width)*sx)-Math.floor(rect.x*sx))+' × '+(Math.ceil((rect.y+rect.height)*sy)-Math.floor(rect.y*sy));
 const w=dimensions.offsetWidth,h=dimensions.offsetHeight,pad=8;
 const x=Math.max(pad,Math.min(innerWidth-w-pad,rect.x+(rect.width-w)/2));
 let y=rect.y+rect.height+pad;if(y+h>innerHeight-pad)y=rect.y-h-pad;if(y<pad)y=Math.max(pad,Math.min(innerHeight-h-pad,rect.y+pad));
 Object.assign(dimensions.style,{left:x+'px',top:y+'px'});
}
document.addEventListener('pointerdown',event=>{if(done||start||event.button!==0||event.target.closest('#hint'))return;start=point(event);pointer=event.pointerId;rect=null;document.body.classList.add('selecting');document.body.setPointerCapture?.(pointer);update(event);});
document.addEventListener('pointermove',update);document.addEventListener('pointerup',event=>{if(!start||event.pointerId!==pointer)return;update(event);if(rect.width>=3&&rect.height>=3){const value=rect;finish(value);}else reset();});
document.addEventListener('pointercancel',event=>{if(event.pointerId===pointer)reset();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')finish(null);});document.addEventListener('contextmenu',event=>{event.preventDefault();finish(null);});document.querySelector('#cancel').onclick=()=>finish(null);
window.addEventListener('blur',()=>finish(null));
window.screenshot.frame().then(value=>{applyTheme(value.theme);if(value.pixelWidth>0&&value.pixelHeight>0)frameSize={width:value.pixelWidth,height:value.pixelHeight};const image=document.querySelector('#frame');image.onload=()=>window.screenshot.ready();image.onerror=()=>finish(null);image.src=value.image;}).catch(()=>finish(null));

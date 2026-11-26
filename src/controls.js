import { escapeHTML as escape, safeColor } from './model.js';

let serial=0,active=null,hooks={};
export function choice(key,title,items,value,{all=false,scope='settings',disabled=false}={}){
  const id=`choice-${++serial}`;
  const options=items.map(item=>({value:String(item[0]),label:String(item[1])}));
  const selected=options.find(item=>item.value===String(value));
  return `<div class="choice-control" data-choice data-choice-options="${escape(JSON.stringify(options))}"><input type="hidden" ${all?'data-all-renderer':`${scope==='capture'?'data-capture-setting':scope==='tools'?'data-tools-setting':'data-setting'}="${escape(key)}"`} value="${escape(value)}" ${disabled?'disabled':''}><button type="button" ${disabled?'disabled':''} id="${id}" class="choice-trigger" role="combobox" aria-label="${escape(title)}" aria-haspopup="listbox" aria-expanded="false"><span data-choice-label>${escape(selected?.label||(scope==='capture'?'Выберите…':'Разные стили'))}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m7 10 5 5 5-5"/></svg></button></div>`;
}
export function colorControl(key,title,value){
  const hex=safeColor(value);
  return `<div class="color-control"><input class="hex-input" data-inline-hex="${key}" aria-label="${escape(title)} HEX" value="${hex}" maxlength="7" spellcheck="false"><input type="hidden" data-setting="${key}" value="${hex}"><button type="button" class="color-trigger" data-color-target="${key}" data-color-title="${escape(title)}" aria-label="${escape(title)}" aria-haspopup="dialog" style="--picked-color:${hex}"><span></span></button></div>`;
}
export function syncControls(root=document){
  if(active?.kind==='choice'&&active.input.disabled)closeControls({restore:false});
  if(active)active.panel.dataset.renderer=document.documentElement.dataset.uiRenderer||'modern';
  root.querySelectorAll('[data-choice]').forEach(host=>{
    const input=host.querySelector('input');host.querySelector('.choice-trigger').disabled=input.disabled;const value=input.value,items=JSON.parse(host.dataset.choiceOptions);
    const label=items.find(item=>item.value===value)?.label||(input.hasAttribute('data-capture-setting')?'Выберите…':'Разные стили');
    const target=host.querySelector('[data-choice-label]');if(target.textContent!==label)target.textContent=label;
  });
  root.querySelectorAll('[data-inline-hex]').forEach(input=>{
    const hidden=root.querySelector(`[data-setting="${input.dataset.inlineHex}"]`);
    if(hidden&&document.activeElement!==input)input.value=hidden.value;
  });
  root.querySelectorAll('[data-color-target]').forEach(button=>{
    const input=root.querySelector(`[data-setting="${button.dataset.colorTarget}"]`);if(input)button.style.setProperty('--picked-color',safeColor(input.value));
  });
}
function position(panel,trigger){
  const box=trigger.getBoundingClientRect(),pad=12;if(active)active.anchor={x:box.x,y:box.y};
  panel.style.visibility='hidden';document.body.append(panel);
  const width=panel.getBoundingClientRect().width,height=panel.getBoundingClientRect().height;
  panel.style.left=`${Math.max(pad,Math.min(innerWidth-width-pad,box.right-width))}px`;
  const below=box.bottom+7;const above=box.top-height-7;const top=below+height<=innerHeight-pad?below:above>=pad?above:below;
  panel.style.top=`${Math.max(pad,Math.min(innerHeight-height-pad,top))}px`;
  panel.style.visibility='visible';
}
export function closeControls({restore=true}={}){
  if(!active)return;
  const previous=active;active=null;previous.panel.remove();
  previous.trigger.setAttribute('aria-expanded','false');
  if(previous.kind==='color'&&!previous.committed)hooks.cancelPreview?.();
  if(restore&&previous.trigger.isConnected)previous.trigger.focus({preventScroll:true});
}
function choose(host,trigger){
  if(trigger.disabled||host.querySelector('input').disabled)return;
  if(active?.trigger===trigger){closeControls();return;}
  closeControls({restore:false});
  const input=host.querySelector('input'),items=JSON.parse(host.dataset.choiceOptions);
  const panel=document.createElement('div');panel.className='floating-menu';panel.dataset.renderer=document.documentElement.dataset.uiRenderer||'modern';panel.role='listbox';panel.id='eclipse-choice-menu';panel.setAttribute('aria-labelledby',trigger.id);
  panel.innerHTML=`<div class="popover-heading" aria-hidden="true"><span>${escape(trigger.getAttribute('aria-label'))}</span><kbd>Esc</kbd></div>`+items.map(item=>`<button type="button" class="floating-option" role="option" data-choice-value="${escape(item.value)}" aria-selected="${String(item.value===input.value)}"><span>${escape(item.label)}</span><span class="option-check">✓</span></button>`).join('');
  trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',panel.id);
  active={kind:'choice',panel,trigger,host,input};position(panel,trigger);hooks.sound?.('open');
}
function rgb(hex){const h=safeColor(hex).slice(1);return [0,2,4].map(index=>parseInt(h.slice(index,index+2),16));}
function toHex(values){return '#'+values.map(v=>Math.round(Math.min(255,Math.max(0,v))).toString(16).padStart(2,'0')).join('');}
function toHSV(hex){
  const [r,g,b]=rgb(hex).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  let h=0;if(delta){if(max===r)h=((g-b)/delta)%6;else if(max===g)h=(b-r)/delta+2;else h=(r-g)/delta+4;h=(h*60+360)%360;}
  return {h,s:max?delta/max:0,v:max};
}
function fromHSV({h,s,v}){
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
  const values=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return toHex(values.map(value=>(value+m)*255));
}
function updatePicker(){
  const a=active;if(a?.kind!=='color')return;
  const hex=fromHSV(a.hsv),panel=a.panel;a.hex=hex;panel.querySelector('.color-plane').setAttribute('aria-valuetext',`Насыщенность ${Math.round(a.hsv.s*100)}%, яркость ${Math.round(a.hsv.v*100)}%`);
  panel.style.setProperty('--picker-hue',`hsl(${a.hsv.h} 100% 50%)`);
  const thumb=panel.querySelector('.color-point');thumb.style.left=`${a.hsv.s*100}%`;thumb.style.top=`${(1-a.hsv.v)*100}%`;thumb.style.background=hex;
  const hue=panel.querySelector('[data-picker-hue]');hue.value=a.hsv.h;
  const field=panel.querySelector('[data-picker-hex]');if(document.activeElement!==field)field.value=hex;
  rgb(hex).forEach((value,i)=>{const input=panel.querySelector(`[data-picker-rgb="${i}"]`);if(document.activeElement!==input)input.value=value;});
  panel.querySelector('.picker-sample').style.background=hex;
  hooks.preview?.(a.key,hex);
}
function colorPicker(trigger){
  if(active?.trigger===trigger){closeControls();return;}
  closeControls({restore:false});
  const key=trigger.dataset.colorTarget,input=document.querySelector(`[data-setting="${key}"]`),panel=document.createElement('div');
  panel.className='color-popover';panel.dataset.renderer=document.documentElement.dataset.uiRenderer||'modern';panel.role='dialog';panel.setAttribute('aria-label',trigger.dataset.colorTitle);
  panel.innerHTML=`<div class="picker-heading"><strong>${escape(trigger.dataset.colorTitle)}</strong><span class="picker-sample"></span></div><div class="color-plane" tabindex="0" role="slider" aria-label="Насыщенность и яркость"><i class="color-point"></i></div><input class="hue-slider" data-picker-hue type="range" min="0" max="359" step="1" aria-label="Оттенок"><div class="picker-values"><label>HEX<input data-picker-hex spellcheck="false" maxlength="7"></label>${['R','G','B'].map((name,index)=>`<label>${name}<input type="number" min="0" max="255" data-picker-rgb="${index}"></label>`).join('')}</div><div class="picker-presets">${['#bda2ff','#7c3aed','#5b9dff','#36d5d9','#85dfb3','#ffcc75','#ff8eb9','#f0ebfa','#120d1d'].map(hex=>`<button type="button" data-pick-hex="${hex}" style="--picked-color:${hex}" aria-label="${hex}"></button>`).join('')}</div><div class="picker-actions"><button type="button" data-picker-cancel>Отмена</button><button type="button" data-picker-apply>Применить</button></div>`;
  trigger.setAttribute('aria-expanded','true');active={kind:'color',panel,trigger,key,input,hsv:toHSV(input.value),committed:false};position(panel,trigger);updatePicker();panel.querySelector('[data-picker-hex]').focus({preventScroll:true});hooks.sound?.('open');
  const plane=panel.querySelector('.color-plane');let dragging=false;
  function drag(event){const box=plane.getBoundingClientRect();active.hsv.s=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width));active.hsv.v=1-Math.max(0,Math.min(1,(event.clientY-box.top)/box.height));updatePicker();}
  plane.addEventListener('pointerdown',event=>{dragging=true;plane.setPointerCapture(event.pointerId);drag(event);});
  plane.addEventListener('pointermove',event=>{if(dragging&&active?.panel===panel)drag(event);});
  plane.addEventListener('pointerup',()=>dragging=false);plane.addEventListener('lostpointercapture',()=>dragging=false);
  plane.addEventListener('keydown',event=>{if(!active||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();active.hsv.s=Math.max(0,Math.min(1,active.hsv.s+(event.key==='ArrowRight'?.02:event.key==='ArrowLeft'?-.02:0)));active.hsv.v=Math.max(0,Math.min(1,active.hsv.v+(event.key==='ArrowUp'?.02:event.key==='ArrowDown'?-.02:0)));updatePicker();});
}
function commit(input,value){
  if(input.disabled)return;input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));syncControls();}
export function initControls(options={}){
  hooks=options;
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('.choice-trigger');if(trigger){choose(trigger.closest('[data-choice]'),trigger);return;}
    const color=event.target.closest?.('[data-color-target]');if(color){colorPicker(color);return;}
    if(!active)return;
    const option=event.target.closest?.('[data-choice-value]');if(option&&active.kind==='choice'){const a=active;commit(a.input,option.dataset.choiceValue);hooks.sound?.('tap');closeControls();return;}
    if(event.target.closest?.('[data-picker-cancel]')){closeControls();return;}
    if(event.target.closest?.('[data-picker-apply]')){const a=active;a.committed=true;commit(a.input,a.hex);hooks.sound?.('success');closeControls();return;}
    const preset=event.target.closest?.('[data-pick-hex]');if(preset&&active.kind==='color'){active.hsv=toHSV(preset.dataset.pickHex);updatePicker();return;}
    if(!active.panel.contains(event.target))closeControls({restore:false});
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.matches('[data-inline-hex]')){el.classList.toggle('invalid',!/^#[\da-f]{6}$/i.test(el.value));if(/^#[\da-f]{6}$/i.test(el.value))hooks.preview?.(el.dataset.inlineHex,el.value.toLowerCase());return;}
    if(active?.kind!=='color')return;
    if(el.matches('[data-picker-hue]'))active.hsv.h=Number(el.value);
    else if(el.matches('[data-picker-hex]')){if(!/^#[\da-f]{6}$/i.test(el.value))return;active.hsv=toHSV(el.value);}
    else if(el.matches('[data-picker-rgb]'))active.hsv=toHSV(toHex([...active.panel.querySelectorAll('[data-picker-rgb]')].map(input=>Number(input.value)||0)));
    else return;
    updatePicker();
  });
  document.addEventListener('change',event=>{
    const el=event.target;if(!el.matches('[data-inline-hex]'))return;
    const hidden=document.querySelector(`[data-setting="${el.dataset.inlineHex}"]`);
    if(/^#[\da-f]{6}$/i.test(el.value))commit(hidden,el.value.toLowerCase());else{el.value=hidden.value;hooks.cancelPreview?.();}el.classList.remove('invalid');
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&active){event.preventDefault();event.stopImmediatePropagation();closeControls();return;}
    const trigger=event.target.closest?.('.choice-trigger');
    if(trigger&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!active)choose(trigger.closest('[data-choice]'),trigger);active?.panel.querySelector('[aria-selected="true"],.floating-option')?.focus();return;}
    if(active?.kind==='choice'&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const list=[...active.panel.querySelectorAll('.floating-option')],index=list.indexOf(document.activeElement);
      list[event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowDown'?1:-1)+list.length)%list.length]?.focus();
    }
    if(event.key==='Tab'&&active?.kind==='choice')closeControls({restore:false});
  },true);
  document.addEventListener('scroll',event=>{if(!active||active.panel.contains(event.target))return;const box=active.trigger.getBoundingClientRect();if(!active.anchor||Math.abs(box.x-active.anchor.x)>1||Math.abs(box.y-active.anchor.y)>1)closeControls({restore:false});},true);
  document.addEventListener('focusin',event=>{if(active?.kind==='color'&&!active.panel.contains(event.target)&&event.target!==active.trigger)closeControls({restore:false});});
  window.addEventListener('resize',()=>closeControls({restore:false}));
}

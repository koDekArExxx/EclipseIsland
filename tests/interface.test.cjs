const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'../src');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(overlay=false){
  const dom=new JSDOM(fs.readFileSync(path.join(root,overlay?'overlay.html':'index.html'),'utf8'),{url:'http://localhost/'+(overlay?'?view=overlay':''),runScripts:'outside-only',pretendToBeVisual:true});
  const {window:w}=dom;let listener;const commands=[],applied=[],captureCommands=[],captureSaves=[],transferCommands=[],heartbeats=[],toolCommands=[];let saved;
  const timers=new Map(),nativeSetTimeout=w.setTimeout.bind(w),nativeClearTimeout=w.clearTimeout.bind(w);
  w.setTimeout=(fn,delay,...args)=>{let id;id=nativeSetTimeout(()=>{timers.delete(id);fn(...args);},delay);timers.set(id,delay);return id;};
  w.clearTimeout=id=>{timers.delete(id);nativeClearTimeout(id);};
  const initial={settings:{...require('../electron/settings.cjs').defaults,sounds:false},weather:{status:'empty'},media:{available:true,active:false},capture:{status:'idle',active:false,settings:{...require('../electron/capture-store.cjs').defaults,folder:'C:\\Videos\\EclipseIsland'},recent:[]},transfers:{items:[],status:'ready'},tools:{entries:[],recent:[],settings:{copy:true,folder:'C:\\Pictures\\EclipseIsland'}},platform:'win32',version:'0.1.0',shortcuts:{expand:true,visibility:true},monitors:[{id:13,label:'Test display'}]};
  w.ResizeObserver=class{observe(){}disconnect(){}};
  w.HTMLElement.prototype.scrollTo=function(){};
  w.island={launcherProcesses:async()=>({ok:true,items:[{id:'proc-1',name:'Spotify',title:'Музыка',target:'C:/Spotify.exe',pids:[17]},{id:'proc-2',name:'Editor',title:'Код',target:'C:/Editor.exe',pids:[20]}]}),focusInput:value=>toolCommands.push({type:'focus',value}),launcher:async(action,id,value)=>{toolCommands.push({type:'launcher',action,id,value});return action==='open-all'?{ok:true,launched:2,total:2}:{ok:true};},screenshot:async(action,id)=>{toolCommands.push({type:'screenshot',action,id});return {ok:true,copied:true};},toolsSettings:async patch=>{toolCommands.push({type:'settings',patch});initial.tools={...initial.tools,settings:{...initial.tools.settings,...patch}};listener({type:'tools',value:initial.tools});return {ok:true};},screenshotFolder:async()=>{toolCommands.push({type:'folder'});return {ok:true};},captureSources:async()=>[{id:'screen:1:0',name:'Экран 1',thumbnail:''}],captureSettings:async patch=>{captureSaves.push(patch);initial.capture={...initial.capture,settings:{...initial.capture.settings,...patch}};listener({type:'capture',value:initial.capture});return initial.capture;},capture:async(action,id)=>{captureCommands.push({action,id});if(action==='start')initial.capture={...initial.capture,active:true,status:'recording',elapsed:0};if(action==='pause')initial.capture={...initial.capture,status:initial.capture.status==='paused'?'recording':'paused'};if(action==='stop')initial.capture={...initial.capture,active:false,status:'idle',recent:[{id:'a'.repeat(32),name:'EclipseIsland-Test.webm',bytes:1024,createdAt:1000,duration:12}]};listener({type:'capture',value:initial.capture});return initial.capture;},transfer:async(action,id)=>{transferCommands.push({action,id});return {ok:true};},activityHeartbeat:ids=>heartbeats.push(ids),mediaApplied:sequence=>applied.push(sequence),init:async()=>initial,on:fn=>{listener=fn;},save:async value=>{saved=value;return value;},media:async(action,seconds)=>{commands.push({action,seconds});return {ok:true};},bounds:()=>{},cities:async()=>({ok:true,items:[{name:'Москва',country:'Россия',latitude:55.75,longitude:37.61}]}),selectCity:async()=>{},refreshWeather:async()=>{},showSettings:page=>toolCommands.push({type:'show-settings',page}),minimize:()=>{},close:()=>{},quit:()=>{}};
  // Execute the actual renderer modules in one lexical scope; no browser or network is used.
  const bundle=['icons.js','model.js','browser-api.js','audio.js','controls.js','app.js'].map(name=>fs.readFileSync(path.join(root,name),'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')+(name==='model.js'?'\nconst esc=escapeHTML;const escape=escapeHTML;':'')).join('\n');
  w.eval(bundle);await sleep(40);
  return {dom,w,document:w.document,commands,applied,timers,captureCommands,captureSaves,transferCommands,heartbeats,toolCommands,emit:(type,value,sequence)=>listener({type,value,sequence}),saved:()=>saved};
}
test('settings UI saves changes, navigates, expands and protects media metadata',async()=>{
  const f=await fixture();const {document:d,w}=f;
  try{
    assert.equal(d.querySelector('#page-title').textContent,'Обзор');
    d.querySelector('[data-setting="topmost"]').click();await sleep(5);assert.equal(f.saved().topmost,false);
    d.querySelector('.sidebar [data-nav="appearance"]').click();assert.equal(d.querySelector('#page-title').textContent,'Внешний вид');
    d.querySelector('[data-accent="violet"]').click();await sleep(5);assert.equal(f.saved().accent,'violet');assert.equal(d.documentElement.dataset.accent,'violet');
    d.querySelector('[data-expand]').click();assert.equal(d.querySelector('[data-expand]').getAttribute('aria-expanded'),'true');
    d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(d.querySelector('[data-expand]').getAttribute('aria-expanded'),'false');
    d.querySelector('.sidebar [data-nav="music"]').click();
    assert.equal(d.querySelector('[data-media="toggle"]').disabled,true);
    f.emit('media',{available:true,active:true,title:'<img src=x onerror=alert(1)>',artist:'Тест',source:'Spotify.exe',playing:true,position:45,duration:180,canToggle:true,canNext:true,canPrevious:false,canSeek:true});
    assert.equal(d.querySelector('[data-track-title]').textContent,'<img src=x onerror=alert(1)>');assert.equal(d.querySelector('.track-copy img'),null);
    d.querySelector('[data-media="toggle"]').click();await sleep(5);assert.equal(f.commands[0].action,'toggle');
    const seek=d.querySelector('[data-seek]');seek.value='75';seek.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);assert.deepEqual(f.commands[1],{action:'seek',seconds:75});
    d.querySelector('.sidebar [data-nav="weather"]').click();assert.match(d.querySelector('[data-weather-detail]').textContent,/Выберите город/);
    f.emit('weather',{status:'error',error:'Нет сети'});assert.match(d.querySelector('[data-weather-detail]').textContent,/Нет сети/);
    const search=d.querySelector('#city-search');search.value='Мос';search.dispatchEvent(new w.Event('input',{bubbles:true}));await sleep(450);assert.equal(d.querySelector('[data-city="0"] strong').textContent,'Москва');
  }finally{f.dom.window.close();}
});
test('startup has explicit yes/no options and can be disabled without losing the purple theme',async()=>{
  const f=await fixture();const {document:d,w}=f;
  try{
    assert.equal(d.documentElement.dataset.accent,'violet');assert.match(d.querySelector('.brand').textContent,/EclipseIsland/);
    const field=d.querySelector('[data-setting="autoLaunch"]');assert.equal(field.value,'true');assert.equal(d.querySelector('select'),null);field.parentElement.querySelector('.choice-trigger').click();assert.deepEqual([...d.querySelectorAll('.floating-option')].map(x=>x.textContent.trim()),['Да✓','Нет✓']);d.querySelector('[data-choice-value="false"]').click();await sleep(5);assert.equal(f.saved().autoLaunch,false);
    field.value='false';field.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.saved().autoLaunch,false);assert.equal(f.saved().accent,'violet');
    field.value='true';field.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.saved().autoLaunch,true);
  }finally{f.dom.window.close();}
});
test('overlay renders standalone, follows settings and honors global expand messages',async()=>{
  const f=await fixture(true);const {document:d}=f;
  try{
    assert.equal(d.querySelector('.sidebar'),null);assert.ok(d.querySelector('.overlay-root'));assert.ok(d.documentElement.classList.contains('overlay-document'));assert.equal(d.querySelector('#boot-loader'),null);
    f.emit('expand');assert.ok(d.querySelector('.island.expanded'));
    f.emit('settings',{...require('../electron/settings.cjs').defaults,showMusic:false,showWeather:false,reducedMotion:true,scale:120,sounds:false});
    assert.equal(d.querySelector('[data-island-tab="music"]'),null);assert.equal(d.querySelector('[data-island-tab="weather"]'),null);assert.ok(d.documentElement.classList.contains('reduced-motion'));
    d.querySelector('[data-collapse]').click();assert.equal(d.querySelector('.island.expanded'),null);
  }finally{f.dom.window.close();}
});
test('unchanged media does not mutate the DOM or remount the island',async()=>{
  const f=await fixture();const {document:d,w}=f;
  try{
    d.querySelector('.sidebar [data-nav="music"]').click();
    const packet={available:true,active:true,trackKey:'stable',title:'Stable',artist:'Artist',playing:false,position:10,duration:120,canToggle:true,canNext:false,canPrevious:false,canSeek:true};
    f.emit('media',packet);await sleep(5);
    const updates=[];const observer=new w.MutationObserver(records=>updates.push(...records));observer.observe(d.querySelector('#app'),{subtree:true,attributes:true,characterData:true,childList:true});
    for(let i=0;i<10;i++)f.emit('media',packet);
    await sleep(5);observer.disconnect();assert.equal(updates.length,0);
  }finally{f.dom.window.close();}
});
test('hidden UI stops its timers and applies a fresh native snapshot on show',async()=>{
  const f=await fixture(true);const {document:d}=f;
  try{
    f.emit('media',{available:true,active:true,trackKey:'timer',title:'Before hide',playing:true,position:5,duration:90,canSeek:true});
    f.emit('expand');d.querySelector('[data-island-tab="music"]').click();
    assert.ok([...f.timers.values()].includes(250));
    f.emit('view-visible',false);assert.equal(f.timers.size,0);assert.ok(d.documentElement.classList.contains('ui-paused'));
    f.emit('snapshot',{media:{available:true,active:true,trackKey:'new',title:'After show',playing:false,position:0,duration:90},settings:{...require('../electron/settings.cjs').defaults,sounds:false}});
    f.emit('view-visible',true);assert.equal(d.querySelector('[data-track-title]').textContent,'After show');assert.equal(d.documentElement.classList.contains('ui-paused'),false);
    assert.equal([...f.timers.values()].includes(250),false);
  }finally{f.dom.window.close();}
});
test('materials can be linked, separated and customized without bringing back the camera dot',async()=>{
  const f=await fixture();const {document:d,w}=f;
  try{
    d.querySelector('.sidebar [data-nav="appearance"]').click();
    d.querySelector('[data-renderer-preset="liquid"]').click();await sleep(5);
    assert.equal(f.saved().uiRenderer,'liquid');assert.equal(f.saved().loaderRenderer,'liquid');assert.equal(d.querySelector('.island').dataset.renderer,'liquid');assert.equal(d.querySelector('.camera-dot'),null);
    const renderer=d.querySelector('[data-setting="islandRenderer"]');renderer.value='frosted';renderer.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);
    assert.equal(f.saved().uiRenderer,'liquid');assert.equal(f.saved().islandRenderer,'frosted');assert.equal(d.querySelector('[data-all-renderer]').value,'mixed');
    const color=d.querySelector('[data-inline-hex="customAccent"]');color.value='#ff0066';color.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.documentElement.style.getPropertyValue('--accent'),'#ff0066');color.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.saved().accent,'custom');assert.equal(f.saved().customAccent,'#ff0066');
    const blur=d.querySelector('[data-setting="blur"]');blur.value='40';blur.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.documentElement.style.getPropertyValue('--glass-blur'),'40px');blur.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.saved().blur,40);
  }finally{f.dom.window.close();}
});
test('artwork updates without reloading on every tick and old covers cannot overwrite the next track',async()=>{
  const f=await fixture();const {document:d}=f;const art='data:image/png;base64,aGVsbG8=';
  try{
    d.querySelector('.sidebar [data-nav="music"]').click();
    f.emit('media',{available:true,active:true,trackKey:'one',title:'First',playing:true,position:4,duration:100,canToggle:true});
    f.emit('media',{trackKey:'one',artwork:art,artworkStatus:'ready'});
    const image=d.querySelector('.album-art .cover-image');assert.ok(image);assert.equal(image.getAttribute('src'),art);
    f.emit('media',{available:true,active:true,trackKey:'one',title:'First',position:5});assert.equal(d.querySelector('.album-art .cover-image'),image);
    d.querySelector('[data-media="toggle"]').click();assert.equal(d.querySelector('[data-media="toggle"]').getAttribute('aria-busy'),'true');await sleep(5);assert.equal(d.querySelector('[data-media="toggle"]').getAttribute('aria-busy'),'false');
    f.emit('media',{available:true,active:true,trackKey:'two',title:'Second',artworkStatus:'loading'});assert.equal(d.querySelector('.album-art .cover-image'),null);assert.equal(d.querySelector('[data-track-title]').textContent,'Second');
    f.emit('media',{trackKey:'one',artwork:art});assert.equal(d.querySelector('.album-art .cover-image'),null);
    f.emit('media',{trackKey:'two',artwork:'javascript:alert(1)'});assert.equal(d.querySelector('.album-art .cover-image'),null);
  }finally{f.dom.window.close();}
});

test('real backend diffs update the displayed track and drop the previous artwork',async()=>{
  const f=await fixture();const {MediaBridge}=require('../electron/media.cjs');const bridge=new MediaBridge(patch=>f.emit('media',patch));
  try{
    f.document.querySelector('.sidebar [data-nav="music"]').click();
    const base={type:'media',available:true,active:true,playing:true,source:'Spotify.exe',duration:200,canNext:true,canToggle:true};
    bridge.accept({...base,trackKey:'first',title:'Первый',artist:'Один',position:50});
    bridge.accept({type:'artwork',trackKey:'first',artwork:'data:image/png;base64,YQ=='});
    assert.ok(f.document.querySelector('.cover-image'));
    bridge.accept({...base,trackKey:'second',title:'Второй',artist:'Два',position:0});
    assert.equal(f.document.querySelector('[data-track-title]').textContent,'Второй');assert.equal(f.document.querySelector('.cover-image'),null);
    // The older producer omits unchanged active:true. It must still work after upgrades.
    f.emit('media',{trackKey:'third',title:'Третий',artist:'Три',artwork:null});
    assert.equal(f.document.querySelector('[data-track-title]').textContent,'Третий');
    bridge.accept({type:'artwork',trackKey:'first',artwork:'data:image/png;base64,YQ=='});
    assert.equal(f.document.querySelector('[data-track-title]').textContent,'Третий');
  }finally{f.dom.window.close();}
});
test('custom color picker previews, cancels and applies without native dialogs',async()=>{
  const f=await fixture();const {document:d,w}=f;
  try{
    d.querySelector('.sidebar [data-nav="appearance"]').click();assert.equal(d.querySelector('input[type=color],select'),null);
    const original=d.documentElement.style.getPropertyValue('--accent');
    d.querySelector('[data-color-target="customAccent"]').click();
    d.querySelector('[data-pick-hex="#ff8eb9"]').click();assert.equal(d.documentElement.style.getPropertyValue('--accent'),'#ff8eb9');
    d.querySelector('[data-picker-cancel]').click();assert.equal(d.documentElement.style.getPropertyValue('--accent'),original);assert.equal(f.saved(),undefined);
    d.querySelector('[data-color-target="customAccent"]').click();
    const hex=d.querySelector('[data-picker-hex]');assert.equal(d.activeElement,hex);hex.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true}));assert.ok(d.querySelector('.color-popover'));hex.value='#345678';hex.dispatchEvent(new w.Event('input',{bubbles:true}));
    d.querySelector('[data-picker-apply]').click();await sleep(5);assert.equal(f.saved().customAccent,'#345678');assert.equal(f.saved().accent,'custom');
    assert.equal(d.querySelector('[data-inline-hex="customAccent"]').value,'#345678');
    d.querySelector('[data-reset-theme]').click();await sleep(5);assert.equal(f.saved().accent,'violet');assert.equal(f.saved().autoLaunch,true);
  }finally{f.dom.window.close();}
});
test('custom choices support keyboard navigation and live media source discovery',async()=>{
  const f=await fixture();const {document:d,w}=f;
  try{
    const trigger=d.querySelector('[data-setting="autoLaunch"]').parentElement.querySelector('button');trigger.focus();
    trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(d.activeElement.getAttribute('aria-selected'),'true');
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));d.activeElement.click();await sleep(5);assert.equal(f.saved().autoLaunch,false);assert.equal(d.querySelector('.floating-menu'),null);
    f.emit('media',{sessions:[{id:'Spotify.exe',playing:true},{id:'chrome.exe',playing:false}]});f.emit('media',{available:true,active:false});d.querySelector('.sidebar [data-nav="music"]').click();
    d.querySelector('[data-setting="mediaSource"]').parentElement.querySelector('button').click();
    d.querySelector('[data-choice-value="Spotify.exe"]').click();await sleep(5);assert.equal(f.saved().mediaSource,'Spotify.exe');
  }finally{f.dom.window.close();}
});

test('visible overlay updates immediately when Chromium reports it occluded',async()=>{
  const f=await fixture(true);const {document:d,w}=f;
  try{
    Object.defineProperty(d,'hidden',{configurable:true,get:()=>true});
    f.emit('media',{available:true,active:true,trackKey:'spotify-first',title:'Сразу первый',artist:'Артист',playing:true});
    assert.equal(d.querySelector('.compact-track').textContent,'Сразу первый');
    f.emit('media',{trackKey:'spotify-next',title:'Сразу следующий',artwork:null,position:0});
    assert.equal(d.querySelector('.compact-track').textContent,'Сразу следующий');
    assert.equal(d.querySelector('.compact-art .track-monogram'),null);assert.ok(d.querySelector('.compact-art .icon'));
    f.emit('view-visible',false);f.emit('media',{available:true,active:false});f.emit('view-visible',true);
    assert.ok(d.querySelector('.compact-clock'));assert.equal(d.querySelector('.compact-track'),null);
  }finally{f.dom.window.close();}
});
test('popup choices follow settings material independently from island material',async()=>{
  const f=await fixture();const {document:d}=f;
  try{
    for(const mode of ['modern','liquid','frosted']){
      f.emit('settings',{...require('../electron/settings.cjs').defaults,uiRenderer:mode,islandRenderer:'liquid',sounds:false});
      d.querySelector('[data-setting="autoLaunch"]').parentElement.querySelector('button').click();
      assert.equal(d.querySelector('.floating-menu').dataset.renderer,mode);assert.equal(d.querySelector('.island').dataset.renderer,'liquid');
      d.querySelector('[data-choice-value="true"]').click();
    }
  }finally{f.dom.window.close();}
});
test('native metadata-first packets update title and late cover for Spotify, Yandex, browser and generic players',async()=>{
 const f=await fixture();const {MediaBridge}=require('../electron/media.cjs'),bridge=new MediaBridge(p=>f.emit('media',p));
 const art='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=';
 try{
   f.document.querySelector('.sidebar [data-nav="music"]').click();
   for(const source of ['Spotify.exe','YandexMusic.exe','chrome.exe','vlc.exe']){
     const packet={type:'media',available:true,active:true,source,trackKey:source+'-one',title:'First',artist:'Artist',artworkStatus:'loading',position:0};
     bridge.accept(packet);bridge.accept({type:'artwork',trackKey:packet.trackKey,artwork:art});
     assert.equal(f.document.querySelector('.album-art img').getAttribute('src'),art);
     bridge.accept({...packet,trackKey:source+'-two',title:'Next'});
     assert.equal(f.document.querySelector('[data-track-title]').textContent,'Next');assert.equal(f.document.querySelector('.album-art img'),null);
     bridge.accept({type:'artwork',trackKey:packet.trackKey,artwork:art});assert.equal(f.document.querySelector('.album-art img'),null);
     bridge.accept({type:'artwork',trackKey:source+'-two',artwork:art});assert.equal(f.document.querySelector('.album-art img').getAttribute('src'),art);
   }
   assert.equal(f.document.querySelector('[data-media-diagnostics]'),null);
 }finally{f.dom.window.close();}
});

test('visible settings apply new tracks immediately even when Chromium reports document.hidden',async()=>{
 const f=await fixture();const d=f.document;
 try{
  d.querySelector('.sidebar [data-nav="music"]').click();
  Object.defineProperty(d,'hidden',{configurable:true,get:()=>true});
  f.emit('media',{available:true,active:true,trackKey:'new',title:'Immediate title',artist:'New artist'},17);
  assert.equal(d.querySelector('[data-track-title]').textContent,'Immediate title');
  assert.equal(f.applied.at(-1),17,'DOM application is acknowledged synchronously, without a timer');
  f.emit('view-visible',false);
  f.emit('media',{available:true,active:true,trackKey:'buffered',title:'Buffered'},18);
  assert.equal(f.applied.at(-1),17,'intentionally hidden windows do not claim an update was displayed');
  f.emit('view-visible',true);
  assert.equal(d.querySelector('[data-track-title]').textContent,'Buffered');
  f.emit('snapshot',{media:{available:true,active:true,trackKey:'restored',title:'Fresh after restore'}},19);
  assert.equal(d.querySelector('[data-track-title]').textContent,'Fresh after restore');assert.equal(f.applied.at(-1),19);
 }finally{f.dom.window.close();}
});

test('technical setup panels stay hidden while player events keep updating the music UI',async()=>{
 const f=await fixture();const d=f.document;
 try{
  d.querySelector('.sidebar [data-nav="music"]').click();
  for(const status of ['installing','error','installed'])f.emit('spotify-setup',{status,message:'internal setup message'});
  assert.equal(d.querySelector('[data-direct-status]'),null);assert.equal(d.querySelector('[data-spotify-setup]'),null);
  assert.equal(d.querySelector('[data-spotify-log]'),null);assert.equal(d.querySelector('[data-media-diagnostics]'),null);
  assert.doesNotMatch(d.body.textContent,/Прямая связь со Spotify|internal setup message/);
  f.emit('media',{available:true,active:true,title:'Updated track',playing:true});
  assert.equal(d.querySelector('[data-track-title]').textContent,'Updated track');
  d.querySelector('.sidebar [data-nav="transfers"]').click();
  assert.equal(d.querySelector('[data-media-diagnostics]'),null);assert.equal(d.querySelector('[data-download-list]'),null);assert.equal(d.querySelector('[data-ayu-folder-choose]'),null);
  assert.doesNotMatch(d.body.textContent,/Что скачалось недавно|Папка загрузок AyuGram|Скопировать диагностику/);
  d.querySelector('.sidebar [data-nav="appearance"]').click();assert.doesNotMatch(d.body.textContent,/Нажатия на остров и медиакнопки/);
  d.querySelector('.sidebar [data-nav="about"]').click();
  assert.equal(d.querySelector('.about-card .version').textContent,'0.1.0');assert.equal(d.querySelector('.os-label'),null);
  const style=d.createElement('style');style.textContent=fs.readFileSync(path.join(root,'styles.css'),'utf8');d.head.append(style);
  assert.equal(f.w.getComputedStyle(d.querySelector('.about-logo')).width,'64px');assert.equal(f.w.getComputedStyle(d.querySelector('.about-logo .icon')).width,'48px');
 }finally{f.dom.window.close();}
});

test('track changes replace the cover, duration and seek range for every source and reset an incomplete timeline',async()=>{
 const f=await fixture();const d=f.document;
 try{
  d.querySelector('.sidebar [data-nav="music"]').click();
  for(const source of ['Spotify.exe','YandexMusic.exe','vlc.exe']){
   const first=source+'-first',next=source+'-next';
   f.emit('media',{available:true,active:true,source,trackKey:first,title:'First',playing:false,duration:180,position:90,canSeek:true,artwork:'data:image/jpeg;base64,YQ=='});
   assert.equal(d.querySelector('[data-duration]').textContent,'3:00');assert.equal(d.querySelector('[data-seek]').max,'180');
   f.emit('media',{active:true,source,trackKey:next,title:'Next',playing:false});
   assert.equal(d.querySelector('[data-duration]').textContent,'0:00');assert.equal(d.querySelector('[data-seek]').value,'0');assert.equal(d.querySelector('.cover-image'),null);
   f.emit('media',{trackKey:next,position:12,duration:250,canSeek:true,artwork:'data:image/jpeg;base64,Yg==',artworkStatus:'ready'});
   assert.equal(d.querySelector('[data-duration]').textContent,'4:10');assert.equal(d.querySelector('[data-seek]').max,'250');assert.equal(d.querySelector('[data-seek]').value,'12');
   assert.equal(d.querySelector('.cover-image').getAttribute('src'),'data:image/jpeg;base64,Yg==');
  }
 }finally{f.dom.window.close();}
});

test('capture UI exposes requested quality/FPS, controls recording and opens recent videos',async()=>{
 const f=await fixture(),d=f.document,w=f.w;
 try{
  d.querySelector('.sidebar [data-nav="capture"]').click();await sleep(5);
  assert.deepEqual(JSON.parse(d.querySelector('[data-capture-setting="height"]').closest('[data-choice]').dataset.choiceOptions).map(x=>x.value),['360','480','720','1080','1440','2160']);
  assert.deepEqual(JSON.parse(d.querySelector('[data-capture-setting="fps"]').closest('[data-choice]').dataset.choiceOptions).map(x=>x.value),['30','60','90','120','144','165','240']);
  const fps=d.querySelector('[data-capture-setting="fps"]');fps.value='120';fps.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.captureSaves.at(-1).fps,120);
  assert.equal(d.querySelectorAll('[data-capture-source]').length,1);
  d.querySelector('[data-capture-action="start"]').click();await sleep(5);assert.equal(d.querySelector('[data-capture-action="start"]').disabled,true);assert.match(d.querySelector('[data-record-status]').textContent,/Идёт запись/);
  d.querySelector('[data-capture-action="pause"]').click();await sleep(5);assert.match(d.querySelector('[data-record-status]').textContent,/паузе/);
  d.querySelector('[data-capture-action="stop"]').click();await sleep(5);assert.ok(d.querySelector('.recording-item'));
  d.querySelector('[data-capture-action="preview"]').click();await sleep(5);assert.deepEqual(f.captureCommands.at(-1),{action:'preview',id:'a'.repeat(32)});
 }finally{f.dom.window.close();}
});
test('compact recording buttons appear only while recording and operations remain above every tab',async()=>{
 const f=await fixture(true),d=f.document;
 try{
  assert.equal(d.querySelector('[data-activity-band] [data-capture-action="start"]'),null);assert.equal(d.querySelector('.island').classList.contains('has-activity'),false);
  f.emit('capture',{active:true,status:'recording',elapsed:2,settings:{},recent:[]});
  const band=()=>d.querySelector('[data-activity-band]');assert.ok(band().querySelector('[data-capture-action="pause"]'));assert.equal(d.querySelector('.island').classList.contains('expanded'),false);
  f.emit('transfers',{items:[{id:'123',title:'<script>Удаление</script>',details:'63 017 файлов',kind:'delete',percent:null,canPause:true,canCancel:true}]});
  const top=d.querySelector('[data-transfer-band]');assert.equal(d.querySelector('.island').firstElementChild,top);assert.equal(top.querySelector('script'),null);assert.match(top.textContent,/63 017/);
  const card=top.firstElementChild;f.emit('transfers',{items:[{id:'123',title:'Удаление',details:'63 018 файлов',kind:'delete',percent:32,canPause:true,canCancel:true}]});assert.equal(top.firstElementChild,card,'progress keeps existing DOM and button focus');assert.match(top.textContent,/32%/);
  top.querySelector('[data-transfer-action="pause"]').click();await sleep(5);assert.deepEqual(f.transferCommands.at(-1),{action:'pause',id:'123'});
  d.querySelector('[data-expand]').click();d.querySelector('[data-island-tab="music"]').click();assert.ok(top.isConnected);assert.equal(d.querySelector('[data-transfer-band]').children.length,1);
  f.emit('capture',{active:false,status:'idle',settings:{},recent:[]});assert.equal(d.querySelector('[data-activity-band] [data-capture-action]'),null);
  f.emit('transfers',{items:[]});assert.equal(d.querySelector('.island').classList.contains('has-transfers'),false);
 }finally{f.dom.window.close();}
});
test('replay preferences expose a disabled-by-default buffer, quality, disk limit and save hotkey',async()=>{
 const f=await fixture(),d=f.document;
 try{d.querySelector('.sidebar [data-nav="capture"]').click();assert.equal(d.querySelector('[data-capture-setting="replayEnabled"]').checked,false);assert.equal(d.querySelector('[data-capture-setting="replayFPS"]').value,'30');assert.ok(d.querySelector('[data-capture-setting="replayMaxMB"]'));assert.ok(d.querySelector('[data-capture-setting="replayHotkey"]'));}finally{f.dom.window.close();}
});

test('recording quality menus are themed, save numbers and close or lock correctly',async()=>{
 const f=await fixture(),d=f.document,w=f.w;
 try{
  d.querySelector('.sidebar [data-nav="capture"]').click();await sleep(5);assert.equal(d.querySelector('#page-content select'),null);
  const field=d.querySelector('[data-capture-setting="height"]'),trigger=field.closest('[data-choice]').querySelector('.choice-trigger');
  d.documentElement.dataset.uiRenderer='frosted';trigger.click();const menu=d.querySelector('.floating-menu');assert.equal(menu.dataset.renderer,'frosted');menu.querySelector('[data-choice-value="2160"]').click();await sleep(5);assert.equal(f.captureSaves.at(-1).height,2160);assert.equal(trigger.querySelector('[data-choice-label]').textContent,'2160p 4K');
  trigger.click();d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('.floating-menu'),null);assert.equal(d.activeElement,trigger);
  trigger.click();d.querySelector('[data-capture-action="start"]').click();await sleep(5);assert.equal(trigger.disabled,true);assert.equal(d.querySelector('.floating-menu'),null);d.querySelector('[data-capture-action="stop"]').click();await sleep(5);assert.equal(trigger.disabled,false);
 }finally{f.dom.window.close();}
});

test('instant replay save stays in the recording tab and never appears over music or the compact island',async()=>{
 const f=await fixture(true),d=f.document;
 try{
  f.emit('replay',{status:'buffering',bufferSeconds:600,saving:false});
  assert.equal(d.querySelector('[data-capture-action="replay-save"]'),null);
  assert.equal(d.querySelector('.island').classList.contains('has-activity'),false);
  d.querySelector('[data-expand]').click();d.querySelector('[data-island-tab="music"]').click();
  assert.equal(d.querySelector('[data-capture-action="replay-save"]'),null);
  d.querySelector('[data-island-tab="capture"]').click();
  const save=d.querySelector('.island-capture [data-capture-action="replay-save"]');assert.ok(save);assert.equal(save.disabled,false);assert.ok(save.classList.contains('replay-save-primary'));assert.equal(save.querySelector('[data-replay-save-info]').textContent,'10:00 · Alt + F10');
  save.click();await sleep(5);assert.equal(f.captureCommands.at(-1).action,'replay-save');
  f.emit('replay',{status:'buffering',bufferSeconds:600,saving:true,saveProgress:42});assert.equal(save.disabled,true);assert.match(save.querySelector('[data-replay-save-label]').textContent,/42%/);
  f.emit('replay',{status:'off',saving:false});assert.equal(save.disabled,true);
  d.querySelector('[data-island-tab="music"]').click();assert.equal(d.querySelector('[data-capture-action="replay-save"]'),null);
 }finally{f.dom.window.close();}
});

test('file operation settings can keep native progress visible independently of the island',async()=>{
 const f=await fixture(),d=f.document;
 try{
  d.querySelector('.sidebar [data-nav="transfers"]').click();const toggle=d.querySelector('[data-setting="replaceTransferWindow"]');assert.ok(toggle);assert.equal(toggle.checked,true);
  toggle.checked=false;toggle.dispatchEvent(new f.w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.saved().replaceTransferWindow,false);assert.equal(f.saved().showTransfers,true);
  f.emit('transfers',{items:[{id:'123',title:'Копирование',percent:30,canCancel:true}]});assert.ok(d.querySelector('[data-transfer-list] [data-operation-id="123"]'));
 }finally{f.dom.window.close();}
});

test('launcher and screenshots work from the island tabs, protect names, and respond to busy state',async()=>{
 const f=await fixture(true),d=f.document;
 const tools={entries:[{id:'app1',name:'<img onerror=alert(1)>',target:'C:/App.exe',kind:'app',icon:''}],recent:[],settings:{copy:true,folder:'C:/Pictures'}};
 try{
  f.emit('tools',tools);f.emit('tools-panel','launcher');assert.equal(d.querySelector('.island').classList.contains('expanded'),true);const tile=d.querySelector('.launcher-tile');assert.equal(tile.querySelector('strong').textContent,tools.entries[0].name);assert.equal(tile.querySelector('img'),null);
  tile.click();await sleep(5);assert.equal(f.toolCommands.at(-1).action,'open');assert.equal(d.querySelector('.island').classList.contains('expanded'),false);
  d.querySelector('[data-expand]').click();d.querySelector('[data-island-tab="screenshots"]').click();d.querySelector('[data-shot-action="area"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).type,'screenshot');assert.equal(f.toolCommands.at(-1).action,'area');
  f.emit('tools',{...tools,busy:true});assert.equal(d.querySelector('[data-shot-action="area"]').disabled,true);assert.equal(d.querySelector('[data-shot-action="screen"]').disabled,true);
  f.emit('tools',{...tools,busy:false,recent:[{id:'s1',width:400,height:300,createdAt:1000,thumbnail:''}]});d.querySelector('[data-shot-action="copy"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).id,'s1');assert.equal(f.toolCommands.at(-1).action,'copy');
 }finally{f.dom.window.close();}
});
test('desktop tools settings add app or folder, edit a title, and save the clipboard preference',async()=>{
 const f=await fixture(),d=f.document;
 try{
  d.querySelector('.sidebar [data-nav="launcher"]').click();d.querySelector('[data-entry-kind="folder"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).value,'folder');
  f.emit('tools',{entries:[{id:'p1',name:'Old',target:'C:/App.exe',kind:'app'}],recent:[],settings:{copy:true}});const name=d.querySelector('[data-launcher-name]');name.value='New';name.dispatchEvent(new f.w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.toolCommands.at(-1).value,'New');
  d.querySelector('.sidebar [data-nav="screenshots"]').click();d.querySelector('[data-tools-copy]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).patch.copy,false);d.querySelector('[data-shot-folder-change]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).type,'folder');
 }finally{f.dom.window.close();}
});
test('screenshot selection accepts reverse drags, waits for its frame, and cancels on Escape',async()=>{
 async function selector(){const dom=new JSDOM(fs.readFileSync(path.join(root,'screenshot-select.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,finished=[];let ready=0;w.screenshot={frame:async()=>({image:'data:image/png;base64,AA=='}),ready:()=>ready++,finish:value=>finished.push(value)};w.eval(fs.readFileSync(path.join(root,'model.js'),'utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync(path.join(root,'screenshot-select.js'),'utf8').replace(/^import .*;\s*$/gm,''));await sleep(1);w.document.querySelector('#frame').onload();return {dom,w,finished,ready:()=>ready};}
 const f=await selector();try{assert.equal(f.ready(),1);for(const [type,x,y]of [['pointerdown',700,500],['pointermove',100,80],['pointerup',100,80]])f.w.document.body.dispatchEvent(new f.w.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0}));assert.deepEqual(JSON.parse(JSON.stringify(f.finished[0])),{x:100,y:80,width:600,height:420});f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(f.finished.length,1);}finally{f.dom.window.close();}
 const g=await selector();try{g.w.document.dispatchEvent(new g.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(g.finished[0],null);}finally{g.dom.window.close();}
});

test('a saved screenshot briefly appears on the compact island and opens the screenshot, not a video',async()=>{
 const f=await fixture(true),d=f.document;
 try{f.emit('tools',{entries:[],settings:{copy:true},busy:false,recent:[{id:'shot1',width:400,height:300,createdAt:1000}]});const notice=d.querySelector('[data-activity-band] [data-shot-action="open"]');assert.ok(notice);notice.click();await sleep(5);assert.equal(f.toolCommands.at(-1).type,'screenshot');assert.equal(f.toolCommands.at(-1).id,'shot1');assert.equal(f.captureCommands.length,0);}finally{f.dom.window.close();}
});

test('quick launch searches pinned apps on the island, requests keyboard focus and launches all from its bottom button',async()=>{
 const f=await fixture(true),d=f.document;
 try{f.emit('tools',{entries:[{id:'a',name:'Spotify',kind:'app',target:'C:/Spotify.exe'},{id:'b',name:'Photos',kind:'folder',target:'C:/Photos'}],recent:[],settings:{copy:true}});f.emit('tools-panel','launcher');const search=d.querySelector('[data-launcher-search]');search.focus();assert.equal(f.toolCommands.at(-1).type,'focus');search.value='photos';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(d.querySelectorAll('.launcher-tile').length,1);assert.match(d.querySelector('.launcher-tile').textContent,/Photos/);const all=d.querySelector('[data-launcher-action="open-all"]');assert.match(all.textContent,/2/);all.click();await sleep(5);assert.equal(f.toolCommands.at(-1).action,'open-all');d.querySelector('[data-process-open]').click();assert.equal(f.toolCommands.at(-1).page,'launcher-processes');}finally{f.dom.window.close();}
});
test('process picker filters running apps and pins a selected process token',async()=>{
 const f=await fixture(),d=f.document;
 try{f.emit('tools-panel','launcher-processes');await sleep(5);assert.equal(d.querySelector('[data-process-panel]').hidden,false);assert.equal(d.querySelectorAll('.process-row').length,2);const search=d.querySelector('[data-process-search]');search.value='spotify';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(d.querySelectorAll('.process-row').length,1);d.querySelector('[data-launcher-action="add-process"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).id,'proc-1');assert.equal(f.toolCommands.at(-1).action,'add-process');}finally{f.dom.window.close();}
});
test('screenshot settings use glass choices, enable JPEG quality, and save inclusion and monitor options',async()=>{
 const f=await fixture(),d=f.document;
 try{d.querySelector('.sidebar [data-nav="screenshots"]').click();assert.equal(d.querySelector('[data-tools-setting="quality"]').disabled,true);const input=d.querySelector('[data-tools-setting="format"]');input.closest('[data-choice]').querySelector('button').click();d.querySelector('[data-choice-value="jpg"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).patch.format,'jpg');const quality=d.querySelector('[data-tools-setting="quality"]');assert.equal(quality.disabled,false);quality.value='74';quality.dispatchEvent(new f.w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.toolCommands.at(-1).patch.quality,74);d.querySelector('[data-tools-setting="excludeIsland"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).patch.excludeIsland,false);const monitor=d.querySelector('[data-tools-setting="monitor"]');monitor.closest('[data-choice]').querySelector('button').click();d.querySelector('[data-choice-value="13"]').click();await sleep(5);assert.equal(f.toolCommands.at(-1).patch.monitor,13);}finally{f.dom.window.close();}
});

test('instant replay microphone and sound controls save independent settings without changing ordinary recording',async()=>{
 const f=await fixture(),d=f.document;
 try{d.querySelector('.sidebar [data-nav="capture"]').click();assert.equal(d.querySelector('[data-capture-setting="microphone"]').checked,false);d.querySelector('[data-capture-setting="replayMicrophone"]').click();await sleep(5);assert.equal(f.captureSaves.at(-1).replayMicrophone,true);assert.equal(d.querySelector('[data-capture-setting="microphone"]').checked,false);d.querySelector('[data-capture-setting="replayNoiseSuppression"]').click();await sleep(5);assert.equal(f.captureSaves.at(-1).replayNoiseSuppression,false);assert.equal(d.querySelector('[data-capture-setting="noiseSuppression"]').checked,true);d.querySelector('[data-capture-setting="replayMicHighPass"]').click();await sleep(5);assert.equal(f.captureSaves.at(-1).replayMicHighPass,true);d.querySelector('[data-capture-setting="replayMicCompressor"]').click();await sleep(5);assert.equal(f.captureSaves.at(-1).replayMicCompressor,true);const gain=d.querySelector('[data-capture-setting="replayMicVolume"]');gain.value='160';gain.dispatchEvent(new f.w.Event('change',{bubbles:true}));await sleep(5);assert.equal(f.captureSaves.at(-1).replayMicVolume,160);assert.equal(d.querySelector('[data-capture-setting="micVolume"]').value,'100');
 f.emit('replay',{status:'buffering',bufferSeconds:12,warnings:['Микрофон не поддерживает шумоподавление']});assert.match(d.querySelector('[data-replay-status]').textContent,/не поддерживает шумоподавление/);
 }finally{f.dom.window.close();}
});
test('legacy FPS setting cannot restore the removed counter or its toggle',async()=>{
 const f=await fixture(true);try{
  f.emit('settings',{...require('../electron/settings.cjs').defaults,showFPS:true});
  assert.equal(f.document.querySelector('[data-fps]'),null);assert.equal(f.document.querySelector('[data-setting="showFPS"]'),null);
  assert.doesNotMatch(f.document.body.textContent,/\bFPS\b/);
 }finally{f.dom.window.close();}
});

test('performance mode and capture presets persist real settings',async()=>{
 const f=await fixture();try{
  const mode=f.document.querySelector('[data-setting="performanceMode"]');assert.ok(mode);
  mode.value='eco';mode.dispatchEvent(new f.w.Event('change',{bubbles:true}));await sleep(10);
  assert.equal(f.saved().performanceMode,'eco');assert.equal(f.document.documentElement.dataset.performance,'eco');
  f.document.querySelector('.sidebar [data-nav="capture"]').click();
  f.document.querySelector('[data-capture-profile="eco"]').click();await sleep(10);
  assert.equal(f.captureSaves.at(-1).fps,30);assert.equal(f.captureSaves.at(-1).height,720);assert.equal(f.captureSaves.at(-1).quality,'auto');
 }finally{f.dom.window.close();}
});

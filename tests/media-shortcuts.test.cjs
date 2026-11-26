const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerMediaShortcuts}=require('../electron/media-shortcuts.cjs');
function fixture({blocked,command}={}){
  const handlers=new Map(),calls=[],errors=[];
  const globalShortcut={register(key,fn){if(key===blocked)return false;handlers.set(key,fn);return true;}};
  const media={state:{active:true,playing:true,canToggle:true,canNext:true,canPrevious:true,source:'Spotify',trackKey:'one'},command(action){calls.push(action);return command?command(action):Promise.resolve({ok:true});}};
  const controller=registerMediaShortcuts(globalShortcut,media,error=>errors.push(error));
  return {media,calls,errors,controller,press:key=>handlers.get('Control+Alt+'+key)(),update:patch=>{Object.assign(media.state,patch);controller.update(media.state);}};
}
test('registers previous, next and pause globally and exposes conflicts',async()=>{
  const f=fixture({blocked:'Control+Alt+Down'});
  assert.deepEqual(f.controller.shortcuts,{mediaPrevious:true,mediaNext:true,mediaPause:false});
  await f.press('Left');await f.press('Right');assert.deepEqual(f.calls,['previous','next']);
});
test('pause never toggles paused media and ignores repeats while metadata catches up',async()=>{
  let resolve;const f=fixture({command:()=>new Promise(r=>{resolve=r;})});
  const pending=f.press('Down');await f.press('Down');assert.deepEqual(f.calls,['toggle']);
  resolve({ok:true});await pending;await f.press('Down');assert.deepEqual(f.calls,['toggle']);
  f.update({playing:false});await f.press('Down');assert.deepEqual(f.calls,['toggle']);
  f.update({playing:true});const resumed=f.press('Down');resolve({ok:true});await resumed;assert.deepEqual(f.calls,['toggle','toggle']);
});
test('skips unavailable actions and allows pause retry after a rejected command',async()=>{
  const f=fixture({command:async()=>({ok:false,error:'failed'})});
  f.update({active:false});await f.press('Left');await f.press('Right');await f.press('Down');
  f.update({active:true,canNext:false,canPrevious:false,canToggle:false});await f.press('Left');await f.press('Right');await f.press('Down');assert.deepEqual(f.calls,[]);
  f.update({canToggle:true});await f.press('Down');await f.press('Down');assert.deepEqual(f.calls,['toggle','toggle']);assert.deepEqual(f.errors,['failed','failed']);
});
test('a rejected transport promise does not become an unhandled rejection',async()=>{
  const f=fixture({command:async()=>{throw Error('offline');}});await f.press('Right');assert.deepEqual(f.errors,['offline']);
});

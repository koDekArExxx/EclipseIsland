// Global shortcuts share the active player and transport used by the island.
function registerMediaShortcuts(globalShortcut, media, onError=()=>{}) {
  let togglePending=false;
  // Keep the existing delivery hook; playback state is read at each key press.
  function update() {}
  async function command(action) {
    const state=media.state||{};
    if(!state.active)return;
    const toggle=action==='toggle';
    if(toggle){if(!state.canToggle||togglePending)return;togglePending=true;}
    else if(!state[action==='next'?'canNext':'canPrevious'])return;
    try {
      const result=await media.command(action);
      if(!result?.ok)onError(result?.error||'Плеер не выполнил действие');
    }catch(error){onError(error.message||String(error));}
    finally{if(toggle)togglePending=false;}
  }
  const shortcuts={};
  for(const [key,accelerator,action] of [
    ['mediaPrevious','Control+Alt+Left','previous'],
    ['mediaNext','Control+Alt+Right','next'],
    ['mediaPause','Control+Alt+Down','toggle']
  ])shortcuts[key]=globalShortcut.register(accelerator,()=>command(action));
  return {shortcuts,update};
}
module.exports={registerMediaShortcuts};

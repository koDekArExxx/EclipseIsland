// Global shortcuts share the active player and transport used by the island.
function registerMediaShortcuts(globalShortcut, media, onError=()=>{}) {
  let pausePending=false, pauseRequested=false;
  const sessionKey=state=>JSON.stringify([state.connection,state.source,state.trackKey]);
  let lastSession;
  function update(state) {
    const key=sessionKey(state);
    if(!state.active||!state.playing||key!==lastSession)pauseRequested=false;
    lastSession=key;
  }
  async function command(action) {
    const state=media.state||{};
    update(state);
    if(!state.active)return;
    const pause=action==='pause';
    if(pause){
      // Existing Windows and Spotify workers expose toggle, not a pause-only
      // command. Never toggle an already paused session or repeat a successful
      // pause request while waiting for playback metadata to catch up.
      if(!state.playing||!state.canToggle||pausePending||pauseRequested)return;
      pausePending=true;pauseRequested=true;
    }else if(!state[action==='next'?'canNext':'canPrevious'])return;
    try {
      const result=await media.command(pause?'toggle':action);
      if(!result?.ok){if(pause)pauseRequested=false;onError(result?.error||'Плеер не выполнил действие');}
    }catch(error){if(pause)pauseRequested=false;onError(error.message||String(error));}
    finally{if(pause)pausePending=false;}
  }
  const shortcuts={};
  for(const [key,accelerator,action] of [
    ['mediaPrevious','Control+Alt+Left','previous'],
    ['mediaNext','Control+Alt+Right','next'],
    ['mediaPause','Control+Alt+Down','pause']
  ])shortcuts[key]=globalShortcut.register(accelerator,()=>command(action));
  return {shortcuts,update};
}
module.exports={registerMediaShortcuts};

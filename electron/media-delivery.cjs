// Track the boundary between main-process media reception and renderer updates.
// No titles, artwork or listening history are kept in this diagnostic state.
class MediaDelivery {
  constructor(now=Date.now){this.now=now;this.sequence=0;this.views=new Map();}
  sent(viewId){
    const sequence=++this.sequence,at=this.now();
    const state=this.views.get(viewId)||{sent:0,applied:0,lastLagMs:null,pending:new Map()};
    state.sent=sequence;state.sentAt=at;state.pending.set(sequence,at);
    while(state.pending.size>32)state.pending.delete(state.pending.keys().next().value);
    this.views.set(viewId,state);return sequence;
  }
  applied(viewId,sequence){
    const state=this.views.get(viewId);if(!state||!Number.isSafeInteger(sequence)||sequence<=state.applied||!state.pending.has(sequence))return false;
    state.applied=sequence;state.lastLagMs=Math.max(0,this.now()-state.pending.get(sequence));
    for(const key of state.pending.keys())if(key<=sequence)state.pending.delete(key);
    return true;
  }
  snapshot(){return [...this.views].map(([viewId,state])=>({viewId,lastSent:state.sent,lastApplied:state.applied,lastApplyLagMs:state.lastLagMs,pendingAgeMs:state.sent>state.applied?Math.max(0,this.now()-Math.min(...state.pending.values())):0}));}
}
module.exports={MediaDelivery};

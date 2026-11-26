// Only emit on positive completion evidence, not on cancel, timeout or lost monitoring.
class CompletionNotices {
 constructor(emit){this.emit=emit;this.downloads=new Set();this.transfers=new Map();}
 download(state){const recent=state.recent||[];const next=new Set(recent.map(x=>x.id));if(state.status==='ready'&&recent.some(x=>!this.downloads.has(x.id)))this.emit('download');this.downloads=next;}
 cancel(id){const seen=this.transfers.get(id);if(seen)seen.cancelled=true;}
 transfer(state){if(state.status!=='ready'){this.transfers.clear();return;}const next=new Map();let completed=false;for(const item of state.items||[]){const old=this.transfers.get(item.id);const record=old||{played:false,cancelled:false};if(item.attention||item.nativeOnly)record.uncertain=true;if(['copy','move'].includes(item.kind)&&item.percent===100&&!record.played&&!record.cancelled&&!record.uncertain){record.played=true;completed=true;}next.set(item.id,record);}this.transfers=next;if(completed)this.emit('transfer');}
}
module.exports={CompletionNotices};

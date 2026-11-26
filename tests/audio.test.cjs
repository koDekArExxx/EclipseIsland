const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/audio.js'),'utf8').replace(/^export /gm,'')+'\nthis.playSound=playUISound;',context);
test('UI audio respects mute, uses a gentle bounded envelope and releases its nodes',()=>{
  const notes=[],levels=[];
  const audio={currentTime:2,destination:{},createOscillator:()=>{const note={frequency:{setValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect(){},disconnect(){this.disconnected=true;},start(){},stop(){}};notes.push(note);return note;},createGain:()=>({gain:{setValueAtTime:()=>{},linearRampToValueAtTime:value=>levels.push(value),exponentialRampToValueAtTime:()=>{}},connect(){},disconnect(){}})};
  context.playSound(audio,'startup',0);assert.equal(notes.length,0);
  context.playSound(audio,'startup',28);assert.equal(notes.length,3);assert.ok(levels.every(v=>v>0&&v<.055));notes.forEach(n=>{n.onended();assert.ok(n.disconnected);});
});

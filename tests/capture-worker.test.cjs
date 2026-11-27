const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs');const {defaults}=require('../electron/capture-store.cjs');
const source=fs.readFileSync(require.resolve('../src/capture-worker.js'),'utf8');
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw Error('Recorder did not finish');};
async function fixture(options={}){
 let clock=0,command,recorder,finished,nextFrame,paints=0;const formats=[],segments=[],audioNodes=[];const reports=[],chunks=[],timers=new Map(),requests=[],tracks=[];let timerId=0;
 const track=kind=>{const value={kind,stopped:false,stop(){this.stopped=true;},addEventListener(){},applyConstraints:async()=>{},getSettings:()=>({frameRate:60,...(options.nativeTrack&&kind==='video'?{width:options.width||1920,height:options.height||1080}:{})})};tracks.push(value);return value;};
 let requestedFrames=0;const screenTrack=track('video'),systemTrack=track('audio'),outputTrack=track('video'),micTrack=track('audio'),mixed=track('audio');
 const stream=values=>({getTracks:()=>values,getVideoTracks:()=>values.filter(x=>x.kind==='video'),getAudioTracks:()=>values.filter(x=>x.kind==='audio'),addTrack:value=>values.push(value)});
 const config={...defaults,countdown:0,systemAudio:false,microphone:false,height:720,fps:120,sourceId:'screen:chosen',...options.config};
 const screen=stream([screenTrack,...(config.systemAudio?[systemTrack]:[])]),output=stream([outputTrack]);
 const video={videoWidth:options.width||1920,videoHeight:options.height||1080,srcObject:null,play:async()=>{}};
 if(options.frameCallbacks){video.requestVideoFrameCallback=fn=>{nextFrame=fn;return 1;};video.cancelVideoFrameCallback=()=>{nextFrame=null;};}
 if(options.manualFrames)outputTrack.requestFrame=()=>requestedFrames++;
 const canvas={getContext:()=>({drawImage(){paints++;}}),captureStream:()=>output};
 class Recorder{
  static isTypeSupported(type){if(options.allCodecs)return true;return options.h264?type.includes('avc1'):type.includes('vp8');}
  constructor(stream,settings){this.stream=stream;this.settings=settings;this.state='inactive';this.events={};recorder=this;}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  emit(name,event={}){for(const fn of this.events[name]||[])fn(event);}
  data(value){this.emit('dataavailable',{data:new Blob([value])});}
  start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}
  stop(){this.state='inactive';this.data('tail');this.emit('stop');}
 }
 const node=type=>{const n={type,targets:[],connect(target){this.targets.push(target);return target;}};audioNodes.push(n);return n;};
 class Audio{resume(){return Promise.resolve();}close(){return Promise.resolve();}createMediaStreamDestination(){return {...node('destination'),stream:stream([mixed])};}createGain(){return {...node('gain'),gain:{value:1}};}createMediaStreamSource(input){return node(input.getAudioTracks().includes(micTrack)?'mic':'system');}createBiquadFilter(){return {...node('filter'),frequency:{value:0},Q:{value:0}};}createDynamicsCompressor(){return {...node('compressor'),threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}};}}

 const api={format:async value=>formats.push(value),segment:async value=>{segments.push(value);if(options.segmentGate)await options.segmentGate;},init:async()=>config,chunk:async bytes=>{if(options.writeError)throw Error('Disk full');await new Promise(r=>setTimeout(r,2));chunks.push(Buffer.from(bytes).toString());},report:state=>reports.push(state),finish:async state=>{finished=state;},on:fn=>command=fn};
 await vm.runInNewContext(source,{window:{captureWorker:api,capturePolicy:require('../src/capture-policy.js')},document:{querySelector:selector=>selector==='video'?video:canvas},navigator:{mediaCapabilities:options.capabilities,mediaDevices:{getDisplayMedia:async()=>{if(options.captureError)throw Object.assign(Error('Capture failed'),{name:options.captureError});return screen;},getUserMedia:async request=>{requests.push(request);return request.video?screen:stream([micTrack]);}}},MediaStream:function(values){return stream(values);},process:{argv:[]},MediaRecorder:Recorder,AudioContext:Audio,Blob,Uint8Array,performance:{now:()=>clock},setTimeout,clearTimeout,setInterval:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearInterval:id=>timers.delete(id)});
 return {reports,chunks,requests,tracks,video,canvas,output,formats,segments,audioNodes,requestedFrames:()=>requestedFrames,timers,paints:()=>paints,frame:ms=>{clock+=ms;nextFrame?.();},recorder:()=>recorder,finished:()=>finished,command:value=>command(value),advance:ms=>{clock+=ms;timers.forEach(x=>{if(x.ms===1000)x.fn();});}};
}
test('recorder scales output, pauses elapsed time, serializes chunks and flushes the last chunk on stop',async()=>{
 const f=await fixture();assert.equal(f.canvas.width,1280);assert.equal(f.canvas.height,720);assert.match(f.recorder().settings.mimeType,/vp8/);
 f.recorder().data('one');f.recorder().data('two');f.advance(2500);assert.equal(f.reports.at(-1).elapsed,2.5);
 f.command('pause');f.advance(4000);assert.equal(f.reports.at(-1).elapsed,2.5);f.command('resume');f.advance(1000);assert.equal(f.reports.at(-1).elapsed,3.5);
 f.command('stop');await wait(()=>f.finished());assert.deepEqual(f.chunks,['one','two','tail']);assert.equal(f.finished().duration,3.5);assert.equal(f.finished().error,null);assert.equal(f.video.srcObject,null);assert.ok(f.tracks.filter(x=>x.kind==='video').every(x=>x.stopped));
});
test('a hidden document can use the preselected desktop source; explicit permission denial does not use fallback',async()=>{
 const f=await fixture({captureError:'InvalidStateError'});assert.equal(f.requests[0].video.mandatory.chromeMediaSourceId,'screen:chosen');f.command('stop');await wait(()=>f.finished());
 const denied=await fixture({captureError:'NotAllowedError'});assert.equal(denied.requests.length,0);assert.match(denied.finished().error,/доступ/);assert.equal(denied.recorder(),undefined);
});
test('disk write failure closes capture and reports an interrupted recording instead of silent success',async()=>{
 const f=await fixture({writeError:true});f.recorder().data('first');await wait(()=>f.finished());assert.equal(f.finished().error,'Disk full');assert.equal(f.video.srcObject,null);
});
test('system sound and microphone are mixed into one audio track without requesting camera video',async()=>{
 const f=await fixture({config:{systemAudio:true,microphone:true}});assert.equal(f.output.getAudioTracks().length,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].video,false);assert.equal(f.requests[0].audio.echoCancellation,true);f.command('stop');await wait(()=>f.finished());
});

test('microphone noise reduction, echo cancellation and auto gain follow separate settings',async()=>{
 const f=await fixture({config:{microphone:true,noiseSuppression:false,echoCancellation:false,autoGainControl:true}});
 assert.equal(f.requests[0].audio.noiseSuppression,false);assert.equal(f.requests[0].audio.echoCancellation,false);assert.equal(f.requests[0].audio.autoGainControl,true);
 f.command('stop');await wait(()=>f.finished());
 const clean=await fixture({config:{microphone:true,noiseSuppression:true}});assert.equal(clean.requests[0].audio.noiseSuppression,true);clean.command('stop');await wait(()=>clean.finished());
});

test('4K at 240 FPS keeps native dimensions and never upscales a smaller source',async()=>{
 const f=await fixture({width:3840,height:2160,config:{height:2160,fps:240,bitrate:200,quality:'manual'}});assert.equal(f.reports[0].width,3840);assert.equal(f.reports[0].height,2160);assert.equal(f.recorder().settings.videoBitsPerSecond,200000000);assert.equal(f.reports[0].targetFPS,240);f.command('stop');await wait(()=>f.finished());
 const smaller=await fixture({config:{height:2160,fps:240}});assert.equal(smaller.reports[0].height,1080);smaller.command('stop');await wait(()=>smaller.finished());
});

test('H.264 direct capture bypasses the canvas and chooses fast MP4 when supported',async()=>{
 const f=await fixture({nativeTrack:true,h264:true,config:{height:2160,fps:120}});assert.equal(f.reports[0].capturePath,'direct');assert.equal(f.canvas.width,undefined);assert.match(f.formats[0].mimeType,/video\/mp4/);assert.match(f.recorder().settings.mimeType,/avc1/);f.command('stop');await wait(()=>f.finished());assert.equal(f.finished().error,null);
});
test('instant replay rotates complete segments and saves a snapshot without stopping screen tracks',async()=>{
 const f=await fixture({nativeTrack:true,h264:true,config:{height:1080,fps:30,mode:'replay'}});const first=f.recorder();f.advance(2000);f.command('snapshot');await wait(()=>f.segments.length===1&&f.recorder()!==first);assert.equal(f.segments[0].save,true);assert.ok(f.tracks.some(x=>!x.stopped));assert.equal(f.finished(),undefined);f.command('stop');await wait(()=>f.finished());assert.equal(f.finished().error,null);
});

test('microphone processing applies high-pass and compression only to voice and keeps system audio separate',async()=>{
 const f=await fixture({nativeTrack:true,config:{microphone:true,systemAudio:true,micVolume:150,systemVolume:60,micHighPass:true,micCompressor:true,noiseSuppression:true,echoCancellation:true,autoGainControl:true}});
 try{const request=f.requests.find(x=>!x.video);assert.deepEqual(JSON.parse(JSON.stringify(request.audio)),{echoCancellation:true,noiseSuppression:true,autoGainControl:true});const mic=f.audioNodes.find(x=>x.type==='mic'),system=f.audioNodes.find(x=>x.type==='system');const filter=mic.targets[0];assert.equal(filter.type,'highpass');assert.equal(filter.frequency.value,80);const gain=filter.targets[0];assert.equal(gain.gain.value,1.5);const compressor=gain.targets[0];assert.equal(compressor.threshold.value,-12);assert.equal(compressor.ratio.value,4);assert.equal(compressor.targets[0].type,'destination');assert.equal(system.targets[0].gain.value,.6);assert.equal(system.targets[0].targets[0].type,'destination');}finally{f.command('stop');await wait(()=>f.finished());}
});

test('replay restarts acquisition before slow segment finalization and Stop still flushes the new segment',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const f=await fixture({nativeTrack:true,h264:true,segmentGate:gate,config:{height:1080,fps:30,mode:'replay'}});
 const first=f.recorder();f.command('snapshot');await wait(()=>f.segments.length===1);
 assert.notEqual(f.recorder(),first,'disk work must not block the next recorder');
 const next=f.recorder();next.data('new-segment');f.command('stop');assert.equal(f.finished(),undefined);
 release();await wait(()=>f.finished());assert.equal(next.state,'inactive');assert.ok(f.chunks.includes('new-segment'));assert.equal(f.finished().error,null);
});
test('automatic quality scales bitrate while a manual bitrate is honored',async()=>{
 const automatic=await fixture({nativeTrack:true,h264:true,config:{height:1080,fps:60,quality:'auto'}});
 assert.equal(automatic.recorder().settings.videoBitsPerSecond,22394880);automatic.command('stop');await wait(()=>automatic.finished());
 const manual=await fixture({nativeTrack:true,h264:true,config:{height:1080,fps:60,quality:'manual',bitrate:12}});
 assert.equal(manual.recorder().settings.videoBitsPerSecond,12000000);manual.command('stop');await wait(()=>manual.finished());
});
test('auto prefers a reported power-efficient codec over a software-only candidate',async()=>{
 const f=await fixture({nativeTrack:true,allCodecs:true,capabilities:{encodingInfo:async c=>({supported:true,smooth:true,powerEfficient:c.video.contentType.includes('vp8')})},config:{height:1080,fps:60}});
 assert.match(f.recorder().settings.mimeType,/vp8/);assert.equal(f.reports[0].encodingEfficiency,'efficient');f.command('stop');await wait(()=>f.finished());
});

test('resize fallback draws only at the requested cadence even when the source callback is faster',async()=>{const f=await fixture({frameCallbacks:true,config:{height:720,fps:30}});for(let i=0;i<60;i++)f.frame(1000/60);assert.ok(f.paints()<=32&&f.paints()>=29);const before=f.paints();f.command('pause');for(let i=0;i<60;i++)f.frame(1000/60);assert.equal(f.paints(),before);f.command('stop');await wait(()=>f.finished());});

test('canvas requests one encoded frame per selected draw and telemetry is quiet in replay',async()=>{
 const f=await fixture({manualFrames:true,frameCallbacks:true,config:{height:720,fps:30,mode:'replay'}});
 for(let i=0;i<60;i++)f.frame(1000/60);
 assert.equal(f.requestedFrames(),f.paints());assert.ok(f.requestedFrames()<=32);
 assert.equal([...f.timers.values()].some(x=>x.ms===1000),false,'replay has no UI telemetry interval');
 f.command('stop');await wait(()=>f.finished());
});

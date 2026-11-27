/* Dedicated recorder renderer. No media data is kept for the whole recording. */
(async()=>{
 const api=window.captureWorker,streams=[],warnings=[];let rotate=()=>{},recorder,audio,timer,metrics,draw,videoFrame,started=null,pausedAt=null,pausedMS=0,stopping=false,finished=false,queue=Promise.resolve(),queued=0,config,cancelled=false,rotation=null,segmentTimer,segmentStarted=0,saveRequested=false,outputStream,recorderOptions;
 const video=document.querySelector('video'),canvas=document.querySelector('canvas');
 const elapsed=()=>started!==null?Math.max(0,((pausedAt??performance.now())-started-pausedMS)/1000):0;
 function cleanup(){clearTimeout(segmentTimer);clearInterval(metrics);clearInterval(draw);if(videoFrame!==undefined)video.cancelVideoFrameCallback?.(videoFrame);for(const stream of streams)for(const track of stream.getTracks())track.stop();video.srcObject=null;audio?.close().catch(()=>{});}
 async function finish(error){if(finished)return;finished=true;cleanup();try{await queue;}catch(e){error=error||e.message;}await api.finish({duration:elapsed(),error:error||null});}
 async function stop(error){if(stopping)return;stopping=true;cancelled=true;clearTimeout(segmentTimer);if(rotation)await rotation.catch(()=>{});if(recorder&&recorder.state!=='inactive'){recorder.addEventListener('stop',()=>finish(error),{once:true});recorder.stop();}else await finish(error);}
 api.on(command=>{
  if(command==='stop')stop();
  if(command==='snapshot'&&config?.mode==='replay')rotate(true);
  if(command==='rotate'&&config?.mode==='replay')rotate(false);
  if(command==='pause'&&recorder?.state==='recording'){recorder.pause();pausedAt=performance.now();api.report({status:'paused',elapsed:elapsed()});}
  if(command==='resume'&&recorder?.state==='paused'){pausedMS+=performance.now()-pausedAt;pausedAt=null;recorder.resume();api.report({status:'recording',elapsed:elapsed()});}
 });
 try{
  config=await api.init();
  for(let seconds=config.countdown;seconds>0&&!cancelled;seconds--){api.report({status:'countdown',remaining:seconds});await new Promise(resolve=>setTimeout(resolve,1000));}
  if(cancelled)return;
  let screen;
  try{screen=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:config.fps,max:config.fps}},audio:config.systemAudio});}
  catch(error){
   if(error.name!=='InvalidStateError')throw error;
   // A hidden recorder may have no document focus/transient activation. The
   // source ID was chosen and validated by the main process after Start.
   screen=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:config.sourceId,maxFrameRate:config.fps,maxHeight:config.height,maxWidth:Math.min(8192,config.height*4)}},audio:config.systemAudio?{mandatory:{chromeMediaSource:'desktop'}}:false});
  }
  streams.push(screen);
  if(cancelled){cleanup();return;}
  const screenTrack=screen.getVideoTracks()[0];screenTrack.contentHint='motion';screenTrack.addEventListener('ended',()=>stop());
  let sourceSettings=screenTrack.getSettings();
  if(!sourceSettings.width||!sourceSettings.height){video.srcObject=screen;await video.play();sourceSettings={...sourceSettings,width:video.videoWidth||1920,height:video.videoHeight||1080};}
  const height=Math.max(2,Math.floor(Math.min(config.height,sourceSettings.height)/2)*2),width=Math.max(2,Math.round(height*sourceSettings.width/sourceSettings.height/2)*2);
  await screenTrack.applyConstraints({width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:config.fps,max:config.fps}}).catch(()=>warnings.push('Источник не принял все выбранные параметры'));
  const actual=screenTrack.getSettings();let output,capturePath='direct',outputWidth=actual.width||sourceSettings.width,outputHeight=actual.height||sourceSettings.height;
  if(outputHeight<=height&&outputWidth<=width){
   // Pass the captured video track straight to the encoder: no video decode,
   // canvas readback, JS repaint timer, or duplicated frames in the common path.
   output=new MediaStream([screenTrack]);
  }else{
   capturePath='resize';video.srcObject=screen;await video.play();canvas.width=width;canvas.height=height;outputWidth=width;outputHeight=height;
   const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
   let manualFrame,lastPaint=-Infinity;const paint=()=>{const now=performance.now();if(!stopping&&recorder?.state!=='paused'&&now-lastPaint>=1000/config.fps-.5){ctx.drawImage(video,0,0,width,height);manualFrame?.requestFrame();lastPaint=now;}};
   output=canvas.captureStream(0);manualFrame=output.getVideoTracks()[0];
   if(typeof manualFrame?.requestFrame!=='function'){for(const track of output.getTracks())track.stop();manualFrame=null;output=canvas.captureStream(config.fps);}
   paint();
   if(video.requestVideoFrameCallback){const next=()=>{paint();if(!stopping)videoFrame=video.requestVideoFrameCallback(next);};videoFrame=video.requestVideoFrameCallback(next);}
   else draw=setInterval(paint,1000/Math.min(config.fps,actual.frameRate||sourceSettings.frameRate||60));
  }
  streams.push(output);
  const inputs=[];if(config.systemAudio){if(screen.getAudioTracks().length)inputs.push({stream:screen,volume:config.systemVolume});else warnings.push('Источник не передал системный звук');}
  if(config.microphone){const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:config.echoCancellation,noiseSuppression:config.noiseSuppression,autoGainControl:config.autoGainControl},video:false});streams.push(mic);const micSettings=mic.getAudioTracks()[0]?.getSettings();if(config.noiseSuppression&&micSettings?.noiseSuppression===false)warnings.push('Микрофон не поддерживает шумоподавление');inputs.push({stream:mic,volume:config.micVolume,microphone:true});}
  if(cancelled){cleanup();return;}
  if(inputs.length===1&&inputs[0].volume===100&&!(inputs[0].microphone&&(config.micHighPass||config.micCompressor))){for(const track of inputs[0].stream.getAudioTracks())output.addTrack(track);}
  else if(inputs.length){audio=new AudioContext();await audio.resume();const destination=audio.createMediaStreamDestination();for(const input of inputs){const gain=audio.createGain();gain.gain.value=input.volume/100;let node=audio.createMediaStreamSource(input.stream);if(input.microphone&&config.micHighPass){const filter=audio.createBiquadFilter();filter.type='highpass';filter.frequency.value=80;filter.Q.value=.7;node.connect(filter);node=filter;}node.connect(gain);node=gain;if(input.microphone&&config.micCompressor){const compressor=audio.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.25;node.connect(compressor);node=compressor;}node.connect(destination);}for(const track of destination.stream.getAudioTracks())output.addTrack(track);}
  const hasAudio=!!output.getAudioTracks().length,audioSuffix=hasAudio?',opus':'';
  const h264=['video/mp4;codecs=avc1'+(hasAudio?',mp4a.40.2':''),'video/mp4;codecs=avc1'+audioSuffix,'video/webm;codecs=h264'+audioSuffix];
  const candidates=config.codec==='vp8'?['video/webm;codecs=vp8'+audioSuffix]:config.codec==='vp9'?['video/webm;codecs=vp9'+audioSuffix]:config.codec==='h264'?h264:[...h264,'video/webm;codecs=vp8'+audioSuffix,'video/webm;codecs=vp9'+audioSuffix,'video/webm'];
  const effectiveFPS=Math.min(config.fps,actual.frameRate||config.fps),videoBitrate=window.capturePolicy.bitrate(config,outputWidth,outputHeight,effectiveFPS);
  const ranked=await window.capturePolicy.codecs(candidates.filter(m=>MediaRecorder.isTypeSupported(m)),navigator.mediaCapabilities,{width:outputWidth,height:outputHeight,framerate:effectiveFPS,bitrate:videoBitrate});
  let mimeType,encodingEfficiency='unknown';
  for(const option of ranked){const candidate=option.mimeType;try{recorder=new MediaRecorder(output,{mimeType:candidate,videoBitsPerSecond:videoBitrate,audioBitsPerSecond:config.audioBitrate*1000,videoKeyFrameIntervalDuration:1000});mimeType=recorder.mimeType||candidate;encodingEfficiency=option.info?option.info.powerEfficient?'efficient':'software':'unknown';break;}catch{}}
  if(!recorder)throw Error('Выбранный кодек недоступен. Выберите Авто или VP8');
  if(api.format)await api.format({mimeType});
  if(cancelled){cleanup();return;}
  outputStream=output;recorderOptions={mimeType,videoBitsPerSecond:videoBitrate,audioBitsPerSecond:config.audioBitrate*1000,videoKeyFrameIntervalDuration:1000};
  function bind(instance){
  instance.addEventListener('dataavailable',event=>{
   if(!event.data.size)return;queued+=event.data.size;
   if(queued>128*1024*1024){stop('Диск не успевает сохранять видео. Уменьшите битрейт');return;}
   queue=queue.then(async()=>{try{for(let offset=0;offset<event.data.size;offset+=8*1024*1024)await api.chunk(new Uint8Array(await event.data.slice(offset,offset+8*1024*1024).arrayBuffer()));}finally{queued-=event.data.size;}});
   queue.catch(error=>stop((error.message||'Ошибка записи на диск').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')));
  });
  instance.addEventListener('error',event=>stop(event.error?.message||'Ошибка кодирования'));
  }
  rotate=save=>{
   saveRequested=saveRequested||save;if(rotation||stopping)return rotation;
   clearTimeout(segmentTimer);
   rotation=new Promise((resolve,reject)=>{
    recorder.addEventListener('stop',()=>{try{
     const duration=Math.max(0,(performance.now()-segmentStarted)/1000),save=saveRequested;saveRequested=false;
     // Gate the next segment's writes behind finalizing the old file, but restart
     // capture immediately. Slow disk/index operations no longer stop acquisition.
     queue=queue.then(()=>api.segment({duration,save}));const boundary=queue;
     if(!stopping){recorder=new MediaRecorder(outputStream,recorderOptions);bind(recorder);segmentStarted=performance.now();recorder.start(1000);}
     boundary.then(resolve,reject);
    }catch(error){reject(error);}
   },{once:true});recorder.stop();
   });
   rotation.then(()=>{rotation=null;if(!stopping)segmentTimer=setTimeout(()=>rotate(false),saveRequested?0:5000);},error=>{rotation=null;stop(error.message||'Ошибка буфера повтора');});return rotation;
  };
  bind(recorder);
  started=performance.now();segmentStarted=started;recorder.start(1000);if(config.mode==='replay')segmentTimer=setTimeout(()=>rotate(false),5000);
  const sourceFPS=screenTrack.getSettings().frameRate||null;
  api.report({status:'recording',elapsed:0,width:outputWidth,height:outputHeight,targetFPS:config.fps,sourceFPS,codec:mimeType,capturePath,encodingEfficiency,videoBitrate,effectiveFPS,warnings});
  if(config.mode!=='replay')metrics=setInterval(()=>{if(stopping)return;api.report({status:recorder.state==='paused'?'paused':'recording',elapsed:elapsed()});if(config.maxMinutes&&elapsed()>=config.maxMinutes*60)stop();},1000);
 }catch(error){const reason={NotAllowedError:'Запись не началась: доступ к экрану или микрофону отклонён',NotReadableError:'Источник захвата недоступен. Выберите экран или другое окно',NotFoundError:'Не найден выбранный экран или микрофон',OverconstrainedError:'Источник не поддерживает выбранные параметры. Уменьшите разрешение или FPS'}[error.name];await stop(reason||error.message||'Не удалось начать запись');}
})();

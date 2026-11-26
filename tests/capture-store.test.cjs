const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CaptureStore,sanitize,range}=require('../electron/capture-store.cjs');
const {plan,fixDuration}=require('../electron/webm-duration.cjs');
const folder=async()=>{const directory=path.resolve(__dirname,'../test-results/tmp');await fs.mkdir(directory,{recursive:true});return fs.mkdtemp(path.join(directory,'capture-test-'));};
function webm(){return Buffer.from('1a45dfa3801853806701ffffffffffffff1549a966872ad7b1830f42401f43b67580','hex');}
test('recording settings constrain resolution, frame rate, audio and limits',()=>{
 const settings=sanitize({height:1440,fps:120,bitrate:999,micVolume:-3,maxMinutes:500,codec:'evil',microphone:true,source:'screen:0:0'});
 assert.equal(sanitize({height:2160,fps:240,bitrate:200}).height,2160);assert.equal(sanitize({fps:240}).fps,240);assert.equal(sanitize({noiseSuppression:false}).noiseSuppression,false);assert.equal(sanitize().noiseSuppression,true);assert.equal(settings.height,1440);assert.equal(settings.fps,120);assert.equal(settings.bitrate,200);assert.equal(settings.micVolume,0);assert.equal(settings.maxMinutes,180);assert.equal(settings.codec,'auto');assert.equal(settings.microphone,true);
 assert.equal(sanitize({height:9999,fps:500}).height,1080);assert.equal(sanitize({height:9999,fps:500}).fps,60);
});
test('recording stream writes are preserved, indexed, listed and served with seek ranges',async()=>{
 const root=await folder(),store=new CaptureStore(path.join(root,'data'),root);
 try{
  await store.saveSettings({...store.settings,folder:path.join(root,'video folder'),height:720});const session=await store.create();
  await store.append(session,webm());await store.append(session,Buffer.from('frames'));
  const saved=await store.finish(session,12.5);assert.equal(saved.indexedDuration,true);assert.ok((await fs.stat(saved.file)).size>webm().length);
  assert.equal((await store.list()).length,1);assert.equal(new CaptureStore(path.join(root,'data'),root).settings.height,720);
  const response=await store.response(saved.id,'bytes=0-3');assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from('1a45dfa3','hex'));
  assert.equal((await store.response(saved.id,'bytes=9999999-')).status,416);assert.equal((await store.response('../private',null)).status,404);
  assert.equal(await fs.stat(store.pendingFile).catch(()=>null),null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('cancelled empty recordings do not create phantom videos; crash fragments can be recovered',async()=>{
 const root=await folder(),store=new CaptureStore(path.join(root,'data'),root);
 try{
  const empty=await store.create();assert.equal(await store.finish(empty,0),null);assert.equal((await store.list()).length,0);
  const active=await store.create();await store.append(active,webm());await active.handle.close();
  const recovered=new CaptureStore(path.join(root,'data'),root);await recovered.recover();const list=await recovered.list();
  assert.equal(list.length,1);assert.equal(list[0].interrupted,true);assert.match(list[0].name,/interrupted\.webm$/);await recovered.recover();assert.equal((await recovered.list()).length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('streaming WebM duration metadata is added without loading the recording, and existing metadata is updated',async()=>{
 const root=await folder(),file=path.join(root,'test.webm');
 try{
  await fs.writeFile(file,webm());assert.equal(await fixDuration(file,3),true);const before=await fs.readFile(file);const first=plan(before,3000);assert.ok(first.patch);assert.equal(first.patch.readDoubleBE(),3000);
  assert.equal(await fixDuration(file,8.25),true);const after=await fs.readFile(file);assert.equal(after.length,before.length);assert.equal(plan(after,8250).patch.readDoubleBE(),8250);
  assert.equal(plan(Buffer.from('not a WebM'),1000),null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('HTTP range validation permits bounded seeks and rejects malformed or excessive ranges',()=>{
 assert.deepEqual(range('bytes=2-6',10),{start:2,end:6});assert.deepEqual(range('bytes=-3',10),{start:7,end:9});assert.deepEqual(range('bytes=8-999',10),{start:8,end:9});
 for(const header of ['bytes=0-1,3-5','bytes=99-','bytes=6-2','bytes=-0','../secret'])assert.throws(()=>range(header,10));
});

test('native MP4 capture survives a crash with the real extension and concurrent index imports do not lose videos',async()=>{
 const root=await folder(),store=new CaptureStore(path.join(root,'data'),root);
 try{
  const session=await store.create();await store.setFormat(session,'video/mp4;codecs=avc1.42001f,mp4a.40.2');await store.append(session,Buffer.concat([Buffer.from('00000020ftypisom'),Buffer.alloc(64)]));await session.handle.close();
  const recovered=new CaptureStore(path.join(root,'data'),root);await recovered.recover();const saved=(await recovered.list())[0];assert.match(saved.file,/interrupted\.source\.mp4$/);assert.equal(saved.videoCodec,'h264');assert.equal(saved.audioCodec,'aac');
  const imported=Array.from({length:5},(_,i)=>({id:String(i).repeat(32),file:path.join(root,'EclipseIsland-'+i+'.mp4')}));await Promise.all(imported.map(entry=>recovered.importVideo(entry)));assert.equal(recovered.items.length,6);assert.equal(new CaptureStore(path.join(root,'data'),root).items.length,6);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('instant replay settings support ten minutes and unlimited disk size',()=>{
 const max=sanitize({replaySeconds:600,replayMaxMB:0});assert.equal(max.replaySeconds,600);assert.equal(max.replayMaxMB,0);assert.equal(sanitize({replaySeconds:601,replayMaxMB:-1}).replaySeconds,30);
});

test('replay audio settings migrate once and remain independent from ordinary recording audio',()=>{
 const legacy=sanitize({microphone:true,noiseSuppression:false,systemAudio:false,micVolume:999,systemVolume:999,audioBitrate:999});assert.equal(legacy.replayMicrophone,true);assert.equal(legacy.replayNoiseSuppression,false);assert.equal(legacy.replaySystemAudio,false);assert.equal(legacy.replayMicVolume,200);assert.equal(legacy.replaySystemVolume,100);assert.equal(legacy.replayAudioBitrate,192);
 const edited=sanitize({...legacy,microphone:false,noiseSuppression:true,replayAudioBitrate:320,replayMicHighPass:true,replayMicCompressor:true});assert.equal(edited.replayMicrophone,true);assert.equal(edited.replayNoiseSuppression,false);assert.equal(edited.replayAudioBitrate,320);assert.equal(edited.replayMicCompressor,true);assert.equal(edited.replayMicHighPass,true);
});

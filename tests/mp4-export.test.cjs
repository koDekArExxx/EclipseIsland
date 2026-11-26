const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {CaptureStore}=require('../electron/capture-store.cjs');
const {exportMP4,verifyEncoder,argumentsFor}=require('../electron/mp4-export.cjs');
const binary=process.platform==='win32'?path.resolve(__dirname,'../electron/encoder/win-x64/ffmpeg.exe'):'/usr/bin/ffmpeg';
const available=spawnSync(binary,['-version'],{windowsHide:true}).status===0;
async function temporary(){const base=path.resolve(__dirname,'../test-results/tmp');await fs.mkdir(base,{recursive:true});return fs.mkdtemp(path.join(base,'mp4-'));}
test('MP4 encoder integrity is verified without downloading a runtime during unit tests',async()=>{
 const root=await temporary(),file=path.join(root,'ffmpeg.exe');
 const bytes=Buffer.from('encoder integrity fixture');
 const sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 try{
  await fs.writeFile(file,bytes);
  await fs.writeFile(path.join(root,'build.json'),JSON.stringify({sha256}));
  assert.equal(await verifyEncoder(file),file);
  // Changing the binary invalidates the cached verification and must be rejected.
  await fs.writeFile(file,Buffer.from('corrupted encoder integrity fixture'));
  await assert.rejects(verifyEncoder(file),/повреждён/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('MP4 export preserves 240 FPS timestamps, resolution and audio in a real H.264/AAC file',{skip:!available},async()=>{
 const root=await temporary();
 try{
  const input=path.join(root,'EclipseIsland-sample.webm');
  const generated=spawnSync(binary,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=240','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libvpx','-threads','2','-deadline','realtime','-cpu-used','8','-b:v','4M','-c:a','libopus',input],{windowsHide:true});
  assert.equal(generated.status,0,generated.stderr?.toString());
  const store=new CaptureStore(path.join(root,'settings'),root),id='a'.repeat(32);
  const entry={id,file:input,name:path.basename(input),bytes:(await fs.stat(input)).size,createdAt:Date.now(),duration:1,indexedDuration:true};store.items=[entry];
  const progress=[];const file=await exportMP4(entry,{bitrate:30,audioBitrate:192},x=>progress.push(x),{binary});
  assert.equal(progress.at(-1),100);const saved=await store.replaceWithMP4(entry,file);assert.match(saved.name,/\.mp4$/);assert.ok(saved.bytes>32);
  assert.equal(await fs.stat(input).catch(()=>null),null);
  assert.equal(new CaptureStore(path.join(root,'settings'),root).get(id).format,'mp4');
  const response=await store.response(id,'bytes=0-31');assert.equal(response.headers.get('Content-Type'),'video/mp4');assert.match(Buffer.from(await response.arrayBuffer()).toString(),/ftyp/);
  const decoded=spawnSync(binary,['-hide_banner','-i',file,'-f','null','-'],{windowsHide:true});assert.equal(decoded.status,0,decoded.stderr?.toString());
  const description=decoded.stderr.toString();assert.match(description,/Video: h264/);assert.match(description,/Audio: aac/);assert.match(description,/640x360/);assert.match(description,/240 fps/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('an invalid capture cannot create fake MP4; original video is preserved',{skip:!available},async()=>{
 const root=await temporary();
 try{
  const file=path.join(root,'EclipseIsland-invalid.webm');await fs.writeFile(file,'invalid media');
  await assert.rejects(exportMP4({file,duration:1},{},()=>{},{binary}),/MP4/);
  assert.equal(await fs.readFile(file,'utf8'),'invalid media');assert.deepEqual(await fs.readdir(root),['EclipseIsland-invalid.webm']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('export command uses argument arrays, local input protocols and variable timestamps without fabricated FPS',()=>{
 const args=argumentsFor({file:'C:\\Видео\\test.webm'},{bitrate:999,audioBitrate:999},'output.part');
 assert.equal(args[args.indexOf('-i')+1],'C:\\Видео\\test.webm');assert.equal(args[args.indexOf('-maxrate')+1],'200M');assert.equal(args[args.indexOf('-b:a')+1],'320k');
 assert.equal(args.includes('-r'),false);assert.equal(args[args.indexOf('-fps_mode')+1],'vfr');assert.equal(args[args.indexOf('-protocol_whitelist')+1],'file,pipe');
});

test('fragmented H.264/AAC is remuxed without encoding and replay segments can be joined into a playable MP4',{skip:!available},async()=>{
 const root=await temporary();
 try{
  const input=path.join(root,'EclipseIsland-native.source.mp4');
  const generated=spawnSync(binary,['-hide_banner','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-threads','2','-preset','ultrafast','-g','60','-c:a','aac','-movflags','+frag_keyframe+empty_moov',input],{windowsHide:true});assert.equal(generated.status,0,generated.stderr?.toString());
  const modes=[];const first=await exportMP4({file:input,duration:2,videoCodec:'h264',audioCodec:'aac'},{},(n,mode)=>modes.push(mode),{binary});assert.ok(modes.every(x=>x==='copy'));
  const args=argumentsFor({file:input,videoCodec:'h264',audioCodec:'aac'},{},'x');assert.equal(args[args.indexOf('-c:v')+1],'copy');assert.equal(args[args.indexOf('-c:a')+1],'copy');
  const hash=file=>{const r=spawnSync(binary,['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-f','hash','-'],{windowsHide:true});assert.equal(r.status,0,r.stderr?.toString());return r.stdout.toString();};assert.equal(hash(first),hash(input),'the encoded video is preserved byte for byte');
  const concatFile=path.join(root,'replay.ffconcat');await fs.writeFile(concatFile,"ffconcat version 1.0\nfile '"+input.replace(/\\/g,'/')+"'\nfile '"+input.replace(/\\/g,'/')+"'\n");
  const replay=await exportMP4({file:path.join(root,'EclipseIsland-replay.webm'),concatFile,startOffset:1,duration:3,videoCodec:'h264',audioCodec:'aac'},{},()=>{},{binary});
  const decoded=spawnSync(binary,['-hide_banner','-i',replay,'-f','null','-'],{windowsHide:true});assert.equal(decoded.status,0,decoded.stderr?.toString());assert.match(decoded.stderr.toString(),/Video: h264/);assert.match(decoded.stderr.toString(),/Audio: aac/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

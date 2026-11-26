const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{gzipSync}=require('node:zlib');
const {ensureEncoder}=require('../electron/encoder-download.cjs');
const bytes=Buffer.from('test encoder bytes');
const metadata={source:'https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eclipse-encoder-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'ffmpeg.exe');}
test('encoder is streamed, decompressed and verified; concurrent consumers share one download',async t=>{
 const file=await setup(t);let calls=0;
 const options={fetch:async url=>{calls++;assert.equal(url,'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz');return new Response(gzipSync(bytes));}};
 const results=await Promise.all([ensureEncoder(file,metadata,options),ensureEncoder(file,metadata,options)]);
 assert.equal(calls,1);assert.deepEqual(results,[file,file]);assert.deepEqual(await fs.readFile(file),bytes);assert.deepEqual(JSON.parse(await fs.readFile(path.join(path.dirname(file),'build.json'))),metadata);
});
test('invalid hash or broken download never leaves an executable or temporary file',async t=>{
 const file=await setup(t);
 for(const response of [()=>new Response(gzipSync(Buffer.from('corrupt'))),()=>new Response('not gzip'),()=>new Response(null,{status:503})]){
  await assert.rejects(ensureEncoder(file,metadata,{fetch:async()=>response()}));
  assert.deepEqual(await fs.readdir(path.dirname(file)),[]);
 }
 // A failed attempt can be retried, it does not poison the in-flight cache.
 await ensureEncoder(file,metadata,{fetch:async()=>new Response(gzipSync(bytes))});assert.deepEqual(await fs.readFile(file),bytes);
});
test('untrusted encoder source is rejected before network access',async t=>{
 const file=await setup(t);let calls=0;
 await assert.rejects(ensureEncoder(file,{...metadata,downloadUrl:'https://evil.example/ffmpeg.gz'},{fetch:async()=>{calls++;}}));assert.equal(calls,0);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mediaWorker}=require('../electron/media-worker.cjs');
test('packaged Windows builds use the typed service for both metadata and controls',()=>{
  for(const arch of ['x64','arm64']) {
    const metadata=mediaWorker(false,{arch,existsSync:()=>true}),control=mediaWorker(true,{arch,existsSync:()=>true});
    assert.equal(metadata.backend,'native');assert.match(metadata.executable,new RegExp(`win-${arch}[/\\\\]EclipseMedia\\.exe$`));
    assert.equal(control.executable,metadata.executable);assert.deepEqual(control.args,['-ControlOnly']);assert.deepEqual(metadata.args,[]);
  }
});
test('source checkouts without a compiled helper retain an explicit legacy fallback',()=>{
 const worker=mediaWorker(false,{existsSync:()=>false});assert.equal(worker.backend,'powershell');assert.ok(worker.args.includes('-File'));
});

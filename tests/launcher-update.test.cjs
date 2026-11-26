const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {replaceLauncher,refreshLauncher}=require('../electron/launcher-update.cjs');
async function fixture(t){const root=path.resolve(__dirname,'../test-results/tmp');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'launcher-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const source=path.join(dir,'new.exe'),target=path.join(dir,'EclipseIsland.exe'),bytes=Buffer.alloc(2048,42);await fs.writeFile(source,bytes);await fs.writeFile(target,'old launcher');return {dir,source,target,bytes,sha:crypto.createHash('sha256').update(bytes).digest('hex')};}
test('a verified launcher waits for the previous process and then replaces atomically',async t=>{
 const f=await fixture(t);let renames=0,waits=0;
 const fsOps={...fs,rename:async(...args)=>{renames++;if(renames<3)throw Object.assign(Error('mapped executable'),{code:'EBUSY'});return fs.rename(...args);}};
 const changed=await replaceLauncher(f.source,f.target,f.sha,{fsOps,wait:async()=>{waits++;assert.equal(await fs.readFile(f.target,'utf8'),'old launcher');}});
 assert.equal(changed,true);assert.equal(waits,2);assert.deepEqual(await fs.readFile(f.target),f.bytes);
 assert.equal(await replaceLauncher(f.source,f.target,f.sha),false);
 assert.deepEqual((await fs.readdir(f.dir)).sort(),['EclipseIsland.exe','new.exe']);
});
test('checksum failures or a permanently locked launcher retain the existing executable',async t=>{
 const f=await fixture(t);await assert.rejects(replaceLauncher(f.source,f.target,'0'.repeat(64)),/checksum/);
 const fsOps={...fs,rename:async()=>{throw Object.assign(Error('locked'),{code:'EPERM'});}};
 await assert.rejects(replaceLauncher(f.source,f.target,f.sha,{fsOps,wait:async()=>{},attempts:2}),/locked/);
 assert.equal(await fs.readFile(f.target,'utf8'),'old launcher');assert.deepEqual((await fs.readdir(f.dir)).sort(),['EclipseIsland.exe','new.exe']);
});
test('development and standalone launches never modify an installed launcher',async()=>{
 const app={isPackaged:false};assert.equal(await refreshLauncher(app,{platform:'win32',env:{}}),false);
 assert.equal(await refreshLauncher({isPackaged:true},{platform:'win32',env:{}}),false);
});

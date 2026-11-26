const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {SpotifySetup}=require('../electron/spotify-setup.cjs');

function fixture(){
 let stored,call;const child=new EventEmitter();const states=[];
 const setup=new SpotifySetup('/profile with spaces',state=>states.push(state),{
  platform:'win32',script:'/application with spaces/Install-Spotify-Bridge.ps1',
  fs:{unlinkSync(){stored=undefined;},readFileSync(){if(!stored)throw Error('Missing');return JSON.stringify(stored);}},
  spawn:(file,args,options)=>{call={file,args,options};return child;}
 });
 return {setup,child,states,call:()=>call,write:state=>{stored=state;}};
}
test('first launch starts one hidden installer; simultaneous retry shares the running installation',async()=>{
 const f=fixture();const first=f.setup.run();assert.equal(f.setup.run(true),first);
 const {args,options}=f.call();assert.ok(args.includes('-Auto'));assert.ok(args.includes('-NonInteractive'));assert.ok(!args.includes('-Force'));
 assert.equal(args[args.indexOf('-File')+1],'/application with spaces/Install-Spotify-Bridge.ps1');
 assert.equal(options.shell,false);assert.equal(options.windowsHide,true);
 f.write({status:'applying',message:'Restarting Spotify'});f.setup.read();assert.equal(f.setup.state.status,'applying');
 f.write({status:'installed',message:'Waiting for connection'});f.child.emit('exit',0);
 assert.equal((await first).ok,true);assert.equal(f.setup.state.status,'installed');
 const retry=f.setup.run(true);assert.ok(f.call().args.includes('-Force'));
 f.write({status:'installed',message:'Waiting for connection'});f.child.emit('exit',0);await retry;f.setup.stop();
});
test('missing Spotify is reported without claiming that it was installed',async()=>{
 const f=fixture(),pending=f.setup.run();f.write({status:'absent',message:'Spotify missing'});f.child.emit('exit',0);
 const result=await pending;assert.equal(result.ok,false);assert.equal(result.status,'absent');assert.equal(f.setup.pending,null);
});
test('failed PowerShell start is recoverable, and installer errors remain visible',async()=>{
 const f=fixture();let pending=f.setup.run();f.child.emit('error',Object.assign(Error('Denied'),{code:'EACCES'}));
 assert.equal((await pending).error,'EACCES');assert.equal(f.setup.state.status,'error');
 pending=f.setup.run(true);f.write({status:'error',message:'Download checksum failed'});f.child.emit('exit',1);
 assert.equal((await pending).message,'Download checksum failed');
});
test('a successful process exit without a final installation status is an error',async()=>{
 const f=fixture(),pending=f.setup.run();f.child.emit('exit',0);assert.equal((await pending).status,'error');
});
test('unsupported systems never run an installer',async()=>{
 const setup=new SpotifySetup('/profile',()=>{},{platform:'linux',spawn:()=>{throw Error('Must not run');}});
 assert.equal((await setup.run()).ok,false);
});

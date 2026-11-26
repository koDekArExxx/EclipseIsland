const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');const {TransferMonitor}=require('../electron/transfers.cjs');
test('Explorer windows are not hidden without fresh observations and acknowledged renderer IDs',async()=>{
 let clock=10000;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.unref=()=>{};const lines=[];child.stdin.on('data',data=>lines.push(data.toString()));
 const states=[];const monitor=new TransferMonitor(value=>states.push(value),{platform:'win32',now:()=>clock,spawn:()=>child});
 monitor.configure(true);monitor.lease(true,['123']);assert.match(lines.at(-1),/^LEASE 0/);
 child.stdout.write(JSON.stringify({type:'transfers',items:[{id:'123',title:'Copy',details:'Files',percent:42,kind:'copy',canPause:true,canCancel:true}]})+'\n');await new Promise(r=>setImmediate(r));
 monitor.lease(true,['123','bad']);assert.equal(lines.at(-1),'LEASE 1 123\n');
 clock+=2501;monitor.lease(true,['123']);assert.match(lines.at(-1),/^LEASE 0/);
 assert.equal(monitor.command('cancel','999').ok,false);assert.equal(monitor.command('pause','123').ok,true);assert.match(lines.at(-1),/"action":"pause"/);
 monitor.stop();assert.match(lines.at(-1),/^LEASE 0/);child.emit('exit',0);
});
test('unsupported systems never spawn Explorer automation',()=>{let started=false;const m=new TransferMonitor(()=>{},{platform:'linux',spawn:()=>{started=true;}});m.configure(true);assert.equal(started,false);assert.equal(m.state.supported,false);});

test('a crashed helper triggers independent restoration for acknowledged operations, including a pre-snapshot hide',async()=>{
 let clock=10000;const calls=[];const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();const restore=new EventEmitter();restore.unref=()=>{};
 const monitor=new TransferMonitor(()=>{},{platform:'win32',now:()=>clock,spawn:(exe,args,options)=>{calls.push({exe,args,options});return calls.length===1?child:restore;}});
 monitor.configure(true);child.stdout.write(JSON.stringify({type:'transfers',items:[{id:'123',title:'Copy',percent:10,hidden:false,canCancel:true}]})+'\n');await new Promise(r=>setImmediate(r));monitor.lease(true,['123']);
 child.emit('exit',1);assert.equal(calls.length,2);assert.ok(calls[1].args.some(x=>x.endsWith('transfers-restore.ps1')));assert.equal(calls[1].args.at(-1),'123');assert.equal(calls[1].options.stdio,'ignore');assert.equal(monitor.state.status,'error');assert.deepEqual(monitor.state.items,[]);
});

test('replacement diagnostics report eligibility and mask mode without file names',async()=>{
 const {PassThrough}=require('node:stream');const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();const m=new TransferMonitor(()=>{},{platform:'win32',now:()=>10000,spawn:()=>child});m.configure(true);child.stdout.write(JSON.stringify({type:'transfers',items:[{id:'55',title:'private-file-name.txt',details:'private-path',canCancel:true,hidden:true,maskMode:3,reason:'eligible'}]})+'\n');await new Promise(resolve=>setImmediate(resolve));m.lease(true,['55']);const d=m.diagnostics();assert.equal(d.operations[0].maskMode,3);assert.equal(d.lease.allowed,true);assert.equal(JSON.stringify(d).includes('private-'),false);child.emit('exit',0);
});

test('closing operations retain renderer acknowledgement while controls disappear, but confirmations stay native',async()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();const lines=[];child.stdin.on('data',data=>lines.push(data.toString()));
 const m=new TransferMonitor(()=>{},{platform:'win32',now:()=>10000,spawn:()=>child});m.configure(true);
 child.stdout.write(JSON.stringify({type:'transfers',items:[{id:'123',closing:true,canCancel:false,hidden:true}]})+'\n');await new Promise(r=>setImmediate(r));m.lease(true,['123']);assert.equal(lines.at(-1),'LEASE 1 123\n');
 child.stdout.write(JSON.stringify({type:'transfers',items:[{id:'123',closing:true,canCancel:false,attention:true}]})+'\n');await new Promise(r=>setImmediate(r));m.lease(true,['123']);assert.equal(lines.at(-1),'LEASE 1 \n');
});
test('helper crash restores provisional masks even before the first operation snapshot',async()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();const calls=[];const restore=new EventEmitter();restore.unref=()=>{};
 const m=new TransferMonitor(()=>{},{platform:'win32',now:()=>10000,spawn:(...args)=>{calls.push(args);return calls.length===1?child:restore;}});m.configure(true);
 child.stdout.write(JSON.stringify({type:'transfers',items:[]})+'\n');await new Promise(r=>setImmediate(r));m.lease(true,[]);child.emit('exit',1);assert.equal(calls.length,2);assert.ok(calls[1][1].some(x=>x.endsWith('transfers-restore.ps1')));
});

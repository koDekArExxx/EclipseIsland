const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
test('recorder preload exposes only narrow methods and never returns the ipcRenderer object or native event',async()=>{
 let api,listener,call;
 const native={privateNativeObject:true,on:(channel,fn)=>{listener=fn;return native;},invoke:async(...args)=>{call=args;return {ok:true};},send:()=>{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../electron/capture-preload.cjs'),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'captureWorker');api=value;}},ipcRenderer:native})});
 let command;assert.equal(api.on(value=>command=value),undefined);listener({sender:'must not cross bridge'},'stop');assert.equal(command,'stop');await api.init();assert.deepEqual(call,['capture-worker:init']);assert.equal(api.privateNativeObject,undefined);
});

const {test}=require('node:test');const assert=require('node:assert/strict');const policy=require('../src/capture-policy.js');
test('auto quality covers 720p through 4K, honors FPS and caps bitrate',()=>{
 assert.equal(policy.bitrate({},1280,720,30),4976640);
 assert.equal(policy.bitrate({},1920,1080,60),22394880);
 assert.equal(policy.bitrate({},3840,2160,240),200000000);
 assert.equal(policy.bitrate({quality:'manual',bitrate:6},3840,2160,60),6000000);
});
test('missing or rejecting capability API preserves a usable fallback',async()=>{
 const candidates=['video/mp4;codecs=avc1','video/webm;codecs=vp8'];
 assert.deepEqual((await policy.codecs(candidates,null,{})).map(x=>x.mimeType),candidates);
 assert.deepEqual((await policy.codecs(candidates,{encodingInfo:async()=>{throw Error('Unsupported');}},{})).map(x=>x.mimeType),candidates);
});

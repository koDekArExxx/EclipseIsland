const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MediaDelivery}=require('../electron/media-delivery.cjs');
test('renderer diagnostics distinguish a 30-second renderer stall from current main-process data',()=>{
 let now=0;const delivery=new MediaDelivery(()=>now),sequence=delivery.sent(7);
 now=30000;assert.equal(delivery.snapshot()[0].pendingAgeMs,30000);
 assert.equal(delivery.applied(7,sequence),true);assert.equal(delivery.snapshot()[0].lastApplyLagMs,30000);assert.equal(delivery.snapshot()[0].pendingAgeMs,0);
});
test('late acknowledgements cannot regress delivery state and views are independent',()=>{
 let now=0;const delivery=new MediaDelivery(()=>now),first=delivery.sent(1),second=delivery.sent(1),other=delivery.sent(2);
 now=120;assert.equal(delivery.applied(1,second),true);assert.equal(delivery.applied(1,first),false);assert.equal(delivery.applied(1,other),false);
 assert.equal(delivery.snapshot()[1].lastApplied,0);assert.equal(delivery.snapshot()[0].lastApplyLagMs,120);
});

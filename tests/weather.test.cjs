const {test}=require('node:test');
const assert=require('node:assert/strict');
const {searchCities,getWeather}=require('../electron/weather.cjs');
test('city names are URL encoded and empty searches do not use the network',async()=>{
  const saved=global.fetch;let calls=0;
  global.fetch=async url=>{calls++;const u=new URL(url);assert.equal(u.hostname,'geocoding-api.open-meteo.com');assert.equal(u.searchParams.get('name'),'A&B ?');return {ok:true,json:async()=>({results:[{name:'A&B ?',latitude:1,longitude:2,country:'Test'}]})};};
  try{assert.deepEqual(await searchCities(' '),[]);assert.equal(calls,0);const cities=await searchCities('A&B ?');assert.equal(cities[0].latitude,1);assert.equal(calls,1);}finally{global.fetch=saved;}
});
test('weather rejects service errors and malformed data',async()=>{
  const saved=global.fetch;
  try{global.fetch=async()=>({ok:false});await assert.rejects(()=>getWeather({latitude:1,longitude:2}),/недоступен/);global.fetch=async()=>({ok:true,json:async()=>({current:{}})});await assert.rejects(()=>getWeather({latitude:1,longitude:2}),/неполные/);}finally{global.fetch=saved;}
});

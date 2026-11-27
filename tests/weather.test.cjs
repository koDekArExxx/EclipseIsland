const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWeatherClient,parseWeather,daylight}=require('../src/weather-client.js');
const cities=require('../src/russian-cities.js');
const city={name:'Москва',latitude:55.7558,longitude:37.6173};
const payload=()=>({current_condition:[{temp_C:'-3',FeelsLikeC:'-9',windspeedKmph:'18',weatherCode:'326',lang_ru:[{value:'Слабый снег'}]}],weather:[{maxtempC:'-2',mintempC:'-6'}]});
const ok=()=>({ok:true,json:async()=>payload()});
test('Russian cities and aliases are found locally without any network',async()=>{
 const c=createWeatherClient({cities,fetch:async()=>{throw Error('Network must not be used');}});
 assert.equal((await c.searchCities('Моск'))[0].name,'Москва');assert.equal((await c.searchCities('СПБ'))[0].name,'Санкт-Петербург');assert.equal((await c.searchCities('Каза'))[0].name,'Казань');assert.equal((await c.searchCities('санкт петербург'))[0].name,'Санкт-Петербург');assert.equal(cities.length,1117);
});
test('international names are URL encoded; empty searches make no requests',async()=>{
 let calls=0;const c=createWeatherClient({cities,fetch:async url=>{calls++;const u=new URL(url);assert.equal(u.hostname,'geocoding-api.open-meteo.com');assert.equal(u.searchParams.get('name'),'A&B ?');return {ok:true,json:async()=>({results:[{name:'A&B ?',latitude:1,longitude:2,country:'Test'}]})};}});
 assert.deepEqual(await c.searchCities(' '),[]);assert.equal(calls,0);assert.equal((await c.searchCities('A&B ?'))[0].latitude,1);assert.equal((await c.searchCities('A&B ?'))[0].name,'A&B ?');assert.equal(calls,1);
});
test('wttr data maps temperatures, m/s wind, snow and source without API credentials',async()=>{
 const c=createWeatherClient({fetch:async(url,options)=>{const u=new URL(url);assert.equal(u.hostname,'ru.wttr.in');assert.equal(u.pathname,'/55.7558,37.6173');assert.equal(u.searchParams.get('format'),'j1');assert.equal(Object.keys(options.headers).some(k=>/key|token/i.test(k)),false);return ok();}});
 const w=await c.getWeather(city);assert.equal(w.temperature,-3);assert.equal(w.feels,-9);assert.equal(w.wind,5);assert.equal(w.code,71);assert.equal(w.source,'wttr.in');assert.equal(w.stale,false);assert.equal(w.description,'Слабый снег');
});
test('alternate host is tried after failure or malformed data',async()=>{
 const hosts=[];const c=createWeatherClient({fetch:async url=>{hosts.push(new URL(url).hostname);return hosts.length===1?{ok:true,json:async()=>({})}:ok();}});
 assert.equal((await c.getWeather(city)).temperature,-3);assert.deepEqual(hosts,['ru.wttr.in','wttr.in']);
});
test('simultaneous requests share one fetch, fresh cache avoids requests and returned objects are isolated',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r);let time=100000;
 const c=createWeatherClient({now:()=>time,fetch:async()=>{calls++;await gate;return ok();}});
 const first=c.getWeather(city),second=c.getWeather({...city,name:'Москва — центр'});assert.equal(calls,1);release();const [a,b]=await Promise.all([first,second]);assert.equal(a.city,'Москва');assert.equal(b.city,'Москва — центр');a.temperature=100;
 assert.equal((await c.getWeather(city)).temperature,-3);assert.equal(calls,1);time+=31000;await c.getWeather(city,{force:true});assert.equal(calls,2);
});
test('a temporary outage returns only same-city cache with an explicit stale marker and original time',async()=>{
 let time=100000,broken=false;const c=createWeatherClient({now:()=>time,fetch:async()=>{if(broken)throw Error('Offline');return ok();}});
 const original=await c.getWeather(city);time+=600001;broken=true;const saved=await c.getWeather(city);assert.equal(saved.stale,true);assert.equal(saved.updatedAt,original.updatedAt);assert.equal(saved.temperature,-3);
 await assert.rejects(()=>c.getWeather({...city,name:'Казань',longitude:49.1115}),/Не удалось/);time+=21600001;await assert.rejects(()=>c.getWeather(city),/Не удалось/);
});
test('invalid input and incomplete or empty measurements are rejected, not converted to zero',()=>{
 assert.throws(()=>parseWeather(payload(),{...city,latitude:NaN}),/корректный/);
 for(const value of [undefined,null,'','  ']){const p=payload();p.current_condition[0].temp_C=value;assert.throws(()=>parseWeather(p,city),/неполные/);}
 const p=payload();p.weather[0].mintempC='10';assert.throws(()=>parseWeather(p,city),/неполные/);
});
test('day/night icons account for coordinates and polar day instead of the PC timezone',()=>{
 assert.equal(daylight(55.75,37.62,Date.UTC(2026,10,27,9)),true);assert.equal(daylight(55.75,37.62,Date.UTC(2026,10,27,23)),false);
 assert.equal(daylight(69,33,Date.UTC(2026,5,21,22)),true);assert.equal(daylight(69,33,Date.UTC(2026,11,21,10)),false);
});

test('desktop weather facade can use the Electron transport without a Node fetch',async()=>{
 const service=require('../electron/weather.cjs');let calls=0;service.useWeatherFetch(async url=>{calls++;assert.match(url,/^https:\/\/ru\.wttr\.in\//);return ok();});
 try{assert.equal((await service.getWeather({...city,longitude:37.6178})).source,'wttr.in');assert.equal(calls,1);}finally{service.useWeatherFetch((...args)=>fetch(...args));}
});

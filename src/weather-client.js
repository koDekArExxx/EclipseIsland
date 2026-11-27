/* Shared desktop/browser weather client; no credentials, background polling or scraping. */
(function(root){
 const HOSTS=['https://ru.wttr.in/','https://wttr.in/'];
 const CODES={113:0,116:1,119:2,122:3,143:45,176:61,179:71,182:71,185:56,200:95,227:73,230:75,248:45,260:48,263:51,266:53,281:56,284:57,293:61,296:61,299:63,302:63,305:65,308:65,311:66,314:67,317:71,320:73,323:71,326:71,329:73,332:73,335:75,338:75,350:77,353:80,356:81,359:82,362:85,365:86,368:85,371:86,374:77,377:77,386:95,389:95,392:95,395:95};
 const norm=value=>String(value).toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^a-zа-я0-9]/g,'');
 const number=value=>value===null||value===undefined||String(value).trim()===''?NaN:Number(value);
 function validCity(city){return !!city&&typeof city.name==='string'&&city.name.length<=100&&Number.isFinite(city.latitude)&&Math.abs(city.latitude)<=90&&Number.isFinite(city.longitude)&&Math.abs(city.longitude)<=180;}
 function daylight(latitude,longitude,at){
  // NOAA approximate solar zenith; uses UTC, including polar days/nights.
  const d=new Date(at),year=d.getUTCFullYear(),day=(at-Date.UTC(year,0,1))/86400000,hour=d.getUTCHours()+d.getUTCMinutes()/60;
  const days=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000,g=2*Math.PI/days*(Math.floor(day)+(hour-12)/24);
  const eq=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
  const dec=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g);
  const solar=((hour*60+4*longitude+eq)%1440+1440)%1440,ha=(solar/4-180)*Math.PI/180,lat=latitude*Math.PI/180;
  return Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(ha)>Math.cos(90.833*Math.PI/180);
 }
 function parseWeather(data,city,at=Date.now()){
  if(!validCity(city))throw Error('Выберите корректный город');
  const c=data?.current_condition?.[0],today=data?.weather?.[0];
  const temperature=number(c?.temp_C),feels=number(c?.FeelsLikeC),wind=number(c?.windspeedKmph)/3.6,high=number(today?.maxtempC),low=number(today?.mintempC),code=CODES[number(c?.weatherCode)]??3;
  if(![temperature,feels,wind,high,low].every(Number.isFinite)||temperature < -100||temperature > 70||wind<0||wind>150||low>high)throw Error('Сервис вернул неполные данные');
  const text=c?.lang_ru?.[0]?.value||c?.lang_xx?.[0]?.value;
  return {city:city.name,temperature,feels,wind:Math.round(wind*10)/10,high,low,code,isDay:daylight(city.latitude,city.longitude,at),description:typeof text==='string'?text.slice(0,120):null,source:'wttr.in',updatedAt:at,stale:false};
 }
 function createWeatherClient({cities=[],fetch:request=(...args)=>fetch(...args),now=Date.now,ttl=600000,maxStale=21600000,timeout=8000}={}){
  const cache=new Map(),inflight=new Map(),searchCache=new Map();
  async function json(url){const response=await request(url,{signal:AbortSignal.timeout(timeout),headers:{Accept:'application/json'}});if(!response.ok)throw Error('Сервис погоды временно недоступен');return response.json();}
  async function searchCities(query){
   if(typeof query!=='string'||query.trim().length<2||query.length>100)return [];
   let q=norm(query);q=({спб:'санктпетербург',питер:'санктпетербург',moscow:'москва',saintpetersburg:'санктпетербург'})[q]||q;
   const local=cities.map(c=>({c,n:norm(c.name)})).filter(x=>x.n.includes(q));
   if(local.length)return local.sort((a,b)=>(a.n===q?0:a.n.startsWith(q)?1:2)-(b.n===q?0:b.n.startsWith(q)?1:2)).slice(0,6).map(x=>({...x.c}));
   if(searchCache.has(q))return searchCache.get(q).map(x=>({...x}));
   // Preserve international lookup; Russian city selection uses no network.
   const data=await json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query.trim(),count:'6',language:'ru',format:'json'}));
   const result=(Array.isArray(data.results)?data.results:[]).filter(c=>validCity(c)).slice(0,6).map(c=>({name:c.name,country:[c.admin1,c.country].filter(Boolean).join(', '),latitude:c.latitude,longitude:c.longitude}));
   searchCache.set(q,result);if(searchCache.size>32)searchCache.delete(searchCache.keys().next().value);return result.map(x=>({...x}));
  }
  async function getWeather(city,{force=false}={}){
   if(!validCity(city))throw Error('Выберите корректный город');
   const key=city.latitude.toFixed(4)+','+city.longitude.toFixed(4),saved=cache.get(key),age=saved?now()-saved.updatedAt:Infinity;
   if(saved&&age>=0&&age<(force?30000:ttl))return {...saved,city:city.name};
   if(inflight.has(key))return {...await inflight.get(key),city:city.name};
   const run=(async()=>{
    let failure;
    for(const host of HOSTS){try{const data=await json(host+key+'?format=j1&lang=ru');const value=parseWeather(data,city,now());cache.delete(key);cache.set(key,value);if(cache.size>24)cache.delete(cache.keys().next().value);return value;}catch(error){failure=error;}}
    if(saved&&age>=0&&age<=maxStale)return {...saved,stale:true};
    throw Error('Не удалось загрузить погоду. Проверьте подключение и повторите попытку');
   })();inflight.set(key,run);try{return {...await run,city:city.name};}finally{inflight.delete(key);}
  }
  return {searchCities,getWeather};
 }
 const api={createWeatherClient,parseWeather,daylight};if(typeof module!=='undefined')module.exports=api;else root.EclipseWeather=api;
})(globalThis);

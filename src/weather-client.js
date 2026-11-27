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
 function parseMet(data,city,at=Date.now()){
  const series=data?.properties?.timeseries;if(!Array.isArray(series)||!series.length)throw Error('Неполные данные MET');
  const valid=series.filter(p=>Number.isFinite(Date.parse(p.time))&&Number.isFinite(p.data?.instant?.details?.air_temperature));
  if(!valid.length)throw Error('Неполные данные MET');
  const point=valid.reduce((a,b)=>Math.abs(Date.parse(a.time)-at)<=Math.abs(Date.parse(b.time)-at)?a:b),d=point.data.instant.details;
  const temperature=d.air_temperature,wind=d.wind_speed;
  if(!Number.isFinite(wind)||wind<0||temperature < -100||temperature>70)throw Error('Неполные данные MET');
  const range=valid.filter(p=>Date.parse(p.time)>=at-3600000&&Date.parse(p.time)<=at+86400000).map(p=>p.data.instant.details.air_temperature);if(!range.length)throw Error('Прогноз MET устарел');
  const symbol=(point.data.next_1_hours||point.data.next_6_hours||point.data.next_12_hours)?.summary?.symbol_code||'cloudy';
  let code=3,description='Пасмурно';
  if(symbol.includes('thunder')){code=95;description='Гроза';}else if(symbol.includes('sleet')){code=71;description='Дождь со снегом';}else if(symbol.includes('snow')){code=symbol.includes('heavy')?75:symbol.includes('light')?71:73;description='Снег';}else if(symbol.includes('rain')){code=symbol.includes('heavy')?65:symbol.includes('light')?61:63;description='Дождь';}else if(symbol.includes('fog')){code=45;description='Туман';}else if(symbol.includes('clearsky')){code=0;description='Ясно';}else if(symbol.includes('fair')){code=1;description='Малооблачно';}else if(symbol.includes('partlycloudy')){code=2;description='Облачно с прояснениями';}
  return {city:city.name,temperature,feels:null,wind:Math.round(wind*10)/10,high:Math.max(...range),low:Math.min(...range),code,description,isDay:daylight(city.latitude,city.longitude,at),source:'MET Norway',rangeLabel:'Ближайшие 24 часа',updatedAt:at,stale:false};
 }
 function parseOpenMeteo(data,city,at=Date.now()){
  const c=data?.current,high=data?.daily?.temperature_2m_max?.[0],low=data?.daily?.temperature_2m_min?.[0];
  if(![c?.temperature_2m,c?.apparent_temperature,c?.weather_code,c?.wind_speed_10m,high,low].every(Number.isFinite))throw Error('Неполные данные Open-Meteo');
  return {city:city.name,temperature:c.temperature_2m,feels:c.apparent_temperature,wind:c.wind_speed_10m,high,low,code:c.weather_code,isDay:!!c.is_day,source:'Open-Meteo',updatedAt:at,stale:false};
 }
 function createWeatherClient({cities=[],fetch:request=(...args)=>fetch(...args),now=Date.now,ttl=600000,maxStale=21600000,timeout=7000,providers=['met','openmeteo','wttr'],onCache=()=>{}}={}){
  const cache=new Map(),inflight=new Map(),searchCache=new Map(),catalog=cities.map(c=>({c,n:norm(c.name)}));
  async function json(url,signal,headers={}){const response=await request(url,{signal:signal||AbortSignal.timeout(timeout),headers:{Accept:'application/json',...headers}});if(!response.ok)throw Error('HTTP '+response.status);return {data:await response.json(),expires:Date.parse(response.headers?.get?.('expires')||'')};}
  async function searchCities(query){
   if(typeof query!=='string'||query.trim().length<2||query.length>100)return [];
   let q=norm(query);q=({спб:'санктпетербург',питер:'санктпетербург',moscow:'москва',saintpetersburg:'санктпетербург'})[q]||q;
   const local=catalog.filter(x=>x.n.includes(q));
   if(local.length)return local.sort((a,b)=>(a.n===q?0:a.n.startsWith(q)?1:2)-(b.n===q?0:b.n.startsWith(q)?1:2)).slice(0,6).map(x=>({...x.c}));
   if(searchCache.has(q))return searchCache.get(q).map(x=>({...x}));
   const {data}=await json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query.trim(),count:'6',language:'ru',format:'json'}));
   const result=(Array.isArray(data.results)?data.results:[]).filter(c=>validCity(c)).slice(0,6).map(c=>({name:c.name,country:[c.admin1,c.country].filter(Boolean).join(', '),latitude:c.latitude,longitude:c.longitude}));
   searchCache.set(q,result);if(searchCache.size>32)searchCache.delete(searchCache.keys().next().value);return result.map(x=>({...x}));
  }
  function cacheEntries(){return [...cache].map(([key,entry])=>({key,...entry,value:{...entry.value}}));}
  function loadCache(entries){if(!Array.isArray(entries))return;for(const e of entries.slice(-24)){const coords=typeof e?.key==='string'?e.key.split(',').map(Number):[],v=e?.value;if(coords.length!==2||!validCity({name:v?.city,latitude:coords[0],longitude:coords[1]})||!['MET Norway','Open-Meteo','wttr.in'].includes(v?.source)||![v.temperature,v.wind,v.high,v.low,v.updatedAt].every(Number.isFinite)||now()-v.updatedAt<0||now()-v.updatedAt>maxStale)continue;cache.set(e.key,{value:{...v},expiresAt:Number.isFinite(e.expiresAt)?e.expiresAt:v.updatedAt+ttl});}}
  async function getWeather(city,{force=false}={}){
   if(!validCity(city))throw Error('Выберите корректный город');
   const key=city.latitude.toFixed(4)+','+city.longitude.toFixed(4),saved=cache.get(key),age=saved?now()-saved.value.updatedAt:Infinity;
   if(saved&&age>=0&&(force?age<30000||saved.value.source==='MET Norway'&&now()<saved.expiresAt:now()<saved.expiresAt))return {...saved.value,city:city.name};
   if(inflight.has(key))return {...await inflight.get(key),city:city.name};
   const run=(async()=>{
    const controllers=providers.map(()=>new AbortController()),timeouts=[],errors=[];
    const tasks=providers.map(async(provider,i)=>{
     const controller=controllers[i];timeouts.push(setTimeout(()=>controller.abort(),timeout));
     try{
      let result,value;
      if(provider==='met'){result=await json('https://api.met.no/weatherapi/locationforecast/2.0/compact?'+new URLSearchParams({lat:city.latitude.toFixed(4),lon:city.longitude.toFixed(4)}),controller.signal,{'User-Agent':'EclipseIsland/1.0.7 (https://github.com/koDekArExxx/EclipseIsland)'});value=parseMet(result.data,city,now());}
      else if(provider==='openmeteo'){result=await json('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:city.latitude.toFixed(4),longitude:city.longitude.toFixed(4),current:'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min',timezone:'auto',forecast_days:'1',wind_speed_unit:'ms'}),controller.signal);value=parseOpenMeteo(result.data,city,now());}
      else{for(const host of HOSTS){try{result=await json(host+key+'?format=j1&lang=ru',controller.signal);value=parseWeather(result.data,city,now());break;}catch(error){if(controller.signal.aborted)throw error;}}if(!value)throw Error('wttr недоступен');}
      return {value,expiresAt:Math.max(now()+ttl,Number.isFinite(result.expires)?result.expires:0)};
     }catch(error){errors.push(({'met':'MET Norway','openmeteo':'Open-Meteo','wttr':'wttr.in'}[provider]||provider)+': '+(controller.signal.aborted?'таймаут':/^HTTP \d{3}$/.test(error.message)?error.message:'нет данных'));throw error;}
    });
    try{const entry=await Promise.any(tasks);cache.delete(key);cache.set(key,entry);if(cache.size>24)cache.delete(cache.keys().next().value);try{onCache(cacheEntries());}catch{}return entry.value;}
    catch{if(saved&&age>=0&&age<=maxStale)return {...saved.value,stale:true};throw Error('Погода недоступна ('+errors.join('; ')+'). Проверьте подключение.');}
    finally{timeouts.forEach(clearTimeout);controllers.forEach(c=>c.abort());}
   })();inflight.set(key,run);try{return {...await run,city:city.name};}finally{inflight.delete(key);}
  }
  return {searchCities,getWeather,loadCache,cacheEntries};
 }
 const api={createWeatherClient,parseWeather,parseMet,parseOpenMeteo,daylight};if(typeof module!=='undefined')module.exports=api;else root.EclipseWeather=api;
})(globalThis);

import { DEFAULTS, syncIslandAccent } from './model.js';
export function createBrowserAPI(){
  let settings;try{settings=syncIslandAccent({...DEFAULTS,...JSON.parse(localStorage.getItem('island-settings')||'{}')});}catch{settings={...DEFAULTS};}
  const listeners=new Set();const emit=(type,value)=>listeners.forEach(fn=>fn({type,value}));
  let weather={status:'empty'},generation=0;
  async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Сервис временно недоступен');return r.json();}
  async function refreshWeather(){
    const g=++generation;if(!settings.city){weather={status:'empty'};emit('weather',weather);return weather;}
    weather={...weather,status:'loading'};emit('weather',weather);
    try{
      const c=settings.city;const d=await json('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:c.latitude,longitude:c.longitude,current:'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min',timezone:'auto',forecast_days:'1',wind_speed_unit:'ms'}));
      if(!['temperature_2m','apparent_temperature','weather_code','wind_speed_10m'].every(k=>Number.isFinite(d.current?.[k]))||!Number.isFinite(d.daily?.temperature_2m_max?.[0])||!Number.isFinite(d.daily?.temperature_2m_min?.[0]))throw new Error('Invalid weather data');
      if(g!==generation)return weather;
      weather={status:'ready',city:c.name,temperature:d.current.temperature_2m,feels:d.current.apparent_temperature,code:d.current.weather_code,isDay:!!d.current.is_day,wind:d.current.wind_speed_10m,high:d.daily.temperature_2m_max[0],low:d.daily.temperature_2m_min[0],updatedAt:Date.now()};
    }catch{if(g!==generation)return weather;weather={...weather,status:'error',error:'Нет соединения с сервисом погоды'};}
    emit('weather',weather);return weather;
  }
  return {
    init:async()=>({settings,weather,media:{available:false,reason:'Системная музыка доступна в приложении Windows'},autostart:{supported:false,enabled:false},platform:'browser',version:'1.0.0',shortcuts:{expand:false,visibility:false},monitors:[],downloads:{items:[],recent:[],status:'ready'}}),
    save:async value=>{localStorage.setItem('island-settings',JSON.stringify(value));settings=value;emit('settings',settings);return settings;},
    cities:async query=>{try{const d=await json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:6,language:'ru',format:'json'}));return {ok:true,items:(d.results||[]).map(c=>({name:c.name,country:[c.admin1,c.country].filter(Boolean).join(', '),latitude:c.latitude,longitude:c.longitude}))};}catch{return {ok:false,error:'Нет соединения с сервисом поиска'};}},
    selectCity:async city=>{settings={...settings,city};localStorage.setItem('island-settings',JSON.stringify(settings));emit('settings',settings);return refreshWeather();},
    refreshWeather,
    spotifySetupLog:async()=>({ok:false}),
    launcherProcesses:async()=>({ok:false,error:'Список процессов доступен в Windows'}),focusInput:()=>{},
    launcher:async()=>({ok:false,error:'Быстрый запуск доступен в приложении Windows'}),screenshot:async()=>({ok:false,error:'Скриншоты доступны в приложении Windows'}),toolsSettings:async()=>({ok:false}),screenshotFolder:async()=>({ok:false}),
    ayuFolder:async()=>({ok:false,error:'Доступно в Windows'}),downloads:async()=>({ok:false,error:'Доступно в Windows'}),
    capture:async()=>({ok:false,error:'Запись доступна в приложении Windows'}),
    transfer:async()=>({ok:false,error:'Доступно в Windows'}),activityHeartbeat:()=>{},captureSources:async()=>[],captureSettings:async()=>{throw Error('Настройки записи доступны в Windows');},captureFolder:async()=>{throw Error('Выбор папки доступен в Windows');},
    setupSpotify:async()=>({ok:false,error:'Откройте EclipseIsland в Windows'}),
    mediaDiagnostics:async()=>({ok:false}),
    media:async()=>({ok:false,error:'Откройте приложение EclipseIsland в Windows'}),
    showSettings:()=>{},minimize:()=>{},close:()=>{},quit:()=>{},bounds:()=>{},
    on:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}
  };
}

import './russian-cities.js';
import './weather-client.js';
import { DEFAULTS, syncIslandAccent } from './model.js';
export function createBrowserAPI(){
  let settings;try{settings=syncIslandAccent({...DEFAULTS,...JSON.parse(localStorage.getItem('island-settings')||'{}')});}catch{settings={...DEFAULTS};}
  const listeners=new Set();const emit=(type,value)=>listeners.forEach(fn=>fn({type,value}));
  let weather={status:'empty'},generation=0;const weatherClient=globalThis.EclipseWeather.createWeatherClient({cities:globalThis.EclipseRussianCities});
  async function refreshWeather(force=false){
    const g=++generation;if(!settings.city){weather={status:'empty'};emit('weather',weather);return weather;}
    weather={...weather,status:'loading'};emit('weather',weather);
    try{
      const value=await weatherClient.getWeather(settings.city,{force});if(g!==generation)return weather;
      weather={status:'ready',...value};
    }catch(error){if(g!==generation)return weather;weather={...weather,status:'error',error:error.message||'Нет соединения с сервисом погоды'};}
    emit('weather',weather);return weather;
  }
  return {
    init:async()=>({settings,weather,media:{available:false,reason:'Системная музыка доступна в приложении Windows'},autostart:{supported:false,enabled:false},platform:'browser',version:'1.0.6',shortcuts:{expand:false,visibility:false},monitors:[],downloads:{items:[],recent:[],status:'ready'}}),
    save:async value=>{localStorage.setItem('island-settings',JSON.stringify(value));settings=value;emit('settings',settings);return settings;},
    cities:async query=>{try{return {ok:true,items:await weatherClient.searchCities(query)};}catch{return {ok:false,error:'Нет соединения с сервисом поиска'};}},
    selectCity:async city=>{settings={...settings,city};localStorage.setItem('island-settings',JSON.stringify(settings));emit('settings',settings);return refreshWeather(true);},
    refreshWeather:()=>refreshWeather(true),
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

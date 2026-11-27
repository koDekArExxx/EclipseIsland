const {createWeatherClient}=require('../src/weather-client.js');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
let preferred,file,writes=Promise.resolve();
async function request(url,options){if(preferred){try{return await preferred(url,options);}catch(error){if(options?.signal?.aborted)throw error;}}return fetch(url,options);}
const client=createWeatherClient({cities:require('../src/russian-cities.js'),fetch:request,onCache:entries=>{if(!file)return;const target=file;writes=writes.catch(()=>{}).then(async()=>{await fsp.writeFile(target+'.tmp',JSON.stringify(entries));await fsp.rename(target+'.tmp',target);});writes.catch(()=>{});}});
module.exports={...client,flushWeatherCache:()=>writes,useWeatherFetch(fn){if(typeof fn==='function')preferred=fn;},configureWeatherCache(directory){file=path.join(directory,'weather-cache.json');try{if(fs.statSync(file).size<=1048576)client.loadCache(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}}};

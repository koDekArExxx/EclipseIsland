const {createWeatherClient}=require('../src/weather-client.js');
let request=(...args)=>fetch(...args);
const client=createWeatherClient({cities:require('../src/russian-cities.js'),fetch:(...args)=>request(...args)});
module.exports={...client,useWeatherFetch(fn){if(typeof fn==='function')request=fn;}};

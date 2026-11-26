async function getJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Сервис погоды временно недоступен');
  return response.json();
}
async function searchCities(query) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) return [];
  const data = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({name:query.trim(), count:'6', language:'ru', format:'json'}));
  return (data.results || []).map(c => ({name:c.name, country:[c.admin1,c.country].filter(Boolean).join(', '), latitude:c.latitude, longitude:c.longitude}));
}
async function getWeather(city) {
  const data = await getJSON('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({latitude:String(city.latitude),longitude:String(city.longitude),current:'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min',timezone:'auto',forecast_days:'1',wind_speed_unit:'ms'}));
  if (!['temperature_2m','apparent_temperature','weather_code','wind_speed_10m'].every(k=>Number.isFinite(data.current?.[k])) || !Number.isFinite(data.daily?.temperature_2m_max?.[0]) || !Number.isFinite(data.daily?.temperature_2m_min?.[0])) throw new Error('Сервис вернул неполные данные');
  return {city:city.name, temperature:data.current.temperature_2m, feels:data.current.apparent_temperature, code:data.current.weather_code, isDay:!!data.current.is_day, wind:data.current.wind_speed_10m, high:data.daily?.temperature_2m_max?.[0],low:data.daily?.temperature_2m_min?.[0],updatedAt:Date.now()};
}
module.exports = { searchCities, getWeather };

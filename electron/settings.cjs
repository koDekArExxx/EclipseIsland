const defaults = Object.freeze({
  ...{"advancedTheme":false,"separateIslandAccent":false,"sidebarColor":"#181322","cardColor":"#201a2b","mutedColor":"#a49aaf","lineColor":"#393145","islandSurface":"#120d1d","islandGradient":"#211831","islandText":"#f0ebfa","islandMuted":"#b2a7c0","islandAccent":"#bda2ff","islandBorder":"#665680","glowColor":"#bda2ff","shadowColor":"#000000","buttonColor":"#bda2ff","buttonText":"#21162f","gradientEnabled":true,"gradientAngle":145,"islandOpacity":100,"borderOpacity":45,"borderWidth":1,"shadowStrength":30,"shadowBlur":22,"compactRadius":30,"cardRadius":12},
  enabled: true, topmost: true, hoverExpand: true, sounds: true, reducedMotion: false, autoLaunch: true,
  showSeconds: false, hour12: false, showWeather: true, showMusic: true,  showDownloads:true, downloadSound:true, transferSound:true, completionVolume:45, downloadTone:'soft', transferTone:'chime', transferReplacementVersion:1,showTransfers:true,replaceTransferWindow:true,transferDetails:true,
  
  ayuDownloadFolder: null,
  scale: 100, offset: 18, monitor: 'primary', accent: 'violet', city: null,
  uiRenderer: 'modern', islandRenderer: 'modern', loaderRenderer: 'modern',
  customAccent: '#bda2ff', surfaceColor: '#120d1d', textColor: '#f0ebfa',
  blur: 24, opacity: 78, tint: 15, glow: 15, radius: 28, soundVolume: 28, mediaSource: 'auto'
});
function sanitize(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof defaults[key] === 'boolean' && typeof input[key] === 'boolean') out[key] = input[key];
  }
  for (const [key, min, max] of [['scale', 80, 120], ['offset', 0, 120], ['blur',0,48], ['opacity',35,100], ['tint',0,60], ['glow',0,50], ['radius',20,36], ['soundVolume',0,100], ['completionVolume',0,100], ['gradientAngle',0,360], ['islandOpacity',15,100], ['borderOpacity',0,100], ['borderWidth',0,3], ['shadowStrength',0,75], ['shadowBlur',0,36], ['compactRadius',10,30], ['cardRadius',4,24]]) {
    if (Number.isFinite(input[key])) out[key] = Math.round(Math.min(max, Math.max(min, input[key])));
  }
  for(const key of ['downloadTone','transferTone'])if(['soft','chime','digital'].includes(input[key]))out[key]=input[key];
  if (['mint', 'violet', 'blue', 'peach', 'rose', 'amber', 'custom'].includes(input.accent)) out.accent = input.accent;
  if(typeof input.mediaSource==='string'&&input.mediaSource.length>0&&input.mediaSource.length<=200&&!/[\x00-\x1f]/.test(input.mediaSource))out.mediaSource=input.mediaSource;
  for (const key of ['uiRenderer','islandRenderer','loaderRenderer']) if (['modern','liquid','frosted'].includes(input[key])) out[key] = input[key];
  for (const key of ["customAccent","surfaceColor","textColor","sidebarColor","cardColor","mutedColor","lineColor","islandSurface","islandGradient","islandText","islandMuted","islandAccent","islandBorder","glowColor","shadowColor","buttonColor","buttonText"]) if (typeof input[key] === 'string' && /^#[0-9a-f]{6}$/i.test(input[key])) out[key] = input[key].toLowerCase();
  if (input.monitor === 'primary' || (typeof input.monitor === 'number' && Number.isInteger(input.monitor))) out.monitor = input.monitor;
  if(typeof input.ayuDownloadFolder==='string'&&input.ayuDownloadFolder.length<1024&&require('node:path').isAbsolute(input.ayuDownloadFolder)&&!/[\x00-\x1f]/.test(input.ayuDownloadFolder))out.ayuDownloadFolder=input.ayuDownloadFolder;
  const c = input.city;
  if (c && typeof c.name === 'string' && c.name.length <= 100 && Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 && Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180) {
    out.city = { name: c.name, country: typeof c.country === 'string' ? c.country.slice(0,100) : '', latitude: c.latitude, longitude: c.longitude };
  }
  if(input.transferReplacementVersion!==1){out.showTransfers=true;out.replaceTransferWindow=true;}
  if(!out.separateIslandAccent){
    const palette={mint:'#bcebc5',violet:'#bda2ff',blue:'#b3d6ff',peach:'#f2ccb2',rose:'#f5a1ca',amber:'#efcb7b'};
    const accent=out.accent==='custom'?out.customAccent:palette[out.accent];
    const old=out.islandAccent;
    if(out.glowColor===old)out.glowColor=accent;
    if(out.buttonColor===old)out.buttonColor=accent;
    out.islandAccent=accent;
  }
  return out;
}
function migrateLegacySettings(input){
  const previous=input&&typeof input==='object'?input:{};
  const next=sanitize(previous);
  // Refresh the former default palette, while preserving deliberate custom themes.
  if((!previous.accent||previous.accent==='mint')&&(!previous.surfaceColor||previous.surfaceColor==='#101513')&&(!previous.customAccent||previous.customAccent==='#bcebc5')){
    next.accent=defaults.accent;next.surfaceColor=defaults.surfaceColor;next.textColor=defaults.textColor;next.customAccent=defaults.customAccent;
  }
  return sanitize(next);
}
module.exports = { defaults, sanitize, migrateLegacySettings };

export const STYLE_DEFAULTS={"advancedTheme":false,"separateIslandAccent":false,"sidebarColor":"#181322","cardColor":"#201a2b","mutedColor":"#a49aaf","lineColor":"#393145","islandSurface":"#120d1d","islandGradient":"#211831","islandText":"#f0ebfa","islandMuted":"#b2a7c0","islandAccent":"#bda2ff","islandBorder":"#665680","glowColor":"#bda2ff","shadowColor":"#000000","buttonColor":"#bda2ff","buttonText":"#21162f","gradientEnabled":true,"gradientAngle":145,"islandOpacity":100,"borderOpacity":45,"borderWidth":1,"shadowStrength":30,"shadowBlur":22,"compactRadius":30,"cardRadius":12};
export const DEFAULTS={...STYLE_DEFAULTS,enabled:true,topmost:true,hoverExpand:true,sounds:true,reducedMotion:false,autoLaunch:true,showSeconds:false,hour12:false,showWeather:true,showMusic:true,showDownloads:true,downloadSound:true,transferSound:true,completionVolume:45,downloadTone:'soft',transferTone:'chime',ayuDownloadFolder:null,transferReplacementVersion:1,showTransfers:true,replaceTransferWindow:true,transferDetails:true,scale:100,offset:18,monitor:'primary',accent:'violet',city:null,uiRenderer:'modern',islandRenderer:'modern',loaderRenderer:'modern',customAccent:'#bda2ff',surfaceColor:'#120d1d',textColor:'#f0ebfa',blur:24,opacity:78,tint:15,glow:15,radius:28,soundVolume:28,mediaSource:'auto'};
export const PALETTES={mint:'#bcebc5',violet:'#bda2ff',blue:'#b3d6ff',peach:'#f2ccb2',rose:'#f5a1ca',amber:'#efcb7b'};
// Common accent follows the selected swatch unless explicitly separated.
export function syncIslandAccent(settings){
  if(settings.separateIslandAccent)return settings;
  const accent=settings.accent==='custom'?safeColor(settings.customAccent,PALETTES.violet):PALETTES[settings.accent]||PALETTES.violet;
  const old=settings.islandAccent;
  return {...settings,islandAccent:accent,...(settings.glowColor===old?{glowColor:accent}:{}),...(settings.buttonColor===old?{buttonColor:accent}:{})};
}
export function themePatch(patch){
  if('accent' in patch||'customAccent' in patch)return {...patch,separateIslandAccent:false};
  if('islandAccent' in patch)return {...patch,separateIslandAccent:true};
  return patch;
}
export function contrastRatio(first,second){const luminance=hex=>{const values=safeColor(hex).slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};const a=luminance(first),b=luminance(second);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
export function safeColor(value,fallback='#bcebc5'){return typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value)?value:fallback;}
export function colorRGB(value){const hex=safeColor(value).slice(1);return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');}
export function safeArtwork(value){return typeof value==='string'&&value.length<=3000000&&/^data:image\/(jpeg|png|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(value)?value:null;}
export function mergeMedia(previous,patch,now=Date.now()){
  if(patch.available===false||patch.active===false)return {...(previous.sessions?{sessions:previous.sessions}:{}),...patch,active:false,artwork:null,artworkStatus:'missing',receivedAt:now};
  // A delayed image from the previous track must never replace the new track's cover.
  const artworkOnly=patch.active===undefined&&'artwork' in patch&&!('title' in patch)&&!('artist' in patch);
  if(artworkOnly&&patch.trackKey&&patch.trackKey!==previous.trackKey)return previous;
  const changed=patch.trackKey!==undefined&&patch.trackKey!==previous.trackKey;
  const next={...previous,...(changed?{artwork:null,artworkStatus:'loading',position:0,duration:0,canSeek:false,receivedAt:now}:{}),...patch};
  if('artwork' in patch)next.artwork=safeArtwork(patch.artwork);
  if('position' in patch)next.receivedAt=now;
  return next;
}
export const escapeHTML=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function weatherLabel(code,isDay=true){if(code===0)return isDay?'Ясно':'Ясная ночь';if(code<=3)return 'Облачно';if(code<=48)return 'Туман';if(code>=71&&code<=77||code===85||code===86)return 'Снег';if(code>=95)return 'Гроза';return 'Дождь';}
export function weatherIcon(code,isDay=true){if(code===0)return isDay?'sun':'moon';if(code<=48)return 'cloud';if(code>=71&&code<=77||code===85||code===86)return 'snow';return 'rain';}
export function trackTime(value){const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
export function clockText(settings,date=new Date()){return date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',...(settings.showSeconds?{second:'2-digit'}:{}),hour12:settings.hour12});}


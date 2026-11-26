const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sanitize,defaults}=require('../electron/settings.cjs');
const {migrateLegacySettings}=require('../electron/settings.cjs');
test('untrusted settings cannot bypass bounded geometry or add unknown properties',()=>{
  const value=sanitize({scale:9000,offset:-400,enabled:'true',accent:'red',topmost:false,unknown:'ignored',monitor:'garbage'});
  assert.equal(value.scale,120);assert.equal(value.offset,0);assert.equal(value.enabled,defaults.enabled);assert.equal(value.accent,defaults.accent);assert.equal(value.topmost,false);assert.equal(value.monitor,'primary');assert.equal(value.unknown,undefined);
});
test('invalid geographic coordinates never reach the weather API',()=>{
  for(const city of [{name:'x',latitude:91,longitude:0},{name:'x',latitude:0,longitude:Infinity},{name:'x',latitude:'1',longitude:2}])assert.equal(sanitize({city}).city,null);
  assert.deepEqual(sanitize({city:{name:'Москва',country:'Россия',latitude:55.75,longitude:37.61}}).city,{name:'Москва',country:'Россия',latitude:55.75,longitude:37.61});
});
test('settings survive a save/load round trip',()=>{
  const s=sanitize({showMusic:false,scale:105,monitor:234,accent:'violet',city:{name:'Тула',latitude:54.19,longitude:37.61}});
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(s))),s);
});
test('appearance migrates old settings and rejects arbitrary CSS or renderer strings',()=>{
  assert.equal(sanitize({scale:100}).uiRenderer,'modern');
  const value=sanitize({uiRenderer:'liquid',islandRenderer:'frosted',loaderRenderer:'execute',customAccent:'#123ABC',surfaceColor:'url(https://evil)',textColor:'#ff0000',opacity:-2,blur:999,glow:Infinity,radius:800,accent:'custom'});
  assert.equal(value.uiRenderer,'liquid');assert.equal(value.islandRenderer,'frosted');assert.equal(value.loaderRenderer,'modern');assert.equal(value.customAccent,'#123abc');assert.equal(value.surfaceColor,defaults.surfaceColor);assert.equal(value.opacity,35);assert.equal(value.blur,48);assert.equal(value.glow,defaults.glow);assert.equal(value.radius,36);assert.equal(value.accent,'custom');assert.deepEqual(sanitize(null),defaults);
});
test('EclipseIsland defaults to purple and startup on, with safe migration of old preferences',()=>{
  assert.equal(defaults.autoLaunch,true);assert.equal(defaults.accent,'violet');assert.equal(sanitize({autoLaunch:false,soundVolume:500}).autoLaunch,false);assert.equal(sanitize({soundVolume:500}).soundVolume,100);
  const original={accent:'mint',surfaceColor:'#101513',customAccent:'#bcebc5',city:{name:'Тула',latitude:54,longitude:37},scale:105};
  const migrated=migrateLegacySettings(original);assert.equal(migrated.accent,'violet');assert.equal(migrated.city.name,'Тула');assert.equal(migrated.scale,105);assert.equal(migrated.autoLaunch,true);
  assert.equal(migrateLegacySettings({accent:'custom',customAccent:'#ff0066',surfaceColor:'#181818'}).customAccent,'#ff0066');
});

test('Explorer replacement is enabled once on upgrade, then an explicit opt-out is preserved',()=>{
 const old=sanitize({showTransfers:false,replaceTransferWindow:false});assert.equal(old.showTransfers,true);assert.equal(old.replaceTransferWindow,true);assert.equal(old.transferReplacementVersion,1);
 const off=sanitize({...old,showTransfers:false,replaceTransferWindow:false});assert.equal(off.showTransfers,false);assert.equal(off.replaceTransferWindow,false);
});

test('system window hiding is independent of showing progress and survives saves',()=>{
 const s=sanitize({transferReplacementVersion:1,showTransfers:true,replaceTransferWindow:false});assert.equal(s.showTransfers,true);assert.equal(s.replaceTransferWindow,false);
 const hidden=sanitize({...s,replaceTransferWindow:true});assert.equal(hidden.replaceTransferWindow,true);assert.equal(sanitize({...hidden,showTransfers:false}).replaceTransferWindow,true);
 assert.equal(sanitize({...s,transferDetails:false}).replaceTransferWindow,false);
});

test('removed horizontal position preferences are ignored while original monitor and top offset remain',()=>{
  const value=sanitize({islandPosition:'right',leftOffset:36,rightOffset:90,offset:42,monitor:2});
  for(const key of ['islandPosition','leftOffset','rightOffset']) assert.equal(Object.hasOwn(value,key),false);
  assert.equal(value.offset,42);assert.equal(value.monitor,2);
});

test('advanced color studio persists bounded values and rejects injected CSS',async()=>{
 const s=sanitize({advancedTheme:true,gradientEnabled:false,islandSurface:'#123ABC',islandText:'url(https://evil)',borderWidth:100,borderOpacity:-40,gradientAngle:999,islandOpacity:0,shadowStrength:Infinity,cardRadius:999,compactRadius:-3,buttonText:'#ff00ee'});
 assert.equal(s.advancedTheme,true);assert.equal(s.gradientEnabled,false);assert.equal(s.islandSurface,'#123abc');assert.equal(s.islandText,defaults.islandText);assert.equal(s.borderWidth,3);assert.equal(s.borderOpacity,0);assert.equal(s.gradientAngle,360);assert.equal(s.islandOpacity,15);assert.equal(s.shadowStrength,defaults.shadowStrength);assert.equal(s.cardRadius,24);assert.equal(s.compactRadius,10);assert.equal(s.buttonText,'#ff00ee');
 assert.deepEqual(sanitize(JSON.parse(JSON.stringify(s))),s);
 const model=await import('data:text/javascript;base64,'+Buffer.from(require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/model.js'))).toString('base64'));
 assert.deepEqual(defaults,model.DEFAULTS);
});

test('old independent accent mismatch follows selected common color; explicit separation persists',async()=>{
 const old={advancedTheme:true,accent:'violet',islandAccent:'#81e6b5',glowColor:'#81e6b5',buttonColor:'#81e6b5'};
 const fixed=sanitize(old);assert.equal(fixed.islandAccent,'#bda2ff');assert.equal(fixed.glowColor,'#bda2ff');assert.equal(fixed.buttonColor,'#bda2ff');
 const separate=sanitize({...old,separateIslandAccent:true});assert.equal(separate.islandAccent,'#81e6b5');assert.deepEqual(sanitize(separate),separate);
 assert.equal(sanitize({...old,glowColor:'#ff0000'}).glowColor,'#ff0000');
 const model=await import('data:text/javascript;base64,'+Buffer.from(require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/model.js'))).toString('base64'));
 assert.equal(model.syncIslandAccent({...model.DEFAULTS,...old}).islandAccent,fixed.islandAccent);
 assert.equal(model.themePatch({islandAccent:'#ff0000'}).separateIslandAccent,true);
 assert.equal(model.themePatch({accent:'blue'}).separateIslandAccent,false);
});

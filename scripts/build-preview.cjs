const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../src');
const js=['icons.js','model.js','browser-api.js','audio.js','controls.js','app.js'].map(name=>
  fs.readFileSync(path.join(root,name),'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')+
  (name==='model.js'?'\nconst esc=escapeHTML;const escape=escapeHTML;':'')
).join('\n');
const asset=name=>'data:'+(name.endsWith('.png')?'image/png':'image/svg+xml')+';base64,'+fs.readFileSync(path.join(root,name)).toString('base64');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8').replaceAll('url(wallpaper.svg)',`url("${asset('wallpaper.svg')}")`);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/,'')
  .replace('<link rel="stylesheet" href="styles.css">',`<style>${css}</style>`)
  .replace('href="eclipse-logo.png"',`href="${asset('eclipse-logo.png')}"`)
  .replace('<script type="module" src="app.js"></script>',`<script>${js.replaceAll('src="eclipse-logo.png"',`src="${asset('eclipse-logo.png')}"`)}</script>`);
fs.writeFileSync(path.join(__dirname,'../EclipseIsland-preview.html'),html);
fs.rmSync(path.join(__dirname,'../Island-preview.html'),{force:true});
console.log('Updated EclipseIsland-preview.html');

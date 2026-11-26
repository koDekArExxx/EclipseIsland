const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../src');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
http.createServer((req,res)=>{
  let file;try{file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400).end();return;}
  if(file===root)file=path.join(root,'index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);});
}).listen(4173,'127.0.0.1',()=>console.log('EclipseIsland preview: http://127.0.0.1:4173'));

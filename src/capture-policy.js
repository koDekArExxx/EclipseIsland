(function(root){
 const policy={
  bitrate(config,width,height,fps){if(config.quality==='manual')return config.bitrate*1000000;return Math.round(Math.max(4000000,Math.min(200000000,width*height*fps*.18)));},
  async codecs(candidates,capabilities,video){
   if(!capabilities?.encodingInfo)return candidates.map(mimeType=>({mimeType}));
   const results=await Promise.all(candidates.map(async(mimeType,index)=>{
    let timer;try{const videoType=mimeType.replace(/,(opus|mp4a\.[^,;]+)$/,'');const info=await Promise.race([capabilities.encodingInfo({type:'record',video:{...video,contentType:videoType}}),new Promise(resolve=>timer=setTimeout(()=>resolve(null),600))]);return {mimeType,index,info};}catch{return {mimeType,index};}finally{clearTimeout(timer);}
   }));
   return results.sort((a,b)=>Number(!!b.info?.powerEfficient)-Number(!!a.info?.powerEfficient)||Number(!!b.info?.smooth)-Number(!!a.info?.smooth)||a.index-b.index);
  }
 };if(typeof module!=='undefined')module.exports=policy;else root.capturePolicy=policy;
})(typeof window==='undefined'?globalThis:window);

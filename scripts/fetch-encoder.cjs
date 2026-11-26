const path=require('node:path');
const {ensureEncoder}=require('../electron/encoder-download.cjs');
const {verifyEncoder}=require('../electron/mp4-export.cjs');
const fs=require('node:fs/promises');
(async()=>{
 const folder=path.join(__dirname,'../electron/encoder/win-x64'),file=path.join(folder,'ffmpeg.exe');
 try{await fs.access(file);}catch{console.log('Downloading MP4 component…');await ensureEncoder(file,require('../electron/encoder/win-x64/build.json'));}
 await verifyEncoder(file);console.log('MP4 component ready.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});

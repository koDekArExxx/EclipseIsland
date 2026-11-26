const fs=require('node:fs');
const fsp=require('node:fs/promises');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
function vint(buffer,offset,id=false){if(offset>=buffer.length||!buffer[offset])return null;let width=1,mask=128;while(!(buffer[offset]&mask)&&width<=8){mask>>=1;width++;}if(width>8||offset+width>buffer.length)return null;let value=id?buffer[offset]:buffer[offset]&(mask-1),unknown=!id&&value===mask-1;for(let i=1;i<width;i++){value=value*256+buffer[offset+i];unknown=unknown&&buffer[offset+i]===255;}return {width,value:unknown?Infinity:value};}
function size(value,width){if(!Number.isSafeInteger(value)||value<0||value>=2**(7*width)-1)return null;const out=Buffer.alloc(width);for(let i=width-1;i>=0;i--){out[i]=value%256;value=Math.floor(value/256);}out[0]|=1<<(8-width);return out;}
function element(buffer,offset){const id=vint(buffer,offset,true);if(!id)return null;const length=vint(buffer,offset+id.width);if(!length)return null;return {id:id.value,size:length.value,sizeAt:offset+id.width,width:length.width,start:offset+id.width+length.width,end:offset+id.width+length.width+length.value};}
// Chromium MediaRecorder emits an unindexed, unknown-sized Segment without a
// Duration element. Add just Duration to Info, keeping clusters streaming. Never
// adjust files with SeekHead offsets; no entire recording is loaded into RAM.
function plan(buffer,milliseconds){let offset=0,segment;while(offset<buffer.length){const e=element(buffer,offset);if(!e)return null;if(e.id===0x18538067){segment=e;break;}if(!Number.isFinite(e.end))return null;offset=e.end;}if(!segment)return null;let info,seekHead=false;offset=segment.start;while(offset<buffer.length){const e=element(buffer,offset);if(!e)break;if(e.id===0x1f43b675)break;if(e.id===0x114d9b74)seekHead=true;if(e.id===0x1549a966)info=e;if(!Number.isFinite(e.end))break;offset=e.end;}if(!info||info.end>buffer.length)return null;
 let scale=1000000,duration;offset=info.start;while(offset<info.end){const e=element(buffer,offset);if(!e||e.end>info.end)return null;if(e.id===0x2ad7b1){scale=0;for(const byte of buffer.subarray(e.start,e.end))scale=scale*256+byte;}if(e.id===0x4489)duration=e;offset=e.end;}
 const value=milliseconds*1000000/scale;if(!Number.isFinite(value)||value<=0)return null;
 if(duration&&(duration.size===8||duration.size===4)){const bytes=Buffer.alloc(duration.size);if(duration.size===8)bytes.writeDoubleBE(value);else bytes.writeFloatBE(value);return {patchAt:duration.start,patch:bytes};}
 if(seekHead)return null;const encoded=size(info.size+11,info.width);if(!encoded)return null;const prefix=Buffer.from(buffer);
 if(Number.isFinite(segment.size)){const encodedSegment=size(segment.size+11,segment.width);if(!encodedSegment)return null;encodedSegment.copy(prefix,segment.sizeAt);}
 const added=Buffer.alloc(11);added[0]=0x44;added[1]=0x89;added[2]=0x88;added.writeDoubleBE(value,3);
 return {prefix:Buffer.concat([prefix.subarray(0,info.sizeAt),encoded,prefix.subarray(info.start,info.end),added,prefix.subarray(info.end)])};
}
async function fixDuration(file,seconds){if(!Number.isFinite(seconds)||seconds<=0)return false;const handle=await fsp.open(file,'r+');let count,change;try{const prefix=Buffer.alloc(65536);count=(await handle.read(prefix,0,prefix.length,0)).bytesRead;change=plan(prefix.subarray(0,count),seconds*1000);if(!change)return false;if(change.patch){await handle.write(change.patch,0,change.patch.length,change.patchAt);return true;}}finally{await handle.close();}
 const temporary=file+'.indexing';try{async function* chunks(){yield change.prefix;for await(const chunk of fs.createReadStream(file,{start:count}))yield chunk;}await pipeline(Readable.from(chunks()),fs.createWriteStream(temporary,{flags:'wx'}));await fsp.rename(temporary,file);return true;}catch(error){await fsp.unlink(temporary).catch(()=>{});return false;}}
module.exports={fixDuration,plan};

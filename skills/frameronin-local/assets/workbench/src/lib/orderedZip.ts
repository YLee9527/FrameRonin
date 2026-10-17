import type JSZip from 'jszip'
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
/** Inspect central-directory sizes before any ZIP member is inflated. */
export function inspectOrderedZip(bytes:ArrayBuffer,budget:number,expectedName:(index:number)=>string){
 if(!integer(budget,1,2*1024**3)||bytes.byteLength<22||bytes.byteLength>128*1024**2)throw new Error('CUSTOM_ARCHIVE_LIMIT')
 const view=new DataView(bytes);let end=-1
 for(let at=bytes.byteLength-22;at>=Math.max(0,bytes.byteLength-65557);at--)if(view.getUint32(at,true)===0x06054b50&&at+22+view.getUint16(at+20,true)===bytes.byteLength){end=at;break}
 if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new Error('CUSTOM_ARCHIVE_UNSUPPORTED')
 const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),size=view.getUint32(end+12,true)
 if(count<1||count>4096||view.getUint16(end+8,true)!==count||start+size!==end)throw new Error('CUSTOM_ARCHIVE_LIMIT')
 const names:string[]=[];let at=start,encodedBytes=0
 for(let index=0;index<count;index++){
  if(at+46>end||view.getUint32(at,true)!==0x02014b50)throw new Error('CUSTOM_ARCHIVE_INVALID')
  const len=view.getUint16(at+28,true),next=at+46+len+view.getUint16(at+30,true)+view.getUint16(at+32,true)
  if(next>end||view.getUint16(at+8,true)&1||![0,8].includes(view.getUint16(at+10,true))||![0,0x8000].includes((view.getUint32(at+38,true)>>>16)&0xf000)||view.getUint32(at+42,true)>=start)throw new Error('CUSTOM_ARCHIVE_ENTRY')
  const name=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,at+46,len))
  if(name!==expectedName(index))throw new Error('CUSTOM_ARCHIVE_NAMES')
  encodedBytes+=view.getUint32(at+24,true)
  if(encodedBytes>Math.min(128*1024**2,budget/8)||view.getUint32(at+20,true)===0xffffffff)throw new Error('CUSTOM_ARCHIVE_LIMIT')
  names.push(name);at=next
 }
 if(at!==end)throw new Error('CUSTOM_ARCHIVE_INVALID')
 return {names,encodedBytes}
}

/** Bound actual inflation as well as declared central-directory sizes. */
export function boundedZipBlob(entry:JSZip.JSZipObject,limit:number):Promise<Blob>{
 if(!integer(limit,1,128*1024**2))return Promise.reject(new Error('ZIP_INFLATION_LIMIT'))
 // JSZip 3.10.1 exposes this stream in zipObject.js but omits its declaration.
 // Keep the adapter explicit and block unsupported versions before accumulation.
 const readable=entry as JSZip.JSZipObject&{internalStream(type:'uint8array'):JSZip.JSZipStreamHelper<Uint8Array>}
 if(typeof readable.internalStream!=='function')return Promise.reject(new Error('ZIP_STREAM_UNAVAILABLE'))
 return new Promise((resolve,reject)=>{
  const stream=readable.internalStream('uint8array'),chunks:ArrayBuffer[]=[];let total=0,done=false
  const fail=(error:unknown)=>{if(done)return;done=true;stream.pause();chunks.length=0;reject(error)}
  stream.on('data',chunk=>{
   if(done)return;total+=chunk.byteLength
   if(total>limit){fail(new Error('ZIP_INFLATION_LIMIT'));return}
   chunks.push(Uint8Array.from(chunk).buffer)
  }).on('error',fail).on('end',()=>{if(!done){done=true;resolve(new Blob(chunks))}}).resume()
 })
}

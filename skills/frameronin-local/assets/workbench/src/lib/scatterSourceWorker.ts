export type ScatterSource={file:File;bitmap:ImageBitmap;width:number;height:number;color:number[]}
export function scatterSourceWorker(file:File,budgetBytes:number,frontendBytes:number,signal:AbortSignal):Promise<ScatterSource>{
 signal.throwIfAborted()
 const id=crypto.randomUUID(),generation=0,worker=new Worker(new URL('./scatterSlice.worker.ts',import.meta.url),{type:'module'})
 return new Promise((resolve,reject)=>{
  let settled=false
  const finish=(error:unknown,result?:ScatterSource)=>{if(settled){result?.bitmap.close();return};settled=true;signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!)}
  const abort=()=>finish(new DOMException('Source preview canceled','AbortError'));signal.addEventListener('abort',abort,{once:true})
  worker.onerror=event=>finish(new Error(event.message||'SCATTER_SOURCE_WORKER_FAILED'))
  worker.onmessage=event=>{
   const value=event.data
   if(value.id!==id||value.generation!==generation){value.bitmap?.close?.();return}
   if(value.error){finish(new Error(value.error));return}
   if(value.bitmap instanceof ImageBitmap&&[value.width,value.height].every(v=>Number.isSafeInteger(v)&&v>=1&&v<=30000)&&value.bitmap.width>=1&&value.bitmap.height>=1&&value.bitmap.width<=1024&&value.bitmap.height<=1024&&Array.isArray(value.color)&&value.color.length===4&&value.color.every((v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=255))finish(null,{file,bitmap:value.bitmap,width:value.width,height:value.height,color:value.color})
   else{value.bitmap?.close?.();finish(new Error('SCATTER_SOURCE_RESPONSE_INVALID'))}
  }
  worker.postMessage({id,generation,file,budgetBytes,parameters:{frontendBytes},operation:'image.scatterDetect',action:'preview'})
 })
}

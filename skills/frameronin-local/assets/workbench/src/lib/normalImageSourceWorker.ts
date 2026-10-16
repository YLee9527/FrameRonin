export type NormalSourceResult={bitmap?:ImageBitmap;width?:number;height?:number;color?:number[]}
export function runNormalSourceWorker(file:File,action:'preview'|'sample',budgetBytes:number,retainedBytes:number,signal:AbortSignal,x?:number,y?:number):Promise<NormalSourceResult>{
  signal.throwIfAborted()
  const id=crypto.randomUUID(),generation=0,worker=new Worker(new URL('./normalImage.worker.ts',import.meta.url),{type:'module'})
  return new Promise((resolve,reject)=>{
    let settled=false
    const finish=(error:unknown,result?:NormalSourceResult)=>{
      if(settled){result?.bitmap?.close();return}
      settled=true;signal.removeEventListener('abort',abort);worker.terminate()
      if(error)reject(error);else resolve(result!)
    }
    const abort=()=>finish(new DOMException('Source preview canceled','AbortError'))
    signal.addEventListener('abort',abort,{once:true})
    worker.onerror=event=>finish(new Error(event.message||'NORMAL_SOURCE_WORKER_FAILED'))
    worker.onmessage=event=>{
      const value=event.data
      if(value.id!==id||value.generation!==generation){value.bitmap?.close?.();return}
      if(value.error){finish(new Error(value.error));return}
      if(action==='preview'&&value.bitmap instanceof ImageBitmap&&Number.isSafeInteger(value.width)&&Number.isSafeInteger(value.height)&&value.width>0&&value.height>0&&value.width<=30000&&value.height<=30000&&value.bitmap.width>0&&value.bitmap.height>0&&value.bitmap.width<=1024&&value.bitmap.height<=1024)finish(null,{bitmap:value.bitmap,width:value.width,height:value.height})
      else if(action==='sample'&&Array.isArray(value.color)&&value.color.length===4&&value.color.every((v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=255))finish(null,{color:value.color})
      else{value.bitmap?.close?.();finish(new Error('NORMAL_SOURCE_RESPONSE_INVALID'))}
    }
    worker.postMessage({id,generation,file,action,budgetBytes,retainedBytes,x,y})
  })
}

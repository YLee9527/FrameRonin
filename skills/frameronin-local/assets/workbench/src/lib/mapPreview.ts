import type { MapFeather } from '../localProject/mapDocument'
export function mapFeatherPreview(file:Blob,width:number,height:number,feather:MapFeather,budgetBytes:number,signal:AbortSignal):Promise<Blob>{
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./mapPreview.worker.ts',import.meta.url),{type:'module'})
    let finished=false
    const finish=(error?:Error,blob?:Blob)=>{
      if(finished)return
      finished=true;worker.terminate();clearTimeout(timer);signal.removeEventListener('abort',abort)
      if(error)reject(error);else resolve(blob!)
    }
    const abort=()=>finish(new DOMException('Preview canceled','AbortError'))
    const timer=setTimeout(()=>finish(new Error('MAP_PREVIEW_TIMEOUT')),300000)
    signal.addEventListener('abort',abort,{once:true})
    worker.onerror=event=>finish(new Error(event.message))
    worker.onmessage=event=>{
      if(signal.aborted){abort();return}
      const {ok,error,blob}=event.data
      if(!ok||!(blob instanceof Blob))finish(new Error(error??'MAP_PREVIEW_RESULT_INVALID'));else finish(undefined,blob)
    }
    worker.postMessage({file,width,height,feather,budgetBytes})
  })
}

import { jsonPost, localJson } from './api'

type Ready={ready:boolean;generation?:number;state?:string}
/** Runs beyond its component's lifetime. The existing queue owns publication;
 * this Worker supplies only a PNG, never paths, task state or version IDs. */
export async function browserCanvasTask(id:string,file:Blob,parameters:object,signal:AbortSignal,onStarted?:()=>void,options:{operation:string;budgetBytes:number}={operation:'image.customScale',budgetBytes:0}){
  let worker:Worker|null=null,timer:ReturnType<typeof setInterval>|null=null,generation:number|undefined
  let heartbeatFailure:((reason:unknown)=>void)|null=null
  const stop=()=>worker?.terminate()
  signal.addEventListener('abort',stop,{once:true})
  try{
    let response:Ready={ready:false}
    while(!response.ready){
      signal.throwIfAborted()
      response=await localJson<Ready>(`/api/tasks/${id}/browser`,{signal})
      if(!response.ready){
        if(response.state&&!['queued','running'].includes(response.state))throw new DOMException('Task stopped','AbortError')
        await new Promise(resolve=>window.setTimeout(resolve,100))
      }
    }
    generation=response.generation
    if(!Number.isInteger(generation))throw new Error('BROWSER_GENERATION_INVALID')
    const heartbeat=()=>localJson(`/api/tasks/${id}/browser/heartbeat`,{...jsonPost({generation}),signal})
    await heartbeat()
    timer=setInterval(()=>{void heartbeat().catch(error=>{stop();heartbeatFailure?.(error)})},1000)
    worker=options.operation==='image.expandShrink'?new Worker(new URL('../lib/expandShrink.worker.ts',import.meta.url),{type:'module'}):
      options.operation==='image.normal'?new Worker(new URL('../lib/normalImage.worker.ts',import.meta.url),{type:'module'}):
      new Worker(new URL('../lib/smoothResize.worker.ts',import.meta.url),{type:'module'})
    const blob=await new Promise<Blob>((resolve,reject)=>{
      heartbeatFailure=reject
      signal.addEventListener('abort',()=>reject(new DOMException('Task canceled','AbortError')),{once:true})
      worker!.onerror=event=>reject(new Error(event.message||'BROWSER_WORKER_FAILED'))
      worker!.onmessage=event=>{
        if(event.data.id!==id||event.data.generation!==generation)return
        if(event.data.phase==='processing'){onStarted?.();return}
        if(event.data.error)reject(new Error(event.data.error))
        else if(event.data.blob instanceof Blob)resolve(event.data.blob)
        else reject(new Error('BROWSER_OUTPUT_INVALID'))
      }
      worker!.postMessage({id,generation,file,parameters,budgetBytes:options.budgetBytes})
    })
    signal.throwIfAborted()
    const form=new FormData();form.append('generation',String(generation));form.append('file',blob,'worker-result.png')
    await localJson(`/api/tasks/${id}/browser/result`,{method:'POST',body:form,signal})
  }catch(error){
    if(!signal.aborted&&generation!==undefined)await localJson(`/api/tasks/${id}/browser/failure`,jsonPost({generation}))
    throw error
  }finally{if(timer)clearInterval(timer);stop();signal.removeEventListener('abort',stop)}
}

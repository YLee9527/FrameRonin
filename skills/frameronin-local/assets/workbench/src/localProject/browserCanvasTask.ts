import { jsonPost, localFetch, localJson } from './api'
import {captureSelectedVideo} from '../lib/browserVideoCapture'
import type {VideoCaptureLayout} from '../lib/videoCapture'
import {runFineEditorWorker} from '../lib/fineEditorWorker'

type Ready={ready:boolean;generation?:number;state?:string}
/** Runs beyond its component's lifetime. The existing queue owns publication;
 * this Worker supplies only encoded content, never paths, task state or version IDs. */
export async function browserCanvasTask(id:string,file:Blob,parameters:object,signal:AbortSignal,onStarted?:()=>void,options:{operation:string;budgetBytes:number;files?:Blob[];source?:{width?:number;height?:number;bytes?:number};onProgress?:(progress:number)=>void}={operation:'image.customScale',budgetBytes:0}){
  let worker:Worker|null=null,timer:ReturnType<typeof setInterval>|null=null,generation:number|undefined
  let captureController:AbortController|null=null
  let heartbeatFailure:((reason:unknown)=>void)|null=null
  const stop=()=>{worker?.terminate();captureController?.abort()}
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
    let blob:Blob
    if(options.operation==='video.capture'){
      const source=options.source,p=parameters as {layout:VideoCaptureLayout;frontendBytes:number}
      if(!source||!Number.isSafeInteger(source.width)||!Number.isSafeInteger(source.height)||!Number.isSafeInteger(source.bytes))throw new Error('VIDEO_SOURCE_METADATA_REQUIRED')
      captureController=new AbortController();if(signal.aborted)captureController.abort();onStarted?.()
      // Decode the hash-checked project copy, rather than relying on continued
      // availability of the original user-selected operating-system File.
      const response=await localFetch(`/api/tasks/${id}/browser/input?generation=${generation}`,{signal:captureController.signal})
      if(!response.ok)throw new Error('VIDEO_SOURCE_VERSION_UNREADABLE')
      const selected=await response.blob();if(selected.size!==source.bytes)throw new Error('VIDEO_SOURCE_VERSION_CHANGED')
      blob=await captureSelectedVideo(selected,p.layout,{budget:options.budgetBytes,frontendBytes:p.frontendBytes,physical:{width:source.width!,height:source.height!}},captureController.signal,{id,generation:generation!},p=>options.onProgress?.(.2+.6*p))
    }else if(options.operation==='image.flowNormalize'){
      const p=parameters as {width:number;height:number;frontendBytes:number}
      captureController=new AbortController();if(signal.aborted)captureController.abort();onStarted?.()
      const decoded=await runFineEditorWorker({action:'decode',file,budget:options.budgetBytes,retained:p.frontendBytes},captureController.signal,generation!)
      if(decoded.width!==p.width||decoded.height!==p.height||!decoded.pixels)throw new Error('FLOW_DECODE_DIMENSIONS')
      // Move the buffer directly to the encoder Worker. The main thread does
      // not inspect, copy or iterate the full-resolution raster.
      const encoded=await runFineEditorWorker({action:'encode',width:decoded.width,height:decoded.height,pixels:decoded.pixels,budget:options.budgetBytes,retained:p.frontendBytes},captureController.signal,generation!)
      if(!encoded.blob)throw new Error('FLOW_DECODE_OUTPUT');blob=encoded.blob
    }else{
    worker=options.operation==='video.frameTools'?new Worker(new URL('../lib/videoFrames.worker.ts',import.meta.url),{type:'module'}):
      options.operation==='image.matteTool'?new Worker(new URL('../lib/matteTool.worker.ts',import.meta.url),{type:'module'}):
      ['image.sheetPreprocess','image.sheetPrepare'].includes(options.operation)?new Worker(new URL('../lib/sheetPrepare.worker.ts',import.meta.url),{type:'module'}):
      ['image.sheetCompose','image.sheetGif','image.sheetFix','image.sheetFrames'].includes(options.operation)?new Worker(new URL('../lib/sheetAdjust.worker.ts',import.meta.url),{type:'module'}):
      options.operation==='image.spriteGifs'?new Worker(new URL('../lib/spriteGifRows.worker.ts',import.meta.url),{type:'module'}):
      options.operation==='image.visibleWatermark'?new Worker(new URL('../lib/geminiWatermark.worker.ts',import.meta.url),{type:'module'}):
      ['image.customSlicePlan','image.customSlice','image.customCompose'].includes(options.operation)?new Worker(new URL('../lib/customSlice.worker.ts',import.meta.url),{type:'module'}):
      options.operation.startsWith('image.scatter')?new Worker(new URL('../lib/scatterSlice.worker.ts',import.meta.url),{type:'module'}):
      options.operation==='image.expandShrink'?new Worker(new URL('../lib/expandShrink.worker.ts',import.meta.url),{type:'module'}):
      options.operation==='image.normal'?new Worker(new URL('../lib/normalImage.worker.ts',import.meta.url),{type:'module'}):
      new Worker(new URL('../lib/smoothResize.worker.ts',import.meta.url),{type:'module'})
    blob=await new Promise<Blob>((resolve,reject)=>{
      heartbeatFailure=reject
      signal.addEventListener('abort',()=>reject(new DOMException('Task canceled','AbortError')),{once:true})
      worker!.onerror=event=>reject(new Error(event.message||'BROWSER_WORKER_FAILED'))
      worker!.onmessage=event=>{
        if(event.data.id!==id||event.data.generation!==generation)return
        if(event.data.phase==='processing'){onStarted?.();return}
        if(event.data.phase==='progress'){
          if(typeof event.data.progress!=='number'||!Number.isFinite(event.data.progress)||event.data.progress<0||event.data.progress>1){reject(new Error('BROWSER_PROGRESS_INVALID'));return}
          options.onProgress?.(.2+.6*event.data.progress);return
        }
        if(event.data.error)reject(new Error(event.data.error))
        else if(event.data.blob instanceof Blob)resolve(event.data.blob)
        else reject(new Error('BROWSER_OUTPUT_INVALID'))
      }
      worker!.postMessage({id,generation,file,files:options.files,parameters,budgetBytes:options.budgetBytes,operation:options.operation})
    })
    }
    signal.throwIfAborted()
    const form=new FormData();form.append('generation',String(generation));form.append('file',blob,'worker-result.png')
    await localJson(`/api/tasks/${id}/browser/result`,{method:'POST',body:form,signal})
  }catch(error){
    if(!signal.aborted&&generation!==undefined)await localJson(`/api/tasks/${id}/browser/failure`,jsonPost({generation}))
    throw error
  }finally{if(timer)clearInterval(timer);stop();signal.removeEventListener('abort',stop)}
}

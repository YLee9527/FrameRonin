import type {FineEditorRequest,FineEditorResult} from './fineEditor.worker'

/** One owned operation per disposable Worker. Cancellation invalidates before terminate. */
export function runFineEditorWorker(request:FineEditorRequest,signal:AbortSignal,generation:number):Promise<FineEditorResult>{
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),worker=new Worker(new URL('./fineEditor.worker.ts',import.meta.url),{type:'module'})
    let settled=false
    const finish=(error?:Error,result?:FineEditorResult)=>{
      if(settled)return
      settled=true;worker.terminate();clearTimeout(timer);signal.removeEventListener('abort',abort)
      if(error)reject(error);else resolve(result!)
    }
    const abort=()=>finish(new DOMException('Editing task canceled','AbortError'))
    const timer=setTimeout(()=>finish(new Error('FINE_EDITOR_TIMEOUT')),300000)
    signal.addEventListener('abort',abort,{once:true})
    worker.onerror=event=>finish(new Error(event.message||'FINE_EDITOR_WORKER_FAILED'))
    worker.onmessage=event=>{
      if(signal.aborted){abort();return}
      if(event.data.id!==id||event.data.generation!==generation)return
      if(event.data.error)finish(new Error(event.data.error));else finish(undefined,event.data.result)
    }
    worker.postMessage({...request,id,generation},request.action==='decode'?[]:[request.pixels.buffer])
  })
}

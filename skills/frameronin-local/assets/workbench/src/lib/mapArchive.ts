export function runMapArchive<T>(request:object,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./mapArchive.worker.ts',import.meta.url),{type:'module'})
    let finished=false
    const finish=(error?:Error,result?:T)=>{
      if(finished)return
      finished=true;worker.terminate();clearTimeout(timer);signal.removeEventListener('abort',abort)
      if(error)reject(error);else resolve(result!)
    }
    const abort=()=>finish(new DOMException('Archive canceled','AbortError'))
    const timer=setTimeout(()=>finish(new Error('MAP_ARCHIVE_TIMEOUT')),300000)
    signal.addEventListener('abort',abort,{once:true})
    worker.onerror=event=>finish(new Error(event.message))
    worker.onmessage=event=>{
      if(signal.aborted){abort();return}
      if(!event.data.ok)finish(new Error(event.data.error));else finish(undefined,event.data.result)
    }
    worker.postMessage(request)
  })
}

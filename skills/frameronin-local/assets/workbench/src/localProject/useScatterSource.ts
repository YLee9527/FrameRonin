import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {scatterSourceWorker,type ScatterSource} from '../lib/scatterSourceWorker'
import {localJson} from './api'

export function useScatterSource(file:File|null,retainedBytes:()=>number){
 const slot=useRef<ScatterSource|null>(null),controller=useRef<AbortController|null>(null),alive=useRef(true),retained=useRef(retainedBytes)
 useLayoutEffect(()=>{retained.current=retainedBytes},[retainedBytes])
 const [raster,setRaster]=useState<ScatterSource|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0)
 const accept=useCallback((next:ScatterSource)=>{
  controller.current?.abort();slot.current?.bitmap.close();slot.current=next
  if(alive.current){setRaster(next);setLoading(false);setError('')}
 },[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();slot.current?.bitmap.close();slot.current=null}},[])
 useEffect(()=>{
  if(slot.current?.file===file)return
  slot.current?.bitmap.close();slot.current=null
  const abort=new AbortController();controller.current=abort
  void(async()=>{
   await Promise.resolve();if(!alive.current||abort.signal.aborted)return
   setRaster(null);setError('')
   if(!file){setLoading(false);return}
   setLoading(true)
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const next=await scatterSourceWorker(file,memoryBudgetBytes,retained.current(),abort.signal)
   if(!alive.current||abort.signal.aborted){next.bitmap.close();return}
   // accept aborts the completed request only after the result is owned here.
   accept(next)
  })().catch(error=>{if(alive.current&&!abort.signal.aborted)setError(String(error))}).finally(()=>{if(alive.current&&controller.current===abort)setLoading(false)})
  return()=>abort.abort()
 },[file,retry,accept])
 const cancel=useCallback(()=>{controller.current?.abort();setLoading(false);setError('SCATTER_PREVIEW_CANCELED')},[])
 return {raster:raster?.file===file?raster:null,error,loading,accept,cancel,retry:()=>setRetry(value=>value+1)}
}

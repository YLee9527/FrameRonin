import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {videoAssets,type VideoAssetRequest,type VideoAssetResult} from '../lib/videoAssets'
import {localJson} from './api'
const EMPTY:VideoAssetResult={files:[],previews:[],color:null}
export function useVideoAssets(request:VideoAssetRequest|null,retained:()=>number){
 const alive=useRef(true),controller=useRef<AbortController|null>(null),retainedRef=useRef(retained)
 useLayoutEffect(()=>{retainedRef.current=retained},[retained])
 const [slot,setSlot]=useState<{request:VideoAssetRequest;value:VideoAssetResult}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort()}},[])
 useEffect(()=>{
  const abort=new AbortController();controller.current=abort
  void(async()=>{await Promise.resolve();if(!alive.current||abort.signal.aborted)return
   setSlot(null);setError('');setLoading(!!request);if(!request)return
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const value=await videoAssets(request,memoryBudgetBytes,retainedRef.current(),abort.signal)
   if(alive.current&&!abort.signal.aborted)setSlot({request,value})
  })().catch(e=>{if(alive.current&&!abort.signal.aborted)setError(String(e))}).finally(()=>{if(alive.current&&controller.current===abort)setLoading(false)})
  return()=>abort.abort()
 },[request,attempt])
 return {value:slot?.request===request?slot.value:EMPTY,loading,error,stop:()=>controller.current?.abort(),cancel:()=>{controller.current?.abort();setLoading(false);setError('VIDEO_PREVIEW_CANCELED')},retry:()=>setAttempt(v=>v+1)}
}

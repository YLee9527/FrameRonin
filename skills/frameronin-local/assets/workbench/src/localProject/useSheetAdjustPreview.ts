import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {sheetAdjustPreview,type SheetPreviewRequest} from '../lib/sheetAdjustPreview'
import {localJson} from './api'
const EMPTY:Blob[]=[]
export function useSheetAdjustPreview(request:SheetPreviewRequest|null,retained:()=>number){
 const alive=useRef(true),controller=useRef<AbortController|null>(null),retainedRef=useRef(retained)
 useLayoutEffect(()=>{retainedRef.current=retained},[retained])
 const [slot,setSlot]=useState<{request:SheetPreviewRequest;files:Blob[]}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort()}},[])
 useEffect(()=>{
  const abort=new AbortController();controller.current=abort
  void(async()=>{
   await Promise.resolve();if(!alive.current||abort.signal.aborted)return
   setSlot(null);setError('');setLoading(!!request);if(!request)return
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const result=await sheetAdjustPreview(request,memoryBudgetBytes,retainedRef.current(),abort.signal)
   if(alive.current&&!abort.signal.aborted)setSlot({request,files:result.previews})
  })().catch(e=>{if(alive.current&&!abort.signal.aborted)setError(String(e))}).finally(()=>{if(alive.current&&controller.current===abort)setLoading(false)})
  return()=>abort.abort()
 },[request,attempt])
 return {files:slot?.request===request?slot.files:EMPTY,error,loading,cancel:()=>{controller.current?.abort();setLoading(false);setError('SHEET_PREVIEW_CANCELED')},retry:()=>setAttempt(v=>v+1)}
}

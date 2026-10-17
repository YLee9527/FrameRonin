import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {spriteSheetAssets,type SpriteAssetRequest,type SpriteAssetResult} from '../lib/spriteSheetAssets'
import {localJson} from './api'
const EMPTY:SpriteAssetResult={files:[],previews:[]}
export function useSpriteSheetAssets(request:SpriteAssetRequest|null,retained:()=>number){
 const alive=useRef(true),controller=useRef<AbortController|null>(null),retainedRef=useRef(retained)
 useLayoutEffect(()=>{retainedRef.current=retained},[retained])
 const [slot,setSlot]=useState<{request:SpriteAssetRequest;value:SpriteAssetResult}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort()}},[])
 useEffect(()=>{
  const abort=new AbortController();controller.current=abort
  void(async()=>{
   await Promise.resolve();if(!alive.current||abort.signal.aborted)return
   setSlot(null);setError('');setLoading(!!request);if(!request)return
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const value=await spriteSheetAssets(request,memoryBudgetBytes,retainedRef.current(),abort.signal)
   if(alive.current&&!abort.signal.aborted)setSlot({request,value})
  })().catch(e=>{if(alive.current&&!abort.signal.aborted)setError(String(e))}).finally(()=>{if(alive.current&&controller.current===abort)setLoading(false)})
  return()=>abort.abort()
 },[request,attempt])
 return {value:slot?.request===request?slot.value:EMPTY,loading,error,cancel:()=>{controller.current?.abort();setLoading(false);setError('SPRITE_PREVIEW_CANCELED')},retry:()=>setAttempt(v=>v+1)}
}
export function useSpriteBlobUrls(files:Blob[]){
 const [slot,setSlot]=useState<{files:Blob[];urls:string[]}|null>(null)
 useEffect(()=>{
  let alive=true;const urls=files.map(f=>URL.createObjectURL(f));void Promise.resolve().then(()=>{if(alive)setSlot({files,urls})})
  return()=>{alive=false;urls.forEach(URL.revokeObjectURL)}
 },[files])
 return slot?.files===files?slot.urls:[]
}

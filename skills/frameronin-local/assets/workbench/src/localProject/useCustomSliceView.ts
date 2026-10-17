import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {customSliceAssetWorker,type CustomAsset} from '../lib/customSliceAssetWorker'
import {localJson} from './api'
type View={file:File;raw:string;preview:string;width:number;height:number;frames:string[];thumbnails:string[];sizes:{w:number;h:number}[];bytes:number;urls:string[]}
export function useCustomSliceView(file:File|null,kind:'source'|'archive',retained:()=>number){
 const alive=useRef(true),slot=useRef<View|null>(null),controller=useRef<AbortController|null>(null),retainedRef=useRef(retained)
 useLayoutEffect(()=>{retainedRef.current=retained},[retained])
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0)
 const accept=useCallback((file:File,asset:CustomAsset)=>{
  controller.current?.abort();slot.current?.urls.forEach(URL.revokeObjectURL)
  const urls:string[]=[],url=(blob:Blob)=>{const u=URL.createObjectURL(blob);urls.push(u);return u}
  const next:View={file,raw:url(file),preview:asset.kind==='source'?url(asset.preview):'',width:asset.kind==='source'?asset.width:0,height:asset.kind==='source'?asset.height:0,frames:asset.kind==='archive'?asset.files.map(url):[],thumbnails:asset.kind==='archive'?asset.previews.map(url):[],sizes:asset.kind==='archive'?asset.sizes:[],bytes:asset.kind==='source'?asset.preview.size*2:asset.files.reduce((s,f)=>s+f.size*2,0)+asset.previews.reduce((s,f)=>s+f.size*2,0),urls}
  slot.current=next;if(alive.current){setView(next);setError('');setLoading(false)}
 },[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();slot.current?.urls.forEach(URL.revokeObjectURL);slot.current=null}},[])
 useEffect(()=>{
  if(slot.current?.file===file)return
  slot.current?.urls.forEach(URL.revokeObjectURL);slot.current=null
  const abort=new AbortController();controller.current=abort
  void(async()=>{
   await Promise.resolve();if(!alive.current||abort.signal.aborted)return
   setView(null);setError('');setLoading(!!file);if(!file)return
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const asset=await customSliceAssetWorker(file,kind,memoryBudgetBytes,retainedRef.current(),abort.signal)
   if(alive.current&&!abort.signal.aborted)accept(file,asset)
  })().catch(e=>{if(alive.current&&!abort.signal.aborted)setError(String(e))}).finally(()=>{if(alive.current&&controller.current===abort)setLoading(false)})
  return()=>abort.abort()
 },[file,kind,attempt,accept])
 return {view:view?.file===file?view:null,error,loading,accept,cancel:()=>{controller.current?.abort();setLoading(false);setError('CUSTOM_PREVIEW_CANCELED')},retry:()=>setAttempt(v=>v+1)}
}

import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type MouseEvent} from 'react'
import {Button,Space,Typography} from 'antd'
import {runNormalSourceWorker} from '../lib/normalImageSourceWorker'
import {localJson} from '../localProject/api'
import {useLanguage} from '../i18n/context'

// Only one full source decode is active across the matte preview panels.
let previewTail=Promise.resolve()
async function preview(file:File,budget:number,retained:number,signal:AbortSignal){
 const previous=previewTail;let release!:()=>void
 previewTail=new Promise<void>(resolve=>{release=resolve})
 try{await previous;signal.throwIfAborted();return await runNormalSourceWorker(file,'preview',budget,retained,signal)}finally{release()}
}
export default function MattePreview({file,label,paused,retained,rawUrl,onClick,style}:{file:File;label:string;paused:boolean;retained:()=>number;rawUrl?:string;onClick?:(event:MouseEvent<HTMLCanvasElement>)=>void;style?:CSSProperties}){
 const {lang}=useLanguage(),canvas=useRef<HTMLCanvasElement>(null),controller=useRef<AbortController|null>(null),retainedRef=useRef(retained),cached=useRef<{file:File;attempt:number}|null>(null),transfer=useRef<string|null>(null)
 const [ready,setReady]=useState<File|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>()=>{if(transfer.current)URL.revokeObjectURL(transfer.current)},[])
 useLayoutEffect(()=>{retainedRef.current=retained},[retained])
 useEffect(()=>{
  const abort=new AbortController();controller.current=abort
  void(async()=>{
   await Promise.resolve();if(abort.signal.aborted)return
   if(paused||cached.current?.file===file&&cached.current.attempt===attempt){setLoading(false);return}
   setLoading(true);setError('')
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const result=await preview(file,memoryBudgetBytes,retainedRef.current(),abort.signal),bitmap=result.bitmap!
   try{
    if(abort.signal.aborted||!canvas.current)return
    canvas.current.width=bitmap.width;canvas.current.height=bitmap.height
    const context=canvas.current.getContext('2d');if(!context)throw new Error('MATTE_PREVIEW_CANVAS')
    context.drawImage(bitmap,0,0);cached.current={file,attempt};setReady(file)
   }finally{bitmap.close()}
  })().catch(e=>{if(!abort.signal.aborted)setError(String(e))}).finally(()=>{if(!abort.signal.aborted)setLoading(false)})
  return()=>abort.abort()
 },[file,paused,attempt])
 const text=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 return <div style={{maxWidth:'100%'}}>
  <canvas ref={canvas} role="img" aria-label={label} draggable={!!rawUrl} onDragStart={event=>{if(rawUrl){
   // The stash consumes its URL; never transfer the live download URL.
   // Keep at most one transfer alive, including drops into another tool.
   if(transfer.current)URL.revokeObjectURL(transfer.current)
   transfer.current=URL.createObjectURL(file)
   event.dataTransfer.setData('application/x-frameronin-stash-url',transfer.current)
   event.dataTransfer.setData('application/x-frameronin-stash-name',file.name)
   event.dataTransfer.effectAllowed='copy'
  }}} onDragEnd={event=>{if(event.dataTransfer.dropEffect==='none'&&transfer.current){URL.revokeObjectURL(transfer.current);transfer.current=null}}} onClick={event=>{if(ready===file&&!loading)onClick?.(event)}} style={{display:ready===file?'block':'none',maxWidth:'100%',maxHeight:400,imageRendering:'auto',...style}}/>
  {loading&&<Space><Typography.Text>{text('正在准备预览','Preparing preview','プレビューを準備中')}</Typography.Text><Button size="small" onClick={()=>{controller.current?.abort();setLoading(false);setError(text('预览已取消','Preview canceled','プレビューを取り消しました'))}}>{text('取消预览','Cancel preview','プレビューを取消')}</Button></Space>}
  {error&&<Space><Typography.Text type="warning">{error}</Typography.Text><Button size="small" disabled={paused} onClick={()=>setAttempt(v=>v+1)}>{text('重试预览','Retry preview','プレビューを再試行')}</Button></Space>}
 </div>
}

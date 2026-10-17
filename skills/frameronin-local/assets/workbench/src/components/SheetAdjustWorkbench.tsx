import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react'
import {flushSync} from 'react-dom'
import {Button,Checkbox,ColorPicker,InputNumber,message,Pagination,Progress,Radio,Slider,Space,Switch,Typography,Upload} from 'antd'
import {ArrowDownOutlined,ArrowLeftOutlined,ArrowRightOutlined,ArrowUpOutlined,DeleteOutlined,DownloadOutlined,DragOutlined,PlusOutlined} from '@ant-design/icons'
import type {UploadFile} from 'antd'
import {useLanguage} from '../i18n/context'
import CropPreview from './CropPreview'
import StashDropZone from './StashDropZone'
import StashableImage from './StashableImage'
import {SheetAdjustDocumentSurface} from '../localProject/SheetAdjustDocumentSurface'
import {useSheetAdjustDocument} from '../localProject/useSheetAdjustDocument'
import {emptySheetCrop,newSheetFrame,preparedSheetFrames,currentSheetRecipe,serializeSheetAdjust,sheetAdjustReports,sheetComposeLayout,sheetGifLayout,type SheetAdjustDraft} from '../localProject/sheetAdjustDocument'
import {sheetLayout} from '../lib/sheetAdjust'
import {cacheManagedInput,runManagedTask} from '../localProject/managedTasks'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {prepareFineInput} from '../localProject/fineEditInput'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {validateSheetPreparation,type SheetPreparation} from '../lib/sheetPrepare'
import type {SheetProPreprocessOptions} from '../lib/sheetProPreprocess'
import {sheetAdjustPreview,type SheetPreviewRequest} from '../lib/sheetAdjustPreview'
import {useSheetAdjustPreview} from '../localProject/useSheetAdjustPreview'
import {useCustomSliceView} from '../localProject/useCustomSliceView'
import {useSpriteBlobUrls,useSpriteSheetAssets} from '../localProject/useSpriteSheetAssets'
import {useImageToolUrls} from '../localProject/useManagedImageTool'
import type {CustomResult} from '../localProject/customSliceDocument'
import {localJson} from '../localProject/api'

const {Text}=Typography,{Dragger}=Upload
const board:CSSProperties={padding:12,border:'1px solid #9a8b78',borderRadius:8,background:'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px'}
type Kind='prepare'|'preprocess'|'compose'|'gif'|'fix'|'blank'|'raw'
const EMPTY:number[]=[]
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const download=(file:Blob,name:string)=>{const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}

export default function SheetAdjustWorkbench({integratedSplit=false}:{integratedSplit?:boolean}){
 const {lang,t}=useLanguage(),model=useSheetAdjustDocument(integratedSplit),d=model.draft,dispatch=model.dispatch
 const text=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 const readableError=(error:unknown)=>{
  const value=String(error)
  if(value.includes('SHEET_PREPARATION_LAYOUT'))return text('总帧数最多 4096，请减少行数或列数。','Use at most 4096 cells; reduce the row or column count.','フレーム数の上限は 4096 です。行数または列数を減らしてください。')
  if(value.includes('SHEET_OUTPUT_DIMENSIONS'))return text('合成边长最多 30000 像素，请减少排列或扩边尺寸。','Output sides must not exceed 30000 pixels; reduce the layout or padding.','出力の一辺は 30000 ピクセルまでです。配置や余白を小さくしてください。')
  if(value.includes('_RESOURCE_LIMIT')||value.includes('RESOURCE_BUDGET_EXCEEDED'))return text('超出当前内存预算，请减少帧数或处理尺寸。','This exceeds the memory budget; reduce the frame count or processing dimensions.','メモリ予算を超えています。フレーム数または処理サイズを減らしてください。')
  if(value.includes('SHEET_PREPARATION_EMPTY'))return text('没有找到非透明区域，请选择其他图片或使用整图均分。','No nontransparent regions were found. Choose another image or use the whole-image grid.','不透明な領域がありません。別の画像または画像全体の等分を使用してください。')
  return value
 }
 const alive=useRef(true),active=useRef<{controller:AbortController;promise:Promise<boolean>}|null>(null),incoming=useRef<{controller:AbortController;promise:Promise<boolean>}|null>(null),sample=useRef<{controller:AbortController;promise:Promise<void>}|null>(null),drag=useRef<string|null>(null),interaction=useRef(false),extra=useRef(0),intent=useRef(0),autoTimer=useRef<number|null>(null)
 const [busy,setBusy]=useState<Kind|null>(null),[preparing,setPreparing]=useState(false),[sampling,setSampling]=useState(false),[progress,setProgress]=useState(0),[canceling,setCanceling]=useState(false),[status,setStatus]=useState(''),[page,setPage]=useState(1),[playing,setPlaying]=useState(false),[playCursor,setPlayCursor]=useState(0),[cropIndex,setCropIndex]=useState(0),[dragged,setDragged]=useState<string|null>(null)
 const frameRoot=useRef<HTMLDivElement>(null),workspaceRoot=useRef<HTMLDivElement>(null),focusFrame=useRef<string|null>(null)
 const retained=model.retained,retainedBytes=useCallback(()=>96*1024**2+extra.current+[...retained()].reduce((n,f)=>n+f.size*2,0),[retained])
 const clearAuto=useCallback(()=>{intent.current++;if(autoTimer.current!==null){window.clearTimeout(autoTimer.current);autoTimer.current=null}},[])
 const finishGesture=useCallback(async()=>{flushSync(()=>{drag.current=null;setDragged(null);dispatch({type:'end'})});await incoming.current?.promise;await sample.current?.promise},[dispatch])
 const beforeAction=useCallback(async()=>{clearAuto();await finishGesture()},[clearAuto,finishGesture])
 const hasPendingEdits=useCallback(()=>incoming.current!==null||sample.current!==null||drag.current!==null||interaction.current,[])
 const interactionChange=useCallback((v:boolean)=>{interaction.current=v},[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearAuto();incoming.current?.controller.abort();sample.current?.controller.abort()}},[clearAuto])
 const changed=()=>text('编辑已改变；结果保留在项目中','Edits changed; results remain in Project assets','編集が変わりました。結果はプロジェクトに保存されています')
 const sourceView=useCustomSliceView(d.source,'source',retainedBytes),archive=useCustomSliceView(d.archive?.data??null,'archive',retainedBytes)
 const processedFiles=useMemo(()=>d.processed?[d.processed.data]:[],[d.processed]),processedUrls=useImageToolUrls(processedFiles,processedFiles.map(f=>imageToolMetadata.get(f))),processedInfo=d.processed?imageToolMetadata.get(d.processed.data)?.metadata:null
 const placements=useMemo(()=>d.frames.map(({sourceIndex,dx,dy,crop})=>({sourceIndex,dx,dy,crop:d.integrated?d.crop:crop})),[d.frames,d.integrated,d.crop])
 const layoutReview=useMemo(()=>{if(!placements.length)return {value:null,error:''};try{return {value:sheetLayout(d.sizes,{columns:d.columns,rows:d.rows,frames:placements}),error:''}}catch(error){return {value:null,error:String(error)}}},[placements,d.sizes,d.columns,d.rows]),layout=layoutReview.value
 const selected=useMemo(()=>d.frames.flatMap((f,i)=>f.selected?[i]:[]),[d.frames]),cursor=(playing?playCursor:d.cursor)%Math.max(1,selected.length),displayIndex=selected[cursor]??0,displayFrame=d.frames[displayIndex]
 const pageSize=d.columns*Math.max(1,Math.floor(24/d.columns)),pageValue=Math.min(page,Math.max(1,Math.ceil(d.frames.length/pageSize))),start=(pageValue-1)*pageSize
 const pageIndices=useMemo(()=>Array.from({length:Math.min(pageSize,Math.max(0,d.frames.length-start))},(_,i)=>start+i),[d.frames.length,start,pageSize])
 useLayoutEffect(()=>{if(focusFrame.current){const button=frameRoot.current?.querySelector<HTMLButtonElement>(`button[data-sheet-frame="${focusFrame.current}"]`);if(button){button.focus();focusFrame.current=null}}},[d.frames,pageValue])
 const animationStart=Math.floor(cursor/24)*24,animationIndices=useMemo(()=>selected.length?selected.slice(animationStart,animationStart+24):d.frames.length?[0]:EMPTY,[selected,animationStart,d.frames.length])
 const useCell=d.integrated&&Object.values(d.crop).some(v=>v!==0),cellW=useCell?Math.floor(layout?.cellW??0):0,cellH=useCell?Math.floor(layout?.cellH??0):0
 const requestFor=useCallback((indices:number[],limit:number):SheetPreviewRequest|null=>{
  if(!archive.view||archive.view.file!==d.archive?.data||!indices.length||useCell&&(!cellW||!cellH))return null
  return {action:'preview',files:indices.map(i=>archive.view!.assets[d.frames[i].sourceIndex]),sizes:indices.map(i=>d.sizes[d.frames[i].sourceIndex]),placements:indices.map(i=>placements[i]),cell:useCell?{w:cellW,h:cellH}:null,limit}
 },[archive.view,d.archive,d.frames,d.sizes,placements,useCell,cellW,cellH])
 const pageRequest=useMemo(()=>requestFor(pageIndices,128),[requestFor,pageIndices]),animationRequest=useMemo(()=>requestFor(animationIndices,512),[requestFor,animationIndices])
 const pages=useSheetAdjustPreview(pageRequest,retainedBytes),animations=useSheetAdjustPreview(animationRequest,retainedBytes),pageUrls=useSpriteBlobUrls(pages.files),animationUrls=useSpriteBlobUrls(animations.files)
 const displaySize=displayFrame?(useCell?{w:cellW,h:cellH}:d.sizes[displayFrame.sourceIndex]):null,displayUrl=animationUrls[animationIndices.indexOf(displayIndex)]
 const cropFrame=d.frames[Math.min(cropIndex,Math.max(0,d.frames.length-1))],cropRaw=archive.view&&cropFrame?archive.view.assets[cropFrame.sourceIndex]:null,cropSize=cropFrame?d.sizes[cropFrame.sourceIndex]:null
 const cropRequest=useMemo(()=>cropRaw&&cropSize?{action:'preview' as const,files:[cropRaw],sizes:[{...cropSize,frames:1}]}:null,[cropRaw,cropSize]),cropPreview=useSpriteSheetAssets(cropRequest,retainedBytes),cropUrls=useSpriteBlobUrls(cropPreview.value.previews)
 const resultFiles=useMemo(()=>d.composed?[d.composed.data]:[],[d.composed]),resultUrls=useImageToolUrls(resultFiles,resultFiles.map(f=>imageToolMetadata.get(f)))
 const exportFiles=useMemo(()=>[d.composed?.data,d.gif?.data,d.raw?.data].filter((f):f is File=>!!f),[d.composed,d.gif,d.raw]),exportUrls=useSpriteBlobUrls(exportFiles)
 const exportUrl=(file:File)=>exportUrls[exportFiles.indexOf(file)]
 useLayoutEffect(()=>{extra.current=(archive.view?.bytes??0)+(sourceView.view?.bytes??0)+[...pages.files,...animations.files,...cropPreview.value.previews].reduce((n,f)=>n+f.size*2,0)+24*512*512*16+64*128*128*16+2*1024*1024*16},[archive.view,sourceView.view,pages.files,animations.files,cropPreview.value.previews])
 useEffect(()=>{if(!playing||!selected.length)return;const timer=window.setInterval(()=>setPlayCursor(v=>(v+1)%selected.length),Math.max(50,100/d.speedScale));return()=>window.clearInterval(timer)},[playing,selected.length,d.speedScale])

 const result=async(completed:Awaited<ReturnType<typeof runManagedTask>>):Promise<CustomResult>=>{
  if(completed.outputs.length!==2)throw new Error('SHEET_RESULT_COUNT')
  const files=completed.outputs.map((o,i)=>{const ext=i===1?'json':o.version.metadata.extension?.slice(1)??'png',file=new File([o.blob],`sheet-${i===1?'report':'result'}.${ext}`,{type:i===1?'application/json':ext==='zip'?'application/zip':ext==='gif'?'image/gif':'image/png'});imageToolMetadata.set(file,o.version);cacheManagedInput(file,completed.project.id,o.version.id);return file})
  const report=JSON.parse(await files[1].text());sheetAdjustReports.set(files[1],report)
  return {data:files[0],report:files[1],taskId:completed.taskId}
 }
 const perform=async(kind:Kind,requested?:SheetAdjustDraft,force=false):Promise<boolean>=>{
  if(active.current)return false
  const operation={controller:new AbortController(),promise:Promise.resolve(false)},abort=operation.controller
  active.current=operation;setBusy(kind);setCanceling(false);setProgress(0);setStatus('')
  const work=(async()=>{
   await finishGesture();abort.signal.throwIfAborted();const before=model.current()
   if(requested&&requested!==before)return true
   if(!before.source)return true
   const run=async(name:string,input:File,layout:unknown)=>{
    if(alive.current){setProgress(0);setStatus(name==='image.sheetPreprocess'?text('正在预处理图片','Preprocessing image','画像を前処理中'):name==='image.sheetPrepare'?text('正在拆分帧','Splitting frames','フレームを分割中'):name==='image.sheetGif'?text('正在编码 GIF','Encoding GIF','GIF をエンコード中'):text('正在处理帧','Processing frames','フレームを処理中'))}
    const completed=await runManagedTask(name,[input],{layout,renderer:'browser-worker',frontendBytes:retainedBytes()},{signal:abort.signal,onProgress:n=>{if(alive.current)setProgress(v=>Math.max(v,n))},outputFilter:()=>alive.current})
    if(!alive.current)return null
    return result(completed)
   }
   let candidate:SheetAdjustDraft=before,output:CustomResult|null=null
   if(kind==='prepare'||kind==='preprocess'){
    const recipe=currentSheetRecipe(before),pre=recipe.preprocess,split=recipe.layout
    validateSheetPreparation(split)
    if(kind==='prepare'&&!force&&before.archive&&same(before.recipe,recipe))return true
    let processed=pre?before.processed:null
    if(pre&&(!processed||!same((sheetAdjustReports.get(processed.report)?.parameters as {layout?:unknown}|undefined)?.layout,pre)))processed=await run('image.sheetPreprocess',before.source,pre)
    if(!alive.current)return true
    abort.signal.throwIfAborted()
    if(pre&&!processed)throw new Error('SHEET_PREPROCESS_RESULT')
    if(kind==='preprocess')candidate={...before,processed}
    else{
     output=await run('image.sheetPrepare',processed?.data??before.source,split);if(!alive.current)return true;if(!output)throw new Error('SHEET_PREPARE_RESULT')
     const sizes=sheetAdjustReports.get(output.report)!.frameSizes as SheetAdjustDraft['sizes'],columns=before.integrated?(before.mode==='whole'?before.splitColumns:before.mode==='uniform'?before.uniformColumns:before.transparentColumns):before.splitColumns
     const rows=before.integrated?Math.max(1,Math.ceil(sizes.length/columns)):before.splitRows
     candidate={...before,processed,archive:output,recipe,lineage:[...(processed?[processed.taskId]:[]),output.taskId],sizes,frames:preparedSheetFrames(sizes),columns,rows,...(before.integrated&&before.mode!=='whole'?{splitColumns:columns,splitRows:rows}:{}),fixes:[],fixReference:null,fixedMode:false,composed:null,gif:null,raw:null,cursor:0}
    }
   }else{
    if(!before.archive||!before.frames.length)throw new Error('SHEET_PREPARE_FIRST')
    const input=before.archive.data
    if(kind==='compose'||kind==='gif'){
     output=await run(kind==='compose'?'image.sheetCompose':'image.sheetGif',input,kind==='compose'?sheetComposeLayout(before):sheetGifLayout(before));if(!alive.current)return true;if(!output)throw new Error('SHEET_EXPORT_RESULT')
     candidate={...before,[kind==='compose'?'composed':'gif']:{...output,input}}
    }else if(kind==='raw'||kind==='blank'){
     const first=before.sizes[before.frames[0].sourceIndex]
     output=await run('image.sheetFrames',input,{order:before.frames.map(f=>f.sourceIndex),blank:kind==='blank'?{width:first.w,height:first.h}:null});if(!alive.current)return true;if(!output)throw new Error('SHEET_ARCHIVE_RESULT')
     if(kind==='raw')candidate={...before,raw:{...output,input}}
     else{const sizes=sheetAdjustReports.get(output.report)!.frameSizes as SheetAdjustDraft['sizes'],frames=[...before.frames.map((f,i)=>({...f,sourceIndex:i})),newSheetFrame(before.frames.length)];candidate={...before,archive:output,lineage:[...before.lineage,output.taskId],sizes,frames,rows:Math.max(1,Math.ceil(frames.length/before.columns))}}
    }else{
     if(!before.fixReference)throw new Error('SHEET_PIXEL_FIX_REQUIRED')
     const selected=before.frames.filter(f=>f.selected),reference=before.sizes[(selected[before.cursor%Math.max(1,selected.length)]??before.frames[0]).sourceIndex]
     output=await run('image.sheetFix',input,{selected:selected.map(f=>f.sourceIndex),referenceWidth:reference.w,referenceHeight:reference.h,fixes:before.fixes});if(!alive.current)return true;if(!output)throw new Error('SHEET_FIX_RESULT')
     candidate={...before,archive:output,lineage:[...before.lineage,output.taskId],fixes:[],fixReference:null,fixedMode:false}
    }
   }
   await serializeSheetAdjust(candidate);abort.signal.throwIfAborted()
   if(!alive.current)return true
   if(model.current()!==before||hasPendingEdits()){message.warning(changed());return true}
   model.change(()=>candidate);setStatus(text('处理完成，结果已存入项目','Completed; results saved in Project assets','処理が完了し、結果をプロジェクトに保存しました'))
   if(output&&(kind==='gif'||kind==='raw'))download(output.data,(before.source.name.replace(/\.[^.]+$/,'')||'sprite')+(kind==='gif'?'_frames.gif':'_frames.zip'))
   return true
  })().catch(error=>{if(alive.current)setStatus(error instanceof DOMException&&error.name==='AbortError'?text('加工已取消','Processing canceled','処理を取り消しました'):readableError(error));return error instanceof DOMException&&error.name==='AbortError'})
  operation.promise=work.finally(()=>{if(active.current===operation)active.current=null;if(alive.current){setBusy(null);setCanceling(false)}})
  return operation.promise
 }
 const schedule=(next:SheetAdjustDraft,kind:Kind)=>{
  clearAuto();const token=intent.current;active.current?.controller.abort()
  autoTimer.current=window.setTimeout(()=>{
   autoTimer.current=null
   void(async()=>{const safe=await (active.current?.promise??Promise.resolve(true));if(!safe||!alive.current||token!==intent.current||model.current()!==next)return;await perform(kind,next)})()
  },250)
 }
 const edit=(update:(prev:SheetAdjustDraft)=>SheetAdjustDraft,auto=false)=>{
  const next=update(model.current());flushSync(()=>model.change(()=>next))
  if(auto&&next.source)schedule(next,next.mode==='whole'?'prepare':'preprocess')
 }
 const setSource=(file:File|null)=>{
  clearAuto();incoming.current?.controller.abort();sample.current?.controller.abort();active.current?.controller.abort();setPlaying(false)
  if(!file){model.change(prev=>({...prev,source:null,info:null,processed:null,archive:null,recipe:null,lineage:[],sizes:[],frames:[],fixes:[],fixReference:null,composed:null,gif:null,raw:null}));return Promise.resolve(true)}
  const request={controller:new AbortController(),promise:Promise.resolve(false)},before=model.current();incoming.current=request;setPreparing(true)
  const work=(async()=>{
   const prepared=await prepareFineInput(file,retainedBytes(),request.controller.signal);request.controller.signal.throwIfAborted()
   const m=prepared.version.metadata,s=fineEditorDimensions(m)
   if((m.frames??1)!==1||!['PNG','JPEG','WEBP'].includes(m.containerFormat??'')||m.bytes>20*1024**2)throw new Error('SHEET_STATIC_SOURCE_REQUIRED')
   if(!alive.current||model.current()!==before){if(alive.current)message.warning(changed());return false}
   const next:SheetAdjustDraft={...before,source:file,info:{w:s.width!,h:s.height!},processed:null,archive:null,recipe:null,lineage:[],sizes:[],frames:[],fixes:[],fixReference:null,composed:null,gif:null,raw:null,cursor:0,fixedMode:false,...(integratedSplit?{mode:'whole',splitColumns:8,splitRows:4,columns:8,rows:4,crop:emptySheetCrop()}:{})}
   flushSync(()=>model.change(()=>next));schedule(next,'prepare');return true
  })().catch(error=>{if(alive.current&&!request.controller.signal.aborted)setStatus(String(error));return false})
  const canceled=new Promise<boolean>(resolve=>request.controller.signal.addEventListener('abort',()=>resolve(false),{once:true}))
  request.promise=Promise.race([work,canceled]).finally(()=>{if(incoming.current===request){incoming.current=null;if(alive.current)setPreparing(false)}});return request.promise
 }
 const preChange=(update:Partial<SheetProPreprocessOptions>)=>edit(prev=>({...prev,preprocess:{...prev.preprocess,...update}}),true)
 const shift=(index:number,key:'up'|'down'|'left'|'right')=>edit(prev=>({...prev,frames:prev.frames.map((f,i)=>i!==index?f:{...f,dx:Math.max(-30000,Math.min(30000,f.dx+(key==='left'?-1:key==='right'?1:0))),dy:Math.max(-30000,Math.min(30000,f.dy+(key==='up'?-1:key==='down'?1:0))),counts:{...f.counts,[key]:f.counts[key]+1}})}))
 const toggle=(indices:number[])=>edit(prev=>{const checked=indices.every(i=>prev.frames[i]?.selected),set=new Set(indices);return {...prev,frames:prev.frames.map((f,i)=>set.has(i)?{...f,selected:!checked}:f)}})
 const move=(from:number,to:number)=>{if(from===to||from<0||to<0||from>=d.frames.length||to>=d.frames.length)return;focusFrame.current=d.frames[from].id;edit(prev=>{const frames=[...prev.frames],item=frames.splice(from,1)[0];frames.splice(to,0,item);return {...prev,frames}});setPage(Math.floor(to/pageSize)+1)}
 const endDrag=()=>{drag.current=null;setDragged(null);dispatch({type:'end'})}
 const remove=(indices:number[])=>{const removed=new Set(indices);let empty=false;edit(prev=>{const frames=prev.frames.filter((_,i)=>!removed.has(i));empty=!frames.length;focusFrame.current=frames[Math.min(Math.min(...indices),frames.length-1)]?.id??null;return {...prev,frames,rows:prev.integrated?Math.max(1,Math.ceil(frames.length/prev.columns)):prev.rows}});if(empty)workspaceRoot.current?.focus({preventScroll:true})}
 const samplePixel=(x:number,y:number)=>{
  if(d.integrated||!d.fixedMode||!displayFrame||!archive.view||sample.current)return
  const before=model.current(),size=before.sizes[displayFrame.sourceIndex],abort=new AbortController(),request={controller:abort,promise:Promise.resolve()};sample.current=request;setSampling(true)
  request.promise=(async()=>{
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
   const value=await sheetAdjustPreview({action:'sample',file:archive.view!.assets[displayFrame.sourceIndex],size,dx:displayFrame.dx,dy:displayFrame.dy,x,y,range:before.fixedRange},memoryBudgetBytes,retainedBytes(),abort.signal)
   abort.signal.throwIfAborted();if(!alive.current)return
   if(model.current()!==before){message.warning(changed());return}
   if(value.patch)model.change(prev=>({...prev,fixReference:size,fixes:[...prev.fixes,value.patch!]}))
  })().catch(error=>{if(alive.current&&!abort.signal.aborted)setStatus(String(error))}).finally(()=>{if(sample.current===request){sample.current=null;if(alive.current)setSampling(false)}})
 }
 const errors=[layoutReview.error,sourceView.error,archive.error,pages.error,animations.error,cropPreview.error].filter(Boolean),previewLoading=sourceView.loading||archive.loading||pages.loading||animations.loading||cropPreview.loading
 const selectedCount=selected.length,base=d.source?.name.replace(/\.[^.]+$/,'')||'sprite',pendingRecipe=d.mode==='whole'&&!same(d.recipe,currentSheetRecipe(d)),canRun=!!d.archive&&!!d.frames.length&&!busy&&!preparing&&!pendingRecipe
 const bg=d.background==='checkered'?board.background:d.background,displayScale=displaySize?Math.min(d.zoom,2048/Math.max(displaySize.w,displaySize.h)):1
 const countLabel={up:text('上','Up','上'),down:text('下','Down','下'),left:text('左','Left','左'),right:text('右','Right','右')}
 const cropLabel={top:text('上','Top','上'),bottom:text('下','Bottom','下'),left:countLabel.left,right:countLabel.right}
 const rowsOnPage=[...new Set(pageIndices.map(i=>Math.floor(i/d.columns)))],composedParams=d.composed?(sheetAdjustReports.get(d.composed.report)?.parameters as {layout?:unknown}|undefined)?.layout:null
 return <SheetAdjustDocumentSurface model={model} beforeAction={beforeAction} hasPendingEdits={hasPendingEdits} onInteractionChange={interactionChange}>
  <div ref={workspaceRoot} className="sprite-adjust-module" tabIndex={0} role="region" aria-label={text('精灵表调整工作区','Sheet adjustment workspace','スプライトシート調整ワークスペース')} onPointerDownCapture={event=>{if(!(event.target as HTMLElement).closest('input,textarea,select,button,[role="combobox"]'))event.currentTarget.focus({preventScroll:true})}} onKeyDown={event=>{
   if(event.nativeEvent.isComposing||event.ctrlKey||event.metaKey||event.altKey||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="combobox"]')||!d.frames.length)return
   if(['KeyQ','KeyE'].includes(event.code)&&selected.length){event.preventDefault();const index=event.code==='KeyQ'?Math.min(...selected):Math.max(...selected),target=event.shiftKey?index:index+(event.code==='KeyQ'?-1:1);if(target>=0&&target<d.frames.length)edit(prev=>({...prev,frames:prev.frames.map((f,i)=>i===target?{...f,selected:!event.shiftKey}:f)}));return}
   if(!selected.length)return
   if(['KeyA','KeyD'].includes(event.code)){event.preventDefault();setPlaying(false);model.set('cursor',(cursor+(event.code==='KeyA'?-1:1)+selected.length)%selected.length);return}
   const key=({ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'} as const)[event.key as 'ArrowUp'];if(key){event.preventDefault();shift(displayIndex,key)}
  }}>
  <Space direction="vertical" size="large" style={{width:'100%'}}>
   <Text type="secondary">{t('spriteAdjustHint')}</Text>
   {status&&<Text role="status">{status}</Text>}
   {preparing&&<Space><Text>{text('正在准备素材','Preparing image','素材を準備中')}</Text><Button onClick={()=>incoming.current?.controller.abort()}>{text('取消素材准备','Cancel input preparation','素材の準備を取消')}</Button></Space>}
   {busy&&<Space><Progress percent={Math.round(progress*100)} style={{width:180}}/><Button loading={canceling} onClick={()=>{clearAuto();setCanceling(true);active.current?.controller.abort()}}>{text('取消加工','Cancel processing','処理を取消')}</Button></Space>}
   {sampling&&<Button onClick={()=>sample.current?.controller.abort()}>{text('取消像素读取','Cancel pixel sampling','画素の読取を取消')}</Button>}
   {previewLoading&&<Button onClick={()=>{sourceView.cancel();archive.cancel();pages.cancel();animations.cancel();cropPreview.cancel()}}>{text('取消预览','Cancel previews','プレビューを取消')}</Button>}
   {!!errors.length&&<Space><Text role="alert">{errors.some(e=>e.endsWith('PREVIEW_CANCELED'))?text('预览已取消；素材与结果仍保留','Previews canceled; files and results retained','プレビューを取り消しました。素材と結果は保持されています'):errors.map(readableError).join('; ')}</Text><Button onClick={()=>{sourceView.retry();archive.retry();pages.retry();animations.retry();cropPreview.retry()}}>{text('重试预览','Retry previews','プレビューを再試行')}</Button></Space>}
   <StashDropZone onStashDrop={setSource} maxSizeMB={20}><Dragger accept=".png,.jpg,.jpeg,.webp" maxCount={1} fileList={d.source?[{uid:'1',name:d.source.name} as UploadFile]:[]} beforeUpload={async f=>await setSource(f)?false:Upload.LIST_IGNORE} onRemove={()=>setSource(null)}><p className="ant-upload-text">{t('imageUploadHint')}</p><p className="ant-upload-hint">{t('imageFormats')}</p></Dragger></StashDropZone>
   {sourceView.view&&<Space align="start"><div><Text>{text('原图','Original','元画像')} · {d.info?.w}×{d.info?.h}</Text><StashableImage src={sourceView.view.preview} stashSrc={sourceView.view.raw} alt={t('imgOriginalPreview')} style={{display:'block',maxWidth:220,maxHeight:160,imageRendering:'pixelated'}}/></div>{processedUrls[0]?.preview&&<div><Text>{text('上次预处理','Previous preprocessing','前回の前処理')} · {processedInfo?.width}×{processedInfo?.height}</Text><StashableImage src={processedUrls[0].preview} stashSrc={processedUrls[0].raw} alt={text('预处理结果','Preprocessed image','前処理した画像')} style={{display:'block',maxWidth:220,maxHeight:160,imageRendering:'pixelated'}}/></div>}</Space>}
   {d.integrated&&<>
    <Space><Text>{text('启用预处理','Enable preprocessing','前処理を有効にする')}</Text><Switch aria-label={text('启用预处理','Enable preprocessing','前処理を有効にする')} checked={d.preEnabled} onChange={v=>edit(prev=>({...prev,preEnabled:v}),true)}/></Space>
    {d.preEnabled&&<div style={{...board,background:'transparent'}}><Space direction="vertical" style={{width:'100%'}}>
     <Checkbox checked={d.preprocess.watermark} onChange={e=>preChange({watermark:e.target.checked})}>{text('去除可见水印','Remove visible watermark','可視透かしを除去')}</Checkbox>
     {(['crop','pad'] as const).map(prefix=><Space wrap key={prefix}><Text>{prefix==='crop'?text('内裁','Crop inward','内側をトリミング'):text('透明补边','Transparent padding','透明な余白')}</Text>{(['Top','Bottom','Left','Right'] as const).map(side=>{const key=`${prefix}${side}` as keyof SheetProPreprocessOptions,label=countLabel[side==='Top'?'up':side==='Bottom'?'down':side.toLowerCase() as 'left'|'right'];return <label key={key}>{label}: <InputNumber aria-label={`${prefix==='crop'?text('预处理内裁','Preprocess crop','前処理の切取'):text('预处理补边','Preprocess padding','前処理の余白')} ${label}`} min={0} max={4096} value={d.preprocess[key] as number} onChange={v=>preChange({[key]:v??0})}/></label>})}</Space>)}
     <Space wrap><Checkbox checked={d.preprocess.resizeEnabled} onChange={e=>preChange({resizeEnabled:e.target.checked})}>{text('PS 最近邻缩放','PS nearest-neighbor resize','PS ニアレストネイバー拡縮')}</Checkbox><label>{text('宽','Width','幅')}: <InputNumber aria-label={text('预处理宽度','Preprocess width','前処理の幅')} min={1} max={8192} value={d.preprocess.resizeW} onChange={v=>preChange({resizeW:v??256})}/></label><label>{text('高','Height','高さ')}: <InputNumber aria-label={text('预处理高度','Preprocess height','前処理の高さ')} min={1} max={8192} value={d.preprocess.resizeH} onChange={v=>preChange({resizeH:v??256})}/></label><Checkbox checked={d.preprocess.resizeKeepAspect} onChange={e=>preChange({resizeKeepAspect:e.target.checked})}>{text('保持比例','Keep aspect ratio','縦横比を維持')}</Checkbox></Space>
     <Radio.Group aria-label={text('预处理抠图模式','Preprocess matte mode','前処理の背景除去')} value={d.preprocess.matteMode} onChange={e=>preChange({matteMode:e.target.value})} options={[{value:'none',label:text('不抠图','No matte','背景を保持')},{value:'global',label:text('全局颜色','Global color','全体の色')},{value:'contiguous',label:text('连续区域','Contiguous','連続した領域')}]}/>
     <Space wrap><label>{text('容差','Tolerance','許容値')}: <InputNumber aria-label={text('抠图容差','Matte tolerance','背景除去の許容値')} min={0} max={441} value={d.preprocess.matteTolerance} onChange={v=>preChange({matteTolerance:v??80})}/></label><label>{text('羽化','Feather','ぼかし')}: <InputNumber aria-label={text('抠图羽化','Matte feather','背景除去のぼかし')} min={0} max={64} value={d.preprocess.matteFeather} onChange={v=>preChange({matteFeather:v??5})}/></label></Space>
     <Button disabled={!d.source||!!busy||preparing} onClick={()=>{clearAuto();void perform('preprocess')}}>{text('应用预处理','Apply preprocessing','前処理を適用')}</Button>
    </Space></div>}
    <Radio.Group value={d.mode} aria-label={text('拆分模式','Split mode','分割方法')} onChange={e=>{const mode=e.target.value as SheetPreparation['mode'];edit(prev=>({...prev,mode}),mode==='whole')}} options={[{value:'whole',label:text('整图均分','Whole image grid','画像全体を等分')},{value:'transparent',label:text('透明拆分','Transparent split','透明領域で分割')}]}/>
   </>}
   {d.mode==='whole'&&<Space wrap><label>{t('spriteColumns')}: <InputNumber aria-label={t('spriteColumns')} min={1} max={64} value={d.splitColumns} onChange={v=>edit(prev=>({...prev,splitColumns:Math.max(1,Math.min(64,Math.floor(v??8))),...(!prev.integrated?{columns:Math.max(1,Math.min(64,Math.floor(v??8)))}:{})}),true)}/></label><label>{t('spriteRows')}: <InputNumber aria-label={t('spriteRows')} min={1} max={4096} value={d.splitRows} onChange={v=>edit(prev=>({...prev,splitRows:Math.max(1,Math.min(4096,Math.floor(v??4))),...(!prev.integrated?{rows:Math.max(1,Math.min(4096,Math.floor(v??4)))}:{})}),true)}/></label></Space>}
   <Button type="primary" disabled={!d.source||!!busy||preparing} onClick={()=>{clearAuto();void perform('prepare',undefined,true)}}>{text('拆分 / 重新应用','Split / apply again','分割・再適用')}</Button>
   {!!d.archive&&<>
    <Text strong>{text('拆分预览','Split preview','分割プレビュー')} · {d.frames.length} {t('frame')} · {selectedCount} {text('已选','selected','選択済み')}</Text>
    {d.integrated&&<Space wrap><label>{text('排列列数','Layout columns','配置の列数')}: <InputNumber aria-label={text('排列列数','Layout columns','配置の列数')} min={1} max={64} value={d.columns} onChange={v=>edit(prev=>{const columns=Math.max(1,Math.min(64,Math.floor(v??1)));return {...prev,columns,rows:Math.max(1,Math.ceil(prev.frames.length/columns)),...(prev.mode==='transparent'?{transparentColumns:columns}:{})}})}/></label><Text>{d.rows} {text('行','rows','行')}</Text><Button icon={<PlusOutlined/>} disabled={!canRun||d.frames.length>=4096} onClick={()=>{clearAuto();void perform('blank')}}>{t('imagesToSingleAddBlank')}</Button></Space>}
    <Space wrap><Button onClick={()=>edit(prev=>({...prev,frames:prev.frames.map(f=>({...f,selected:true}))}))}>{text('全选','Select all','すべて選択')}</Button><Button onClick={()=>edit(prev=>({...prev,frames:prev.frames.map(f=>({...f,selected:false}))}))}>{text('清空选择','Clear selection','選択を解除')}</Button>{Array.from({length:d.columns},(_,c)=><Checkbox key={c} aria-label={text(`选择第 ${c+1} 列`,`Select column ${c+1}`,`${c+1} 列目を選択`)} checked={d.frames.some((_,i)=>i%d.columns===c)&&d.frames.every((f,i)=>i%d.columns!==c||f.selected)} onChange={()=>toggle(d.frames.flatMap((_,i)=>i%d.columns===c?[i]:[]))}>{c+1}</Checkbox>)}</Space>
    <Text type="secondary">{text('A/D 切换预览；Q/E 扩选，Shift 缩选；方向键微调当前帧。','A/D step; Q/E expand selection, Shift shrinks; arrows shift the current frame.','A/D でフレーム移動、Q/E で選択拡大、Shift で縮小、矢印で位置を微調整。')}</Text>
    <div style={{...board,maxHeight:460,overflow:'auto'}}>
     {rowsOnPage.map(row=><Space key={row} style={{marginBottom:8,marginRight:12}}><Checkbox checked={d.frames.every((f,i)=>Math.floor(i/d.columns)!==row||f.selected)} onChange={()=>toggle(d.frames.flatMap((_,i)=>Math.floor(i/d.columns)===row?[i]:[]))}>{text(`第 ${row+1} 行`,`Row ${row+1}`,`${row+1} 行目`)}</Checkbox>{d.integrated&&<Button danger size="small" aria-label={text(`删除第 ${row+1} 行`,`Delete row ${row+1}`,`${row+1} 行目を削除`)} icon={<DeleteOutlined/>} onClick={()=>remove(d.frames.flatMap((_,i)=>Math.floor(i/d.columns)===row?[i]:[]))}/>}</Space>)}
     <div ref={frameRoot} style={{display:'grid',gridTemplateColumns:`repeat(${d.columns}, minmax(80px,1fr))`,gap:8,minWidth:Math.min(d.columns,64)*88}}>{pageIndices.map((i,local)=>{const f=d.frames[i];return <div key={f.id} style={{gridColumn:i%d.columns+1,gridRow:Math.floor(i/d.columns)-Math.floor(start/d.columns)+1,border:f.selected?'2px solid #b55233':'2px solid transparent',opacity:dragged===f.id ? .6 : 1,padding:4,borderRadius:4,minWidth:0}} onDragOver={e=>{if(drag.current){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move'}}} onDrop={e=>{e.preventDefault();e.stopPropagation();if(drag.current)move(d.frames.findIndex(v=>v.id===drag.current),i);endDrag()}}>
      <Checkbox checked={f.selected} aria-label={text(`选择帧 ${i+1}`,`Select frame ${i+1}`,`フレーム ${i+1} を選択`)} onChange={()=>toggle([i])}>{i+1}</Checkbox>
      {pageUrls[local]&&<StashableImage src={pageUrls[local]} stashSrc={archive.view?.frames[f.sourceIndex]} alt={`${t('frame')} ${i+1}`} draggable={false} style={{display:'block',width:'100%',height:88,objectFit:'contain',imageRendering:'pixelated'}}/>}
      <Text style={{fontSize:11}}>Δ {f.dx},{f.dy}</Text>
      <Space size={1} wrap>{(['up','down','left','right'] as const).map(key=><Button key={key} size="small" aria-label={text(`帧 ${i+1} 向${countLabel[key]}`,`Shift frame ${i+1} ${key}`,`フレーム ${i+1} を${countLabel[key]}へ`)} onClick={()=>shift(i,key)}>{key==='up'?'↑':key==='down'?'↓':key==='left'?'←':'→'}</Button>)}</Space>
      {d.integrated&&<Space size={2}><Button size="small" icon={<DragOutlined/>} aria-label={text(`移动帧 ${i+1}`,`Move frame ${i+1}`,`フレーム ${i+1} を移動`)} data-sheet-frame={f.id} draggable onDragStart={e=>{e.stopPropagation();drag.current=f.id;setDragged(f.id);dispatch({type:'begin'});e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i))}} onDragEnd={endDrag} onKeyDown={e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;let to=i;if(e.key==='Home')to=0;else if(e.key==='End')to=d.frames.length-1;else if(e.shiftKey&&e.key==='ArrowLeft')to=i-1;else if(e.shiftKey&&e.key==='ArrowRight')to=i+1;else if(e.shiftKey&&e.key==='ArrowUp')to=i-d.columns;else if(e.shiftKey&&e.key==='ArrowDown')to=i+d.columns;else return;e.preventDefault();e.stopPropagation();move(i,to)}}/><Button size="small" danger icon={<DeleteOutlined/>} aria-label={text(`删除帧 ${i+1}`,`Delete frame ${i+1}`,`フレーム ${i+1} を削除`)} onClick={()=>remove([i])}/></Space>}
     </div>})}</div>
    </div>
    <Pagination current={pageValue} pageSize={pageSize} total={d.frames.length} showSizeChanger={false} onChange={setPage}/>
    {d.integrated&&cropFrame&&<div style={board}><Space direction="vertical" style={{width:'100%'}}><Text strong>{text('统一帧裁边 / 扩边','Frame crop / padding','フレームの切取・余白')}</Text><label>{text('参考帧','Reference frame','参照フレーム')}: <InputNumber aria-label={text('裁边参考帧','Crop reference frame','切取の参照フレーム')} min={1} max={d.frames.length} value={Math.min(cropIndex,d.frames.length-1)+1} onChange={v=>setCropIndex(Math.max(0,Math.min(d.frames.length-1,Math.floor(v??1)-1)))}/></label><Space wrap>{(['top','bottom','left','right'] as const).map(key=><label key={key}>{cropLabel[key]}: <InputNumber aria-label={`${text('帧裁边','Frame crop','フレームの切取')} ${cropLabel[key]}`} min={-30000} max={30000} value={d.crop[key]} onChange={v=>model.set('crop',prev=>({...prev,[key]:v??0}))}/></label>)}</Space>{cropUrls[0]&&cropSize&&<CropPreview imageUrl={cropUrls[0]} imageDimensions={cropSize} cropTop={d.crop.top} cropBottom={d.crop.bottom} cropLeft={d.crop.left} cropRight={d.crop.right} allowNegative onChange={value=>model.set('crop',value)}/>}<Button onClick={()=>model.set('crop',emptySheetCrop())}>{text('重置裁边','Reset crop','切取をリセット')}</Button></Space></div>}
    {displayFrame&&displaySize&&<div><Space direction="vertical" style={{width:'100%'}}>
     <Text strong>{text('动态预览','Animation preview','アニメーションプレビュー')} · {displayIndex+1} · {displaySize.w}×{displaySize.h}</Text>
     <Space wrap><Button onClick={()=>{setPlaying(false);model.set('cursor',0)}} disabled={!selectedCount}>{text('首帧','First','先頭')}</Button><Button onClick={()=>{setPlaying(false);model.set('cursor',(cursor-1+Math.max(1,selectedCount))%Math.max(1,selectedCount))}} disabled={!selectedCount}>{text('上一帧','Previous','前へ')}</Button><Button onClick={()=>{if(playing){model.set('cursor',cursor);setPlaying(false)}else{setPlayCursor(d.cursor);setPlaying(true)}}} disabled={!selectedCount}>{playing?text('暂停','Pause','一時停止'):text('播放','Play','再生')}</Button><Button onClick={()=>{setPlaying(false);model.set('cursor',(cursor+1)%Math.max(1,selectedCount))}} disabled={!selectedCount}>{text('下一帧','Next','次へ')}</Button><Button onClick={()=>{setPlaying(false);model.set('cursor',Math.max(0,selectedCount-1))}} disabled={!selectedCount}>{text('末帧','Last','末尾')}</Button></Space>
     <Space wrap><label>{text('播放速度','Playback speed','再生速度')}: <InputNumber aria-label={text('播放速度','Playback speed','再生速度')} min={.25} max={4} step={.25} value={d.speedScale} onChange={v=>model.set('speedScale',v??1)}/></label><label>{text('缩放','Zoom','拡大率')}: <InputNumber aria-label={text('预览缩放','Preview zoom','プレビュー拡大率')} min={1} max={8} value={d.zoom} onChange={v=>model.set('zoom',Math.max(1,Math.min(8,Math.floor(v??4))))}/></label><Checkbox checked={d.background==='checkered'} onChange={e=>model.set('background',e.target.checked?'checkered':'#e4dbcf')}>{text('透明棋盘格','Transparency grid','透明チェッカー')}</Checkbox><ColorPicker value={d.background==='checkered'?'#e4dbcf':d.background} onChange={v=>model.set('background',v.toHexString())}/></Space>
     <div style={{maxWidth:'100%',maxHeight:440,overflow:'auto',...board,background:bg,position:'relative'}}>
      {displayUrl&&<div style={{position:'relative',width:Math.max(1,displaySize.w*displayScale),height:Math.max(1,displaySize.h*displayScale)}}><img src={displayUrl} alt={text('当前帧预览','Current frame preview','現在のフレームプレビュー')} draggable={false} style={{width:'100%',height:'100%',imageRendering:'pixelated',display:'block',cursor:d.fixedMode?'crosshair':'default'}} onClick={e=>{if(!d.fixedMode||playing)return;const rect=e.currentTarget.getBoundingClientRect();samplePixel(Math.min(displaySize.w-1,Math.max(0,Math.floor((e.clientX-rect.left)/rect.width*displaySize.w))),Math.min(displaySize.h-1,Math.max(0,Math.floor((e.clientY-rect.top)/rect.height*displaySize.h))))}}/>{d.fixes.map((fix,i)=><div key={i} aria-hidden style={{position:'absolute',pointerEvents:'none',left:(fix.imgX+displayFrame.dx)*displayScale,top:(fix.imgY+displayFrame.dy)*displayScale,width:fix.range*displayScale,height:fix.range*displayScale,border:'1px solid #bf312c',boxSizing:'border-box'}}/>)}</div>}
     </div>
     {displayScale<d.zoom&&<Text type="secondary">{text('大帧使用缩略预览；加工与取样保持原始像素。','Large frames use a thumbnail; processing and sampling retain original pixels.','大きなフレームは縮小表示します。処理と画素読取は元の解像度を保ちます。')}</Text>}
     <Space wrap>{(['up','down','left','right'] as const).map(key=><Button key={key} aria-label={text(`当前帧向${countLabel[key]}`,`Shift current frame ${key}`,`現在のフレームを${countLabel[key]}へ`)} icon={key==='up'?<ArrowUpOutlined/>:key==='down'?<ArrowDownOutlined/>:key==='left'?<ArrowLeftOutlined/>:<ArrowRightOutlined/>} onClick={()=>shift(displayIndex,key)}>{countLabel[key]} {displayFrame.counts[key]}</Button>)}<Button onClick={()=>edit(prev=>({...prev,frames:prev.frames.map((f,i)=>i===displayIndex?{...f,dx:0,dy:0,counts:{up:0,down:0,left:0,right:0}}:f)}))}>{text('重置当前偏移','Reset current offset','現在の位置をリセット')}</Button></Space>
     {!d.integrated&&<Space wrap><Checkbox checked={d.fixedMode} onChange={e=>{setPlaying(false);model.set('fixedMode',e.target.checked)}}>{text('固定像素','Fixed pixels','固定ピクセル')}</Checkbox><Slider ariaLabelForHandle={text('固定像素范围','Fixed pixel range','固定ピクセルの範囲')} min={1} max={8} value={d.fixedRange} onChange={v=>model.set('fixedRange',v)} style={{width:120}}/><Text>{d.fixedRange}×{d.fixedRange} · {d.fixes.length}</Text><Button disabled={!canRun||!d.fixes.length||!selectedCount||sampling} onClick={()=>{setPlaying(false);flushSync(()=>model.set('cursor',cursor));clearAuto();void perform('fix')}}>{text('应用到选中帧','Apply to selected frames','選択フレームに適用')}</Button><Button onClick={()=>edit(prev=>({...prev,fixes:[],fixReference:null,fixedMode:false}))}>{text('取消固定像素','Cancel fixed pixels','固定ピクセルを取消')}</Button></Space>}
    </Space></div>}
    {layout&&<Text>{text('合成分辨率','Composed size','合成サイズ')}: {layout.width}×{layout.height} · {text('单元','Cell','セル')} {layout.cellW}×{layout.cellH}</Text>}
    <Space wrap><Button type="primary" disabled={!canRun} onClick={()=>{clearAuto();void perform('compose')}}>{text('重新合成','Recompose','再合成')}</Button><Button disabled={!canRun||!selectedCount} onClick={()=>{clearAuto();void perform('gif')}}>{text('导出选中帧 GIF','Export selected GIF','選択フレームを GIF 出力')}</Button><Button disabled={!canRun} onClick={()=>{clearAuto();void perform('raw')}}>{text('下载原帧 ZIP','Download raw frames ZIP','元フレームの ZIP を保存')}</Button>{d.composed&&<Button icon={<DownloadOutlined/>} href={exportUrl(d.composed.data)} download={base+'_adjusted.png'}>{text('下载合成 PNG','Download composed PNG','合成 PNG を保存')}</Button>}{d.gif&&<Button href={exportUrl(d.gif.data)} download={base+'_frames.gif'}>{text('下载上次 GIF','Download previous GIF','前回の GIF を保存')}</Button>}{d.raw&&<Button href={exportUrl(d.raw.data)} download={base+'_frames.zip'}>{text('下载上次原帧 ZIP','Download previous raw ZIP','前回の元フレーム ZIP を保存')}</Button>}</Space>
    {d.composed&&!same(composedParams,sheetComposeLayout(d))&&<Text type="secondary">{text('显示上次合成；重新合成才会应用当前编辑。','The previous composition is shown. Recompose to apply current edits.','前回の合成を表示しています。現在の編集を反映するには再合成してください。')}</Text>}
    {resultUrls[0]?.preview&&<StashableImage src={resultUrls[0].preview} stashSrc={resultUrls[0].raw} alt={text('合成结果','Composed result','合成結果')} style={{maxWidth:'100%',maxHeight:480,imageRendering:'pixelated'}}/>}
   </>}
  </Space></div>
 </SheetAdjustDocumentSurface>
}

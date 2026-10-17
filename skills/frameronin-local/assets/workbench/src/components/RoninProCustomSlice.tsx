import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type SetStateAction} from 'react'
import {flushSync} from 'react-dom'
import {Button,Checkbox,InputNumber,message,Progress,Slider,Space,Tabs,Typography,Upload} from 'antd'
import {DeleteOutlined,DownloadOutlined,FolderOpenOutlined,PlusOutlined,SaveOutlined,ScissorOutlined,ThunderboltOutlined} from '@ant-design/icons'
import type {UploadFile} from 'antd'
import {useLanguage} from '../i18n/context'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import RoninProL7SeamPreview from './RoninProL7SeamPreview'
import {bandColOffsetBounds,maxPolyDeltaX} from '../lib/customSliceAlgorithms'
import {customSliceAssetWorker} from '../lib/customSliceAssetWorker'
import {validateCustomPlan,validateCustomLayout,validateCustomCompose,type CustomLayout,type CustomPlan,type FrameSize} from '../lib/customSlice'
import {clearedCustomSeams,currentCustomLayout,customComposition,customPlanSettings,customReports,type CustomResult,type CustomSliceDraft} from '../localProject/customSliceDocument'
import {useCustomSliceDocument} from '../localProject/useCustomSliceDocument'
import {CustomSliceDocumentSurface} from '../localProject/CustomSliceDocumentSurface'
import {useCustomSliceView} from '../localProject/useCustomSliceView'
import {prepareFineInput} from '../localProject/fineEditInput'
import {cacheManagedInput,runManagedTask} from '../localProject/managedTasks'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {useImageToolUrls} from '../localProject/useManagedImageTool'
import {parseRearrangeText} from '../lib/customSliceRearrange'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
const {Dragger}=Upload,{Text}=Typography
const IMAGE_ACCEPT=['.png','.jpg','.jpeg','.webp']
const REARRANGE_STORAGE_KEY='roninpro-customslice-rearrange'

export default function RoninProCustomSlice(){
 const {t,lang}=useLanguage(),model=useCustomSliceDocument(),d=model.draft
 const {spriteFile,activeTab,columns,rows,regions,rearrangeRows,rearrangeCols,rearrangeGrid,expandUp,expandDown,expandLeft,expandRight,expandMode,sliceL7,previewRowStarts,previewColStarts,previewMeta,l7BandPercent,l7BandColOffset,l7PolyBendY,l7PolyDeltaX}=d
 const setting=<K extends keyof CustomSliceDraft>(key:K)=>(value:SetStateAction<CustomSliceDraft[K]>)=>model.set(key,value)
 const setL7BandPercent=setting('l7BandPercent'),setL7PolyBendY=setting('l7PolyBendY'),setL7PolyDeltaX=setting('l7PolyDeltaX'),setExpandMode=setting('expandMode')
 const setExpandUp=setting('expandUp'),setExpandDown=setting('expandDown'),setExpandLeft=setting('expandLeft'),setExpandRight=setting('expandRight')
 const [busy,setBusy]=useState<'plan'|'split'|'compose'|null>(null),[progress,setProgress]=useState(0),[preparing,setPreparing]=useState(false),[canceling,setCanceling]=useState(false),[status,setStatus]=useState(''),[autoTicket,setAutoTicket]=useState(0)
 const alive=useRef(true),controller=useRef<AbortController|null>(null),incoming=useRef<{controller:AbortController;promise:Promise<void>}|null>(null),textRead=useRef<Promise<void>|null>(null),finishSeam=useRef<(()=>void)|null>(null),pendingGesture=useRef(false),extraBytes=useRef(0),pendingAuto=useRef<CustomSliceDraft|null>(null)
 const rearrangeInput=useRef<HTMLInputElement>(null)
 const retainedFiles=model.retained
 const retainedBytes=useCallback(()=>96*1024**2+extraBytes.current+[...retainedFiles()].reduce((sum,file)=>sum+file.size*2,0),[retainedFiles])
 const sourceView=useCustomSliceView(spriteFile,'source',retainedBytes),archiveView=useCustomSliceView(d.splitResult?.data??null,'archive',retainedBytes)
 const sourceSizeChanged=!!(sourceView.view&&d.info&&(sourceView.view.width!==d.info.w||sourceView.view.height!==d.info.h))
 const sourcePreview=sourceSizeChanged?null:sourceView.view,spritePreviewUrl=sourcePreview?.preview??null,framePreviewUrls=archiveView.view?.thumbnails??[],frameBlobUrls=archiveView.view?.frames??[]
 const splitReport=d.splitResult?customReports.get(d.splitResult.report):undefined,frameSizes=archiveView.view?.sizes??(splitReport?.frameSizes as FrameSize[]|undefined)??[]
 const archiveFiles=useMemo(()=>d.splitResult?[d.splitResult.data]:[],[d.splitResult]),composedFiles=useMemo(()=>d.composedResult?[d.composedResult.data]:[],[d.composedResult])
 const archiveUrls=useImageToolUrls(archiveFiles,[]),composedUrls=useImageToolUrls(composedFiles,composedFiles.map(f=>imageToolMetadata.get(f)))
 const zipUrl=archiveUrls[0]?.raw??null,composedUrl=composedUrls[0]?.raw??null,composedPreviewUrl=composedUrls[0]?.preview??''
 const loading=busy!==null
 useLayoutEffect(()=>{extraBytes.current=(sourceView.view?.bytes??0)+(archiveView.view?.bytes??0)},[sourceView.view,archiveView.view])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;incoming.current?.controller.abort()}},[])
 const interactionChange=useCallback((active:boolean)=>{pendingGesture.current=active},[])
 const dispatch=model.dispatch
 const beforeAction=useCallback(async()=>{flushSync(()=>{finishSeam.current?.();dispatch({type:'end'})});await incoming.current?.promise;await textRead.current},[dispatch])
 const hasPendingEdits=useCallback(()=>pendingGesture.current||incoming.current!==null||textRead.current!==null,[])
 const notice=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 const changed=()=>notice('编辑已改变，结果保留在项目中','Edits changed; results remain in Project assets','編集が変わりました。結果はプロジェクトに保存されています')
 const splitOutdated=useMemo(()=>{
  if(!d.splitResult)return false
  // Draft parameters may be incomplete; execution reports the concrete error.
  try{return JSON.stringify(currentCustomLayout(d))!==JSON.stringify((customReports.get(d.splitResult.report)?.parameters as {layout?:unknown}|undefined)?.layout)}catch{return true}
 },[d])
 const composedOutdated=!!d.composedResult&&JSON.stringify(customComposition(d))!==JSON.stringify((customReports.get(d.composedResult.report)?.parameters as {composition?:unknown}|undefined)?.composition)
 const acceptResult=(completed:Awaited<ReturnType<typeof runManagedTask>>,kind:'plan'|'split'|'compose'):CustomResult=>{
  if(completed.outputs.length!==2)throw new Error('CUSTOM_RESULT_COUNT')
  const files=completed.outputs.map((o,i)=>{const file=new File([o.blob],i===1?'custom-slice-report.json':kind==='plan'?'custom-seams.json':kind==='split'?'custom-slices.zip':'custom-composed.png',{type:i===1||kind==='plan'?'application/json':kind==='split'?'application/zip':'image/png'});imageToolMetadata.set(file,o.version);cacheManagedInput(file,completed.project.id,o.version.id);return file})
  return {data:files[0],report:files[1],taskId:completed.taskId}
 }
 const execute=async(kind:'plan'|'split'|'compose',refine:'l7'|'uniform'='l7')=>{
  if(controller.current){if(kind==='split'&&model.current().activeTab==='auto')pendingAuto.current=model.current();return}
  const abort=new AbortController();controller.current=abort;setBusy(kind);setProgress(0);setCanceling(false)
  try{
   await beforeAction();abort.signal.throwIfAborted()
   const before=model.current();if(!before.spriteFile||!before.info)return
   const options={signal:abort.signal,onProgress:(n:number)=>{if(alive.current)setProgress(v=>Math.max(v,n))}}
   let plan:CustomPlan|undefined,planResult:CustomResult|undefined
   if(kind==='plan'||kind==='split'&&before.activeTab==='auto'&&!before.sliceL7){
    const parameters={mode:before.activeTab==='auto'?'auto':'grid',columns:Math.min(64,before.columns),rows:Math.min(64,before.rows),refine:kind==='plan'?refine:'uniform',bandPercent:before.l7BandPercent,renderer:'browser-worker',frontendBytes:retainedBytes()}
    const complete=await runManagedTask('image.customSlicePlan',[before.spriteFile],parameters,options)
    planResult=acceptResult(complete,'plan');plan=JSON.parse(await planResult.data.text());validateCustomPlan(plan,before.info.w,before.info.h)
    customReports.set(planResult.report,JSON.parse(await planResult.report.text()))
    abort.signal.throwIfAborted()
    if(kind==='plan'){
     if(alive.current&&(model.current()!==before||hasPendingEdits())){message.warning(changed());return}
     if(alive.current){model.change(prev=>({...prev,...customPlanSettings(plan!),planResult:planResult!}));setStatus(t('roninProCustomSliceL7PreviewDone'))}
     return
    }
   }
   let result:CustomResult
   if(kind==='compose'){
    if(!before.splitResult)throw new Error('CUSTOM_SPLIT_REQUIRED')
    const composition=customComposition(before),report=customReports.get(before.splitResult.report),count=(report?.frameSizes as FrameSize[]|undefined)?.length??0
    validateCustomCompose(composition,count)
    const complete=await runManagedTask('image.customCompose',[before.splitResult.data],{composition,renderer:'browser-worker',frontendBytes:retainedBytes()},{...options,outputFilter:()=>alive.current})
    if(!alive.current)return
    result=acceptResult(complete,'compose')
   }else{
    const layout:CustomLayout=plan?{mode:'bands',colStarts:plan.colStarts,rowStarts:plan.rowStarts,bandColOffset:plan.bandColOffset}:currentCustomLayout(before)
    validateCustomLayout(layout,before.info.w,before.info.h)
    const complete=await runManagedTask('image.customSlice',[before.spriteFile],{layout,renderer:'browser-worker',frontendBytes:retainedBytes()},{...options,outputFilter:()=>alive.current})
    if(!alive.current)return
    result=acceptResult(complete,'split')
   }
   const report=JSON.parse(await result.report.text());customReports.set(result.report,report);abort.signal.throwIfAborted()
   if(model.current()!==before||hasPendingEdits()){message.warning(changed());return}
   if(kind==='compose'){model.change(prev=>({...prev,composedResult:{...result,input:before.splitResult!.data}}));setStatus(t('roninProCustomSliceComposed'))}
   else{
    const count=(report.frameSizes as FrameSize[]).length,r=before.activeTab==='custom'?Math.max(1,Math.ceil(Math.sqrt(count))):plan?.rows??(before.sliceL7?before.previewMeta?.rows:undefined)??before.rows,c=before.activeTab==='custom'?Math.ceil(count/r):plan?.columns??(before.sliceL7?before.previewMeta?.cols:undefined)??before.columns
    const grid=Array.from({length:r},(_,row)=>Array.from({length:c},(_,col)=>row*c+col<count?row*c+col+1:0))
    model.change(prev=>({...prev,...(plan?{columns:plan.columns,rows:plan.rows,planResult:planResult!}:{}),splitResult:result,composedResult:null,rearrangeRows:r,rearrangeCols:c,rearrangeGrid:grid}))
    setStatus(t('spriteSplitSuccess',{n:count}))
   }
  }catch(error){if(alive.current){const label=error instanceof DOMException&&error.name==='AbortError'?notice('加工已取消','Processing canceled','処理を取り消しました'):String(error);setStatus(label);if(!(error instanceof DOMException&&error.name==='AbortError'))message.error(label)}}
  finally{
   controller.current=null
   if(alive.current){setBusy(null);setCanceling(false);const next=pendingAuto.current;pendingAuto.current=null;if(next&&model.current()===next)setAutoTicket(v=>v+1)}
  }
 }
 const executeRef=useRef(execute)
 useLayoutEffect(()=>{executeRef.current=execute})
 useEffect(()=>{if(autoTicket)void executeRef.current('split')},[autoTicket])
 const applyImage=(file:File)=>{
  incoming.current?.controller.abort();const operation={controller:new AbortController(),promise:Promise.resolve()};incoming.current=operation;setPreparing(true)
  const work=(async()=>{
   const before=model.current(),prepared=await prepareFineInput(file,retainedBytes());operation.controller.signal.throwIfAborted()
   const asset=await customSliceAssetWorker(file,'source',prepared.memoryBudgetBytes,retainedBytes(),operation.controller.signal)
   if(!alive.current||operation.controller.signal.aborted||model.current()!==before){if(alive.current&&!operation.controller.signal.aborted)message.warning(changed());return}
   if(asset.kind!=='source')throw new Error('CUSTOM_SOURCE_RESPONSE')
   const size=fineEditorDimensions(prepared.version.metadata)
   if(size.width!==asset.width||size.height!==asset.height)throw new Error('CUSTOM_SOURCE_SIZE_CHANGED')
   flushSync(()=>{sourceView.accept(file,asset);model.change(prev=>({...prev,spriteFile:file,info:{w:asset.width,h:asset.height},...clearedCustomSeams(),planResult:null,splitResult:null,composedResult:null}))})
   if(before.activeTab==='auto'&&!before.sliceL7)setAutoTicket(v=>v+1)
  })().catch(error=>{if(alive.current&&!operation.controller.signal.aborted){setStatus(String(error));message.error(String(error))}})
  const canceled=new Promise<void>(resolve=>operation.controller.signal.addEventListener('abort',()=>resolve(),{once:true}))
  operation.promise=Promise.race([work,canceled]).finally(()=>{if(incoming.current===operation){incoming.current=null;if(alive.current)setPreparing(false)}});return operation.promise
 }
 const clearImage=()=>{incoming.current?.controller.abort();pendingAuto.current=null;model.change(prev=>({...prev,spriteFile:null,info:null,...clearedCustomSeams(),planResult:null,splitResult:null,composedResult:null}))}
 const setActiveTab=(activeTab:CustomSliceDraft['activeTab'])=>{model.change(prev=>({...prev,activeTab,...(activeTab==='grid'&&prev.previewMeta&&(prev.columns!==prev.previewMeta.cols||prev.rows!==prev.previewMeta.rows)?clearedCustomSeams():{})}));if(activeTab==='auto'&&!sliceL7&&spriteFile)setAutoTicket(v=>v+1)}
 const setSliceL7=(sliceL7:boolean)=>{model.change(prev=>({...prev,sliceL7,...clearedCustomSeams()}));if(!sliceL7&&activeTab==='auto'&&spriteFile)setAutoTicket(v=>v+1)}
 const setColumns=(n:number)=>model.change(prev=>{const columns=Math.max(1,Math.min(64,Math.floor(n)));return columns===prev.columns?prev:{...prev,columns,...clearedCustomSeams()}})
 const setRows=(n:number)=>model.change(prev=>{const rows=Math.max(1,Math.min(64,Math.floor(n)));return rows===prev.rows?prev:{...prev,rows,...clearedCustomSeams()}})
 const setPreviewRowBoundary=(i:number,y:number)=>model.change(prev=>{if(!prev.previewRowStarts)return prev;const next=[...prev.previewRowStarts],lo=next[i-1]+1,hi=next[i+1]-1;if(lo>=hi)return prev;next[i]=Math.max(lo,Math.min(hi,Math.floor(y)));return {...prev,previewRowStarts:next}})
 const setPreviewColBoundary=(j:number,x:number)=>model.change(prev=>{if(!prev.previewColStarts||!prev.info)return prev;const next=[...prev.previewColStarts],lo=next[j-1]+1,hi=next[j+1]-1;if(lo>=hi)return prev;next[j]=Math.max(lo,Math.min(hi,Math.floor(x)));const bounds=bandColOffsetBounds(next),limit=maxPolyDeltaX(next,prev.info.w);return {...prev,previewColStarts:next,l7BandColOffset:prev.l7BandColOffset.map(v=>Math.max(bounds.min,Math.min(bounds.max,v))),l7PolyDeltaX:Math.max(-limit,Math.min(limit,prev.l7PolyDeltaX))}})
 const setL7BandColOffsetBand=(index:number,value:number)=>model.change(prev=>{if(!prev.previewColStarts||!prev.previewMeta)return prev;const bounds=bandColOffsetBounds(prev.previewColStarts),v=Math.max(bounds.min,Math.min(bounds.max,Math.floor(value))),next=Array.from({length:prev.previewMeta.rows},(_,i)=>prev.l7BandColOffset[i]??0);if(next.length>=2&&index<2){next[0]=v;next[1]=v}else next[index]=v;return {...prev,l7BandColOffset:next}})
 const computeL7Preview=(mode:'l7'|'uniform')=>execute('plan',mode),runSplit=()=>execute('split'),runCompose=()=>execute('compose')
 const addRegion=()=>{if(regions.length>=4096){message.error('CUSTOM_CELL_LIMIT');return}model.change(prev=>({...prev,regions:[...prev.regions,{id:crypto.randomUUID(),x:0,y:0,w:32,h:32}]}))}
 const updateRegion=(id:string,key:'id'|'x'|'y'|'w'|'h',value:number)=>{if(key!=='id')model.change(prev=>({...prev,regions:prev.regions.map(r=>r.id===id?{...r,[key]:value}:r)}))}
 const removeRegion=(id:string)=>model.change(prev=>({...prev,regions:prev.regions.filter(r=>r.id!==id)}))
 const download=(file:File,name:string)=>{const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const downloadZip=()=>{if(d.splitResult)download(d.splitResult.data,(spriteFile?.name.replace(/\.[^.]+$/,'')||'slices')+'_slices.zip')}
 const downloadComposed=()=>{if(d.composedResult)download(d.composedResult.data,(spriteFile?.name.replace(/\.[^.]+$/,'')||'slices')+'_composed.png')}
 const resizeGrid=(grid:number[][],r:number,c:number)=>Array.from({length:r},(_,y)=>Array.from({length:c},(_,x)=>{const v=grid[y]?.[x]??0;return Math.abs(v)<=frameSizes.length?v:0}))
 const setRearrangeRowsAndResize=(n:number)=>{const r=Math.max(1,Math.min(64,Math.floor(n)));model.change(prev=>({...prev,rearrangeRows:r,rearrangeGrid:resizeGrid(prev.rearrangeGrid,r,prev.rearrangeCols)}))}
 const setRearrangeColsAndResize=(n:number)=>{const c=Math.max(1,Math.min(64,Math.floor(n)));model.change(prev=>({...prev,rearrangeCols:c,rearrangeGrid:resizeGrid(prev.rearrangeGrid,prev.rearrangeRows,c)}))}
 const setGridCell=(row:number,col:number,value:number)=>model.change(prev=>{const grid=prev.rearrangeGrid.map(r=>[...r]);grid[row][col]=Math.max(-frameSizes.length,Math.min(frameSizes.length,Math.floor(value)));return {...prev,rearrangeGrid:grid}})
 const saveRearrangeToTxt=()=>download(new File([JSON.stringify({rows:rearrangeRows,cols:rearrangeCols,grid:rearrangeGrid},null,2)],'rearrange_params.txt',{type:'text/plain;charset=utf-8'}),'rearrange_params.txt')
 const loadRearrangeFromTxt=(file:File)=>{
   void beforeAction().then(()=>{
    const before=model.current()
    const work=(async()=>{
     if(file.size>256*1024)throw new Error('CUSTOM_REARRANGE_TEXT_LIMIT')
     const value=await file.text();if(!alive.current||model.current()!==before||pendingGesture.current||incoming.current)throw new Error('CUSTOM_REARRANGE_EDITS_CHANGED')
     const parsed=parseRearrangeText(value,frameSizes.length)
     flushSync(()=>model.change(prev=>({...prev,rearrangeRows:parsed.rows,rearrangeCols:parsed.cols,rearrangeGrid:parsed.grid})))
     message.success(t('roninProCustomSliceRearrangeLoadSuccess'))
     if(parsed.corrections.length)message.warning(parsed.corrections.map(code=>code.startsWith('CUSTOM_REARRANGE_AXES')?notice('行列已调整为 1–64 的整数','Rows and columns normalized to integers from 1 to 64','行列を 1～64 の整数に調整しました'):code.startsWith('CUSTOM_REARRANGE_EXTRA')?notice('已移除布局外的格子','Cells outside the layout removed','配置外のセルを削除しました'):code.startsWith('CUSTOM_REARRANGE_UNKNOWN')?notice('已忽略未知字段：','Unknown fields ignored: ','未対応の項目を無視：')+code.split(': ').slice(1).join(': '):notice('已修正无效帧编号：','Invalid frame indices corrected: ','無効なフレーム番号を修正：')+code.split(': ').at(-1)).join('; '))
    })()
    textRead.current=work
    return work.finally(()=>{if(textRead.current===work)textRead.current=null})
   }).catch(e=>{if(alive.current)message.error(String(e))})
 }
 const applyExpandPreset=(w:number,h=w)=>{
  if(!frameSizes.length)return
  const cellW=Math.max(...frameSizes.map(s=>s.w)),cellH=Math.max(...frameSizes.map(s=>s.h)),dw=Math.max(0,w-cellW),dh=Math.max(0,h-cellH)
  model.change(prev=>({...prev,expandLeft:Math.ceil(dw/2),expandRight:Math.floor(dw/2),expandUp:prev.expandMode==='heightUpOnly'?dh:Math.ceil(dh/2),expandDown:prev.expandMode==='heightUpOnly'?0:Math.floor(dh/2)}))
 }
 useEffect(()=>{try{localStorage.setItem(REARRANGE_STORAGE_KEY,JSON.stringify({rows:rearrangeRows,cols:rearrangeCols,grid:rearrangeGrid}))}catch{/* The formal project remains authoritative if browser storage is unavailable. */}},[rearrangeRows,rearrangeCols,rearrangeGrid])
 const cellW=frameSizes.length?Math.max(...frameSizes.map(s=>s.w)):0,cellH=frameSizes.length?Math.max(...frameSizes.map(s=>s.h)):0,paddedCellW=cellW+expandLeft+expandRight,paddedCellH=cellH+expandUp+expandDown,composedOutW=rearrangeCols*paddedCellW,composedOutH=rearrangeRows*paddedCellH
 const showL7SeamCanvas=!!(spriteFile&&sliceL7&&activeTab!=='custom'&&previewMeta&&previewRowStarts&&previewColStarts&&spritePreviewUrl)

  return (
    <CustomSliceDocumentSurface model={model} beforeAction={beforeAction} hasPendingEdits={hasPendingEdits}><Space direction="vertical" size="large" style={{ width: '100%' }}>
      <input ref={rearrangeInput} type="file" accept=".txt,text/plain" hidden onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)loadRearrangeFromTxt(file)}}/>
      <Text type="secondary">{t('roninProCustomSliceHint')}</Text>
      {(loading||preparing||sourceView.loading||archiveView.loading)&&<Space>{loading?<Progress percent={Math.round(progress*100)} style={{width:180}}/>:<Text>{notice('准备预览…','Preparing previews…','プレビューを準備中…')}</Text>}<Button loading={canceling} onClick={()=>{if(controller.current){setCanceling(true);controller.current.abort()}else if(incoming.current){incoming.current.controller.abort();setStatus(notice('素材准备已取消','Input preparation canceled','素材の準備を取り消しました'))}else if(sourceView.loading)sourceView.cancel();else archiveView.cancel()}}>{notice('取消加工','Cancel processing','処理を取消')}</Button></Space>}
      {status&&<Text role="status">{status}</Text>}
      {sourceSizeChanged&&<Text role="alert">CUSTOM_SOURCE_SIZE_CHANGED</Text>}
      {(splitOutdated||composedOutdated)&&<Text type="secondary">{notice('当前显示上次结果；重新执行才会应用新参数。','Showing saved results; run again to apply changed parameters.','前回の結果を表示中です。変更を適用するには再実行してください。')}</Text>}
      {(sourceView.error||archiveView.error)&&<Space><Text role="alert">{(sourceView.error||archiveView.error)==='CUSTOM_PREVIEW_CANCELED'?notice('预览已取消；原文件和结果仍保留','Preview canceled; original files and results are retained','プレビューを取り消しました。元ファイルと結果は保持されています'):sourceView.error||archiveView.error}</Text><Button onClick={()=>{if(sourceView.error)sourceView.retry();if(archiveView.error)archiveView.retry()}}>{notice('重试预览','Retry previews','プレビューを再試行')}</Button></Space>}


      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'grid' | 'custom' | 'auto')}
        items={[
          {
            key: 'auto',
            label: (
              <span>
                <ThunderboltOutlined /> {t('roninProCustomSliceAuto')}
              </span>
            ),
            children: (
              <Space direction="vertical">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('roninProCustomSliceAutoHint')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('roninProCustomSliceAutoDetectHint')}
                </Text>
              </Space>
            ),
          },
          {
            key: 'grid',
            label: (
              <span>
                <ScissorOutlined /> {t('roninProCustomSliceGrid')}
              </span>
            ),
            children: (
              <Space direction="vertical">
                <Space wrap>
                  <span>
                    <Text type="secondary">{t('spriteColumns')}:</Text>
                    <InputNumber
                      min={1}
                      max={64}
                      aria-label={t('spriteColumns')}
                      precision={0}
                      value={columns}
                      onChange={(v) => setColumns(v ?? 8)}
                      style={{ width: 80, marginLeft: 8 }}
                    />
                  </span>
                  <span>
                    <Text type="secondary">{t('spriteRows')}:</Text>
                    <InputNumber
                      min={1}
                      max={64}
                      aria-label={t('spriteRows')}
                      precision={0}
                      value={rows}
                      onChange={(v) => setRows(v ?? 4)}
                      style={{ width: 80, marginLeft: 8 }}
                    />
                  </span>
                </Space>
              </Space>
            ),
          },
          {
            key: 'custom',
            label: (
              <span>
                <ScissorOutlined /> {t('roninProCustomSliceRegions')}
              </span>
            ),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button type="dashed" icon={<PlusOutlined />} onClick={addRegion}>
                  {t('roninProCustomSliceAddRegion')}
                </Button>
                {regions.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('roninProCustomSliceAddRegionHint')}
                  </Text>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {regions.map((r,index) => (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        padding: 8,
                        background: 'rgba(0,0,0,0.04)',
                        borderRadius: 8,
                      }}
                    >
                      <InputNumber
                        size="small"
                        addonBefore="X"
                        aria-label={`${t('roninProCustomSliceRegions')} ${index+1} X`}
                        max={30000}
                        value={r.x}
                        min={0}
                        onChange={(v) => updateRegion(r.id, 'x', v ?? 0)}
                        style={{ width: 90 }}
                      />
                      <InputNumber
                        size="small"
                        addonBefore="Y"
                        aria-label={`${t('roninProCustomSliceRegions')} ${index+1} Y`}
                        max={30000}
                        value={r.y}
                        min={0}
                        onChange={(v) => updateRegion(r.id, 'y', v ?? 0)}
                        style={{ width: 90 }}
                      />
                      <InputNumber
                        size="small"
                        addonBefore="W"
                        aria-label={`${t('roninProCustomSliceRegions')} ${index+1} W`}
                        max={30000}
                        value={r.w}
                        min={1}
                        onChange={(v) => updateRegion(r.id, 'w', v ?? 32)}
                        style={{ width: 90 }}
                      />
                      <InputNumber
                        size="small"
                        addonBefore="H"
                        aria-label={`${t('roninProCustomSliceRegions')} ${index+1} H`}
                        max={30000}
                        value={r.h}
                        min={1}
                        onChange={(v) => updateRegion(r.id, 'h', v ?? 32)}
                        style={{ width: 90 }}
                      />
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => removeRegion(r.id)}
                      />
                    </div>
                  ))}
                </div>
              </Space>
            ),
          },
        ]}
      />

      <StashDropZone
        onStashDrop={(f) => {void applyImage(f)}}
      >
        <Dragger
          accept={IMAGE_ACCEPT.join(',')}
          maxCount={1}
          fileList={spriteFile ? [{ uid: '1', name: spriteFile.name } as UploadFile] : []}
          beforeUpload={(f) => {
            void applyImage(f)
            return false
          }}
          onRemove={clearImage}
        >
          <p className="ant-upload-text">{notice('点击或拖入 PNG / JPEG / WebP','Click or drop PNG / JPEG / WebP','PNG / JPEG / WebP を選択・ドロップ')}</p>
        </Dragger>
      </StashDropZone>

      {spriteFile && activeTab !== 'custom' && (
        <div>
          <Checkbox checked={sliceL7} onChange={(e) => setSliceL7(e.target.checked)}>
            {t('roninProCustomSliceL7')}
          </Checkbox>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, paddingLeft: 24, marginTop: 2 }}>
            {t('roninProCustomSliceL7Hint')}
          </Text>
        </div>
      )}

      {spriteFile && spritePreviewUrl && !showL7SeamCanvas && (
        <>
          <Text strong>{t('imgOriginalPreview')}</Text>
          <div
            style={{
              padding: 16,
              background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
              borderRadius: 8,
              border: '1px solid #9a8b78',
              display: 'inline-block',
            }}
          >
            <StashableImage
              src={spritePreviewUrl}
              stashSrc={sourcePreview?.raw}
              alt=""
              style={{ maxWidth: 320, maxHeight: 240, display: 'block', imageRendering: 'pixelated' }}
            />
          </div>
        </>
      )}

      {spriteFile && sliceL7 && activeTab !== 'custom' && (
        <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 960 }}>
          <Text strong>{t('roninProCustomSliceL7PreviewTitle')}</Text>
          {(!previewMeta || previewMeta.rows !== 1) && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                {t('roninProCustomSliceL7Band')}
              </Text>
              <Slider
                min={10}
                max={50}
                step={1}
                value={l7BandPercent}
                onChange={setL7BandPercent}
                style={{ maxWidth: 280 }}
                tooltip={{ formatter: (v) => `${v}%` }}
              />
            </div>
          )}
          <Space wrap>
            <Button disabled={loading||preparing||!sourcePreview} loading={busy==='plan'} onClick={() => void computeL7Preview('l7')}>
              {t('roninProCustomSliceL7PreviewL7')}
            </Button>
            <Button disabled={loading||preparing||!sourcePreview} loading={busy==='plan'} onClick={() => void computeL7Preview('uniform')}>
              {t('roninProCustomSliceL7PreviewUniform')}
            </Button>
          </Space>
          {previewMeta && previewRowStarts && previewColStarts && spritePreviewUrl && (
            <>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                {previewMeta.rows === 1
                  ? t('roninProCustomSliceL7PolySeamHint')
                  : t('roninProCustomSliceL7StraightSeams')}
              </Text>
              {previewMeta.rows > 1 && (
                <Text type="warning" style={{ fontSize: 12, display: 'block' }}>
                  {t('roninProCustomSliceL7PolyMultiRowWarn')}
                </Text>
              )}
              {previewMeta.rows === 1 &&
                (l7PolyBendY <= 0 || l7PolyBendY >= previewMeta.h) && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    {t('roninProCustomSliceL7PolyBendRangeHint')}
                  </Text>
                )}
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                {previewMeta.rows === 1
                  ? t('roninProCustomSliceL7PolyDragHint')
                  : t('roninProCustomSliceL7DragHint')}
              </Text>
              <RoninProL7SeamPreview
                imageUrl={spritePreviewUrl!}
                controlRef={finishSeam}
                onInteractionChange={interactionChange}
                label={notice('L7 切线预览','L7 seam preview','L7 切り線プレビュー')}
                imageW={previewMeta.w}
                imageH={previewMeta.h}
                rowStarts={previewRowStarts}
                colStarts={previewColStarts}
                bandColOffset={l7BandColOffset}
                singleRowPolyline={
                  previewMeta.rows === 1
                    ? { bendY: l7PolyBendY, deltaX: l7PolyDeltaX }
                    : undefined
                }
                onRowBoundaryChange={setPreviewRowBoundary}
                onColBoundaryChange={setPreviewColBoundary}
              />
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {previewMeta.rows === 1 &&
                  (() => {
                    const dxMax = maxPolyDeltaX(previewColStarts, previewMeta.w)
                    const bendY = Math.max(0, Math.min(previewMeta.h, Math.round(l7PolyBendY)))
                    const deltaX = Math.max(-dxMax, Math.min(dxMax, Math.round(l7PolyDeltaX)))
                    return (
                      <Space
                        direction="vertical"
                        size="small"
                        style={{ width: '100%', maxWidth: 640, marginBottom: 12 }}
                      >
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('roninProCustomSliceL7PolyParamsTitle')}
                        </Text>
                        <div style={{ width: '100%' }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              flexWrap: 'wrap',
                              marginBottom: 6,
                            }}
                          >
                            <Text type="secondary" style={{ fontSize: 11, flex: '1 1 200px' }}>
                              {t('roninProCustomSliceL7PolyBendY')}
                            </Text>
                            <InputNumber
                              size="small"
                              min={0}
                              max={previewMeta.h}
                              aria-label={t('roninProCustomSliceL7PolyBendY')}
                          value={bendY}
                              onChange={(v) => v != null && setL7PolyBendY(Math.round(v))}
                              style={{ width: 96 }}
                            />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {t('roninProCustomSliceL7PolyBendLimit', { h: previewMeta.h })}
                            </Text>
                          </div>
                          <Slider
                            min={0}
                            max={previewMeta.h}
                            step={1}
                            aria-label={t('roninProCustomSliceL7PolyBendY')}
                          value={bendY}
                            onChange={(v) => setL7PolyBendY(v)}
                            tooltip={{ formatter: (n) => `${n}px` }}
                          />
                        </div>
                        <div style={{ width: '100%' }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              flexWrap: 'wrap',
                              marginBottom: 6,
                            }}
                          >
                            <Text type="secondary" style={{ fontSize: 11, flex: '1 1 200px' }}>
                              {t('roninProCustomSliceL7PolyDeltaX')}
                            </Text>
                            <InputNumber
                              size="small"
                              min={-dxMax}
                              max={dxMax}
                              aria-label={t('roninProCustomSliceL7PolyDeltaX')}
                          value={deltaX}
                              onChange={(v) =>
                                v != null &&
                                setL7PolyDeltaX(
                                  Math.max(-dxMax, Math.min(dxMax, Math.round(v)))
                                )
                              }
                              style={{ width: 96 }}
                            />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {t('roninProCustomSliceL7PolyDeltaLimit', { m: dxMax })}
                            </Text>
                          </div>
                          <Slider
                            min={-dxMax}
                            max={dxMax}
                            step={1}
                            aria-label={t('roninProCustomSliceL7PolyDeltaX')}
                          value={deltaX}
                            onChange={(v) =>
                              setL7PolyDeltaX(
                                Math.max(-dxMax, Math.min(dxMax, Math.round(v)))
                              )
                            }
                            tooltip={{ formatter: (n) => `${n}px` }}
                          />
                        </div>
                      </Space>
                    )
                  })()}
                {previewRowStarts.length > 2 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('roninProCustomSliceL7AdjustH')}
                  </Text>
                )}
                {previewRowStarts.slice(1, -1).map((y, idx) => {
                  const i = idx + 1
                  const lo = previewRowStarts[i - 1]! + 1
                  const hi = previewRowStarts[i + 1]! - 1
                  return (
                    <div key={`rh-${i}`} style={{ width: '100%', maxWidth: 640 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12, minWidth: 72 }}>
                          {t('roninProCustomSliceL7HLine', { i: i + 1 })}
                        </Text>
                        <InputNumber
                          size="small"
                          min={lo}
                          max={hi}
                          aria-label={t('roninProCustomSliceL7HLine',{i:i+1})}
                          value={y}
                          onChange={(v) => v != null && setPreviewRowBoundary(i, v)}
                          style={{ width: 88 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Y px ({lo}–{hi})
                        </Text>
                      </div>
                      {lo < hi && (
                        <Slider
                          min={lo}
                          max={hi}
                          aria-label={t('roninProCustomSliceL7HLine',{i:i+1})}
                          value={y}
                          onChange={(v) => setPreviewRowBoundary(i, v)}
                          tooltip={{ formatter: (n) => `${n}` }}
                        />
                      )}
                    </div>
                  )
                })}
                {previewColStarts.length > 2 && (
                  <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                    {t('roninProCustomSliceL7AdjustV')}
                  </Text>
                )}
                {previewColStarts.slice(1, -1).map((x, idx) => {
                  const j = idx + 1
                  const lo = previewColStarts[j - 1]! + 1
                  const hi = previewColStarts[j + 1]! - 1
                  return (
                    <div key={`cv-${j}`} style={{ width: '100%', maxWidth: 640 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12, minWidth: 72 }}>
                          {t('roninProCustomSliceL7VLine', { j: j + 1 })}
                        </Text>
                        <InputNumber
                          size="small"
                          min={lo}
                          max={hi}
                          aria-label={t('roninProCustomSliceL7VLine',{j:j+1})}
                          value={x}
                          onChange={(v) => v != null && setPreviewColBoundary(j, v)}
                          style={{ width: 88 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          X px ({lo}–{hi})
                        </Text>
                      </div>
                      {lo < hi && (
                        <Slider
                          min={lo}
                          max={hi}
                          aria-label={t('roninProCustomSliceL7VLine',{j:j+1})}
                          value={x}
                          onChange={(v) => setPreviewColBoundary(j, v)}
                          tooltip={{ formatter: (n) => `${n}` }}
                        />
                      )}
                    </div>
                  )
                })}
                {previewMeta.rows > 1 &&
                  l7BandColOffset.length === previewMeta.rows &&
                  (() => {
                    const b = bandColOffsetBounds(previewColStarts)
                    const rowsN = previewMeta.rows
                    if (b.min > b.max) return null
                    return (
                      <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 640, marginTop: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('roninProCustomSliceL7JaggedTitle')}
                        </Text>
                        {rowsN === 2 && (
                          <>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {t('roninProCustomSliceL7Band01Sync')}
                            </Text>
                            <Slider
                              min={b.min}
                              max={b.max}
                              aria-label={t('roninProCustomSliceL7Band01Sync')}
                          value={l7BandColOffset[0] ?? 0}
                              onChange={(v) => setL7BandColOffsetBand(0, v)}
                              tooltip={{ formatter: (n) => `${n}px` }}
                            />
                          </>
                        )}
                        {rowsN >= 3 && (
                          <>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {t('roninProCustomSliceL7Band01Sync')}
                            </Text>
                            <Slider
                              min={b.min}
                              max={b.max}
                              aria-label={t('roninProCustomSliceL7Band01Sync')}
                          value={l7BandColOffset[0] ?? 0}
                              onChange={(v) => setL7BandColOffsetBand(0, v)}
                              tooltip={{ formatter: (n) => `${n}px` }}
                            />
                            {Array.from({ length: rowsN - 2 }, (_, k) => k + 2).map((bandIdx) => (
                              <div key={`jag-${bandIdx}`} style={{ width: '100%' }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {t('roninProCustomSliceL7BandSegOffset', { n: bandIdx + 1 })}
                                </Text>
                                <Slider
                                  min={b.min}
                                  max={b.max}
                                  aria-label={t('roninProCustomSliceL7BandSegOffset',{n:bandIdx+1})}
                          value={l7BandColOffset[bandIdx] ?? 0}
                                  onChange={(v) => setL7BandColOffsetBand(bandIdx, v)}
                                  tooltip={{ formatter: (n) => `${n}px` }}
                                />
                              </div>
                            ))}
                          </>
                        )}
                      </Space>
                    )
                  })()}
              </Space>
            </>
          )}
        </Space>
      )}

      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space>
        <Button
          type="primary"
          loading={loading}
          onClick={runSplit}
          disabled={
            !spriteFile || preparing || loading || !sourcePreview ||

            (activeTab === 'custom' && regions.length === 0)
          }
        >
          {sliceL7 && activeTab !== 'custom'
            ? t('roninProCustomSliceL7ApplySplit')
            : activeTab === 'auto'
              ? t('roninProCustomSliceAutoSplit')
              : t('spriteSplit')}
        </Button>
        {zipUrl && (
          <Button icon={<DownloadOutlined />} onClick={downloadZip}>
            {t('gifDownloadFrames')}
          </Button>
        )}
        </Space>
      </Space>

      {framePreviewUrls.length > 0 && (
        <>
          <Text strong>{t('imgPreview')} ({t('roninProCustomSliceFrameIndex')}: 1~{frameBlobUrls.length}, 0={t('roninProCustomSliceTransparent')}, {t('roninProCustomSliceFrameIndexFlipHint')})</Text>
          <div
            style={{
              padding: 16,
              background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
              borderRadius: 8,
              border: '1px solid #9a8b78',
              display: 'inline-block',
              maxWidth: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                maxHeight: 320,
                overflow: 'auto',
              }}
            >
              {framePreviewUrls.map((url, i) => (
                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                  <StashableImage
                    src={url}
                    stashSrc={frameBlobUrls[i]}
                    alt={`frame ${i}`}
                    style={{
                      width: 48,
                      height: 48,
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 2,
                      top: 2,
                      fontSize: 10,
                      fontWeight: 'bold',
                      color: '#fff',
                      textShadow: '0 0 2px #000, 0 0 2px #000',
                    }}
                  >
                    {i + 1}
                  </span>
                </div>
              ))}
              {frameBlobUrls.length > 24 && (
                <span style={{ alignSelf: 'center', color: '#999', fontSize: 12 }}>
                  ... +{frameBlobUrls.length - 24}
                </span>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <Text strong>{t('roninProCustomSliceRearrange')}</Text>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
              <span>
                <Text type="secondary">{t('roninProCustomSliceRearrangeRows')}:</Text>
                <InputNumber
                  min={1}
                  max={64}
                  aria-label={t('roninProCustomSliceRearrangeRows')}
                      precision={0}
                      value={rearrangeRows}
                  onChange={(v) => setRearrangeRowsAndResize(v ?? 1)}
                  style={{ width: 64, marginLeft: 8 }}
                />
              </span>
              <span>
                <Text type="secondary">{t('roninProCustomSliceRearrangeCols')}:</Text>
                <InputNumber
                  min={1}
                  max={64}
                  aria-label={t('roninProCustomSliceRearrangeCols')}
                      precision={0}
                      value={rearrangeCols}
                  onChange={(v) => setRearrangeColsAndResize(v ?? 1)}
                  style={{ width: 64, marginLeft: 8 }}
                />
              </span>
              <Button icon={<SaveOutlined />} onClick={saveRearrangeToTxt}>
                {t('roninProCustomSliceRearrangeSaveToTxt')}
              </Button>
              <Button icon={<FolderOpenOutlined />} onClick={()=>rearrangeInput.current?.click()}>
                {t('roninProCustomSliceRearrangeLoadFromTxt')}
              </Button>
              <Button type="primary" loading={busy==='compose'} disabled={loading||preparing} onClick={runCompose}>
                {t('roninProCustomSliceCompose')}
              </Button>
              {composedUrl && (
                <Button icon={<DownloadOutlined />} onClick={downloadComposed}>
                  {t('roninProCustomSliceDownloadComposed')}
                </Button>
              )}
            </div>
            <div style={{ marginTop: 8, overflowX: 'auto' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  background: '#fff',
                  border: '1px solid #d9d9d9',
                }}
              >
                <tbody>
                  {rearrangeGrid.map((rowData, row) => (
                    <tr key={row}>
                      {rowData.map((val, col) => (
                        <td
                          key={col}
                          style={{
                            border: '1px solid #d9d9d9',
                            padding: 2,
                          }}
                        >
                          <InputNumber
                            size="small"
                            min={-frameBlobUrls.length}
                            max={frameBlobUrls.length}
                            aria-label={notice(`重排第 ${row+1} 行第 ${col+1} 列`,`Grid row ${row+1} column ${col+1}`,`配置 ${row+1} 行 ${col+1} 列`)}
                            precision={0}
                            value={val}
                            onChange={(v) => setGridCell(row, col, v ?? 0)}
                            style={{ width: 52 }}
                            placeholder="0"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16 }}>
              <Text strong>{t('roninProCustomSliceExpand')}</Text>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('roninProCustomSliceExpandMode')}:</Text>
                <Button.Group size="small">
                  <Button type={expandMode === 'all' ? 'primary' : 'default'} onClick={() => setExpandMode('all')}>
                    {t('roninProCustomSliceExpandModeAll')}
                  </Button>
                  <Button type={expandMode === 'heightUpOnly' ? 'primary' : 'default'} onClick={() => setExpandMode('heightUpOnly')}>
                    {t('roninProCustomSliceExpandModeHeightUpOnly')}
                  </Button>
                </Button.Group>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <span>
                  <Text type="secondary">{t('roninProCustomSliceExpandUp')}:</Text>
                  <InputNumber
                    min={0}
                    max={149}
                    aria-label={t('roninProCustomSliceExpandUp')}
                      precision={0}
                      value={expandUp}
                    onChange={(v) => setExpandUp(v ?? 0)}
                    style={{ width: 56, marginLeft: 6 }}
                  />
                </span>
                <span>
                  <Text type="secondary">{t('roninProCustomSliceExpandDown')}:</Text>
                  <InputNumber
                    min={0}
                    max={149}
                    aria-label={t('roninProCustomSliceExpandDown')}
                      precision={0}
                      value={expandDown}
                    onChange={(v) => setExpandDown(v ?? 0)}
                    style={{ width: 56, marginLeft: 6 }}
                  />
                </span>
                <span>
                  <Text type="secondary">{t('roninProCustomSliceExpandLeft')}:</Text>
                  <InputNumber
                    min={0}
                    max={149}
                    aria-label={t('roninProCustomSliceExpandLeft')}
                      precision={0}
                      value={expandLeft}
                    onChange={(v) => setExpandLeft(v ?? 0)}
                    style={{ width: 56, marginLeft: 6 }}
                  />
                </span>
                <span>
                  <Text type="secondary">{t('roninProCustomSliceExpandRight')}:</Text>
                  <InputNumber
                    min={0}
                    max={149}
                    aria-label={t('roninProCustomSliceExpandRight')}
                      precision={0}
                      value={expandRight}
                    onChange={(v) => setExpandRight(v ?? 0)}
                    style={{ width: 56, marginLeft: 6 }}
                  />
                </span>
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('roninProCustomSliceExpandPreset')}:</Text>
                {[32, 48, 64, 96, 128, 144, 150].map((n) => (
                  <Button key={n} size="small" onClick={() => applyExpandPreset(n)}>
                    {n}×{n}
                  </Button>
                ))}
                <Button size="small" onClick={() => applyExpandPreset(32, 64)}>
                  32×64
                </Button>
              </div>
              <Text type="secondary" style={{ marginTop: 8, fontSize: 12, display: 'block' }}>
                {t('roninProCustomSliceExpandSizeHint', {
                  cellW: paddedCellW,
                  cellH: paddedCellH,
                  outW: composedOutW,
                  outH: composedOutH,
                })}
              </Text>
            </div>

            {composedUrl && (
              <div style={{ marginTop: 12 }}>
                <Text strong>{t('roninProCustomSliceComposedPreview')}</Text>
                <div
                  style={{
                    marginTop: 8,
                    padding: 16,
                    background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                    borderRadius: 8,
                    border: '1px solid #9a8b78',
                    display: 'inline-block',
                  }}
                >
                  <StashableImage
                    src={composedPreviewUrl}
                    stashSrc={composedUrl}
                    alt="composed"
                    style={{ maxWidth: 320, maxHeight: 240, display: 'block', imageRendering: 'pixelated' }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Space></CustomSliceDocumentSurface>
  )
}

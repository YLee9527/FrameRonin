import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {Alert,Button,Checkbox,Divider,InputNumber,Pagination,Progress,Radio,Select,Slider,Space,Typography,Upload,message} from 'antd'
import type {UploadFile} from 'antd'
import {DownloadOutlined,PictureOutlined,PlayCircleOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {flowReports,flowNeedsBrowserDecode,sortFlowFiles,type FlowDraft,type FlowResult} from '../localProject/flowDocument'
import {useFlowDocument} from '../localProject/useFlowDocument'
import {FlowDocumentSurface} from '../localProject/FlowDocumentSurface'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {cacheManagedInput,importManagedInputs,runManagedTask} from '../localProject/managedTasks'
import {useSpriteBlobUrls} from '../localProject/useSpriteSheetAssets'
import StashDropZone from './StashDropZone'
import StashableImage from './StashableImage'
import {useImageStash} from '../stash/context'
import {stashTransferName} from '../stash/transfer'
const checkered='repeating-conic-gradient(#c9bfb0 0% 25%,#e4dbcf 0% 50%) 50% / 16px 16px'
const report=(r:FlowResult|null)=>r?flowReports.get(r.report):undefined
function download(file:File,name:string){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

/** Full original optical-flow module; all frame decoding/processing/export is
 * owned by project tasks. The view only decodes bounded server thumbnails. */
export default function RoninProAdvancedPixel(){
 const {lang,t}=useLanguage(),tx=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 const {addImage,items:stashItems}=useImageStash()
 const model=useFlowDocument(),d=model.draft,p=d.options,{current,retained,dispatch,change:changeDraft}=model
 const alive=useRef(true),epoch=useRef(0),pointer=useRef(false),main=useRef<AbortController|null>(null),importing=useRef<AbortController|null>(null),transient=useRef(new Set<File>())
 const stashRead=useRef<AbortController|null>(null),[stashSelection,setStashSelection]=useState<string>(),[stashBusy,setStashBusy]=useState(false)
 const [busy,setBusy]=useState(''),[preparing,setPreparing]=useState(false),[importError,setImportError]=useState(''),[importAttempt,setImportAttempt]=useState(0),[revision,setRevision]=useState(0),[progress,setProgress]=useState(0),[canceling,setCanceling]=useState(false)
 const change=useCallback((update:(draft:FlowDraft)=>FlowDraft)=>{epoch.current++;changeDraft(update)},[changeDraft])
 const inputs=useMemo(()=>d.inputMode==='files'?sortFlowFiles(d.files):d.sheet?[d.sheet]:[],[d.inputMode,d.files,d.sheet])
 const byteBudget=useCallback(()=>{
  const files=[...new Set([...retained(),...transient.current])]
  return 96*1024**2+files.reduce((n,f)=>n+f.size*2+(imageToolMetadata.get(f)?.metadata.thumbnailDataUrl?.length??0)*2,0)+128*256**2*8
 },[retained])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;importing.current?.abort();stashRead.current?.abort()}},[])
 useEffect(()=>{
  const abort=new AbortController();importing.current=abort
  void(async()=>{await Promise.resolve();if(abort.signal.aborted)return;setPreparing(!!inputs.length);setImportError('')
   const result=await importManagedInputs(inputs,abort.signal,(f,v)=>{if(f instanceof File)imageToolMetadata.set(f,v)})
   for(const v of result.versions){const m=v.metadata;if(m.kind!=='image'||(m.frames??1)!==1||!['PNG','JPEG','WEBP'].includes(m.containerFormat??'')||m.bytes>20*1024**2||Math.max(m.width??0,m.height??0)>30000)throw new Error('FLOW_SOURCE_FORMAT')}
   if(byteBudget()>result.memoryBudgetBytes)throw new Error('FLOW_FRONTEND_RESOURCE_LIMIT')
   if(alive.current&&!abort.signal.aborted)setRevision(v=>v+1)
  })().catch(e=>{if(alive.current&&!abort.signal.aborted)setImportError(String(e))}).finally(()=>{if(importing.current===abort){importing.current=null;if(alive.current)setPreparing(false)}})
  return()=>abort.abort()
 },[inputs,importAttempt,byteBudget])
 const ready=!preparing&&!importError&&inputs.length>0&&inputs.every(f=>imageToolMetadata.has(f)),first=inputs[0],firstMetadata=first?imageToolMetadata.get(first):undefined
 const sendToStash=async(file:File)=>{try{await addImage(URL.createObjectURL(file),file.name,true);if(alive.current)message.success(t('imgFineEditorSendToStashSuccess'))}catch(error){if(alive.current)message.error(String(error))}}
 const sourceFiles=useMemo(()=>first?[first]:[],[first]),sourceUrls=useSpriteBlobUrls(sourceFiles)
 const sourceSize=firstMetadata?fineEditorDimensions(firstMetadata.metadata):null,count=d.inputMode==='files'?inputs.length:d.sheet?d.columns*d.rows:0
 const frameSize=d.inputMode==='sheet'&&sourceSize?{width:Math.max(1,Math.floor(sourceSize.width!/d.columns)),height:Math.max(1,Math.floor(sourceSize.height!/d.rows))}:sourceSize
 const resultFiles=useMemo(()=>d.flow?.outputs??[],[d.flow]),sourcePage=Math.min(d.view.sourcePage,Math.max(1,Math.ceil(d.files.length/d.view.pageSize))),page=Math.min(d.view.resultPage,Math.max(1,Math.ceil(resultFiles.length/d.view.pageSize)))
 const visible=useMemo(()=>resultFiles.slice((page-1)*d.view.pageSize,page*d.view.pageSize),[resultFiles,page,d.view.pageSize]),resultUrls=useSpriteBlobUrls(visible)
 void revision
 const options=(patch:Partial<FlowDraft['options']>)=>change(v=>({...v,options:{...v.options,...patch}}))
 const number=(label:string,value:number,apply:(n:number)=>void,min:number,max:number,step=1,disabled=false)=><label style={{display:'inline-flex',flexDirection:'column',gap:4,margin:8}}><span>{label}</span><InputNumber aria-label={label} value={value} min={min} max={max} step={step} disabled={disabled} onChange={v=>{if(v!==null)apply(Number(v))}}/></label>
 const add=(file:File)=>{if(busy)return
  if(!/\.(png|jpe?g|webp)$/i.test(file.name)||file.size>20*1024**2||!file.size||/[\\/]/.test(file.name)||[...file.name].some(c=>c.charCodeAt(0)<32)||d.inputMode==='files'&&d.files.length>=1000){message.error('FLOW_SOURCE_FORMAT');return}
  change(v=>({...v,...(v.inputMode==='files'?{files:[...v.files,file]}:{sheet:file,normalizations:v.normalizations.filter(n=>n.inputs[0]!==v.sheet)}),split:null,flow:null,zip:null,sprite:null,view:{...v.view,sourcePage:1,resultPage:1}}))
 }
 const importStash=async()=>{
  const item=stashItems.find(v=>v.id===stashSelection);if(!item||main.current||stashRead.current)return
  const abort=new AbortController(),before=current(),at=epoch.current;stashRead.current=abort;setStashBusy(true)
  try{
   if(!item.url.startsWith('data:')&&!item.url.startsWith('blob:')||item.url.startsWith('data:')&&item.url.length>30*1024**2)throw new Error('FLOW_STASH_SOURCE_LIMIT')
   const response=await fetch(item.url,{signal:abort.signal});if(!response.ok)throw new Error('FLOW_STASH_SOURCE_UNAVAILABLE')
   const blob=await response.blob();abort.signal.throwIfAborted()
   if(alive.current&&current()===before&&epoch.current===at&&!pointer.current)add(new File([blob],stashTransferName(item.name??'',blob.type),{type:blob.type}))
   else if(alive.current)message.info(tx('读取期间编辑已改变；未替换当前输入','Edits changed while reading; current inputs were preserved','読み込み中に編集が変更されました。現在の入力を保持します'))
  }catch(error){if(alive.current&&!abort.signal.aborted)message.error(String(error))}
  finally{if(stashRead.current===abort){stashRead.current=null;if(alive.current)setStashBusy(false)}}
 }
 const execute=async(operation:string,files:File[],parameters:object,signal:AbortSignal,keepForNext=false):Promise<FlowResult>=>{
  const completed=await runManagedTask(operation,files,{...parameters,frontendBytes:byteBudget()},{signal,imageResults:'encoded-only',outputFilter:()=>alive.current||keepForNext,
   onTask:()=>{if(alive.current)setProgress(0)},onProgress:v=>{if(alive.current)setProgress(n=>Math.max(n,v))}})
  if(!completed.outputs.length&&!alive.current)throw new Error('FLOW_RESULT_SAVED_TO_PROJECT')
  const outputs:File[]=[],last=completed.outputs.at(-1)
  if(!last||last.version.metadata.extension!=='.json'||completed.outputs.length<2)throw new Error('FLOW_TASK_OUTPUTS')
  for(const [i,o] of completed.outputs.entries()){
   const ext=o.version.metadata.extension!,isReport=i===completed.outputs.length-1,file=new File([o.blob],operation.replaceAll('.','-')+'-'+i+ext,{type:isReport?'application/json':ext==='.png'?'image/png':'application/zip'})
   imageToolMetadata.set(file,o.version);cacheManagedInput(file,completed.project.id,o.version.id);transient.current.add(file);outputs.push(file)
  }
  const reportFile=outputs.pop()!,value=JSON.parse(await reportFile.text());if(value.operation!==operation)throw new Error('FLOW_TASK_REPORT');flowReports.set(reportFile,value)
  return {outputs,report:reportFile,inputs:files,taskId:completed.taskId}
 }
 async function run(title:string,work:(s:FlowDraft,signal:AbortSignal)=>Promise<{normalizations?:FlowResult[];split?:FlowResult;result:FlowResult}>,apply:(s:FlowDraft,v:{normalizations?:FlowResult[];split?:FlowResult;result:FlowResult})=>FlowDraft,after?:(result:FlowResult)=>void){
  if(main.current||preparing)return
  const snapshot=current(),at=epoch.current,abort=new AbortController();main.current=abort;setBusy(title);setProgress(0);setCanceling(false)
  try{const value=await work(snapshot,abort.signal);abort.signal.throwIfAborted()
   if(alive.current&&epoch.current===at&&current()===snapshot&&!pointer.current){epoch.current++;flushSync(()=>model.change(v=>apply(v,value)));after?.(value.result)}
   else if(alive.current)message.info(tx('结果已保存到项目；当前编辑未被覆盖','Result saved to project; current edits were preserved','結果は保存済みです。現在の編集は保持されます'))
  }catch(e){if(alive.current){if(abort.signal.aborted)message.info(t('roninProFlowCanceled'));else message.error(String(e))}}
  finally{if(main.current===abort)main.current=null;transient.current.clear();if(alive.current){setBusy('');setProgress(0);setCanceling(false)}}
 }
 const interpolate=()=>{if(count<2||count>500){message.error('OPTICAL_FLOW_FRAMES: 2–500');return}void run(t('roninProFlowRun'),async(s,signal)=>{
  let split=s.split,files=sortFlowFiles(s.files)
  const normalizations=[...s.normalizations]
  const normalize=async(source:File)=>{
   const m=imageToolMetadata.get(source)!.metadata;if(!flowNeedsBrowserDecode(m))return source
   let existing=normalizations.find(n=>n.inputs[0]===source)
   if(!existing){const size=fineEditorDimensions(m);existing=await execute('image.flowNormalize',[source],{renderer:'browser-worker',width:size.width,height:size.height},signal,true);normalizations.push(existing)}
   return existing.outputs[0]
  }
  if(s.inputMode==='sheet'){
   const source=await normalize(s.sheet!)
   const q=report(split)?.parameters as {columns:number;rows:number}|undefined
   if(!split||q?.columns!==s.columns||q?.rows!==s.rows)split=await execute('image.flowSplit',[source],{columns:s.columns,rows:s.rows},signal,true)
   files=split.outputs
  }else{const decoded:File[]=[];for(const file of files)decoded.push(await normalize(file));files=decoded}
  const result=await execute('sequence.opticalFlow',files,s.options,signal);return {normalizations,split:split??undefined,result}
 },(s,{normalizations,split,result})=>({...s,normalizations:normalizations!,split:s.inputMode==='sheet'?split!:null,flow:result,zip:null,sprite:null,sheetColumns:Math.max(1,Math.ceil(Math.sqrt(result.outputs.length))),view:{...s.view,resultPage:1}}))}
 const exportResult=(format:'zip'|'sheet')=>{
  const existing=format==='zip'?d.zip:d.sprite,q=report(existing)?.parameters as {columns:number}|undefined,name=format==='zip'?'roninpro_flow_frames.zip':'roninpro_flow_spritesheet.png'
  if(existing&&(format==='zip'||q?.columns===d.sheetColumns)){download(existing.outputs[0],name);return}
  void run(format==='zip'?t('roninProFlowDownloadZip'):t('roninProFlowDownloadSheet'),async(s,signal)=>({result:await execute('sequence.flowExport',s.flow!.outputs,{format,columns:s.sheetColumns},signal)}),(s,{result})=>({...s,[format==='zip'?'zip':'sprite']:result}),r=>download(r.outputs[0],name))
 }
 const prepare=useCallback(async()=>{if(stashRead.current){stashRead.current.abort();stashRead.current=null;setStashBusy(false)}dispatch({type:'end'})},[dispatch]),pending=useCallback(()=>pointer.current||!!stashRead.current,[])
 const interaction=useCallback((active:boolean)=>{pointer.current=active;if(active)epoch.current++},[]),history=()=>{epoch.current++}
 const restore=(value:FlowDraft)=>{epoch.current++;model.apply(value)}
 const fileList:UploadFile[]=d.files.slice((sourcePage-1)*d.view.pageSize,sourcePage*d.view.pageSize).map((f,i)=>({uid:String((sourcePage-1)*d.view.pageSize+i),name:f.name,originFileObj:f as UploadFile['originFileObj']}))
 return <FlowDocumentSurface model={model} beforeAction={prepare} hasPendingEdits={pending} onInteraction={interaction} onHistory={history} onRestore={restore}>
  <section aria-label={tx('光流补帧工作台','Optical flow workbench','オプティカルフローワークベンチ')} style={{maxWidth:960,marginTop:16}}>
   <Typography.Title level={5}>{t('roninProFlowModuleTitle')}</Typography.Title>
   <Radio.Group aria-label={t('roninProFlowInputMode')} value={d.inputMode} onChange={e=>change(v=>({...v,inputMode:e.target.value,split:null,flow:null,zip:null,sprite:null,view:{...v.view,sourcePage:1,resultPage:1}}))}>
    <Radio value="files">{t('roninProFlowInputFiles')}</Radio><Radio value="sheet">{t('roninProFlowInputSheet')}</Radio>
   </Radio.Group>
   {!!stashItems.length&&<Space wrap style={{display:'flex',marginTop:12}}><Select aria-label={tx('选择暂存素材','Choose stash asset','一時保管の素材を選択')} placeholder={tx('选择暂存素材','Choose stash asset','一時保管の素材を選択')} style={{width:300}} value={stashItems.some(v=>v.id===stashSelection)?stashSelection:undefined} onChange={setStashSelection} disabled={!!busy||stashBusy} options={stashItems.map((v,i)=>({value:v.id,label:(v.name??t('frame'))+' ('+(i+1)+')'}))}/><Button disabled={!stashSelection||!!busy||stashBusy} onClick={()=>{void importStash()}}>{tx('从暂存导入','Import from stash','一時保管から読み込む')}</Button>{stashBusy&&<Button onClick={()=>stashRead.current?.abort()}>{tx('取消导入','Cancel import','読み込みを取消')}</Button>}</Space>}
   <StashDropZone disabled={!!busy} onStashDrop={add} maxFiles={d.inputMode==='files'?1000-d.files.length:1} onCountError={()=>message.error({key:'flow-input-count',content:'FLOW_INPUT_COUNT'})} onSizeError={()=>message.error('FLOW_SOURCE_FORMAT')}><Upload.Dragger style={{marginTop:12}} accept=".png,.jpg,.jpeg,.webp" multiple={d.inputMode==='files'} disabled={!!busy}
    fileList={d.inputMode==='files'?fileList:d.sheet?[{uid:'sheet',name:d.sheet.name}]:[]}
    beforeUpload={(file,batch)=>{if(d.inputMode==='files'&&d.files.length+batch.length>1000){message.error({key:'flow-input-count',content:'FLOW_INPUT_COUNT'});return Upload.LIST_IGNORE}add(file);return false}}
    onRemove={file=>{change(v=>{const files=v.inputMode==='files'?v.files.filter((_,i)=>String(i)!==file.uid):v.files,sheet=v.inputMode==='sheet'?null:v.sheet;return {...v,files,sheet,normalizations:v.normalizations.filter(n=>files.includes(n.inputs[0])||sheet===n.inputs[0]),split:null,flow:null,zip:null,sprite:null,view:{...v.view,resultPage:1}}});return true}}>
    <p>{t(d.inputMode==='files'?'roninProFlowUploadHint':'roninProFlowSheetUploadHint')}</p>
   </Upload.Dragger></StashDropZone>
   {d.inputMode==='files'&&d.files.length>24&&<Pagination current={sourcePage} total={d.files.length} pageSize={d.view.pageSize} pageSizeOptions={[24,64,128]} showSizeChanger onChange={(sourcePage,pageSize)=>change(v=>({...v,view:{...v.view,sourcePage,pageSize}}))}/>}
   {d.inputMode==='sheet'&&<Space>{number(t('roninProFlowSheetCols'),d.columns,n=>change(v=>({...v,columns:n})),1,64)}{number(t('roninProFlowSheetRows'),d.rows,n=>change(v=>({...v,rows:n})),1,64)}</Space>}
   {preparing&&<Typography.Paragraph>{tx('正在导入素材…','Importing assets…','素材を読み込み中…')}</Typography.Paragraph>}
   {importError&&<Alert type="error" title={importError} action={<Button onClick={()=>setImportAttempt(v=>v+1)}>{tx('重试','Retry','再試行')}</Button>}/>}
   {count>0&&<Typography.Paragraph>{t('roninProFlowFramesCount',{n:count})}{frameSize&&' · '+frameSize.width+'×'+frameSize.height}</Typography.Paragraph>}
   {firstMetadata?.metadata.thumbnailDataUrl&&<div style={{padding:12,background:checkered}}><Typography.Paragraph>{t('roninProFlowOriginalPreview')}</Typography.Paragraph><StashableImage src={firstMetadata.metadata.thumbnailDataUrl} stashSrc={sourceUrls[0]} stashName={first.name} alt={first.name} style={{maxWidth:'100%',maxHeight:300,imageRendering:'pixelated'}}/></div>}
   <Typography.Paragraph type="secondary">{t('roninProFlowModuleDesc')}</Typography.Paragraph><Typography.Paragraph type="secondary">{t('roninProAdvancedPixelHint')}</Typography.Paragraph>
   <Typography.Paragraph type="secondary">{tx('预览使用缩略图；加工与暂存保留原图。参数可继续修改，已有结果保留生成时的输入。','Previews use thumbnails; processing and stash retain originals. Existing results preserve their original inputs when settings change.','プレビューはサムネイルです。処理と一時保管は元画像を保持し、既存結果は生成時の入力を維持します。')}</Typography.Paragraph>
   <Divider/>
   <Typography.Text>{t('roninProFlowQuality')}</Typography.Text><Radio.Group value={p.quality} onChange={e=>options({quality:e.target.value})} style={{display:'block',margin:'8px 0'}}>{(['fast','balanced','high'] as const).map(q=><Radio key={q} value={q}>{t(q==='fast'?'roninProFlowQualityFast':q==='balanced'?'roninProFlowQualityBalanced':'roninProFlowQualityHigh')}</Radio>)}</Radio.Group>
   <Space wrap><Checkbox checked={p.bidirectional} onChange={e=>options({bidirectional:e.target.checked})}>{t('roninProFlowBidirectional')}</Checkbox><Checkbox checked={p.smoothFlow} onChange={e=>options({smoothFlow:e.target.checked})}>{t('roninProFlowSmooth')}</Checkbox></Space>
   {(['maxMotionRelative','alpha'] as const).map(key=>{const label=t(key==='alpha'?'roninProFlowAlpha':'roninProFlowMaxMotion'),min=key==='alpha'?0:.1,max=key==='alpha'?1:.6;return <div key={key} style={{marginTop:12}}><Typography.Text>{label}</Typography.Text><div style={{display:'flex',alignItems:'center',gap:12}}><Slider ariaLabelForHandle={label} min={min} max={max} step={.05} value={p[key]} onChange={n=>options({[key]:n})} style={{flex:1}}/>{number(label,p[key],n=>options({[key]:n}),min,max,.05)}</div></div>})}
   <Typography.Paragraph type="secondary">{t('roninProFlowAlphaHint')}</Typography.Paragraph><Checkbox checked={p.nearestNeighbor} onChange={e=>options({nearestNeighbor:e.target.checked})}>{t('roninProFlowNearest')}</Checkbox>
   <div style={{marginTop:16}}><Space wrap><Button type="primary" icon={<PlayCircleOutlined/>} disabled={!ready||count<2||!!busy} onClick={interpolate}>{t('roninProFlowRun')}</Button><Button icon={<DownloadOutlined/>} disabled={!d.flow||!!busy} onClick={()=>exportResult('zip')}>{t('roninProFlowDownloadZip')}</Button>{number(t('roninProFlowSheetOutCols'),d.sheetColumns,n=>change(v=>({...v,sheetColumns:n})),1,Math.max(1,resultFiles.length,d.sheetColumns),1,!d.flow)}<Button icon={<PictureOutlined/>} disabled={!d.flow||!!busy} onClick={()=>exportResult('sheet')}>{t('roninProFlowDownloadSheet')}</Button></Space></div>
   {busy&&<Alert style={{marginTop:12}} type="info" title={<Space>{busy}<Button disabled={canceling} onClick={()=>{epoch.current++;setCanceling(true);main.current?.abort()}}>{t(canceling?'roninProFlowCanceling':'roninProFlowCancel')}</Button></Space>} description={<Progress percent={Math.round(progress*100)}/>}/>}
   {!!resultFiles.length&&<><Divider/><Typography.Text strong>{t('roninProFlowResultTitle')} ({resultFiles.length})</Typography.Text><Pagination current={page} pageSize={d.view.pageSize} total={resultFiles.length} pageSizeOptions={[24,64,128]} showSizeChanger onChange={(resultPage,pageSize)=>change(v=>({...v,view:{...v.view,resultPage,pageSize}}))}/><div style={{display:'flex',flexWrap:'wrap',gap:8,padding:8,background:checkered}}>{visible.map((f,i)=>{const m=imageToolMetadata.get(f)?.metadata;return <div key={String((page-1)*d.view.pageSize+i)} style={{width:72,minHeight:112}}>{m?.thumbnailDataUrl&&<StashableImage src={m.thumbnailDataUrl} stashSrc={resultUrls[i]} stashName={f.name} alt={t('frame')+' '+((page-1)*d.view.pageSize+i+1)} style={{width:56,height:56,objectFit:'contain',imageRendering:'pixelated'}}/>}<small>{(page-1)*d.view.pageSize+i+1}</small><Button size="small" disabled={!!busy} aria-label={t('imgFineEditorSendToStash')+' '+((page-1)*d.view.pageSize+i+1)} onClick={()=>{void sendToStash(f)}}>{tx('暂存','Stash','一時保管')}</Button></div>})}</div></>}
  </section>
 </FlowDocumentSurface>
}

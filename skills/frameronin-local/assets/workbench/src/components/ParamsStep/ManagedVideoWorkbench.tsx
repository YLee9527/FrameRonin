import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {Alert,Button,Checkbox,ColorPicker,Divider,Input,InputNumber,Pagination,Progress,Slider,Space,Typography,message} from 'antd'
import type {JobParams} from '../../api'
import {useLanguage} from '../../i18n/context'
import {captureSelectedVideo,inspectSelectedVideo} from '../../lib/browserVideoCapture'
import {videoAssets,type VideoAssetRequest,type VideoStroke} from '../../lib/videoAssets'
import {sampleVideoSelection,videoTimestamps,type VideoFrameLayout} from '../../lib/videoFrameTools'
import {initialVideoDraft,videoCaptureLayout,videoReports,type VideoDraft,type VideoResult,type VideoSettings} from '../../localProject/videoDocument'
import {useVideoDocument} from '../../localProject/useVideoDocument'
import {VideoDocumentSurface} from '../../localProject/VideoDocumentSurface'
import {cacheManagedInput,importManagedInputs,runManagedTask} from '../../localProject/managedTasks'
import {imageToolMetadata} from '../../localProject/imageToolDocument'
import {useVideoAssets} from '../../localProject/useVideoAssets'
import {useSpriteBlobUrls} from '../../localProject/useSpriteSheetAssets'
import {localJson} from '../../localProject/api'
import {VideoBrushEditor,VideoCropEditor} from './VideoCanvasTools'

type Props={file:File|null;params:JobParams;onParamsChange:(p:JobParams)=>void;onFileChange?:(f:File|null)=>void}
const checkered='repeating-conic-gradient(#c1c1c1 0% 25%,#f2f2f2 0% 50%) 50% / 16px 16px'
const cleanName=(s:string)=>s.replace(/[<>:"/\\|?*]/g,'_').trim()||'sprite_sheet'
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const report=(r:VideoResult|null)=>r?videoReports.get(r.report):undefined
function initial(params:JobParams){const d=initialVideoDraft();d.settings={...d.settings,fps:params.fps??12,start:params.frame_range?.start_sec??0,end:params.frame_range?.end_sec??5,maxFrames:params.max_frames??300,width:params.target_size?.w??256,height:params.target_size?.h??256,columns:params.columns??4,padding:params.padding??0,spacing:params.spacing??0};d.view.animationFps=d.settings.fps;return d}

export default function ManagedVideoWorkbench({file,params,onParamsChange,onFileChange}:Props){
 const {lang,t}=useLanguage(),tx=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 const model=useVideoDocument(initial(params)),d=model.draft,p=d.settings,video=useRef<HTMLVideoElement>(null)
 const {current,change:changeDraft,retained:retainedFiles,dispatch}=model
 const alive=useRef(true),epoch=useRef(0),pointer=useRef(false),seenInput=useRef<File|null|undefined>(undefined),initialized=useRef(!file),sourceRead=useRef<AbortController|null>(null)
 const main=useRef<AbortController|null>(null),transient=useRef(new Set<File>()),previewBytes=useRef(0),cropBytes=useRef(0),cancelPreviews=useRef<(()=>void)[]>([])
 const micro=useRef<{controller:AbortController;promise:Promise<void>;kind:string}|null>(null),brushHistory=useRef<(File|null)[]>([])
 const [busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[microBusy,setMicroBusy]=useState(''),[status,setStatus]=useState(''),[progress,setProgress]=useState(0)
 const [playing,setPlaying]=useState(false),[playOffset,setPlayOffset]=useState(0),[processedPage,setProcessedPage]=useState(1),[cropArchive,setCropArchive]=useState<{file:Blob;source:File}|null>(null),[previewEnabled,setPreviewEnabled]=useState(true)
 const retained=useCallback(()=>96*1024**2+[...new Set([...retainedFiles(),...transient.current])].reduce((sum,f)=>sum+f.size*2,0)+previewBytes.current+cropBytes.current,[retainedFiles])
 const previewRetained=useCallback(()=>{const s=current(),m=s.source?imageToolMetadata.get(s.source)?.metadata:null;return retained()+Math.max((s.info?.width??0)*(s.info?.height??0),(m?.width??0)*(m?.height??0))*96},[retained,current])
 const change=useCallback((update:(draft:VideoDraft)=>VideoDraft)=>{epoch.current++;changeDraft(update)},[changeDraft])
 const settings=(patch:Partial<VideoSettings>)=>change(v=>({...v,settings:{...v.settings,...patch},...('fps'in patch?{view:{...v.view,animationFps:patch.fps!}}:{})}))
 const view=(patch:Partial<VideoDraft['view']>)=>change(v=>({...v,view:{...v.view,...patch}}))
 const interaction=useCallback((active:boolean)=>{pointer.current=active;if(active)epoch.current++},[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sourceRead.current?.abort();micro.current?.controller.abort()}},[])
 useEffect(()=>{
  if(file===seenInput.current)return
  seenInput.current=file;sourceRead.current?.abort()
  if(!file)return
  const abort=new AbortController();sourceRead.current=abort;const before=current(),at=++epoch.current
  void(async()=>{
   await Promise.resolve();if(abort.signal.aborted)return;setPreparing(true)
   if(video.current){video.current.pause();video.current.removeAttribute('src');video.current.load()}
   if(file.size>200*1024**2)throw new Error('VIDEO_CAPTURE_RESOURCE_LIMIT')
   const imported=await importManagedInputs([file],abort.signal),m=imported.versions[0].metadata;imageToolMetadata.set(file,imported.versions[0])
   const info=await inspectSelectedVideo(file,{budget:imported.memoryBudgetBytes,frontendBytes:retained()+file.size*2,physical:{width:m.width!,height:m.height!}},abort.signal)
   if(!alive.current||abort.signal.aborted||sourceRead.current!==abort||epoch.current!==at||current()!==before)throw new Error('VIDEO_INPUT_CHANGED_WHILE_READING')
   initialized.current=true;brushHistory.current=[];setCropArchive(null);setPlayOffset(0);setPlaying(false)
   const fresh=initialVideoDraft(),end=Math.min(info.duration,86400,Math.max(.001,before.settings.end)),start=Math.min(before.settings.start,Math.max(0,end-.001))
   changeDraft(()=>({...fresh,source:file,info,settings:{...before.settings,start,end,crop:{...fresh.settings.crop}},view:{...before.view,page:1,cursor:0}}))
  })().catch(error=>{if(alive.current&&!abort.signal.aborted){message.error(String(error));seenInput.current=current().source;onFileChange?.(current().source)}}).finally(()=>{if(sourceRead.current===abort){sourceRead.current=null;if(alive.current)setPreparing(false)}})
  return()=>{abort.abort();if(sourceRead.current===abort){sourceRead.current=null;seenInput.current=undefined}}
 },[file,current,changeDraft,onFileChange,retained])
 useEffect(()=>{
  if(!initialized.current||sourceRead.current)return
  seenInput.current=d.source;onFileChange?.(d.source)
  onParamsChange({fps:d.settings.fps,frame_range:{start_sec:d.settings.start,end_sec:d.settings.end},max_frames:d.settings.maxFrames,target_size:{w:d.settings.width,h:d.settings.height},transparent:true,padding:d.settings.padding,spacing:d.settings.spacing,layout_mode:'fixed_columns',columns:d.settings.columns,matte_strength:.6,crop_mode:'tight_bbox'})
 },[d.source,d.settings,onFileChange,onParamsChange])
 const playbackFiles=useMemo(()=>d.source&&!busy&&!microBusy&&!preparing?[d.source]:[],[d.source,busy,microBusy,preparing]),playbackUrls=useSpriteBlobUrls(playbackFiles)
 const selected=d.selected,offset=playing?Math.min(playOffset,Math.max(0,selected.length-1)):Math.max(0,selected.indexOf(d.view.cursor)),chunk=Math.floor(offset/64)*64
 const playPosition=useRef(playOffset);useLayoutEffect(()=>{playPosition.current=playOffset},[playOffset])
 useEffect(()=>{
  if(!playing||!selected.length||busy||microBusy)return
  const timer=setInterval(()=>{const current=Math.min(playPosition.current,selected.length-1)
   if(current+1>=selected.length&&!d.view.animationLoop){setPlaying(false);changeDraft(v=>v.view.cursor===selected.at(-1)?v:{...v,view:{...v.view,cursor:selected.at(-1)!}});return}
   setPlayOffset(current+1>=selected.length?0:current+1)
  },Math.max(50,1000/Math.min(d.view.animationFps,12)/d.view.animationSpeed))
  return()=>clearInterval(timer)
 },[playing,selected,busy,microBusy,d.view.animationLoop,d.view.animationFps,d.view.animationSpeed,changeDraft])
 const pageIndices=useMemo(()=>Array.from({length:Math.max(0,Math.min(d.view.pageSize,d.frameCount-(d.view.page-1)*d.view.pageSize))},(_,i)=>(d.view.page-1)*d.view.pageSize+i),[d.view.page,d.view.pageSize,d.frameCount])
 const indicesKey=[...new Set([...pageIndices,...selected.slice(chunk,chunk+64),selected[0]??0])].filter(i=>i<d.frameCount).sort((a,b)=>a-b).join(',')
 const indices=useMemo(()=>indicesKey?indicesKey.split(',').map(Number):[],[indicesKey])
 const paused=busy||!!microBusy||preparing
 const framesRequest=useMemo<VideoAssetRequest|null>(()=>!paused&&d.capture&&d.frameSize&&indices.length?{action:'frames',file:d.capture.data,size:d.frameSize,count:d.frameCount,indices,limit:256}:null,[paused,d.capture,d.frameSize,d.frameCount,indices])
 const frames=useVideoAssets(framesRequest,previewRetained),frameUrls=useSpriteBlobUrls(frames.value.previews),frameUrl=(i:number)=>frameUrls[indices.indexOf(i)]
 const processedCount=Number(report(d.processed)?.outputFrames??0),processedAt=Math.min(processedPage,Math.max(1,Math.ceil(processedCount/24)))
 const processedIndices=useMemo(()=>Array.from({length:Math.min(24,Math.max(0,processedCount-(processedAt-1)*24))},(_,i)=>(processedAt-1)*24+i),[processedCount,processedAt])
 const processedRequest=useMemo<VideoAssetRequest|null>(()=>!paused&&d.processed&&d.frameSize&&processedIndices.length?{action:'frames',file:d.processed.data,size:d.frameSize,count:processedCount,indices:processedIndices,limit:256}:null,[paused,d.processed,d.frameSize,processedIndices,processedCount])
 const processedAssets=useVideoAssets(processedRequest,previewRetained),processedUrls=useSpriteBlobUrls(processedAssets.value.previews)
 const matteRequest=useMemo<VideoAssetRequest|null>(()=>!paused&&previewEnabled&&d.capture&&d.frameSize&&selected.length?{action:'matte',file:d.capture.data,size:d.frameSize,count:d.frameCount,index:selected[0],background:p.background,tolerance:p.tolerance,feather:p.feather,mask:d.mask,limit:1024}:null,[paused,previewEnabled,d.capture,d.frameSize,d.frameCount,selected,p.background,p.tolerance,p.feather,d.mask])
 const matte=useVideoAssets(matteRequest,previewRetained),matteUrls=useSpriteBlobUrls(matte.value.previews)
 const sheet=d.styledSheet??d.rawSheet,sheetReport=report(sheet)
 const sheetRequest=useMemo<VideoAssetRequest|null>(()=>!paused&&sheet&&sheetReport?{action:'sheet',file:sheet.data,size:{w:Number(sheetReport.width),h:Number(sheetReport.height)},limit:1024}:null,[paused,sheet,sheetReport])
 const sheetAssets=useVideoAssets(sheetRequest,previewRetained),sheetUrls=useSpriteBlobUrls(sheetAssets.value.previews)
 const cropRequest=useMemo<VideoAssetRequest|null>(()=>!paused&&cropArchive&&cropArchive.source===d.source&&d.info?{action:'frames',file:cropArchive.file,size:{w:d.info.width,h:d.info.height},count:1,indices:[0],limit:1024}:null,[paused,cropArchive,d.source,d.info])
 const cropAssets=useVideoAssets(cropRequest,previewRetained),cropUrls=useSpriteBlobUrls(cropAssets.value.previews)
 useLayoutEffect(()=>{
  cancelPreviews.current=[frames.stop,processedAssets.stop,matte.stop,sheetAssets.stop,cropAssets.stop]
  previewBytes.current=[...frames.value.previews,...processedAssets.value.previews,...matte.value.previews,...sheetAssets.value.previews,...sheetAssets.value.files,...cropAssets.value.previews].reduce((n,b)=>n+b.size*2,0)+(indices.length+processedIndices.length)*256**2*8+3*1024**2*8
  cropBytes.current=(cropArchive?.file.size??0)*2
 })
 const suspend=()=>{setPlaying(false);cancelPreviews.current.forEach(cancel=>cancel());if(video.current){video.current.pause();video.current.removeAttribute('src');video.current.load()}}
 const execute=async(operation:string,inputs:File[],layout:object,signal:AbortSignal,keepForNext=false):Promise<VideoResult>=>{
  const result=await runManagedTask(operation,inputs,{renderer:'browser-worker',frontendBytes:retained(),layout},{signal,outputFilter:()=>alive.current||keepForNext,onTask:()=>{if(alive.current)setProgress(0)},onProgress:v=>{if(alive.current)setProgress(old=>Math.max(old,v))}})
  // A final background result stays in the project. Only a subsequent stage
  // needs bytes after unmount; do not download an invisible final preview.
  if(!result.outputs.length&&!alive.current)throw new Error('VIDEO_RESULT_SAVED_TO_PROJECT')
  if(result.outputs.length!==2)throw new Error('VIDEO_TASK_OUTPUTS')
  const files=result.outputs.map((o,i)=>{const f=new File([o.blob],i?'video-report.json':'video-result.zip',{type:i?'application/json':'application/zip'});cacheManagedInput(f,result.project.id,o.version.id);imageToolMetadata.set(f,o.version);transient.current.add(f);return f})
  const value=JSON.parse(await files[1].text());if(value.operation!==operation)throw new Error('VIDEO_TASK_REPORT');videoReports.set(files[1],value)
  return {data:files[0],report:files[1],inputs,taskId:result.taskId}
 }
 async function run<T>(title:string,work:(snapshot:VideoDraft,signal:AbortSignal)=>Promise<T>,apply:(snapshot:VideoDraft,value:T)=>VideoDraft,after?:(value:T)=>void){
  if(main.current||sourceRead.current||micro.current)return
  const abort=new AbortController(),snapshot=model.current(),at=epoch.current;main.current=abort;suspend();setBusy(true);setStatus(title);setProgress(0)
  try{const value=await work(snapshot,abort.signal);abort.signal.throwIfAborted()
   if(alive.current&&epoch.current===at&&model.current()===snapshot&&!pointer.current){epoch.current++;flushSync(()=>model.change(current=>apply(current,value)));after?.(value)}
   else if(alive.current)message.info(tx('结果已保存到项目；当前编辑未被覆盖','Result saved to project; current edits were preserved','結果を保存しました。現在の編集は保持されます'))
  }catch(error){if(alive.current){if(abort.signal.aborted)message.info(tx('已取消','Canceled','キャンセルしました'));else message.error(String(error))}}
  finally{if(main.current===abort)main.current=null;transient.current.clear();if(alive.current){setBusy(false);setStatus('');setProgress(0)}}
 }
 async function runMicro<T>(kind:string,work:(signal:AbortSignal)=>Promise<T>,apply:(value:T)=>void){
  if(main.current||micro.current||sourceRead.current)return
  const abort=new AbortController(),at=epoch.current;let resolve!:()=>void
  const promise=new Promise<void>(done=>{resolve=done});micro.current={controller:abort,promise,kind};suspend();setMicroBusy(kind)
  try{const value=await work(abort.signal);abort.signal.throwIfAborted();if(alive.current&&epoch.current===at)apply(value)}
  catch(error){if(alive.current&&!abort.signal.aborted)message.error(String(error))}
  finally{if(micro.current?.controller===abort)micro.current=null;if(alive.current)setMicroBusy('');resolve()}
 }
 const prepare=useCallback(async()=>{
  if(sourceRead.current){sourceRead.current.abort();sourceRead.current=null;setPreparing(false);seenInput.current=current().source;onFileChange?.(current().source)}
  if(micro.current?.kind==='crop')micro.current.controller.abort()
  else if(micro.current)await micro.current.promise
  dispatch({type:'end'})
 },[current,dispatch,onFileChange])
 const pending=useCallback(()=>pointer.current||!!sourceRead.current||!!micro.current,[])
 const historyChanged=()=>{epoch.current++;micro.current?.controller.abort();brushHistory.current=[];setPlaying(false)}
 const restore=(value:VideoDraft)=>{historyChanged();setCropArchive(null);initialized.current=true;seenInput.current=value.source;onFileChange?.(value.source);model.apply(value);setPlayOffset(0);setProcessedPage(1)}
 const stop=()=>{epoch.current++;main.current?.abort();micro.current?.controller.abort();sourceRead.current?.abort();setStatus(tx('正在取消…','Canceling…','キャンセル中…'))}
 const capture=()=>{void run(t('extract'),async(s,signal)=>{const captured=await execute('video.capture',[s.source!],videoCaptureLayout(s),signal,true),analysis=await execute('video.frameTools',[captured.data],{mode:'analyze'},signal);return {captured,analysis}},(s,{captured,analysis})=>{const r=report(captured)!;return {...s,capture:captured,analysis,frameCount:Number(r.outputFrames),frameSize:{w:Number(r.width),h:Number(r.height)},selected:Array.from({length:Number(r.outputFrames)},(_,i)=>i),mask:null,processed:null,rawSheet:null,styledSheet:null,rawDownload:null,processedDownload:null,settings:{...s.settings,sampleStart:1,sampleEnd:Number(r.outputFrames)},view:{...s.view,page:1,cursor:0}}},()=>{brushHistory.current=[]})}
 const process=(skip:boolean)=>{void run(skip?t('skipMatteToNext'):t('matte'),(s,signal)=>execute('video.frameTools',[s.capture!.data,...(!skip&&s.mask?[s.mask]:[])],skip?{mode:'select',selected:s.selected}:{mode:'matte',selected:s.selected,background:s.settings.background,tolerance:s.settings.tolerance,feather:s.settings.feather,mask:!!s.mask},signal),(s,value)=>{const captured=report(s.capture)!;return {...s,processed:value,rawSheet:null,styledSheet:null,processedDownload:null,settings:{...s.settings,width:Number(captured.cropWidth),height:Number(captured.cropHeight),columns:Math.min(12,Math.max(4,Math.ceil(Math.sqrt(Number(report(value)!.outputFrames))))),padding:0,spacing:0}}},()=>setProcessedPage(1))}
 const compose=()=>{void run(t('exportSprite'),(s,signal)=>{
  const chosen=(report(s.processed)!.parameters as {layout:{selected:number[]}}).layout.selected,timestamps=report(s.capture)!.timestamps as number[],q=s.settings
  return execute('video.frameTools',[s.processed!.data],{mode:'compose',width:q.width,height:q.height,padding:q.padding,spacing:q.spacing,columns:q.columns,timestamps:chosen.map(i=>timestamps[i]),strokeWidth:0,strokeColor:q.strokeColor},signal)
 },(s,value)=>({...s,rawSheet:value,styledSheet:null}))}
 const style=()=>{
  if(!p.strokeWidth){change(s=>({...s,styledSheet:null}));return}
  void run(t('applyStroke'),(s,signal)=>{const layout=(report(s.rawSheet)!.parameters as {layout:VideoFrameLayout}).layout;return execute('video.frameTools',[s.processed!.data],{...layout,strokeWidth:s.settings.strokeWidth,strokeColor:s.settings.strokeColor},signal)},(s,value)=>({...s,styledSheet:value}))
 }
 const archive=(processed:boolean)=>{const existing=processed?d.processedDownload:d.rawDownload;if(existing){download(existing.data,processed?'matted_frames.zip':'frames.zip');return}
  void run(t('downloadZip'),(s,signal)=>execute('video.frameTools',[(processed?s.processed:s.capture)!.data],{mode:'archive',selected:Array.from({length:processed?Number(report(s.processed)!.outputFrames):s.frameCount},(_,i)=>i),kind:processed?'matted':'extracted'},signal),(s,value)=>({...s,[processed?'processedDownload':'rawDownload']:value}),value=>download(value.data,processed?'matted_frames.zip':'frames.zip'))
 }
 const openCrop=()=>{const s=model.current();if(!s.source||!s.info)return
  void runMicro('crop',async signal=>{const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal}),m=imageToolMetadata.get(s.source!)!.metadata,start=Math.min(s.settings.start,s.info!.duration-.000001)
   return captureSelectedVideo(s.source!,{...videoCaptureLayout(s),start,end:Math.min(s.info!.duration,start+1),fps:1,maxFrames:1,crop:{left:0,top:0,right:0,bottom:0}},{budget:memoryBudgetBytes,frontendBytes:retained(),physical:{width:m.width!,height:m.height!}},signal,{id:crypto.randomUUID(),generation:0})
  },value=>setCropArchive({file:value,source:s.source!}))
 }
 const sample=(x:number,y:number)=>{const s=model.current();void runMicro('sample',async signal=>{const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal});return videoAssets({action:'sample',file:s.capture!.data,size:s.frameSize!,count:s.frameCount,index:s.selected[0],x,y},memoryBudgetBytes,retained(),signal)},value=>{const hex='#'+value.color!.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');epoch.current++;flushSync(()=>model.change(current=>({...current,mask:null,settings:{...current.settings,background:hex}})));brushHistory.current=[];setPreviewEnabled(true)})}
 const brush=async(stroke:VideoStroke)=>{const s=model.current();await runMicro('brush',async signal=>{const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal});return videoAssets({action:'brush',mask:s.mask,size:s.frameSize!,stroke},memoryBudgetBytes,retained(),signal)},value=>{const mask=new File([value.files[0]],`video-brush-${crypto.randomUUID()}.png`,{type:'image/png'});brushHistory.current.push(s.mask);epoch.current++;flushSync(()=>model.change(current=>({...current,mask})))})}
 const choose=(values:number[])=>{change(s=>({...s,selected:values,settings:{...s.settings,sampleStart:1,sampleEnd:Math.max(1,values.length)}}));setPlayOffset(0)}
 const adjustSelection=(action:'firstRemove'|'lastRemove'|'previous'|'next')=>{if(!selected.length)return;let next=selected
  if(action==='firstRemove')next=selected.slice(1);if(action==='lastRemove')next=selected.slice(0,-1);if(action==='previous'&&selected[0]>0)next=[selected[0]-1,...selected];if(action==='next'&&selected.at(-1)!<d.frameCount-1)next=[...selected,selected.at(-1)!+1];choose(next)
 }
 let expected=0;try{expected=videoTimestamps(p.start,p.end,p.fps,p.maxFrames).length}catch{/* Incomplete numeric input is displayed and refused at execution. */}
 const duplicates=new Map((report(d.analysis)?.duplicates as {index:number;groupId:number;totalInGroup:number}[]|undefined)?.map(v=>[v.index,v])??[]),blocked=paused
 const note=(value:ReturnType<typeof useVideoAssets>)=>(value.loading||value.error)&&<Space><Typography.Text type={value.error?'danger':'secondary'}>{value.loading?tx('正在准备预览','Preparing preview','プレビュー準備中'):value.error}</Typography.Text><Button onClick={value.loading?value.cancel:value.retry}>{value.loading?tx('取消预览','Cancel preview','プレビューを中止'):tx('重试预览','Retry preview','再試行')}</Button></Space>
 const number=(label:string,value:number,onChange:(v:number)=>void,min:number,max:number,step=1)=><label style={{display:'inline-flex',flexDirection:'column',gap:4,margin:8}}><span>{label}</span><InputNumber aria-label={label} value={value} min={min} max={max} step={step} onChange={v=>{if(v!==null)onChange(Number(v))}}/></label>
 return <VideoDocumentSurface model={model} beforeAction={prepare} hasPendingEdits={pending} onInteraction={interaction} onRestore={restore} onHistory={historyChanged}>
  <section aria-label={tx('视频工作台','Video workbench','動画ワークベンチ')} style={{marginTop:16}}>
   {(busy||preparing||microBusy)&&<Alert type="info" title={<Space>{preparing?tx('正在读取视频','Reading video','動画を読み込み中'):microBusy?tx('正在准备预览或画笔','Preparing preview or brush','プレビュー・ブラシを準備中'):status}<Button onClick={stop}>{tx('取消当前操作','Cancel current operation','現在の操作を中止')}</Button></Space>} description={busy?<Progress percent={Math.round(progress*100)}/>:undefined}/>}
   {!d.source&&<Typography.Paragraph>{tx('上传视频，或打开已保存的视频文档。','Upload a video or open a saved video document.','動画をアップロードするか、保存済み文書を開いてください。')}</Typography.Paragraph>}
   {d.source&&d.info&&<>
    <Typography.Title level={4}>{tx('视频预览与时间范围','Video preview and time range','動画プレビューと時間範囲')}</Typography.Title>
    {playbackUrls[0]&&<video ref={video} src={playbackUrls[0]} controls aria-label={tx('原视频预览','Source video preview','元動画プレビュー')} style={{width:'100%',maxHeight:280,background:'#222'}}
     onLoadedMetadata={()=>{const v=video.current;if(v&&(v.videoWidth!==d.info!.width||v.videoHeight!==d.info!.height))message.error('VIDEO_SOURCE_CHANGED')}}
     onTimeUpdate={()=>{const v=video.current;if(v&&p.autoReplay&&p.end>p.start&&v.currentTime>=p.end-.05){v.currentTime=p.start;void v.play().catch(e=>message.error(String(e)))}}}/>}
    <Slider range ariaLabelForHandle={[tx('开始时间','Start time','開始時間'),tx('结束时间','End time','終了時間')]} min={0} max={Math.min(d.info.duration,86400)} step={Math.min(.05,1/p.fps)} value={[p.start,p.end]} onChange={v=>{if(Array.isArray(v)){const[start,end]=v;settings({start,end});if(video.current)video.current.currentTime=start!==p.start?start:end}}}/>
    <Space wrap><Button disabled={blocked} onClick={()=>{if(video.current){video.current.currentTime=p.start;void video.current.play().catch(e=>message.error(String(e)))}}}>{t('replay')}</Button><Checkbox checked={p.autoReplay} onChange={e=>settings({autoReplay:e.target.checked})}>{t('autoReplay')}</Checkbox><span>{p.start.toFixed(3)} — {p.end.toFixed(3)} s / {d.info.duration.toFixed(3)} s · {d.info.width}×{d.info.height}</span></Space>
    <div>{number(t('targetFps'),p.fps,v=>settings({fps:v}),1,60,.1)}{number(t('startTime'),p.start,v=>settings({start:v}),0,Math.min(d.info.duration,86400),.1)}{number(t('endTime'),p.end,v=>settings({end:v}),0,Math.min(d.info.duration,86400),.1)}{number(t('maxFrames'),p.maxFrames,v=>settings({maxFrames:v}),1,2000)}</div>
    <Space wrap><Button disabled={blocked} onClick={openCrop}>{t('cropManual')}</Button>{cropArchive?.source===d.source&&<Button onClick={()=>setCropArchive(null)}>{t('cropClose')}</Button>}<Button onClick={()=>settings({crop:{left:0,top:0,right:0,bottom:0}})}>{t('resetCrop')}</Button></Space>
    {cropArchive?.source===d.source&&<div style={{aspectRatio:`${d.info.width}/${d.info.height}`,width:'100%',maxWidth:640}}>{cropUrls[0]&&<VideoCropEditor url={cropUrls[0]} size={{w:d.info.width,h:d.info.height}} crop={p.crop} onChange={crop=>settings({crop})} label={tx('视频裁切画布','Video crop canvas','動画クロップキャンバス')}/>}</div>}{note(cropAssets)}
    <div>{(['left','top','right','bottom'] as const).map(side=>number(t(side),p.crop[side],v=>settings({crop:{...p.crop,[side]:v}}),0,(side==='left'||side==='right'?d.info!.width:d.info!.height)-1,.25))}</div>
    <Typography.Paragraph>{t('cropResultSize')}: {Math.max(1,d.info.width-p.crop.left-p.crop.right)} × {Math.max(1,d.info.height-p.crop.top-p.crop.bottom)} · {t('expectedFrames',{n:expected})}</Typography.Paragraph>
    <Space><Button type="primary" onClick={capture} disabled={blocked||!expected}>{t('extract')}</Button>{d.capture&&<Button onClick={()=>archive(false)} disabled={blocked}>{t('downloadExtractedFrames',{n:d.frameCount})}</Button>}</Space>
   </>}
   {d.capture&&d.frameSize&&<>
    <Divider/><Space wrap><Typography.Text strong>{t('selectFrames')} ({selected.length}/{d.frameCount})</Typography.Text><Button onClick={()=>choose(Array.from({length:d.frameCount},(_,i)=>i))}>{t('selectAll')}</Button><Button onClick={()=>choose([])}>{t('selectNone')}</Button></Space>
    <Pagination current={d.view.page} pageSize={d.view.pageSize} total={d.frameCount} pageSizeOptions={[24,64,128]} showSizeChanger onChange={(page,pageSize)=>view({page,pageSize})} style={{margin:'12px 0'}}/>{note(frames)}
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{pageIndices.map(i=><div key={i} style={{width:96,border:`1px solid ${duplicates.has(i)?'#c34e2c':'#aaa'}`,padding:4,borderRadius:6}}>
     <Checkbox aria-label={`${tx('选择帧','Select frame','フレーム選択')} ${i+1}`} checked={selected.includes(i)} onChange={e=>choose(e.target.checked?[...selected,i].sort((a,b)=>a-b):selected.filter(v=>v!==i))}>{i+1}</Checkbox>
     <div style={{width:88,height:66,background:checkered}}>{frameUrl(i)&&<img src={frameUrl(i)} alt={`${t('frame')} ${i+1}`} style={{width:88,height:66,objectFit:'contain',display:'block'}}/>}</div>{duplicates.has(i)&&<small>{t('duplicate',{n:duplicates.get(i)!.totalInGroup})}</small>}
    </div>)}</div>
    {selected.length>0&&<><Typography.Title level={5}>{t('frameAnimPreview')}</Typography.Title>
     {frameUrl(selected[offset])&&<img src={frameUrl(selected[offset])} alt={tx('动画预览','Animation preview','アニメーションプレビュー')} style={{maxWidth:320,width:'100%',height:180,objectFit:'contain',background:checkered}}/>}
     <Space wrap><Button disabled={blocked} onClick={()=>{if(playing){view({cursor:selected[offset]});setPlaying(false)}else{setPlayOffset(offset);setPlaying(true)}}}>{playing?tx('暂停','Pause','一時停止'):tx('播放','Play','再生')}</Button><Checkbox checked={d.view.animationLoop} onChange={e=>view({animationLoop:e.target.checked})}>{tx('循环','Loop','ループ')}</Checkbox>{number(t('previewSpeed'),d.view.animationSpeed,v=>view({animationSpeed:v}),.25,4,.25)}<span>{offset+1}/{selected.length}</span></Space>
     <Slider ariaLabelForHandle={tx('动画帧','Animation frame','アニメーションフレーム')} min={1} max={selected.length} value={offset+1} onChange={v=>{setPlaying(false);setPlayOffset(Number(v)-1);view({cursor:selected[Number(v)-1]})}}/>
     <Space wrap><Button onClick={()=>adjustSelection('firstRemove')}>{tx('移除首帧','Remove first','先頭を除外')}</Button><Button disabled={selected[0]===0} onClick={()=>adjustSelection('previous')}>{tx('补回前一帧','Add previous','直前を追加')}</Button><Button onClick={()=>adjustSelection('lastRemove')}>{tx('移除末帧','Remove last','末尾を除外')}</Button><Button disabled={selected.at(-1)===d.frameCount-1} onClick={()=>adjustSelection('next')}>{tx('补回后一帧','Add next','直後を追加')}</Button></Space>
     <div>{number(tx('选中列表起始','Selected-list start','選択リスト開始'),p.sampleStart,v=>settings({sampleStart:v}),1,2000)}{number(tx('选中列表结束','Selected-list end','選択リスト終了'),p.sampleEnd,v=>settings({sampleEnd:v}),1,2000)}{number(tx('采样间隔','Sampling step','サンプル間隔'),p.sampleStep,v=>settings({sampleStep:v}),1,2000)}<Button onClick={()=>choose(sampleVideoSelection(selected,p.sampleStart,p.sampleEnd,p.sampleStep))}>{tx('按选中范围采样','Sample selected range','選択範囲をサンプリング')}</Button></div>
    </>}
    <Divider/><Typography.Title level={4}>{t('matte')}</Typography.Title>
    <Space wrap><label>{t('bgColor')} <ColorPicker value={p.background} showText onChange={(_,hex)=>settings({background:hex})}/></label>{number(t('tolerance'),p.tolerance,v=>settings({tolerance:v}),1,100,.5)}{number(t('featherEdge'),p.feather,v=>settings({feather:v}),0,30,.25)}</Space>
    <div style={{display:'flex',flexWrap:'wrap',gap:16,margin:'16px 0'}}><div style={{flex:'1 1 250px'}}><Typography.Paragraph>{t('originalImageFirst')}</Typography.Paragraph>
     {selected.length>0&&frameUrl(selected[0])&&<img src={frameUrl(selected[0])} alt={t('originalImage')} role="button" tabIndex={0} aria-label={tx('从原帧取色','Sample source frame color','元フレームから色を取得')} style={{width:'100%',maxWidth:640,cursor:'crosshair',background:checkered}} onClick={e=>{if(blocked)return;const r=e.currentTarget.getBoundingClientRect();sample(Math.min(d.frameSize!.w-1,Math.max(0,Math.floor((e.clientX-r.left)/r.width*d.frameSize!.w))),Math.min(d.frameSize!.h-1,Math.max(0,Math.floor((e.clientY-r.top)/r.height*d.frameSize!.h))))}}/>}
     <Button disabled={blocked||!selected.length} onClick={()=>sample(0,0)}>{tx('取左上角颜色','Sample top-left color','左上の色を取得')}</Button>
    </div><div style={{flex:'1 1 250px',background:d.view.matteSolid?p.background:checkered,padding:8}}><Space><Typography.Text>{t('mattePreview')}</Typography.Text><Button onClick={()=>view({matteSolid:!d.view.matteSolid})}>{d.view.matteSolid?t('gridBg'):t('solidBg')}</Button></Space>{note(matte)}
     <div style={{aspectRatio:`${d.frameSize.w}/${d.frameSize.h}`,width:'100%',maxWidth:640}}>{matteUrls[0]&&<VideoBrushEditor url={matteUrls[0]} size={d.frameSize} brushSize={p.brushSize} disabled={blocked} onCommit={brush} label={tx('视频擦除画笔','Video erase brush','動画消去ブラシ')}/>}</div>
    </div></div>
    <Space wrap>{number(tx('画笔粗细','Brush size','ブラシサイズ'),p.brushSize,v=>settings({brushSize:v}),4,80)}<Button disabled={!brushHistory.current.length||blocked} onClick={()=>{const mask=brushHistory.current.pop()!;change(s=>({...s,mask}))}}>{tx('撤回笔画','Undo stroke','ストロークを戻す')}</Button><Button onClick={()=>{brushHistory.current=[];change(s=>({...s,mask:null}))}}>{tx('清除画笔','Clear brush','ブラシをクリア')}</Button><Button disabled={blocked} onClick={()=>{brushHistory.current=[];change(s=>({...s,mask:null}));setPreviewEnabled(true);matte.retry()}}>{t('updatePreview')}</Button></Space>
    <Space wrap style={{marginTop:12}}><Button type="primary" disabled={blocked||!selected.length} onClick={()=>process(false)}>{t('startMatteWithFrames',{n:selected.length})}</Button><Button disabled={blocked||!selected.length} onClick={()=>process(true)}>{t('skipMatteToNext')}</Button></Space>
   </>}
   {d.processed&&d.frameSize&&<>
    <Divider/><Space><Typography.Title level={4}>{t('mattedFramesTitle',{n:processedCount})}</Typography.Title><Button disabled={blocked} onClick={()=>archive(true)}>{t('downloadMattedFrames',{n:processedCount})}</Button></Space>
    <Pagination current={processedAt} pageSize={24} total={processedCount} showSizeChanger={false} onChange={setProcessedPage}/>{note(processedAssets)}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>{processedUrls.map((url,i)=><img key={url} src={url} alt={t('matteFrameN',{n:processedIndices[i]+1})} style={{width:88,height:66,objectFit:'contain',background:checkered}}/>)}</div>
    <Typography.Title level={4}>{t('exportParams')}</Typography.Title>
    <Space wrap>{number(t('width'),p.width,v=>{const r=report(d.capture)!,ratio=Number(r.cropWidth)/Number(r.cropHeight);settings({width:v,...(p.keepAspect?{height:Math.max(1,Math.round(v/ratio))}:{})})},1,30000,.25)}{number(t('height'),p.height,v=>{const r=report(d.capture)!,ratio=Number(r.cropWidth)/Number(r.cropHeight);settings({height:v,...(p.keepAspect?{width:Math.max(1,Math.round(v*ratio))}:{})})},1,30000,.25)}<Checkbox checked={p.keepAspect} onChange={e=>settings({keepAspect:e.target.checked})}>{tx('保持比例','Keep aspect ratio','縦横比を保持')}</Checkbox></Space>
    <Space wrap>{[64,128,256,512].map(w=>{const r=report(d.capture)!,h=Math.max(32,Math.round(w*Number(r.cropHeight)/Number(r.cropWidth)));return <Button key={w} onClick={()=>settings({width:w,height:h})}>{w}×{h}</Button>})}</Space>
    <div>{number(tx('列数','Columns','列数'),p.columns,v=>settings({columns:v}),1,64)}{number(tx('边距','Padding','余白'),p.padding,v=>settings({padding:v}),0,64,.25)}{number(tx('间距','Spacing','間隔'),p.spacing,v=>settings({spacing:v}),0,64,.25)}</div>
    <Button type="primary" disabled={blocked} onClick={compose}>{t('exportSprite')}</Button>
   </>}
   {d.rawSheet&&<>
    <Divider/>{note(sheetAssets)}{sheetUrls[0]&&<img src={sheetUrls[0]} alt={tx('精灵表预览','Sprite sheet preview','スプライトシートプレビュー')} style={{maxWidth:'100%',height:'auto',background:checkered}}/>}
    <Space wrap>{number(t('strokeWidth'),p.strokeWidth,v=>settings({strokeWidth:v}),0,16,.5)}<label>{t('strokeColor')} <ColorPicker value={p.strokeColor} showText onChange={(_,hex)=>settings({strokeColor:hex})}/></label><Button disabled={blocked} onClick={style}>{t('applyStroke')}</Button></Space>
    <label style={{display:'block',margin:'12px 0'}}>{t('filename')} <Input aria-label={t('filename')} value={p.exportName} maxLength={240} onChange={e=>settings({exportName:e.target.value})} style={{width:240}}/></label>
    <Space><Button type="primary" disabled={blocked||!sheet} onClick={()=>download(sheet!.data,cleanName(p.exportName)+'.zip')}>{t('downloadZip')}</Button><Button disabled={blocked||!sheetAssets.value.files[0]} onClick={()=>download(sheetAssets.value.files[0],cleanName(p.exportName)+'.png')}>{t('downloadPng')}</Button><Button disabled={blocked||!sheetAssets.value.files[1]} onClick={()=>download(sheetAssets.value.files[1],cleanName(p.exportName)+'.json')}>{tx('下载索引','Download index','索引をダウンロード')}</Button></Space>
   </>}
   {(d.capture||d.processed)&&<Typography.Paragraph type="secondary" style={{marginTop:16}}>{tx('参数与选帧可继续修改；已生成结果保留当时的输入。再次执行后才应用新设置。','Parameters and selection can change independently. Existing results retain their original inputs; execute again to apply edits.','設定と選択は変更できます。既存の結果は元の入力を保持します。再実行すると変更が反映されます。')}</Typography.Paragraph>}
  </section>
 </VideoDocumentSurface>
}

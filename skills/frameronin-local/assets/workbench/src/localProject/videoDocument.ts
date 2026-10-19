import {videoCapturePlan,type VideoCaptureLayout} from '../lib/videoCapture'
import {validateVideoFrameLayout,type VideoFrameLayout,type VideoFrameSize} from '../lib/videoFrameTools'
import {validateMediaResource,type StoredCustomSlice} from './customSliceDocument'
import {imageToolMetadata} from './imageToolDocument'
import {cacheManagedInput,importManagedInputs,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {localFetch,localJson} from './api'

export type VideoInfo={width:number;height:number;duration:number}
export type VideoSettings={start:number;end:number;fps:number;maxFrames:number;crop:{left:number;top:number;right:number;bottom:number};autoReplay:boolean;background:string;tolerance:number;feather:number;width:number;height:number;keepAspect:boolean;padding:number;spacing:number;columns:number;strokeWidth:number;strokeColor:string;exportName:string;brushSize:number;sampleStart:number;sampleEnd:number;sampleStep:number}
export type VideoView={page:number;pageSize:number;cursor:number;animationFps:number;animationSpeed:number;animationLoop:boolean;matteSolid:boolean}
export type VideoResult={data:File;report:File;inputs:File[];taskId:string}
const resultKeys=['capture','analysis','processed','rawSheet','styledSheet','rawDownload','processedDownload'] as const
type ResultKey=typeof resultKeys[number]
export type VideoDraft={source:File|null;info:VideoInfo|null;settings:VideoSettings;view:VideoView;frameCount:number;frameSize:VideoFrameSize|null;selected:number[];mask:File|null}&Record<ResultKey,VideoResult|null>
type Resource=NonNullable<StoredCustomSlice['spriteFile']>
type StoredResult={data:Resource;report:Resource;inputs:Resource[];taskId:string}
export type StoredVideo=Omit<VideoDraft,'source'|'mask'|ResultKey>&{formatVersion:1;source:Resource|null;mask:Resource|null}&Record<ResultKey,StoredResult|null>
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:{renderer:string;frontendBytes:number;layout:unknown}}}
export const initialVideoDraft=():VideoDraft=>({source:null,info:null,settings:{start:0,end:5,fps:12,maxFrames:300,crop:{left:0,top:0,right:0,bottom:0},autoReplay:false,background:'#ffffff',tolerance:40,feather:10,width:256,height:256,keepAspect:true,padding:0,spacing:0,columns:4,strokeWidth:0,strokeColor:'#000000',exportName:'sprite_sheet',brushSize:24,sampleStart:1,sampleEnd:1,sampleStep:1},view:{page:1,pageSize:24,cursor:0,animationFps:12,animationSpeed:1,animationLoop:true,matteSolid:false},frameCount:0,frameSize:null,selected:[],mask:null,capture:null,analysis:null,processed:null,rawSheet:null,styledSheet:null,rawDownload:null,processedDownload:null})
export const videoFiles=(drafts:VideoDraft[])=>new Set(drafts.flatMap(d=>[d.source,d.mask,...resultKeys.flatMap(key=>d[key]?[d[key]!.data,d[key]!.report,...d[key]!.inputs]:[])]).filter((f):f is File=>!!f))
export const videoReports=new WeakMap<File,Record<string,unknown>>()
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const integer=(v:unknown,a:number,b:number)=>finite(v,a,b)&&Number.isSafeInteger(v)
const color=(v:unknown)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(v)
const equal=(a:unknown,b:unknown):boolean=>Object.is(a,b)||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]))||object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]))
function size(v:unknown){if(!object(v)||!fields(v,['w','h'])||!integer(v.w,1,30000)||!integer(v.h,1,30000))throw new Error('VIDEO_DOCUMENT_SIZE')}
export const videoCaptureLayout=(d:VideoDraft):VideoCaptureLayout=>({sourceWidth:d.info!.width,sourceHeight:d.info!.height,start:d.settings.start,end:d.settings.end,fps:d.settings.fps,maxFrames:d.settings.maxFrames,crop:d.settings.crop})
export function validateStoredVideo(value:unknown):StoredVideo{
 // Early format-1 foundation documents predate playback controls. Normalize
 // only that exact old shape; unknown/partially missing fields still fail.
 if(object(value)&&object(value.view)&&fields(value.view,['page','pageSize','cursor','animationFps','matteSolid']))value={...value,view:{...value.view,animationSpeed:1,animationLoop:true}}
 if(!object(value)||!fields(value,['formatVersion',...Object.keys(initialVideoDraft())])||value.formatVersion!==1||!object(value.settings)||!fields(value.settings,Object.keys(initialVideoDraft().settings))||!object(value.view)||!fields(value.view,Object.keys(initialVideoDraft().view)))throw new Error('VIDEO_DOCUMENT_FIELDS')
 const p=value.settings,v=value.view
 if(!finite(p.start,0,86400)||!finite(p.end,0,86400)||Number(p.end)<=Number(p.start)||!finite(p.fps,1,60)||!integer(p.maxFrames,1,2000)||!object(p.crop)||!fields(p.crop,['left','top','right','bottom'])||Object.values(p.crop).some(n=>!finite(n,0,29999))||typeof p.autoReplay!=='boolean'||!color(p.background)||!finite(p.tolerance,1,100)||!finite(p.feather,0,30)||!finite(p.width,1,30000)||!finite(p.height,1,30000)||typeof p.keepAspect!=='boolean'||!finite(p.padding,0,64)||!finite(p.spacing,0,64)||!integer(p.columns,1,64)||!finite(p.strokeWidth,0,16)||!color(p.strokeColor)||typeof p.exportName!=='string'||p.exportName.length>240||!integer(p.brushSize,4,80)||!['sampleStart','sampleEnd','sampleStep'].every(k=>integer(p[k],1,2000)))throw new Error('VIDEO_DOCUMENT_SETTINGS')
 if(!integer(v.page,1,2000)||!integer(v.pageSize,24,128)||![24,64,128].includes(Number(v.pageSize))||!integer(v.cursor,0,1999)||!finite(v.animationFps,1,60)||!finite(v.animationSpeed,.25,4)||typeof v.animationLoop!=='boolean'||typeof v.matteSolid!=='boolean'||!integer(value.frameCount,0,2000)||!Array.isArray(value.selected)||value.selected.some((n,i)=>!integer(n,0,Number(value.frameCount)-1)||i>0&&Number(n)<=Number((value.selected as unknown[])[i-1])))throw new Error('VIDEO_DOCUMENT_VIEW_SELECTION')
 if(value.source!==null){validateMediaResource(value.source)
  if(!object(value.info)||!fields(value.info,['width','height','duration'])||!integer(value.info.width,1,30000)||!integer(value.info.height,1,30000)||!finite(value.info.duration,Number.MIN_VALUE,Number.MAX_VALUE))throw new Error('VIDEO_DOCUMENT_INFO')
  if(Number(p.crop.left)>=Number(value.info.width)||Number(p.crop.right)>=Number(value.info.width)||Number(p.crop.top)>=Number(value.info.height)||Number(p.crop.bottom)>=Number(value.info.height))throw new Error('VIDEO_DOCUMENT_CROP')
 }else if(value.info!==null||value.mask!==null||value.frameCount!==0||resultKeys.some(k=>value[k]!==null))throw new Error('VIDEO_DOCUMENT_SOURCE')
 if(value.mask!==null)validateMediaResource(value.mask)
 for(const key of resultKeys){const r=value[key];if(r===null)continue
  if(!value.source||!object(r)||!fields(r,['data','report','inputs','taskId'])||!uuid(r.taskId)||!Array.isArray(r.inputs)||!integer(r.inputs.length,1,2))throw new Error('VIDEO_DOCUMENT_RESULT')
  validateMediaResource(r.data);validateMediaResource(r.report);r.inputs.forEach(validateMediaResource)
 }
 const d=value as StoredVideo
 if(d.view.cursor>Math.max(0,d.frameCount-1)||d.view.page>Math.max(1,Math.ceil(d.frameCount/d.view.pageSize)))throw new Error('VIDEO_DOCUMENT_VIEW_RANGE')
 if(d.capture===null){if(d.frameCount||d.frameSize!==null||d.mask!==null||resultKeys.slice(1).some(k=>d[k]!==null))throw new Error('VIDEO_DOCUMENT_CAPTURE')}
 else{size(d.frameSize);if(!d.frameCount||!equal(d.capture.inputs.map(r=>r.versionId),[d.source!.versionId]))throw new Error('VIDEO_DOCUMENT_CAPTURE_INPUT')}
 if(d.analysis&&!equal(d.analysis.inputs.map(r=>r.versionId),[d.capture!.data.versionId]))throw new Error('VIDEO_DOCUMENT_ANALYSIS_INPUT')
 if(d.processed&&d.processed.inputs[0].versionId!==d.capture!.data.versionId)throw new Error('VIDEO_DOCUMENT_PROCESSED_INPUT')
 if((d.rawSheet||d.styledSheet||d.processedDownload)&&!d.processed)throw new Error('VIDEO_DOCUMENT_PROCESSED_MISSING')
 for(const key of ['rawSheet','styledSheet','processedDownload'] as const)if(d[key]&&!equal(d[key]!.inputs.map(r=>r.versionId),[d.processed!.data.versionId]))throw new Error('VIDEO_DOCUMENT_EXPORT_INPUT')
 if(d.rawDownload&&!equal(d.rawDownload.inputs.map(r=>r.versionId),[d.capture!.data.versionId]))throw new Error('VIDEO_DOCUMENT_DOWNLOAD_INPUT')
 if(d.styledSheet&&!d.rawSheet)throw new Error('VIDEO_DOCUMENT_RAW_SHEET')
 const results=resultKeys.flatMap(k=>d[k]?[d[k]!]:[]),outputs=results.flatMap(r=>[r.data.versionId,r.report.versionId])
 if(new Set(results.map(r=>r.taskId)).size!==results.length||new Set(outputs).size!==outputs.length||outputs.includes(d.source?.versionId??''))throw new Error('VIDEO_DOCUMENT_IDENTITY')
 const aliases=new Map<string,string>()
 for(const r of [d.source,d.mask,...results.flatMap(r=>[r.data,r.report,...r.inputs])].filter((r):r is Resource=>!!r)){
  const previous=aliases.get(r.versionId),identity=JSON.stringify([r.name,r.type])
  if(previous&&previous!==identity)throw new Error('VIDEO_DOCUMENT_RESOURCE_ALIAS')
  aliases.set(r.versionId,identity)
 }
 return d
}
const refs=(d:StoredVideo)=>[d.source,d.mask,...resultKeys.flatMap(k=>d[k]?[d[k]!.data,d[k]!.report,...d[k]!.inputs]:[])].filter((r):r is Resource=>!!r)
const refKey=(r:Resource)=>r.versionId+'|'+r.name+'|'+r.type
async function verify(d:StoredVideo,versions:Map<string,ManagedVersion>,budget:number){
 const tasks=new Map<string,Task>(),meta=(r:Resource)=>versions.get(r.versionId)!.metadata
 for(const r of refs(d))if(!integer(meta(r).bytes,1,(r.versionId===d.source?.versionId?200:128)*1024**2))throw new Error('VIDEO_DOCUMENT_RESOURCE_LIMIT')
 if(d.source){const m=meta(d.source);if(m.kind!=='video'||!integer(m.width,1,30000)||!integer(m.height,1,30000)||!finite(m.durationSeconds,Number.MIN_VALUE,Number.MAX_VALUE)||Math.abs(d.info!.duration-m.durationSeconds!)>1)throw new Error('VIDEO_DOCUMENT_SOURCE_METADATA')}
 let capturePlan:ReturnType<typeof videoCapturePlan>|null=null,processedSelection:number[]|null=null
 for(const key of resultKeys){const r=d[key];if(!r)continue
  const t=await localJson<Task>(`/api/tasks/${r.taskId}`),p=t.payload?.parameters
  if(t.state!=='succeeded'||t.payload.operation!==(key==='capture'?'video.capture':'video.frameTools')||!equal(t.payload.inputs,r.inputs.map(i=>i.versionId))||!equal(t.results,[r.data.versionId,r.report.versionId])||!p||!fields(p,['layout','renderer','frontendBytes'])||p.renderer!=='browser-worker'||!integer(p.frontendBytes,0,2*1024**3))throw new Error('VIDEO_DOCUMENT_TASK')
  if(meta(r.report).kind!=='document'||meta(r.report).extension!=='.json'||meta(r.report).bytes>8*1024**2||meta(r.data).kind!=='archive'||meta(r.data).extension!=='.zip')throw new Error('VIDEO_DOCUMENT_OUTPUT_METADATA')
  if(key==='capture'){
   const m=meta(d.source!);capturePlan=videoCapturePlan(p.layout,m.bytes,budget,0,{width:m.width!,height:m.height!})
   const layout=p.layout as VideoCaptureLayout
   if(layout.sourceWidth!==d.info!.width||layout.sourceHeight!==d.info!.height||layout.end>d.info!.duration+1e-6||layout.end>m.durationSeconds!+1||d.frameCount!==capturePlan.timestamps.length||d.frameSize!.w!==capturePlan.width||d.frameSize!.h!==capturePlan.height)throw new Error('VIDEO_DOCUMENT_CAPTURE_BINDING')
  }else{
   const count=['rawSheet','styledSheet','processedDownload'].includes(key)?processedSelection!.length:d.frameCount
   validateVideoFrameLayout(Array.from({length:count},()=>d.frameSize!),p.layout)
   const layout=p.layout as VideoFrameLayout
   if(key==='analysis'&&layout.mode!=='analyze'||key==='processed'&&!['matte','select'].includes(layout.mode)||['rawSheet','styledSheet'].includes(key)&&layout.mode!=='compose'||['rawDownload','processedDownload'].includes(key)&&layout.mode!=='archive')throw new Error('VIDEO_DOCUMENT_RESULT_ROLE')
   if(key==='processed'){
    const recipe=layout as Extract<VideoFrameLayout,{mode:'matte'|'select'}>;processedSelection=recipe.selected
    if(r.inputs.length!==(recipe.mode==='matte'&&recipe.mask?2:1))throw new Error('VIDEO_DOCUMENT_MASK_INPUT')
    if(r.inputs[1]){
     const m=meta(r.inputs[1]);if(m.kind!=='image'||m.containerFormat!=='PNG'||(m.frames??1)!==1||m.bytes>20*1024**2||m.width!==d.frameSize!.w||m.height!==d.frameSize!.h)throw new Error('VIDEO_DOCUMENT_MASK_METADATA')
    }
   }
   if(layout.mode==='compose'){
    if(!equal(layout.timestamps,processedSelection!.map(i=>capturePlan!.timestamps[i]))||key==='rawSheet'&&layout.strokeWidth!==0||key==='styledSheet'&&layout.strokeWidth<=0)throw new Error('VIDEO_DOCUMENT_COMPOSE_BINDING')
    if(key==='styledSheet'){
     const raw=tasks.get(d.rawSheet!.taskId)!.payload.parameters.layout as Extract<VideoFrameLayout,{mode:'compose'}>
     if(!equal({...layout,strokeWidth:raw.strokeWidth,strokeColor:raw.strokeColor},raw))throw new Error('VIDEO_DOCUMENT_STROKE_BINDING')
    }
   }
   if(layout.mode==='archive'&&(layout.kind!==(key==='rawDownload'?'extracted':'matted')||!equal(layout.selected,Array.from({length:count},(_,i)=>i))))throw new Error('VIDEO_DOCUMENT_ARCHIVE_BINDING')
  }
  tasks.set(r.taskId,t)
 }
 if(d.mask){const m=meta(d.mask);if(m.kind!=='image'||m.containerFormat!=='PNG'||(m.frames??1)!==1||m.bytes>20*1024**2||m.width!==d.frameSize!.w||m.height!==d.frameSize!.h)throw new Error('VIDEO_DOCUMENT_MASK_METADATA')}
 return tasks
}
async function reports(d:VideoDraft,tasks:Map<string,Task>){
 for(const key of resultKeys){const r=d[key];if(!r)continue
  const report=JSON.parse(await r.report.text()),t=tasks.get(r.taskId)!,p=t.payload.parameters
  if(!object(report)||report.operation!==t.payload.operation||!equal(report.parameters,p))throw new Error('VIDEO_DOCUMENT_REPORT')
  if(key==='capture'){
   const m=imageToolMetadata.get(d.source!)!.metadata,plan=videoCapturePlan(p.layout,m.bytes,2*1024**3,0,{width:m.width!,height:m.height!})
   if(!equal(report.timestamps,plan.timestamps)||report.outputFrames!==d.frameCount||report.width!==d.frameSize!.w||report.height!==d.frameSize!.h||report.cropWidth!==plan.cropWidth||report.cropHeight!==plan.cropHeight)throw new Error('VIDEO_DOCUMENT_CAPTURE_REPORT')
  }else{
   const layout=p.layout as VideoFrameLayout
   if(report.mode!==layout.mode||report.inputFrames!==(key==='rawSheet'||key==='styledSheet'||key==='processedDownload'?(tasks.get(d.processed!.taskId)!.payload.parameters.layout as {selected:number[]}).selected.length:d.frameCount))throw new Error('VIDEO_DOCUMENT_FRAME_REPORT')
   const count=layout.mode==='compose'?1:layout.mode==='analyze'?0:layout.selected.length
   if(report.outputFrames!==count)throw new Error('VIDEO_DOCUMENT_OUTPUT_COUNT')
   if(layout.mode==='matte'||layout.mode==='select')if(!equal(report.frameSizes,layout.selected.map(()=>d.frameSize)))throw new Error('VIDEO_DOCUMENT_FRAME_SIZES')
  }
  videoReports.set(r.report,report)
 }
}
function encode(d:VideoDraft,ref:(f:File)=>Resource):StoredVideo{
 const results=Object.fromEntries(resultKeys.map(k=>[k,d[k]?{data:ref(d[k]!.data),report:ref(d[k]!.report),inputs:d[k]!.inputs.map(ref),taskId:d[k]!.taskId}:null]))
 return validateStoredVideo({...d,...results,formatVersion:1,source:d.source?ref(d.source):null,mask:d.mask?ref(d.mask):null})
}
export async function serializeVideo(d:VideoDraft):Promise<StoredVideo>{
 const files=[...videoFiles([d])],placeholders=new Map(files.map((f,i)=>[f,{versionId:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,name:f.name,type:f.type}]))
 encode(d,f=>placeholders.get(f)!)
 const {versions,memoryBudgetBytes:budget}=await importManagedInputs(files);files.forEach((f,i)=>imageToolMetadata.set(f,versions[i]))
 const stored=encode(d,f=>({versionId:imageToolMetadata.get(f)!.id,name:f.name,type:f.type}))
 if(files.reduce((sum,f)=>sum+f.size*2,0)+JSON.stringify(stored).length*2>budget/4)throw new Error('VIDEO_DOCUMENT_RESOURCE_LIMIT')
 const tasks=await verify(stored,new Map(versions.map(v=>[v.id,v])),budget);await reports(d,tasks);return stored
}
export async function restoreVideo(value:unknown,retained:File[]=[]):Promise<VideoDraft>{
 const d=validateStoredVideo(value),{project,memoryBudgetBytes:budget}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
 if(!integer(budget,1,2*1024**3))throw new Error('VIDEO_DOCUMENT_BUDGET')
 const resources=refs(d),values=await loadManagedVersions([...new Set(resources.map(r=>r.versionId))]),versions=new Map(values.map(v=>[v.id,v]))
 if([...new Set(retained)].reduce((sum,f)=>sum+f.size*2,0)+values.reduce((sum,v)=>sum+v.metadata.bytes*2,0)+JSON.stringify(d).length*2>budget/4)throw new Error('VIDEO_DOCUMENT_RESOURCE_LIMIT')
 const tasks=await verify(d,versions,budget),loaded=new Map<string,File>()
 for(const r of resources){if(loaded.has(refKey(r)))continue
  const response=await localFetch(`/api/versions/${r.versionId}/content`);if(!response.ok)throw new Error('VIDEO_DOCUMENT_CONTENT')
  const blob=await response.blob();if(blob.size!==versions.get(r.versionId)!.metadata.bytes)throw new Error('VIDEO_DOCUMENT_RESOURCE_SIZE')
  const f=new File([blob],r.name,{type:r.type});imageToolMetadata.set(f,versions.get(r.versionId)!);cacheManagedInput(f,project.id,r.versionId);loaded.set(refKey(r),f)
 }
 const {formatVersion:_,...settings}=d;void _
 const results=Object.fromEntries(resultKeys.map(k=>{const r=d[k];return[k,r?{data:loaded.get(refKey(r.data))!,report:loaded.get(refKey(r.report))!,inputs:r.inputs.map(v=>loaded.get(refKey(v))!),taskId:r.taskId}:null]}))
 const draft={...settings,...results,source:d.source?loaded.get(refKey(d.source))!:null,mask:d.mask?loaded.get(refKey(d.mask))!:null} as VideoDraft
 await reports(draft,tasks);return draft
}

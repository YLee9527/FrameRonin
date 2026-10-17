import {checkCustomSliceBudget,customComposeSize,customSliceSizes,validateCustomCompose,validateCustomLayout,validateCustomPlan,type CustomCompose,type CustomLayout,type CustomPlan,type FrameSize} from '../lib/customSlice'
import type {Region} from '../lib/customSliceAlgorithms'
import {uniformColStarts,uniformRowStarts} from '../lib/customSliceAlgorithms'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {imageToolMetadata} from './imageToolDocument'
import {cacheManagedInput,importManagedInputs,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {localFetch,localJson} from './api'

export type CustomResult={data:File;report:File;taskId:string}
export type CustomSettings={activeTab:'auto'|'grid'|'custom';columns:number;rows:number;regions:Region[];rearrangeRows:number;rearrangeCols:number;rearrangeGrid:number[][];expandUp:number;expandDown:number;expandLeft:number;expandRight:number;expandMode:'all'|'heightUpOnly';sliceL7:boolean;previewRowStarts:number[]|null;previewColStarts:number[]|null;previewMeta:{w:number;h:number;cols:number;rows:number}|null;l7BandPercent:number;l7BandColOffset:number[];l7PolyBendY:number;l7PolyDeltaX:number}
export type CustomSliceDraft=CustomSettings&{spriteFile:File|null;info:{w:number;h:number}|null;planResult:CustomResult|null;splitResult:CustomResult|null;composedResult:(CustomResult&{input:File})|null}
export const customSettings:CustomSettings={activeTab:'auto',columns:8,rows:4,regions:[],rearrangeRows:2,rearrangeCols:4,rearrangeGrid:[[],[]],expandUp:0,expandDown:0,expandLeft:0,expandRight:0,expandMode:'all',sliceL7:false,previewRowStarts:null,previewColStarts:null,previewMeta:null,l7BandPercent:25,l7BandColOffset:[],l7PolyBendY:32,l7PolyDeltaX:0}
export const initialCustomSliceDraft=():CustomSliceDraft=>({...customSettings,regions:[],rearrangeGrid:Array.from({length:2},()=>Array(4).fill(0)),l7BandColOffset:[],spriteFile:null,info:null,planResult:null,splitResult:null,composedResult:null})
export const customSliceFiles=(drafts:CustomSliceDraft[])=>new Set(drafts.flatMap(d=>[d.spriteFile,d.planResult?.data,d.planResult?.report,d.splitResult?.data,d.splitResult?.report,d.composedResult?.data,d.composedResult?.report,d.composedResult?.input]).filter((f):f is File=>!!f))
export const customReports=new WeakMap<File,Record<string,unknown>>()
type Resource={versionId:string;name:string;type:string}
type StoredResult={data:Resource;report:Resource;taskId:string}
export type StoredCustomSlice=CustomSettings&{formatVersion:1;spriteFile:Resource|null;info:CustomSliceDraft['info'];planResult:StoredResult|null;splitResult:StoredResult|null;composedResult:(StoredResult&{input:Resource})|null}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(v)
function resource(v:unknown):asserts v is Resource{
 if(!object(v)||!fields(v,['versionId','name','type'])||!uuid(v.versionId)||typeof v.name!=='string'||!v.name.length||v.name.length>255||['.','..'].includes(v.name)||/[\\/]/.test(v.name)||[...v.name].some(c=>c.charCodeAt(0)<32)||typeof v.type!=='string'||v.type.length>100||[...v.type].some(c=>c.charCodeAt(0)<32))throw new Error('CUSTOM_DOCUMENT_RESOURCE')
}
export function customComposition(d:CustomSettings):CustomCompose{return {rows:d.rearrangeRows,columns:d.rearrangeCols,grid:d.rearrangeGrid,expandUp:d.expandUp,expandDown:d.expandDown,expandLeft:d.expandLeft,expandRight:d.expandRight}}
export function currentCustomLayout(d:CustomSliceDraft):CustomLayout{
 if(!d.info)throw new Error('CUSTOM_SOURCE_REQUIRED')
 if(d.activeTab==='custom')return {mode:'regions',regions:d.regions}
 if(!d.sliceL7)return d.activeTab==='auto'?{mode:'bands',colStarts:uniformColStarts(d.info.w,d.columns),rowStarts:uniformRowStarts(d.info.h,d.rows),bandColOffset:Array(d.rows).fill(0)}:{mode:'grid',columns:d.columns,rows:d.rows}
 if(!d.previewMeta||!d.previewColStarts||!d.previewRowStarts||d.previewMeta.w!==d.info.w||d.previewMeta.h!==d.info.h||d.activeTab==='grid'&&(d.columns!==d.previewMeta.cols||d.rows!==d.previewMeta.rows))throw new Error('CUSTOM_PREVIEW_REQUIRED')
 return d.previewMeta.rows===1?{mode:'polyline',colStarts:d.previewColStarts,bendY:d.l7PolyBendY,deltaX:d.l7PolyDeltaX}:{mode:'bands',colStarts:d.previewColStarts,rowStarts:d.previewRowStarts,bandColOffset:d.l7BandColOffset}
}
export function clearedCustomSeams(){return {previewRowStarts:null,previewColStarts:null,previewMeta:null,l7BandColOffset:[],l7PolyBendY:32,l7PolyDeltaX:0}}
export function customPlanSettings(plan:CustomPlan){return {columns:plan.columns,rows:plan.rows,previewRowStarts:plan.rowStarts,previewColStarts:plan.colStarts,previewMeta:{w:plan.width,h:plan.height,cols:plan.columns,rows:plan.rows},l7BandColOffset:plan.bandColOffset,l7PolyBendY:plan.bendY,l7PolyDeltaX:plan.deltaX}}
export function validateStoredCustomSlice(value:unknown):StoredCustomSlice{
 if(!object(value)||!fields(value,[...Object.keys(customSettings),'formatVersion','spriteFile','info','planResult','splitResult','composedResult'])||value.formatVersion!==1||!['auto','grid','custom'].includes(String(value.activeTab))||!integer(value.columns,1,4096)||!integer(value.rows,1,4096)||Number(value.columns)*Number(value.rows)>4096||typeof value.sliceL7!=='boolean'||!['all','heightUpOnly'].includes(String(value.expandMode))||!integer(value.l7BandPercent,10,50)||!integer(value.l7PolyBendY,0,30000)||!integer(value.l7PolyDeltaX,-30000,30000)||!Array.isArray(value.l7BandColOffset)||value.l7BandColOffset.length>4096||value.l7BandColOffset.some(v=>!integer(v,-30000,30000)))throw new Error('CUSTOM_DOCUMENT_FIELDS')
 validateCustomCompose(customComposition(value as unknown as CustomSettings),4096)
 if(!Array.isArray(value.regions)||value.regions.length>4096)throw new Error('CUSTOM_DOCUMENT_REGIONS')
 const ids=new Set<string>()
 for(const r of value.regions){
  if(!object(r)||!fields(r,['id','x','y','w','h'])||typeof r.id!=='string'||!/^[a-z\d-]{1,80}$/i.test(r.id)||ids.has(r.id)||!['x','y','w','h'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])&&Number(r[k])>=(k==='x'||k==='y'?0:1)&&Number(r[k])<=30000))throw new Error('CUSTOM_DOCUMENT_REGION')
  ids.add(r.id)
 }
 if(value.spriteFile===null){if(value.info!==null||value.planResult!==null||value.splitResult!==null||value.composedResult!==null||value.previewMeta!==null)throw new Error('CUSTOM_DOCUMENT_SOURCE')}
 else{
  resource(value.spriteFile)
  if(!object(value.info)||!fields(value.info,['w','h'])||!integer(value.info.w,1,30000)||!integer(value.info.h,1,30000))throw new Error('CUSTOM_DOCUMENT_SIZE')
 }
 if(value.previewMeta!==null){
  const m=value.previewMeta
  if(!object(m)||!fields(m,['w','h','cols','rows'])||!object(value.info)||m.w!==value.info.w||m.h!==value.info.h||!integer(m.cols,1,4096)||!integer(m.rows,1,4096)||!Array.isArray(value.previewColStarts)||value.previewColStarts.length!==Number(m.cols)+1||!Array.isArray(value.previewRowStarts)||value.previewRowStarts.length!==Number(m.rows)+1)throw new Error('CUSTOM_DOCUMENT_SEAMS')
  validateCustomLayout({mode:'bands',colStarts:value.previewColStarts,rowStarts:value.previewRowStarts,bandColOffset:value.l7BandColOffset},Number(m.w),Number(m.h))
  if(m.rows===1)validateCustomLayout({mode:'polyline',colStarts:value.previewColStarts,bendY:value.l7PolyBendY,deltaX:value.l7PolyDeltaX},Number(m.w),Number(m.h))
 }else if(value.previewColStarts!==null||value.previewRowStarts!==null||value.l7BandColOffset.length)throw new Error('CUSTOM_DOCUMENT_SEAMS')
 for(const [name,r]of [['planResult',value.planResult],['splitResult',value.splitResult],['composedResult',value.composedResult]] as const)if(r!==null){
  if(!object(r)||!fields(r,name==='composedResult'?['data','report','taskId','input']:['data','report','taskId'])||!uuid(r.taskId)||!value.spriteFile)throw new Error('CUSTOM_DOCUMENT_RESULT')
  resource(r.data);resource(r.report)
  if(name==='composedResult'){resource(r.input);if(!object(value.splitResult)||(r.input as Resource).versionId!==(value.splitResult.data as Resource).versionId)throw new Error('CUSTOM_COMPOSE_INPUT')}
 }
 return value as StoredCustomSlice
}
const refs=(d:StoredCustomSlice)=>[d.spriteFile,d.planResult?.data,d.planResult?.report,d.splitResult?.data,d.splitResult?.report,d.composedResult?.data,d.composedResult?.report,d.composedResult?.input].filter((r):r is Resource=>!!r)
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:Record<string,unknown>}}
const operations={planResult:'image.customSlicePlan',splitResult:'image.customSlice',composedResult:'image.customCompose'} as const
async function verify(d:StoredCustomSlice,versions:Map<string,ManagedVersion>,budget:number){
 if(d.spriteFile){const m=versions.get(d.spriteFile.versionId)!.metadata,size=fineEditorDimensions(m)
  if(m.kind!=='image'||m.bytes>20*1024**2||!['PNG','JPEG','WEBP'].includes(m.containerFormat??'')||(m.frames??1)!==1||size.width!==d.info!.w||size.height!==d.info!.h)throw new Error('CUSTOM_DOCUMENT_SOURCE_METADATA')
  checkCustomSliceBudget(d.info!.w,d.info!.h,m.bytes,budget,0)
 }
 for(const v of versions.values())if(!integer(v.metadata.bytes,1,budget/4))throw new Error('CUSTOM_DOCUMENT_RESOURCE_SIZE')
 for(const key of Object.keys(operations) as (keyof typeof operations)[]){const result=d[key];if(!result)continue
  const task=await localJson<Task>(`/api/tasks/${result.taskId}`),input=key==='composedResult'?d.composedResult!.input.versionId:d.spriteFile!.versionId
  if(task.state!=='succeeded'||task.payload.operation!==operations[key]||JSON.stringify(task.payload.inputs)!==JSON.stringify([input])||JSON.stringify(task.results)!==JSON.stringify([result.data.versionId,result.report.versionId]))throw new Error('CUSTOM_DOCUMENT_TASK')
  const data=versions.get(result.data.versionId)!.metadata,report=versions.get(result.report.versionId)!.metadata
  if(report.kind!=='document'||report.extension!=='.json'||report.bytes>8*1024**2)throw new Error('CUSTOM_DOCUMENT_REPORT')
  if(key==='planResult'?(data.kind!=='document'||data.extension!=='.json'||data.bytes>1024**2):key==='splitResult'?(data.kind!=='archive'||data.extension!=='.zip'||data.bytes>128*1024**2):(data.kind!=='image'||data.containerFormat!=='PNG'||data.extension!=='.png'))throw new Error('CUSTOM_DOCUMENT_RESULT_METADATA')
  if(key==='splitResult')validateCustomLayout(task.payload.parameters.layout,d.info!.w,d.info!.h)
 }
}
async function reports(d:CustomSliceDraft){
 for(const key of Object.keys(operations) as (keyof typeof operations)[]){const result=d[key];if(!result)continue
  const report=JSON.parse(await result.report.text()),task=await localJson<Task>(`/api/tasks/${result.taskId}`)
  if(!object(report)||report.operation!==operations[key]||!object(report.parameters)||Object.entries(task.payload.parameters).some(([k,v])=>JSON.stringify(v)!==JSON.stringify((report.parameters as Record<string,unknown>)[k])))throw new Error('CUSTOM_DOCUMENT_REPORT_PARAMETERS')
  if(key==='planResult'){const plan=JSON.parse(await result.data.text());validateCustomPlan(plan,d.info!.w,d.info!.h);if(report.plannedCells!==plan.columns*plan.rows)throw new Error('CUSTOM_DOCUMENT_PLAN_COUNT')}
  if(key==='splitResult'){
   const sizes=customSliceSizes(d.info!.w,d.info!.h,task.payload.parameters.layout as CustomLayout)
   if(report.outputFrames!==sizes.length||JSON.stringify(report.frameSizes)!==JSON.stringify(sizes))throw new Error('CUSTOM_DOCUMENT_FRAME_SIZES')
  }
  if(key==='composedResult'){
   const split=customReports.get(d.splitResult!.report),sizes=split?.frameSizes as FrameSize[]|undefined
   if(!sizes)throw new Error('CUSTOM_DOCUMENT_COMPOSE_SOURCE')
   const size=customComposeSize(sizes,task.payload.parameters.composition as CustomCompose),meta=imageToolMetadata.get(result.data)!.metadata
   if(meta.width!==size.width||meta.height!==size.height||report.width!==size.width||report.height!==size.height||report.outputFrames!==1||report.sourceFrames!==sizes.length)throw new Error('CUSTOM_DOCUMENT_COMPOSE_SIZE')
  }
  customReports.set(result.report,report)
 }
}
export async function serializeCustomSlice(d:CustomSliceDraft):Promise<StoredCustomSlice>{
 const files=[...customSliceFiles([d])],{versions,memoryBudgetBytes}=await importManagedInputs(files);files.forEach((f,i)=>imageToolMetadata.set(f,versions[i]))
 const ref=(f:File):Resource=>({versionId:imageToolMetadata.get(f)!.id,name:f.name,type:f.type}),result=(r:CustomResult|null)=>r?{data:ref(r.data),report:ref(r.report),taskId:r.taskId}:null
 const stored=validateStoredCustomSlice({...d,formatVersion:1,spriteFile:d.spriteFile?ref(d.spriteFile):null,planResult:result(d.planResult),splitResult:result(d.splitResult),composedResult:d.composedResult?{...result(d.composedResult)!,input:ref(d.composedResult.input)}:null})
 await verify(stored,new Map(versions.map(v=>[v.id,v])),memoryBudgetBytes);await reports(d);return stored
}
export async function restoreCustomSlice(value:unknown,retained:File[]=[]):Promise<CustomSliceDraft>{
 const d=validateStoredCustomSlice(value),{project,memoryBudgetBytes:budget}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
 if(!integer(budget,1,2*1024**3))throw new Error('CUSTOM_DOCUMENT_BUDGET')
 const references=refs(d),values=await loadManagedVersions([...new Set(references.map(r=>r.versionId))]),versions=new Map(values.map(v=>[v.id,v])),loaded=new Map<string,File>()
 const bytes=[...new Set(retained)].reduce((s,f)=>s+f.size*2,0)+values.reduce((s,v)=>s+v.metadata.bytes*2,0)
 if(bytes>budget/4)throw new Error('CUSTOM_DOCUMENT_RESOURCE_LIMIT')
 await verify(d,versions,budget)
 const key=(r:Resource)=>r.versionId+'|'+r.name+'|'+r.type
 for(const r of references){if(loaded.has(key(r)))continue
  const response=await localFetch(`/api/versions/${r.versionId}/content`);if(!response.ok)throw new Error('CUSTOM_DOCUMENT_CONTENT')
  const blob=await response.blob();if(blob.size!==versions.get(r.versionId)!.metadata.bytes)throw new Error('CUSTOM_DOCUMENT_RESOURCE_SIZE')
  const file=new File([blob],r.name,{type:r.type});imageToolMetadata.set(file,versions.get(r.versionId)!);cacheManagedInput(file,project.id,r.versionId);loaded.set(key(r),file)
 }
 const result=(r:StoredResult|null):CustomResult|null=>r?{data:loaded.get(key(r.data))!,report:loaded.get(key(r.report))!,taskId:r.taskId}:null
 const {formatVersion:_,...settings}=d;void _
 const draft:CustomSliceDraft={...settings,spriteFile:d.spriteFile?loaded.get(key(d.spriteFile))!:null,planResult:result(d.planResult),splitResult:result(d.splitResult),composedResult:d.composedResult?{...result(d.composedResult)!,input:loaded.get(key(d.composedResult.input))!}:null}
 await reports(draft);return draft
}

import {sheetLayout,validateSheetCompose,validateSheetFix,type SheetCrop,type SheetPlacement,type SheetPixelFix} from '../lib/sheetAdjust'
import {sheetPreprocessDefaults,sheetPreprocessHasEffect,validateSheetPreprocess,validateSheetPreparation,type SheetPreparation} from '../lib/sheetPrepare'
import type {SheetProPreprocessOptions} from '../lib/sheetProPreprocess'
import type {FrameSize} from '../lib/customSlice'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {validateMediaResource,type CustomResult,type StoredCustomSlice} from './customSliceDocument'
import {imageToolMetadata} from './imageToolDocument'
import {cacheManagedInput,importManagedInputs,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {jsonPost,localFetch,localJson} from './api'

export type SheetFrame=SheetPlacement&{id:string;selected:boolean;counts:{up:number;down:number;left:number;right:number}}
export type SheetRecipe={preprocess:SheetProPreprocessOptions|null;layout:SheetPreparation}
export const currentSheetRecipe=(d:SheetAdjustDraft):SheetRecipe=>({preprocess:d.integrated&&d.preEnabled&&sheetPreprocessHasEffect(d.preprocess)?d.preprocess:null,layout:d.mode==='transparent'?{mode:'transparent'}:{mode:d.mode,columns:d.mode==='whole'?d.splitColumns:d.uniformColumns,rows:d.mode==='whole'?d.splitRows:d.uniformRows}})
export type SheetExport=CustomResult&{input:File}
export type SheetAdjustDraft={integrated:boolean;source:File|null;info:FrameSize|null;preEnabled:boolean;preprocess:SheetProPreprocessOptions;processed:CustomResult|null;mode:SheetPreparation['mode'];splitColumns:number;splitRows:number;uniformColumns:number;uniformRows:number;columns:number;rows:number;transparentColumns:number;crop:SheetCrop;archive:CustomResult|null;recipe:SheetRecipe|null;lineage:string[];sizes:FrameSize[];frames:SheetFrame[];speedScale:number;zoom:number;background:string;cursor:number;fixedMode:boolean;fixedRange:number;fixReference:FrameSize|null;fixes:SheetPixelFix[];composed:SheetExport|null;gif:SheetExport|null;raw:SheetExport|null}
export const emptySheetCrop=():SheetCrop=>({top:0,bottom:0,left:0,right:0})
export const newSheetFrame=(sourceIndex:number):SheetFrame=>({id:crypto.randomUUID(),sourceIndex,dx:0,dy:0,crop:emptySheetCrop(),selected:true,counts:{up:0,down:0,left:0,right:0}})
export const preparedSheetFrames=(sizes:FrameSize[])=>sizes.map((_,i)=>({...newSheetFrame(i),selected:i<6}))
export const initialSheetAdjustDraft=(integrated=false):SheetAdjustDraft=>({integrated,source:null,info:null,preEnabled:false,preprocess:{...sheetPreprocessDefaults},processed:null,mode:'whole',splitColumns:8,splitRows:4,uniformColumns:2,uniformRows:2,columns:8,rows:4,transparentColumns:4,crop:emptySheetCrop(),archive:null,recipe:null,lineage:[],sizes:[],frames:[],speedScale:1,zoom:4,background:'#e4dbcf',cursor:0,fixedMode:false,fixedRange:1,fixReference:null,fixes:[],composed:null,gif:null,raw:null})
export const sheetAdjustFiles=(drafts:SheetAdjustDraft[])=>new Set(drafts.flatMap(d=>[d.source,...[d.processed,d.archive,d.composed,d.gif,d.raw].flatMap(r=>r?[r.data,r.report,...('input'in r?[r.input]:[])]:[])]).filter((f):f is File=>!!f))
export const sheetAdjustReports=new WeakMap<File,Record<string,unknown>>()
export const sheetPlacements=(d:SheetAdjustDraft)=>d.frames.map(({sourceIndex,dx,dy,crop})=>({sourceIndex,dx,dy,crop:d.integrated?d.crop:crop}))
export const sheetComposeLayout=(d:SheetAdjustDraft)=>({columns:d.columns,rows:d.rows,frames:sheetPlacements(d)})
export const sheetGifLayout=(d:SheetAdjustDraft)=>({...sheetComposeLayout(d),selected:d.frames.flatMap((f,i)=>f.selected?[i]:[]),speedScale:d.speedScale})
type Resource=NonNullable<StoredCustomSlice['spriteFile']>
type StoredResult={data:Resource;report:Resource;taskId:string}
type StoredExport=StoredResult&{input:Resource}
export type StoredSheetAdjust=Omit<SheetAdjustDraft,'source'|'processed'|'archive'|'composed'|'gif'|'raw'>&{formatVersion:1;source:Resource|null;processed:StoredResult|null;archive:StoredResult|null;composed:StoredExport|null;gif:StoredExport|null;raw:StoredExport|null}
export type SheetTaskLink={id:string;state:string;operation:string;inputs:string[];results:string[]}
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:{layout:unknown;renderer:string;frontendBytes:number}}}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(v)
const equal=(a:unknown,b:unknown):boolean=>{
 if(Object.is(a,b))return true
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]))
 if(object(a)&&object(b))return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]))
 return false
}
function crop(v:unknown){if(!object(v)||!fields(v,['top','bottom','left','right'])||Object.values(v).some(n=>!finite(n,-30000,30000)))throw new Error('SHEET_DOCUMENT_CROP')}
function size(v:unknown){if(!object(v)||!fields(v,['w','h'])||!integer(v.w,1,30000)||!integer(v.h,1,30000))throw new Error('SHEET_DOCUMENT_SIZE')}
export function validateStoredSheetAdjust(value:unknown):StoredSheetAdjust{
 if(!object(value)||!fields(value,['formatVersion',...Object.keys(initialSheetAdjustDraft())])||value.formatVersion!==1||typeof value.integrated!=='boolean'||typeof value.preEnabled!=='boolean'||typeof value.fixedMode!=='boolean'||!finite(value.speedScale,.25,4)||!integer(value.zoom,1,8)||!integer(value.cursor,0,4095)||!integer(value.fixedRange,1,8)||typeof value.background!=='string'||!(value.background==='checkered'||/^#[a-f\d]{6}$/i.test(value.background)))throw new Error('SHEET_DOCUMENT_FIELDS')
 validateSheetPreprocess(value.preprocess);crop(value.crop)
 if(!['whole','uniform','transparent'].includes(String(value.mode))||!['splitColumns','columns','transparentColumns'].every(k=>integer(value[k],1,64))||!integer(value.splitRows,1,4096)||!integer(value.rows,1,4096)||!['uniformColumns','uniformRows'].every(k=>integer(value[k],1,32)))throw new Error('SHEET_DOCUMENT_GRID')
 if(!Array.isArray(value.lineage)||value.lineage.length>8192||value.lineage.some(v=>!uuid(v))||new Set(value.lineage).size!==value.lineage.length||!Array.isArray(value.sizes)||value.sizes.length>4096||!Array.isArray(value.frames)||value.frames.length>4096||!Array.isArray(value.fixes)||value.fixes.length>4096)throw new Error('SHEET_DOCUMENT_ARRAYS')
 value.sizes.forEach(size)
 const ids=new Set<string>(),indices=new Set<number>()
 for(const frame of value.frames){
  if(!object(frame)||!fields(frame,['id','sourceIndex','dx','dy','crop','selected','counts'])||!uuid(frame.id)||ids.has(String(frame.id))||!integer(frame.sourceIndex,0,value.sizes.length-1)||indices.has(Number(frame.sourceIndex))||!integer(frame.dx,-30000,30000)||!integer(frame.dy,-30000,30000)||typeof frame.selected!=='boolean'||!object(frame.counts)||!fields(frame.counts,['up','down','left','right'])||Object.values(frame.counts).some(v=>!integer(v,0,1e9)))throw new Error('SHEET_DOCUMENT_FRAME')
  crop(frame.crop);ids.add(frame.id as string);indices.add(frame.sourceIndex as number)
 }
 if(value.source===null){if(value.info!==null||value.processed!==null||value.archive!==null||value.composed!==null||value.gif!==null||value.raw!==null)throw new Error('SHEET_DOCUMENT_SOURCE')}
 else{validateMediaResource(value.source);size(value.info)}
 for(const key of ['processed','archive','composed','gif','raw']){const r=value[key];if(r===null)continue
  const output=!['processed','archive'].includes(key)
  if(!value.source||!object(r)||!fields(r,['data','report','taskId',...(output?['input']:[])])||!uuid(r.taskId))throw new Error('SHEET_DOCUMENT_RESULT')
  validateMediaResource(r.data);validateMediaResource(r.report);if(output)validateMediaResource(r.input)
 }
 if(value.archive===null){if(value.recipe!==null||value.sizes.length||value.frames.length||value.lineage.length||value.fixes.length||value.fixReference!==null||value.composed!==null||value.gif!==null||value.raw!==null)throw new Error('SHEET_DOCUMENT_ARCHIVE')}
 else{
  if(!value.sizes.length||!value.lineage.length||!object(value.recipe)||!fields(value.recipe,['preprocess','layout']))throw new Error('SHEET_DOCUMENT_RECIPE')
  if(value.recipe.preprocess!==null)validateSheetPreprocess(value.recipe.preprocess)
  validateSheetPreparation(value.recipe.layout)
  if(value.frames.length)validateSheetCompose(sheetComposeLayout(value as unknown as SheetAdjustDraft),value.sizes as FrameSize[])
 }
 if(value.fixReference!==null)size(value.fixReference)
 if(value.fixes.length){if(!value.fixReference)throw new Error('SHEET_DOCUMENT_FIX_REFERENCE');const ref=value.fixReference as FrameSize;validateSheetFix({selected:[0],referenceWidth:ref.w,referenceHeight:ref.h,fixes:value.fixes},value.sizes as FrameSize[])}
 return value as StoredSheetAdjust
}
/** Verify only immutable IDs here. Historical ZIPs are not fetched to prove a chain. */
export function verifySheetLineage(d:StoredSheetAdjust,links:SheetTaskLink[]){
 if(links.length!==d.lineage.length||links.some((r,i)=>r.id!==d.lineage[i]||r.state!=='succeeded'||r.inputs.length!==1||r.results.length!==2||r.results.some(v=>!uuid(v))))throw new Error('SHEET_DOCUMENT_LINEAGE')
 let input=d.source?.versionId,prepared=false;const archives=new Set<string>()
 for(let i=0;i<links.length;i++){
  const link=links[i]
  if(link.inputs[0]!==input)throw new Error('SHEET_DOCUMENT_LINEAGE_INPUT')
  if(!prepared){
   if(i===0&&d.recipe?.preprocess!==null){if(link.operation!=='image.sheetPreprocess')throw new Error('SHEET_DOCUMENT_LINEAGE_PREPROCESS')}
   else if(link.operation==='image.sheetPrepare')prepared=true
   else throw new Error('SHEET_DOCUMENT_LINEAGE_PREPARE')
  }else if(!['image.sheetFix','image.sheetFrames'].includes(link.operation))throw new Error('SHEET_DOCUMENT_LINEAGE_OPERATION')
  input=link.results[0];if(prepared)archives.add(input)
 }
 if(d.archive&&(!prepared||input!==d.archive.data.versionId||links.at(-1)?.id!==d.archive.taskId||links.at(-1)?.results[1]!==d.archive.report.versionId))throw new Error('SHEET_DOCUMENT_LINEAGE_OUTPUT')
 for(const r of [d.composed,d.gif,d.raw])if(r&&!archives.has(r.input.versionId))throw new Error('SHEET_DOCUMENT_EXPORT_INPUT')
 return archives
}
const refs=(d:StoredSheetAdjust)=>[d.source,...[d.processed,d.archive,d.composed,d.gif,d.raw].flatMap(r=>r?[r.data,r.report,...('input'in r?[r.input]:[])]:[])].filter((r):r is Resource=>!!r)
const resultKeys=['processed','archive','composed','gif','raw'] as const
async function verify(d:StoredSheetAdjust,versions:Map<string,ManagedVersion>,budget:number){
 if(d.source){const m=versions.get(d.source.versionId)!.metadata,s=fineEditorDimensions(m);if(m.kind!=='image'||!['PNG','JPEG','WEBP'].includes(m.containerFormat??'')||(m.frames??1)!==1||!integer(m.bytes,1,20*1024**2)||s.width!==d.info!.w||s.height!==d.info!.h)throw new Error('SHEET_DOCUMENT_SOURCE_METADATA')}
 for(const v of versions.values())if(!integer(v.metadata.bytes,1,Math.min(budget/4,128*1024**2)))throw new Error('SHEET_DOCUMENT_RESOURCE_LIMIT')
 const links=d.lineage.length?await localJson<SheetTaskLink[]>('/api/tasks/manifest',jsonPost({tasks:d.lineage})):[]
 verifySheetLineage(d,links)
 const tasks=new Map<string,Task>()
 for(const key of resultKeys){const r=d[key];if(!r)continue
  const task=await localJson<Task>(`/api/tasks/${r.taskId}`),op=task.payload.operation,p=task.payload.parameters,expected=key==='processed'?['image.sheetPreprocess']:key==='archive'?['image.sheetPrepare','image.sheetFix','image.sheetFrames']:key==='composed'?['image.sheetCompose']:key==='gif'?['image.sheetGif']:['image.sheetFrames']
  const input=key==='processed'?d.source!.versionId:key==='archive'?links.at(-1)!.inputs[0]:(r as StoredExport).input.versionId
  if(task.state!=='succeeded'||!expected.includes(op)||!equal(task.payload.inputs,[input])||!equal(task.results,[r.data.versionId,r.report.versionId])||p.renderer!=='browser-worker')throw new Error('SHEET_DOCUMENT_TASK')
  const data=versions.get(r.data.versionId)!.metadata,report=versions.get(r.report.versionId)!.metadata
  if(report.kind!=='document'||report.extension!=='.json'||report.bytes>8*1024**2||(['archive','raw'].includes(key)?data.kind!=='archive'||data.extension!=='.zip':!(key==='gif'?['image','animation']:['image']).includes(data.kind)||data.containerFormat!==(key==='gif'?'GIF':'PNG')))throw new Error('SHEET_DOCUMENT_RESULT_METADATA')
  tasks.set(r.taskId,task)
 }
 if(d.archive){
  let prepareIndex=0
  if(d.recipe!.preprocess!==null){const t=tasks.get(links[0].id)??await localJson<Task>(`/api/tasks/${links[0].id}`);if(!equal(t.payload.parameters.layout,d.recipe!.preprocess))throw new Error('SHEET_DOCUMENT_PREPROCESS_BINDING');prepareIndex=1}
  const t=tasks.get(links[prepareIndex].id)??await localJson<Task>(`/api/tasks/${links[prepareIndex].id}`)
  if(!equal(t.payload.parameters.layout,d.recipe!.layout))throw new Error('SHEET_DOCUMENT_PREPARE_BINDING')
 }
 return tasks
}
async function reports(d:SheetAdjustDraft,tasks:Map<string,Task>){
 for(const key of resultKeys){const r=d[key];if(!r)continue
  const report=JSON.parse(await r.report.text()),task=tasks.get(r.taskId)!
  if(!object(report)||report.operation!==task.payload.operation||!object(report.parameters)||Object.entries(task.payload.parameters).some(([k,v])=>!equal(v,(report.parameters as Record<string,unknown>)[k])))throw new Error('SHEET_DOCUMENT_REPORT')
  if(key==='archive'&&(report.outputFrames!==d.sizes.length||!equal(report.frameSizes,d.sizes)))throw new Error('SHEET_DOCUMENT_FRAME_SIZES')
  const meta=imageToolMetadata.get(r.data)!.metadata
  if((key==='processed'||key==='composed'||key==='gif')&&(report.width!==meta.width||report.height!==meta.height||report.outputFrames!==(meta.frames??1)))throw new Error('SHEET_DOCUMENT_OUTPUT_SIZE')
  sheetAdjustReports.set(r.report,report)
 }
}
export async function serializeSheetAdjust(d:SheetAdjustDraft):Promise<StoredSheetAdjust>{
 const files=[...sheetAdjustFiles([d])],{versions,memoryBudgetBytes:budget}=await importManagedInputs(files);files.forEach((f,i)=>imageToolMetadata.set(f,versions[i]))
 const ref=(f:File):Resource=>({versionId:imageToolMetadata.get(f)!.id,name:f.name,type:f.type}),result=(r:CustomResult|null)=>r?{data:ref(r.data),report:ref(r.report),taskId:r.taskId,...('input'in r?{input:ref(r.input as File)}:{})}:null
 const stored=validateStoredSheetAdjust({...d,formatVersion:1,source:d.source?ref(d.source):null,processed:result(d.processed),archive:result(d.archive),composed:result(d.composed),gif:result(d.gif),raw:result(d.raw)})
 if(files.reduce((n,f)=>n+f.size*2,0)+JSON.stringify(stored).length*2>budget/4)throw new Error('SHEET_DOCUMENT_RESOURCE_LIMIT')
 const tasks=await verify(stored,new Map(versions.map(v=>[v.id,v])),budget);await reports(d,tasks);return stored
}
export async function restoreSheetAdjust(value:unknown,retained:File[]=[]):Promise<SheetAdjustDraft>{
 const d=validateStoredSheetAdjust(value),{project,memoryBudgetBytes:budget}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
 if(!integer(budget,1,2*1024**3))throw new Error('SHEET_DOCUMENT_BUDGET')
 const resources=refs(d),values=await loadManagedVersions([...new Set(resources.map(r=>r.versionId))]),versions=new Map(values.map(v=>[v.id,v])),loaded=new Map<string,File>(),key=(r:Resource)=>r.versionId+'|'+r.name+'|'+r.type
 if([...new Set(retained)].reduce((s,f)=>s+f.size*2,0)+values.reduce((s,v)=>s+v.metadata.bytes*2,0)+JSON.stringify(d).length*2>budget/4)throw new Error('SHEET_DOCUMENT_RESOURCE_LIMIT')
 const tasks=await verify(d,versions,budget)
 for(const r of resources){if(loaded.has(key(r)))continue
  const response=await localFetch(`/api/versions/${r.versionId}/content`);if(!response.ok)throw new Error('SHEET_DOCUMENT_CONTENT')
  const blob=await response.blob();if(blob.size!==versions.get(r.versionId)!.metadata.bytes)throw new Error('SHEET_DOCUMENT_RESOURCE_SIZE')
  const file=new File([blob],r.name,{type:r.type});imageToolMetadata.set(file,versions.get(r.versionId)!);cacheManagedInput(file,project.id,r.versionId);loaded.set(key(r),file)
 }
 const result=(r:StoredResult|null)=>r?{data:loaded.get(key(r.data))!,report:loaded.get(key(r.report))!,taskId:r.taskId,...('input'in r?{input:loaded.get(key((r as StoredExport).input))!}:{})}:null
 const {formatVersion:_,...settings}=d;void _
 const draft={...settings,source:d.source?loaded.get(key(d.source))!:null,processed:result(d.processed),archive:result(d.archive),composed:result(d.composed),gif:result(d.gif),raw:result(d.raw)} as SheetAdjustDraft
 await reports(draft,tasks);return draft
}
export function sheetDisplaySize(d:SheetAdjustDraft){return d.frames.length?sheetLayout(d.sizes,sheetComposeLayout(d)):null}

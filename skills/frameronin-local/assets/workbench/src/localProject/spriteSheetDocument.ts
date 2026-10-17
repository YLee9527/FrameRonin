import {checkCustomSliceBudget,customSliceSizes,validateCustomLayout,type CustomLayout} from '../lib/customSlice'
import {spriteGifRows,validateSpriteGifLayout,type SpriteGifLayout} from '../lib/spriteGifRows'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {validateMediaResource,type CustomResult,type StoredCustomSlice} from './customSliceDocument'
import {imageToolMetadata} from './imageToolDocument'
import {cacheManagedInput,importManagedInputs,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {localFetch,localJson} from './api'

export type SpriteSheetDraft={source:File|null;info:{w:number;h:number}|null;activeTab:'split'|'togif';columns:number;rows:number;duration:number;framesPerRow:number;order:number[];split:CustomResult|null;frames:CustomResult|null;gifs:CustomResult|null}
export const initialSpriteSheetDraft=():SpriteSheetDraft=>({source:null,info:null,activeTab:'split',columns:8,rows:4,duration:100,framesPerRow:6,order:[],split:null,frames:null,gifs:null})
type Resource=NonNullable<StoredCustomSlice['spriteFile']>
type StoredResult={data:Resource;report:Resource;taskId:string}
export type StoredSpriteSheet=Omit<SpriteSheetDraft,'source'|'split'|'frames'|'gifs'>&{formatVersion:1;source:Resource|null;split:StoredResult|null;frames:StoredResult|null;gifs:StoredResult|null}
export const spriteSheetFiles=(drafts:SpriteSheetDraft[])=>new Set(drafts.flatMap(d=>[d.source,...[d.split,d.frames,d.gifs].flatMap(r=>r?[r.data,r.report]:[])]).filter((f):f is File=>!!f))
export const spriteSheetReports=new WeakMap<File,Record<string,unknown>>()
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(v)
export const spriteGifLayout=(d:SpriteSheetDraft):SpriteGifLayout=>({columns:d.columns,rows:d.rows,order:d.order,framesPerRow:d.framesPerRow,duration:d.duration})
export function validateStoredSpriteSheet(value:unknown):StoredSpriteSheet{
 if(!object(value)||!fields(value,['formatVersion','source','info','activeTab','columns','rows','duration','framesPerRow','order','split','frames','gifs'])||value.formatVersion!==1||!['split','togif'].includes(String(value.activeTab))
  ||!integer(value.columns,1,64)||!integer(value.rows,1,64)||!integer(value.duration,20,500)||!integer(value.framesPerRow,1,128)||!Array.isArray(value.order)||value.order.length>4096||new Set(value.order).size!==value.order.length||value.order.some(v=>!integer(v,0,Number(value.columns)*Number(value.rows)-1)))throw new Error('SPRITE_DOCUMENT_FIELDS')
 if(value.source===null){if(value.info!==null||value.split!==null||value.frames!==null||value.gifs!==null||value.order.length)throw new Error('SPRITE_DOCUMENT_SOURCE')}
 else{validateMediaResource(value.source);if(!object(value.info)||!fields(value.info,['w','h'])||!integer(value.info.w,1,30000)||!integer(value.info.h,1,30000))throw new Error('SPRITE_DOCUMENT_SIZE')}
 for(const key of ['split','frames','gifs']){
  const r=value[key]
  if(r!==null){if(!object(r)||!fields(r,['data','report','taskId'])||!uuid(r.taskId)||!value.source)throw new Error('SPRITE_DOCUMENT_RESULT');validateMediaResource(r.data);validateMediaResource(r.report)}
 }
 if(value.frames===null&&(value.order.length||value.gifs!==null))throw new Error('SPRITE_DOCUMENT_FRAMES')
 return value as StoredSpriteSheet
}
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:{layout:CustomLayout|SpriteGifLayout;renderer:string;frontendBytes:number}}}
const allRefs=(d:StoredSpriteSheet)=>[d.source,...[d.split,d.frames,d.gifs].flatMap(r=>r?[r.data,r.report]:[])].filter((r):r is Resource=>!!r)
async function verify(d:StoredSpriteSheet,versions:Map<string,ManagedVersion>,budget:number){
 if(d.source){const m=versions.get(d.source.versionId)!.metadata,s=fineEditorDimensions(m)
  if(m.kind!=='image'||m.bytes>20*1024**2||!['PNG','JPEG','WEBP'].includes(m.containerFormat??'')||(m.frames??1)!==1||s.width!==d.info!.w||s.height!==d.info!.h)throw new Error('SPRITE_DOCUMENT_SOURCE_METADATA')
  checkCustomSliceBudget(d.info!.w,d.info!.h,m.bytes,budget,0)
 }
 const tasks=new Map<string,Task>()
 for(const key of ['split','frames','gifs'] as const){const result=d[key];if(!result)continue
  const task=await localJson<Task>(`/api/tasks/${result.taskId}`),p=task.payload.parameters
  if(task.state!=='succeeded'||task.payload.operation!==(key==='gifs'?'image.spriteGifs':'image.customSlice')||JSON.stringify(task.payload.inputs)!==JSON.stringify([d.source!.versionId])||JSON.stringify(task.results)!==JSON.stringify([result.data.versionId,result.report.versionId])||p.renderer!=='browser-worker')throw new Error('SPRITE_DOCUMENT_TASK')
  if(key==='gifs')validateSpriteGifLayout(p.layout)
  else{validateCustomLayout(p.layout,d.info!.w,d.info!.h);if((p.layout as CustomLayout).mode!=='grid')throw new Error('SPRITE_DOCUMENT_GRID')}
  const data=versions.get(result.data.versionId)!.metadata,report=versions.get(result.report.versionId)!.metadata
  if(data.kind!=='archive'||data.extension!=='.zip'||!integer(data.bytes,1,128*1024**2)||report.kind!=='document'||report.extension!=='.json'||!integer(report.bytes,1,8*1024**2))throw new Error('SPRITE_DOCUMENT_RESULT_METADATA')
  tasks.set(key,task)
 }
 const frames=tasks.get('frames')?.payload.parameters.layout as Extract<CustomLayout,{mode:'grid'}>|undefined,gifs=tasks.get('gifs')?.payload.parameters.layout as SpriteGifLayout|undefined
 if(frames&&(frames.columns!==d.columns||frames.rows!==d.rows)||gifs&&(!frames||gifs.columns!==frames.columns||gifs.rows!==frames.rows))throw new Error('SPRITE_DOCUMENT_GRID_BINDING')
 return tasks
}
async function reports(d:SpriteSheetDraft,tasks:Map<string,Task>){
 for(const key of ['split','frames','gifs'] as const){const result=d[key];if(!result)continue
  const report=JSON.parse(await result.report.text()),task=tasks.get(key)!
  if(!object(report)||report.operation!==task.payload.operation||!object(report.parameters)||Object.entries(task.payload.parameters).some(([k,v])=>JSON.stringify(v)!==JSON.stringify((report.parameters as Record<string,unknown>)[k])))throw new Error('SPRITE_DOCUMENT_REPORT')
  if(key==='gifs'){
   const rows=spriteGifRows(d.info!.w,d.info!.h,task.payload.parameters.layout as SpriteGifLayout).map(({width,height,frames,durationMs})=>({width,height,frames,durationMs}))
   if(report.outputRows!==rows.length||report.outputFrames!==(task.payload.parameters.layout as SpriteGifLayout).order.length||JSON.stringify(report.gifRows)!==JSON.stringify(rows))throw new Error('SPRITE_DOCUMENT_GIF_ROWS')
  }else{const sizes=customSliceSizes(d.info!.w,d.info!.h,task.payload.parameters.layout as CustomLayout);if(report.outputFrames!==sizes.length||JSON.stringify(report.frameSizes)!==JSON.stringify(sizes))throw new Error('SPRITE_DOCUMENT_FRAME_SIZES')}
  spriteSheetReports.set(result.report,report)
 }
}
export async function serializeSpriteSheet(d:SpriteSheetDraft):Promise<StoredSpriteSheet>{
 const files=[...spriteSheetFiles([d])],{versions,memoryBudgetBytes:budget}=await importManagedInputs(files);files.forEach((f,i)=>imageToolMetadata.set(f,versions[i]))
 const ref=(f:File):Resource=>({versionId:imageToolMetadata.get(f)!.id,name:f.name,type:f.type}),r=(v:CustomResult|null):StoredResult|null=>v?{data:ref(v.data),report:ref(v.report),taskId:v.taskId}:null
 const stored=validateStoredSpriteSheet({...d,formatVersion:1,source:d.source?ref(d.source):null,split:r(d.split),frames:r(d.frames),gifs:r(d.gifs)})
 if(files.reduce((sum,f)=>sum+f.size*2,0)>budget/4)throw new Error('SPRITE_DOCUMENT_RESOURCE_LIMIT')
 const tasks=await verify(stored,new Map(versions.map(v=>[v.id,v])),budget);await reports(d,tasks);return stored
}
export async function restoreSpriteSheet(value:unknown,retained:File[]=[]):Promise<SpriteSheetDraft>{
 const d=validateStoredSpriteSheet(value),{project,memoryBudgetBytes:budget}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
 if(!integer(budget,1,2*1024**3))throw new Error('SPRITE_DOCUMENT_BUDGET')
 const refs=allRefs(d),values=await loadManagedVersions([...new Set(refs.map(r=>r.versionId))]),versions=new Map(values.map(v=>[v.id,v])),loaded=new Map<string,File>()
 if([...new Set(retained)].reduce((s,f)=>s+f.size*2,0)+values.reduce((s,v)=>s+v.metadata.bytes*2,0)>budget/4)throw new Error('SPRITE_DOCUMENT_RESOURCE_LIMIT')
 const tasks=await verify(d,versions,budget),key=(r:Resource)=>r.versionId+'|'+r.name+'|'+r.type
 for(const r of refs){if(loaded.has(key(r)))continue
  const response=await localFetch(`/api/versions/${r.versionId}/content`);if(!response.ok)throw new Error('SPRITE_DOCUMENT_CONTENT')
  const blob=await response.blob();if(blob.size!==versions.get(r.versionId)!.metadata.bytes)throw new Error('SPRITE_DOCUMENT_RESOURCE_SIZE')
  const file=new File([blob],r.name,{type:r.type});imageToolMetadata.set(file,versions.get(r.versionId)!);cacheManagedInput(file,project.id,r.versionId);loaded.set(key(r),file)
 }
 const result=(r:StoredResult|null):CustomResult|null=>r?{data:loaded.get(key(r.data))!,report:loaded.get(key(r.report))!,taskId:r.taskId}:null
 const {formatVersion:_,...settings}=d;void _
 const draft:SpriteSheetDraft={...settings,source:d.source?loaded.get(key(d.source))!:null,split:result(d.split),frames:result(d.frames),gifs:result(d.gifs)}
 await reports(draft,tasks);return draft
}

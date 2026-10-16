import {scatterDetectDefaults,validateScatterDetect,validateScatterBoxes,validateReviewedScatterExport,type ScatterBox,type ScatterDetect,type ScatterFormat,type ScatterOrder} from '../lib/scatterSlice'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {imageToolMetadata} from './imageToolDocument'
import {cacheManagedInput,importManagedInputs,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {localFetch,localJson} from './api'

export type ScatterSettings={tool:'edit'|'add';format:ScatterFormat;quality:number;namesText:string;order:ScatterOrder;namePerRow:boolean;detect:ScatterDetect;zoom:'fit'|'1'|'2'|'4'|'8';showResolution:boolean;resolutionFontSize:number}
export const scatterSettings:ScatterSettings={tool:'edit',format:'png',quality:.92,namesText:'',order:'row-major',namePerRow:false,detect:scatterDetectDefaults,zoom:'fit',showResolution:true,resolutionFontSize:16}
export type ScatterInfo={width:number;height:number;fileNameBase:string}
export type ScatterResult={data:File;report:File;taskId:string}
export const scatterReports=new WeakMap<File,Record<string,unknown>>()
export type ScatterDraft={source:File|null;info:ScatterInfo|null;settings:ScatterSettings;boxes:ScatterBox[];selectedId:string|null;detection:ScatterResult|null;archive:ScatterResult|null}
type Resource={versionId:string;name:string;type:string}
type StoredResult={data:Resource;report:Resource;taskId:string}
export type StoredScatter=Omit<ScatterDraft,'source'|'detection'|'archive'>&{formatVersion:1;source:Resource|null;detection:StoredResult|null;archive:StoredResult|null}
export const initialScatterDraft=():ScatterDraft=>({source:null,info:null,settings:{...scatterSettings,detect:{...scatterDetectDefaults}},boxes:[],selectedId:null,detection:null,archive:null})
export const scatterFiles=(drafts:ScatterDraft[])=>new Set(drafts.flatMap(draft=>[draft.source,draft.detection?.data,draft.detection?.report,draft.archive?.data,draft.archive?.report]).filter((file):file is File=>!!file))
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(v)
function resource(v:unknown):asserts v is Resource{
 if(!object(v)||!fields(v,['versionId','name','type'])||!uuid(v.versionId)||typeof v.name!=='string'||!v.name.length||v.name.length>255||['.','..'].includes(v.name)||/[\\/]/.test(v.name)||[...v.name].some(c=>c.charCodeAt(0)<32)||typeof v.type!=='string'||v.type.length>100||[...v.type].some(c=>c.charCodeAt(0)<32))throw new Error('SCATTER_RESOURCE_INVALID')
}
export function validateScatterSettings(v:unknown):asserts v is ScatterSettings{
 if(!object(v)||!fields(v,Object.keys(scatterSettings))||!['edit','add'].includes(String(v.tool))||!['png','jpeg','webp'].includes(String(v.format))||!['row-major','column-major'].includes(String(v.order))
  ||typeof v.quality!=='number'||!Number.isFinite(v.quality)||v.quality<.4||v.quality>1||typeof v.namesText!=='string'||v.namesText.length>256*1024||typeof v.namePerRow!=='boolean'
  ||!['fit','1','2','4','8'].includes(String(v.zoom))||typeof v.showResolution!=='boolean'||!integer(v.resolutionFontSize,8,48))throw new Error('SCATTER_SETTINGS_INVALID')
 validateScatterDetect(v.detect)
}
export function validateStoredScatter(value:unknown):StoredScatter{
 if(!object(value)||!fields(value,['formatVersion','source','info','settings','boxes','selectedId','detection','archive'])||value.formatVersion!==1)throw new Error('SCATTER_DOCUMENT_FIELDS')
 validateScatterSettings(value.settings)
 if(value.source===null){if(value.info!==null||!Array.isArray(value.boxes)||value.boxes.length||value.selectedId!==null||value.detection!==null||value.archive!==null)throw new Error('SCATTER_DOCUMENT_SOURCE')}
 else{
  resource(value.source)
  const info=value.info
  if(!object(info)||!fields(info,['width','height','fileNameBase'])||!integer(info.width,1,30000)||!integer(info.height,1,30000)||typeof info.fileNameBase!=='string'||!info.fileNameBase.length||info.fileNameBase.length>255||/[\\/]/.test(info.fileNameBase)||[...info.fileNameBase].some(c=>c.charCodeAt(0)<32))throw new Error('SCATTER_DOCUMENT_INFO')
  validateScatterBoxes(value.boxes,info.width as number,info.height as number)
  if(value.selectedId!==null&&!value.boxes.some(box=>box.id===value.selectedId))throw new Error('SCATTER_DOCUMENT_SELECTION')
  for(const result of [value.detection,value.archive])if(result!==null){
   if(!object(result)||!fields(result,['data','report','taskId'])||!uuid(result.taskId))throw new Error('SCATTER_DOCUMENT_RESULT')
   resource(result.data);resource(result.report)
  }
 }
 return value as StoredScatter
}
const refs=(stored:StoredScatter)=>[stored.source,stored.detection?.data,stored.detection?.report,stored.archive?.data,stored.archive?.report].filter((ref):ref is Resource=>!!ref)
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:Record<string,unknown>}}
async function verify(stored:StoredScatter,versions:Map<string,ManagedVersion>,budget:number){
 if(stored.source){
  const source=versions.get(stored.source.versionId)!.metadata,size=fineEditorDimensions(source)
  if(source.kind!=='image'||source.bytes>20*1024**2||!['PNG','JPEG','WEBP'].includes(source.containerFormat??'')||(source.frames??1)!==1||size.width!==stored.info!.width||size.height!==stored.info!.height)throw new Error('SCATTER_SOURCE_METADATA')
 }
 for(const version of versions.values())if(!integer(version.metadata.bytes,1,budget/4))throw new Error('SCATTER_RESOURCE_SIZE')
 for(const [operation,result]of [['image.scatterDetect',stored.detection],['image.scatterExport',stored.archive]] as const)if(result){
  const task=await localJson<Task>(`/api/tasks/${result.taskId}`)
  if(task.state!=='succeeded'||task.payload.operation!==operation||JSON.stringify(task.payload.inputs)!==JSON.stringify([stored.source!.versionId])||JSON.stringify(task.results)!==JSON.stringify([result.data.versionId,result.report.versionId]))throw new Error('SCATTER_TASK_MISMATCH')
  if(operation==='image.scatterExport')validateReviewedScatterExport(task.payload.parameters.layout,stored.info!.width,stored.info!.height)
  const report=versions.get(result.report.versionId)!.metadata,data=versions.get(result.data.versionId)!.metadata
  const badReport=report.kind!=='document'||report.extension!=='.json'||report.bytes>8*1024**2
  const badData=operation==='image.scatterDetect'?data.kind!=='document'||data.extension!=='.json'||data.bytes>8*1024**2:data.kind!=='archive'||data.extension!=='.zip'||data.bytes>128*1024**2
  if(badReport||badData)throw new Error('SCATTER_RESULT_METADATA')
 }
}
async function checkResultData(draft:ScatterDraft){
 for(const [operation,result]of [['image.scatterDetect',draft.detection],['image.scatterExport',draft.archive]] as const)if(result){
  const report=JSON.parse(await result.report.text()),task=await localJson<Task>(`/api/tasks/${result.taskId}`)
  if(!object(report)||report.operation!==operation||!object(report.parameters)||Object.entries(task.payload.parameters).some(([key,value])=>JSON.stringify(value)!==JSON.stringify((report.parameters as Record<string,unknown>)[key])))throw new Error('SCATTER_REPORT_INVALID')
  if(operation==='image.scatterDetect'){
   const data=JSON.parse(await result.data.text())
   if(!object(data)||!fields(data,['formatVersion','width','height','boxes'])||data.formatVersion!==1||data.width!==draft.info!.width||data.height!==draft.info!.height)throw new Error('SCATTER_DETECTION_INVALID')
   validateScatterBoxes(data.boxes,draft.info!.width,draft.info!.height)
   if(report.detectedBoxes!==data.boxes.length)throw new Error('SCATTER_REPORT_COUNT')
  }else{
   const layout=task.payload.parameters.layout
   validateReviewedScatterExport(layout,draft.info!.width,draft.info!.height)
   if(report.exportedSlices!==layout.entries.length||report.format!==layout.format)throw new Error('SCATTER_REPORT_COUNT')
  }
  scatterReports.set(result.report,report)
 }
}
export async function serializeScatter(draft:ScatterDraft):Promise<StoredScatter>{
 const files=[...scatterFiles([draft])],{versions,memoryBudgetBytes}=await importManagedInputs(files)
 files.forEach((file,index)=>imageToolMetadata.set(file,versions[index]))
 const ref=(file:File):Resource=>({versionId:imageToolMetadata.get(file)!.id,name:file.name,type:file.type})
 const result=(value:ScatterResult|null)=>value?{data:ref(value.data),report:ref(value.report),taskId:value.taskId}:null
 const stored=validateStoredScatter({...draft,formatVersion:1,source:draft.source?ref(draft.source):null,detection:result(draft.detection),archive:result(draft.archive)})
 await verify(stored,new Map(versions.map(version=>[version.id,version])),memoryBudgetBytes);await checkResultData(draft);return stored
}
export async function restoreScatter(value:unknown,retained:File[]=[]):Promise<ScatterDraft>{
 const stored=validateStoredScatter(value),context=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context'),budget=context.memoryBudgetBytes
 if(!integer(budget,1,2*1024**3))throw new Error('SCATTER_DOCUMENT_BUDGET')
 const references=refs(stored),values=await loadManagedVersions([...new Set(references.map(ref=>ref.versionId))]),versions=new Map(values.map(version=>[version.id,version]))
 const bytes=[...new Set(retained)].reduce((sum,file)=>sum+file.size*2,0)+references.reduce((sum,ref)=>sum+versions.get(ref.versionId)!.metadata.bytes*2,0)
 if(bytes>budget/4)throw new Error('SCATTER_DOCUMENT_RESOURCE_LIMIT')
 await verify(stored,versions,budget)
 const loaded=new Map<string,File>(),key=(ref:Resource)=>ref.versionId+'|'+ref.name+'|'+ref.type
 for(const ref of references){
  if(loaded.has(key(ref)))continue
  const version=versions.get(ref.versionId)!,response=await localFetch(`/api/versions/${ref.versionId}/content`)
  if(!response.ok)throw new Error('SCATTER_RESOURCE_MISSING')
  const blob=await response.blob();if(blob.size!==version.metadata.bytes)throw new Error('SCATTER_RESOURCE_SIZE')
  const file=new File([blob],ref.name,{type:ref.type});imageToolMetadata.set(file,version);cacheManagedInput(file,context.project.id,version.id);loaded.set(key(ref),file)
 }
 const result=(value:StoredResult|null):ScatterResult|null=>value?{data:loaded.get(key(value.data))!,report:loaded.get(key(value.report))!,taskId:value.taskId}:null
 const draft:ScatterDraft={source:stored.source?loaded.get(key(stored.source))!:null,info:stored.info,settings:stored.settings,boxes:stored.boxes,selectedId:stored.selectedId,detection:result(stored.detection),archive:result(stored.archive)}
 await checkResultData(draft);return draft
}

import { cacheManagedInput, importManagedInputs, loadManagedVersions,type ManagedVersion } from './managedTasks'
import { localFetch, localJson } from './api'

export type ImageToolKind='customScale'|'unifySize'|'findDuplicates'
export type ImageToolParameters={
  customScale:{width:number;height:number;keepAspect:boolean;pixelated:boolean;matteAlgorithm:'contiguous'|'chromaKey'|'chromaKeyAdaptive';nonContiguousTolerance:number};
  unifySize:{columns:number;horizontal:'left'|'center'|'right';vertical:'top'|'center'|'bottom'};
  findDuplicates:{columns:number;rows:number};
}
export type ImageToolDraft<K extends ImageToolKind=ImageToolKind>={tool:K;parameters:ImageToolParameters[K];files:File[];results:File[];reportFile:File|null;editedFile:File|null;taskId:string|null}
type Resource={versionId:string;name:string;type:string}
export type StoredImageTool=Omit<ImageToolDraft,'files'|'results'|'reportFile'|'editedFile'> & {formatVersion:1;files:Resource[];results:Resource[];reportFile:Resource|null;editedFile:Resource|null}
export const imageToolMetadata=new WeakMap<File,ManagedVersion>()
export const imageToolReports=new WeakMap<File,Record<string,unknown>>()
export const imageToolOperations={customScale:'image.customScale',unifySize:'sequence.unifySize',findDuplicates:'image.findDuplicates'} as const
export const imageToolDocumentKinds={customScale:'ronin-scale',unifySize:'ronin-unify',findDuplicates:'ronin-duplicates'} as const
const defaults:ImageToolParameters={customScale:{width:256,height:256,keepAspect:true,pixelated:true,matteAlgorithm:'contiguous',nonContiguousTolerance:5},
  unifySize:{columns:4,horizontal:'center',vertical:'bottom'},findDuplicates:{columns:8,rows:4}}
export const initialImageToolDraft=<K extends ImageToolKind>(tool:K):ImageToolDraft<K>=>({tool,parameters:{...defaults[tool]},files:[],results:[],reportFile:null,editedFile:null,taskId:null})
export const imageToolFiles=(drafts:ImageToolDraft[])=>new Set(drafts.flatMap(draft=>[...draft.files,...draft.results,draft.reportFile,draft.editedFile]).filter((file):file is File=>!!file))
const integer=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max
const fields=(value:object,keys:string[])=>Object.keys(value).sort().join(',')===keys.sort().join(',')
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
function resource(value:unknown):asserts value is Resource{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('IMAGE_TOOL_RESOURCE_INVALID')
  const v=value as Resource
  if(!fields(v,['versionId','name','type'])||!uuid(v.versionId)||typeof v.name!=='string'||!v.name.length||v.name.length>255||['.','..'].includes(v.name)||/[\\/]/.test(v.name)||[...v.name].some(c=>c.charCodeAt(0)<32)
    ||typeof v.type!=='string'||v.type.length>100||[...v.type].some(c=>c.charCodeAt(0)<32))throw new Error('IMAGE_TOOL_RESOURCE_INVALID')
}
export function validateImageToolParameters(tool:ImageToolKind,parameters:unknown):void{
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||!fields(parameters,Object.keys(defaults[tool])))throw new Error('IMAGE_TOOL_PARAMETERS_INVALID')
  if(tool==='customScale'){
    const p=parameters as ImageToolParameters['customScale']
    if(!integer(p.width,1,4096)||!integer(p.height,1,4096)||typeof p.keepAspect!=='boolean'||typeof p.pixelated!=='boolean'||!['contiguous','chromaKey','chromaKeyAdaptive'].includes(p.matteAlgorithm)
      ||typeof p.nonContiguousTolerance!=='number'||!Number.isFinite(p.nonContiguousTolerance)||p.nonContiguousTolerance<0||p.nonContiguousTolerance>100)throw new Error('IMAGE_TOOL_PARAMETERS_INVALID')
  }else if(tool==='unifySize'){
    const p=parameters as ImageToolParameters['unifySize']
    if(!integer(p.columns,1,64)||!['left','center','right'].includes(p.horizontal)||!['top','center','bottom'].includes(p.vertical))throw new Error('IMAGE_TOOL_PARAMETERS_INVALID')
  }else{
    const p=parameters as ImageToolParameters['findDuplicates']
    if(!integer(p.columns,1,64)||!integer(p.rows,1,64))throw new Error('IMAGE_TOOL_PARAMETERS_INVALID')
  }
}
export function validateStoredImageTool(value:unknown):StoredImageTool{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('IMAGE_TOOL_DOCUMENT_INVALID')
  const v=value as StoredImageTool
  if(!fields(v,['formatVersion','tool','parameters','files','results','reportFile','editedFile','taskId'])||v.formatVersion!==1||typeof v.tool!=='string'||!Object.hasOwn(defaults,v.tool))throw new Error('IMAGE_TOOL_DOCUMENT_FIELDS')
  validateImageToolParameters(v.tool,v.parameters)
  if(!Array.isArray(v.files)||v.files.length>(v.tool==='unifySize'?1000:1)||!Array.isArray(v.results)||v.results.length>(v.tool==='findDuplicates'?4096:1))throw new Error('IMAGE_TOOL_DOCUMENT_COUNT')
  for(const item of [...v.files,...v.results])resource(item)
  if(v.reportFile!==null)resource(v.reportFile)
  if(v.editedFile!==null){resource(v.editedFile);if(v.tool!=='customScale')throw new Error('IMAGE_TOOL_EDIT_KIND')}
  if(v.results.length){
    if(!v.files.length||!v.reportFile||!uuid(v.taskId))throw new Error('IMAGE_TOOL_RESULT_SOURCE')
  }else if(v.reportFile||v.editedFile||v.taskId!==null)throw new Error('IMAGE_TOOL_RESULT_SOURCE')
  return v
}
function metadata(file:File,report=false){
  const version=imageToolMetadata.get(file),v=version?.metadata
  if(!version||!v||!integer(v.bytes,1,2*1024**3)||v.bytes!==file.size)throw new Error('IMAGE_TOOL_RESOURCE_SIZE')
  if(report?(v.kind!=='document'||v.extension!=='.json'||v.bytes>8*1024**2):(v.kind!=='image'||!integer(v.width,1,30000)||!integer(v.height,1,30000)))throw new Error('IMAGE_TOOL_RESOURCE_KIND')
  return version
}
export async function imageToolReport(draft:ImageToolDraft):Promise<Record<string,unknown>>{
  if(!draft.reportFile)return {}
  metadata(draft.reportFile,true)
  const report=JSON.parse(await draft.reportFile.text()) as Record<string,unknown>
  if(!report||typeof report!=='object'||Array.isArray(report)||report.operation!==imageToolOperations[draft.tool]||report.outputFrames!==draft.results.length)throw new Error('IMAGE_TOOL_REPORT_INVALID')
  if(draft.tool==='findDuplicates'){
    if(report.indexBase!==0||!Array.isArray(report.groups)||!Array.isArray(report.frameDimensions)||report.frameDimensions.length!==draft.results.length)throw new Error('IMAGE_TOOL_REPORT_INVALID')
    const seen=new Set<number>()
    for(const group of report.groups){
      if(!Array.isArray(group)||group.length<2||group.length>draft.results.length)throw new Error('IMAGE_TOOL_REPORT_GROUP')
      for(const index of group){if(!integer(index,0,draft.results.length-1)||seen.has(index))throw new Error('IMAGE_TOOL_REPORT_GROUP');seen.add(index)}
      const size=metadata(draft.results[group[0]]).metadata
      if(group.some(index=>{const item=metadata(draft.results[index]).metadata;return item.width!==size.width||item.height!==size.height}))throw new Error('IMAGE_TOOL_REPORT_GROUP')
    }
    for(const [index,size]of report.frameDimensions.entries()){
      const v=metadata(draft.results[index]).metadata
      if(!size||typeof size!=='object'||!fields(size,['width','height'])||size.width!==v.width||size.height!==v.height)throw new Error('IMAGE_TOOL_REPORT_DIMENSIONS')
    }
  }
  imageToolReports.set(draft.reportFile,report);return report
}
async function checkTaskReferences(tool:ImageToolKind,taskId:string,inputs:string[],outputs:string[]){
  const task=await localJson<{state:string;results:string[];payload:{operation:string;inputs:string[]}}>(`/api/tasks/${taskId}`)
  if(task.state!=='succeeded'||task.payload.operation!==imageToolOperations[tool]||JSON.stringify(inputs)!==JSON.stringify(task.payload.inputs)||JSON.stringify(outputs)!==JSON.stringify(task.results))throw new Error('IMAGE_TOOL_TASK_MISMATCH')
}
async function checkDraft(draft:ImageToolDraft){
  for(const file of [...draft.files,...draft.results,...(draft.editedFile?[draft.editedFile]:[])])metadata(file)
  if(!draft.taskId)return
  await checkTaskReferences(draft.tool,draft.taskId,draft.files.map(file=>metadata(file).id),[...draft.results.map(file=>metadata(file).id),metadata(draft.reportFile!,true).id])
  if(draft.editedFile){
    const actual=metadata(draft.editedFile).metadata,base=metadata(draft.results[0]).metadata
    if(actual.width!==base.width||actual.height!==base.height)throw new Error('IMAGE_TOOL_EDIT_DIMENSIONS')
  }
  await imageToolReport(draft)
}
export async function serializeImageToolDocument(draft:ImageToolDraft):Promise<StoredImageTool>{
  const placeholder={versionId:'00000000-0000-0000-0000-000000000000',name:'selected.png',type:'image/png'}
  validateStoredImageTool({...draft,formatVersion:1,files:draft.files.map(()=>placeholder),results:draft.results.map(()=>placeholder),reportFile:draft.reportFile?placeholder:null,editedFile:draft.editedFile?placeholder:null})
  const files=[...imageToolFiles([draft])],{versions}=await importManagedInputs(files)
  files.forEach((file,index)=>imageToolMetadata.set(file,versions[index]));await checkDraft(draft)
  const reference=(file:File):Resource=>({versionId:imageToolMetadata.get(file)!.id,name:file.name,type:file.type})
  return validateStoredImageTool({...draft,formatVersion:1,files:draft.files.map(reference),results:draft.results.map(reference),reportFile:draft.reportFile?reference(draft.reportFile):null,editedFile:draft.editedFile?reference(draft.editedFile):null})
}
async function mapBounded<T,R>(values:T[],work:(value:T)=>Promise<R>):Promise<R[]>{
  const result:R[]=new Array(values.length);let next=0,failed=false
  await Promise.all(Array.from({length:Math.min(8,values.length)},async()=>{while(next<values.length&&!failed){const index=next++;try{result[index]=await work(values[index])}catch(error){failed=true;throw error}}}))
  return result
}
export async function restoreImageToolDocument(value:unknown,retained:File[]=[]):Promise<ImageToolDraft>{
  const stored=validateStoredImageTool(value),{project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
  if(!integer(memoryBudgetBytes,1,2*1024**3))throw new Error('IMAGE_TOOL_DOCUMENT_BUDGET')
  if(stored.taskId)await checkTaskReferences(stored.tool,stored.taskId,stored.files.map(ref=>ref.versionId),[...stored.results.map(ref=>ref.versionId),stored.reportFile!.versionId])
  const references=[...stored.files,...stored.results,...(stored.reportFile?[stored.reportFile]:[]),...(stored.editedFile?[stored.editedFile]:[])]
  const key=(ref:Resource)=>ref.versionId+'|'+ref.name+'|'+ref.type
  const unique=[...new Map(references.map(ref=>[key(ref),ref])).values()],byVersion=new Map<string,ManagedVersion>()
  for(const version of await loadManagedVersions([...new Set(unique.map(ref=>ref.versionId))]))byVersion.set(version.id,version)
  let bytes=[...new Set(retained)].reduce((sum,file)=>sum+file.size*2+(imageToolMetadata.get(file)?.metadata.thumbnailDataUrl?.length??0)*2,0)
  bytes+=[...byVersion.values()].reduce((sum,version)=>sum+(version.metadata.thumbnailDataUrl?.length??0)*2,0)
  for(const ref of unique){
    const version=byVersion.get(ref.versionId)!,meta=version.metadata
    if(version.id!==ref.versionId||!integer(meta.bytes,1,memoryBudgetBytes/4))throw new Error('IMAGE_TOOL_RESOURCE_SIZE')
    const isReport=stored.reportFile&&key(ref)===key(stored.reportFile)
    if(isReport?(meta.kind!=='document'||meta.extension!=='.json'||meta.bytes>8*1024**2):(meta.kind!=='image'||!integer(meta.width,1,30000)||!integer(meta.height,1,30000)))throw new Error('IMAGE_TOOL_RESOURCE_KIND')
    bytes+=meta.bytes*2
  }
  if(bytes>memoryBudgetBytes/4)throw new Error('IMAGE_TOOL_DOCUMENT_RESOURCE_LIMIT')
  const loaded=new Map<string,File>()
  await mapBounded(unique,async ref=>{
    const version=byVersion.get(ref.versionId)!,response=await localFetch(`/api/versions/${ref.versionId}/content`)
    if(!response.ok)throw new Error('IMAGE_TOOL_RESOURCE_MISSING')
    const blob=await response.blob();if(blob.size!==version.metadata.bytes)throw new Error('IMAGE_TOOL_RESOURCE_SIZE')
    const file=new File([blob],ref.name,{type:ref.type});imageToolMetadata.set(file,version);cacheManagedInput(file,project.id,ref.versionId);loaded.set(key(ref),file)
  })
  const draft:ImageToolDraft={tool:stored.tool,parameters:stored.parameters,files:stored.files.map(ref=>loaded.get(key(ref))!),results:stored.results.map(ref=>loaded.get(key(ref))!),
    reportFile:stored.reportFile?loaded.get(key(stored.reportFile))!:null,editedFile:stored.editedFile?loaded.get(key(stored.editedFile))!:null,taskId:stored.taskId}
  await checkDraft(draft);return draft
}

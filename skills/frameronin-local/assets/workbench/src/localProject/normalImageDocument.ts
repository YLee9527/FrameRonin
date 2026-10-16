import {normalImageOutputSize,type NormalImageParameters} from '../lib/normalImageTools'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {imageToolMetadata} from './imageToolDocument'
import {importManagedInputs,loadManagedVersions,cacheManagedInput,type ManagedVersion} from './managedTasks'
import {localFetch,localJson} from './api'

export type NormalImageSettings=Omit<NormalImageParameters,'mode'>
export const normalImageDefaults:NormalImageSettings={cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,width:256,height:256,
  keepAspect:true,pixelated:true,enableMatte:false,background:'#ffffff',tolerance:40,feather:5,strokeWidth:0,strokeColor:'#000000'}
export type NormalImageResult={file:File;input:File;report:File;taskId:string}
export type NormalImageDraft={settings:NormalImageSettings;source:File|null;preview:NormalImageResult|null;matte:NormalImageResult|null}
export const normalImageReports=new WeakMap<File,Record<string,unknown>>()
type Resource={versionId:string;name:string;type:string}
type StoredResult={file:Resource;input:Resource;report:Resource;taskId:string}
export type StoredNormalImage={formatVersion:1;settings:NormalImageSettings;source:Resource|null;preview:StoredResult|null;matte:StoredResult|null}
export const initialNormalImageDraft=():NormalImageDraft=>({settings:{...normalImageDefaults},source:null,preview:null,matte:null})
export const normalImageFiles=(drafts:NormalImageDraft[])=>new Set(drafts.flatMap(draft=>[draft.source,...[draft.preview,draft.matte].flatMap(result=>result?[result.file,result.input,result.report]:[])]).filter((file):file is File=>!!file))
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const fields=(value:object,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',')
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const integer=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max
export function validateNormalImageSettings(value:unknown):asserts value is NormalImageSettings{
  if(!object(value)||!fields(value,Object.keys(normalImageDefaults)))throw new Error('NORMAL_SETTINGS_FIELDS')
  for(const key of ['cropLeft','cropRight','cropTop','cropBottom'])if(!integer(value[key],0,30000))throw new Error('NORMAL_CROP_INVALID')
  if(!integer(value.width,1,30000)||!integer(value.height,1,30000)||!integer(value.strokeWidth,0,20)
    ||!['keepAspect','pixelated','enableMatte'].every(key=>typeof value[key]==='boolean')
    ||!['background','strokeColor'].every(key=>typeof value[key]==='string'&&/^#[a-f\d]{6}$/i.test(value[key]))
    ||typeof value.tolerance!=='number'||!Number.isFinite(value.tolerance)||value.tolerance<1||value.tolerance>100
    ||typeof value.feather!=='number'||!Number.isFinite(value.feather)||value.feather<0||value.feather>30)throw new Error('NORMAL_SETTINGS_INVALID')
}
function resource(value:unknown):asserts value is Resource{
  if(!object(value)||!fields(value,['versionId','name','type'])||!uuid(value.versionId)||typeof value.name!=='string'||!value.name.length||value.name.length>255
    ||['.','..'].includes(value.name)||/[\\/]/.test(value.name)||[...value.name].some(c=>c.charCodeAt(0)<32)
    ||typeof value.type!=='string'||value.type.length>100||[...value.type].some(c=>c.charCodeAt(0)<32))throw new Error('NORMAL_RESOURCE_INVALID')
}
export function validateStoredNormalImage(value:unknown):StoredNormalImage{
  if(!object(value)||!fields(value,['formatVersion','settings','source','preview','matte'])||value.formatVersion!==1)throw new Error('NORMAL_DOCUMENT_FIELDS')
  validateNormalImageSettings(value.settings)
  if(value.source!==null)resource(value.source)
  for(const result of [value.preview,value.matte])if(result!==null){
    if(!value.source||!object(result)||!fields(result,['file','input','report','taskId'])||!uuid(result.taskId))throw new Error('NORMAL_RESULT_INVALID')
    resource(result.file);resource(result.input);resource(result.report)
  }
  return value as StoredNormalImage
}
const resources=(stored:StoredNormalImage)=>[stored.source,...[stored.preview,stored.matte].flatMap(result=>result?[result.file,result.input,result.report]:[])].filter((ref):ref is Resource=>!!ref)
const key=(ref:Resource)=>ref.versionId+'|'+ref.name+'|'+ref.type
async function verify(stored:StoredNormalImage,versions:Map<string,ManagedVersion>,budget:number){
  const reports=new Set([stored.preview?.report.versionId,stored.matte?.report.versionId].filter(Boolean))
  for(const version of versions.values()){
    const meta=version.metadata
    if(!integer(meta.bytes,1,budget/4))throw new Error('NORMAL_RESOURCE_SIZE')
    if(reports.has(version.id)?meta.kind!=='document'||meta.extension!=='.json'||meta.bytes>8*1024**2:
      meta.kind!=='image'||!integer(meta.width,1,30000)||!integer(meta.height,1,30000))throw new Error('NORMAL_RESOURCE_KIND')
  }
  if(stored.source){const source=versions.get(stored.source.versionId)!.metadata;if(source.bytes>20*1024**2||!['.png','.jpg','.jpeg','.webp'].includes(source.extension??'')||source.containerFormat&&!['PNG','JPEG','WEBP'].includes(source.containerFormat))throw new Error('NORMAL_SOURCE_LIMIT')}
  for(const [role,result]of [['preview',stored.preview],['matte',stored.matte]] as const)if(result){
    const task=await localJson<{state:string;results:string[];payload:{operation:string;inputs:string[];parameters:Partial<NormalImageParameters>}}>(`/api/tasks/${result.taskId}`)
    if(task.state!=='succeeded'||task.payload.operation!=='image.normal'||JSON.stringify(task.results)!==JSON.stringify([result.file.versionId,result.report.versionId])
      ||JSON.stringify(task.payload.inputs)!==JSON.stringify([result.input.versionId]))throw new Error('NORMAL_TASK_MISMATCH')
    const parameters={...normalImageDefaults,mode:'apply',...task.payload.parameters} as NormalImageParameters
    if(role==='matte'?parameters.mode!=='mattePreview':parameters.mode==='mattePreview')throw new Error('NORMAL_RESULT_ROLE')
    if(parameters.mode!=='extendBottom'&&result.input.versionId!==stored.source!.versionId)throw new Error('NORMAL_RESULT_SOURCE')
    const input=fineEditorDimensions(versions.get(result.input.versionId)!.metadata),expected=normalImageOutputSize(input.width!,input.height!,parameters),actual=versions.get(result.file.versionId)!.metadata
    if(actual.extension!=='.png'||actual.containerFormat&&actual.containerFormat!=='PNG'||(actual.orientation??1)!==1||actual.width!==expected.width||actual.height!==expected.height)throw new Error('NORMAL_RESULT_DIMENSIONS')
  }
}
async function checkReports(draft:NormalImageDraft){
  for(const result of [draft.preview,draft.matte])if(result){
    const report=JSON.parse(await result.report.text())
    if(!object(report)||report.operation!=='image.normal'||report.outputFrames!==1||!object(report.parameters))throw new Error('NORMAL_REPORT_INVALID')
    const parameters=report.parameters
    const task=await localJson<{payload:{parameters:Record<string,unknown>}}>(`/api/tasks/${result.taskId}`)
    if(Object.entries(task.payload.parameters).some(([key,value])=>JSON.stringify(parameters[key])!==JSON.stringify(value)))throw new Error('NORMAL_REPORT_PARAMETERS')
    normalImageReports.set(result.report,report)
  }
}
export async function serializeNormalImage(draft:NormalImageDraft):Promise<StoredNormalImage>{
  validateNormalImageSettings(draft.settings)
  const files=[...normalImageFiles([draft])],{versions,memoryBudgetBytes}=await importManagedInputs(files)
  files.forEach((file,index)=>imageToolMetadata.set(file,versions[index]))
  const ref=(file:File):Resource=>({versionId:imageToolMetadata.get(file)!.id,name:file.name,type:file.type})
  const result=(value:NormalImageResult|null):StoredResult|null=>value?{file:ref(value.file),input:ref(value.input),report:ref(value.report),taskId:value.taskId}:null
  const stored=validateStoredNormalImage({formatVersion:1,settings:draft.settings,source:draft.source?ref(draft.source):null,preview:result(draft.preview),matte:result(draft.matte)})
  await verify(stored,new Map(versions.map(version=>[version.id,version])),memoryBudgetBytes);await checkReports(draft);return stored
}
export async function restoreNormalImage(value:unknown,retained:File[]=[]):Promise<NormalImageDraft>{
  const stored=validateStoredNormalImage(value),{project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
  if(!integer(memoryBudgetBytes,1,2*1024**3))throw new Error('NORMAL_DOCUMENT_BUDGET')
  const refs=[...new Map(resources(stored).map(ref=>[key(ref),ref])).values()],values=await loadManagedVersions([...new Set(refs.map(ref=>ref.versionId))]),versions=new Map(values.map(version=>[version.id,version]))
  const bytes=[...new Set(retained)].reduce((sum,file)=>sum+file.size*2,0)+refs.reduce((sum,ref)=>sum+versions.get(ref.versionId)!.metadata.bytes*2,0)
  if(!Number.isSafeInteger(bytes)||bytes>memoryBudgetBytes/4)throw new Error('NORMAL_DOCUMENT_RESOURCE_LIMIT')
  await verify(stored,versions,memoryBudgetBytes)
  const files=new Map<string,File>()
  // At most seven resources; metadata and task bindings are all checked first.
  for(const ref of refs){
    const response=await localFetch(`/api/versions/${ref.versionId}/content`);if(!response.ok)throw new Error('NORMAL_RESOURCE_MISSING')
    const blob=await response.blob(),version=versions.get(ref.versionId)!
    if(blob.size!==version.metadata.bytes)throw new Error('NORMAL_RESOURCE_SIZE')
    const file=new File([blob],ref.name,{type:ref.type});imageToolMetadata.set(file,version);cacheManagedInput(file,project.id,ref.versionId);files.set(key(ref),file)
  }
  const result=(value:StoredResult|null):NormalImageResult|null=>value?{file:files.get(key(value.file))!,input:files.get(key(value.input))!,report:files.get(key(value.report))!,taskId:value.taskId}:null
  const draft={settings:stored.settings,source:stored.source?files.get(key(stored.source))!:null,preview:result(stored.preview),matte:result(stored.matte)}
  await checkReports(draft);return draft
}

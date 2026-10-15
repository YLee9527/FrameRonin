import { cacheManagedInput, importManagedInputs, type ManagedVersion } from './managedTasks'
import { localFetch, localJson } from './api'

export type SequenceTab = 'gif2frames' | 'frames2gif' | 'images2single' | 'simpleStitch'
export type CombinedParameters = { cols:number; rows:number; outW:number; outH:number; cropTop:number; cropBottom:number; cropLeft:number; cropRight:number }
export type SequenceDraft = {
  activeTab:SequenceTab; gifFile:File|null; frameFiles:File[]; frameDelay:number; frameCols:number;
  combineFiles:File[]; combineCols:number; imagesToSingleInputMode:'multi'|'split'; splitFile:File|null; splitRows:number; splitCols:number;
  cropTop:number; cropBottom:number; cropLeft:number; cropRight:number;
  stitchFiles:File[]; stitchDirection:'vertical'|'horizontal'|'overlay';
  extractedFrameFiles:File[]; framesZipFile:File|null; gifResultFile:File|null; combinedFile:File|null; combinedParams:CombinedParameters|null; stitchedFile:File|null;
}
type Resource = { versionId:string; name:string; type:string }
type FileKey = 'gifFile'|'splitFile'|'framesZipFile'|'gifResultFile'|'combinedFile'|'stitchedFile'
type FilesKey = 'frameFiles'|'combineFiles'|'stitchFiles'|'extractedFrameFiles'
export type StoredSequence = Omit<SequenceDraft,FileKey|FilesKey> & Record<FileKey,Resource|null> & Record<FilesKey,Resource[]> & {formatVersion:1}
const fileKeys:FileKey[]=['gifFile','splitFile','framesZipFile','gifResultFile','combinedFile','stitchedFile']
const filesKeys:FilesKey[]=['frameFiles','combineFiles','stitchFiles','extractedFrameFiles']
export const sequenceMetadata = new WeakMap<File,ManagedVersion>()
export function sequenceFiles(drafts:SequenceDraft[]):Set<File>{
  return new Set(drafts.flatMap(draft=>[...fileKeys.map(key=>draft[key]),...filesKeys.flatMap(key=>draft[key])].filter((file):file is File=>!!file)))
}
export function initialSequenceDraft():SequenceDraft{return {
  activeTab:'images2single',gifFile:null,frameFiles:[],frameDelay:100,frameCols:6,combineFiles:[],combineCols:4,
  imagesToSingleInputMode:'split',splitFile:null,splitRows:2,splitCols:2,cropTop:0,cropBottom:0,cropLeft:0,cropRight:0,
  stitchFiles:[],stitchDirection:'vertical',extractedFrameFiles:[],framesZipFile:null,gifResultFile:null,combinedFile:null,combinedParams:null,stitchedFile:null,
}}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const number=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max
const integer=(value:unknown,min:number,max:number)=>number(value,min,max)&&Number.isInteger(value)
function resource(value:unknown):asserts value is Resource{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('SEQUENCE_RESOURCE_INVALID')
  const input=value as Resource
  if(Object.keys(input).sort().join(',')!=='name,type,versionId'||!uuid(input.versionId)||typeof input.name!=='string'||!input.name.length||input.name.length>255||/[\\/]/.test(input.name)||[...input.name].some(character=>character.charCodeAt(0)<32)||
    typeof input.type!=='string'||input.type.length>100||[...input.type].some(character=>character.charCodeAt(0)<32))throw new Error('SEQUENCE_RESOURCE_INVALID')
}
export function validateStoredSequence(value:unknown):StoredSequence{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('SEQUENCE_DOCUMENT_INVALID')
  const document=value as StoredSequence
  if(Object.keys(document).sort().join(',')!==[...Object.keys(initialSequenceDraft()),'formatVersion'].sort().join(',')||document.formatVersion!==1)throw new Error('SEQUENCE_DOCUMENT_FIELDS')
  if(!['gif2frames','frames2gif','images2single','simpleStitch'].includes(document.activeTab)||!['multi','split'].includes(document.imagesToSingleInputMode)||!['vertical','horizontal','overlay'].includes(document.stitchDirection))throw new Error('SEQUENCE_DOCUMENT_MODE')
  if(!integer(document.frameDelay,20,500)||!integer(document.frameCols,1,16)||!integer(document.combineCols,1,64)||!integer(document.splitRows,1,32)||!integer(document.splitCols,1,32))throw new Error('SEQUENCE_DOCUMENT_PARAMETERS')
  for(const key of ['cropTop','cropBottom','cropLeft','cropRight'] as const)if(!number(document[key],-8192,8192))throw new Error('SEQUENCE_DOCUMENT_CROP')
  for(const key of fileKeys)if(document[key]!==null)resource(document[key])
  for(const key of filesKeys){if(!Array.isArray(document[key])||document[key].length>1000)throw new Error('SEQUENCE_DOCUMENT_FRAME_LIMIT');document[key].forEach(resource)}
  const parameters=document.combinedParams
  if(parameters!==null){
    if(document.combinedFile===null)throw new Error('SEQUENCE_DOCUMENT_OUTPUT_PARAMETERS')
    if(!parameters||typeof parameters!=='object'||Object.keys(parameters).sort().join(',')!=='cols,cropBottom,cropLeft,cropRight,cropTop,outH,outW,rows'||
      !integer(parameters.cols,1,128)||!integer(parameters.rows,1,1000)||!integer(parameters.outW,1,30000)||!integer(parameters.outH,1,30000)||
      !['cropTop','cropBottom','cropLeft','cropRight'].every(key=>number(parameters[key as keyof CombinedParameters],-8192,8192)))throw new Error('SEQUENCE_DOCUMENT_OUTPUT_PARAMETERS')
  }
  return document
}
export async function serializeSequenceDocument(draft:SequenceDraft,onMetadata?:(file:File,version:ManagedVersion)=>void):Promise<StoredSequence>{
  const placeholder={versionId:'00000000-0000-0000-0000-000000000000',name:'selected.png',type:'image/png'}
  const shape={...draft,formatVersion:1,...Object.fromEntries(fileKeys.map(key=>[key,draft[key]?placeholder:null])),...Object.fromEntries(filesKeys.map(key=>[key,draft[key].map(()=>placeholder)]))}
  validateStoredSequence(shape)
  const files=[...sequenceFiles([draft])]
  const {versions}=await importManagedInputs(files,undefined,(file,version)=>{
    // Notify before updating the shared cache so views can detect a first import.
    onMetadata?.(file as File,version);sequenceMetadata.set(file as File,version)
  })
  const references=new Map(files.map((file,index)=>[file,{versionId:versions[index].id,name:file.name,type:file.type}]))
  const metadata=new Map(files.map((file,index)=>[file,versions[index]]))
  for(const key of fileKeys)if(draft[key])checkResourceKind(metadata.get(draft[key]!)!,key)
  for(const key of filesKeys)for(const file of draft[key])checkResourceKind(metadata.get(file)!,key)
  return validateStoredSequence({...draft,formatVersion:1,...Object.fromEntries(fileKeys.map(key=>[key,draft[key]?references.get(draft[key]!):null])),
    ...Object.fromEntries(filesKeys.map(key=>[key,draft[key].map(file=>references.get(file))]))})
}
export async function restoreSequenceDocument(value:unknown,retained:File[]=[]):Promise<SequenceDraft>{
  const document=validateStoredSequence(value)
  const {project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
  if(!Number.isFinite(memoryBudgetBytes)||memoryBudgetBytes<=0)throw new Error('SEQUENCE_DOCUMENT_BUDGET')
  const files=new Map<string,File>(),versions=new Map<string,ManagedVersion>()
  let bytes=[...new Set(retained)].reduce((total,file)=>total+file.size*2,0)
  const load=async(input:Resource,key:FileKey|FilesKey)=>{
    const id=input.versionId+'|'+input.name+'|'+input.type
    let version=versions.get(input.versionId)
    if(!version){version=await localJson<ManagedVersion>(`/api/versions/${input.versionId}`);versions.set(input.versionId,version)}
    checkResourceKind(version,key)
    let file=files.get(id)
    if(!file){
      bytes+=version.metadata.bytes*2
      if(bytes>memoryBudgetBytes/4)throw new Error('SEQUENCE_DOCUMENT_RESOURCE_LIMIT')
      const response=await localFetch(`/api/versions/${input.versionId}/content`)
      if(!response.ok)throw new Error('SEQUENCE_DOCUMENT_RESOURCE_MISSING')
      const blob=await response.blob();if(blob.size!==version.metadata.bytes)throw new Error('SEQUENCE_DOCUMENT_RESOURCE_SIZE')
      file=new File([blob],input.name,{type:input.type});cacheManagedInput(file,project.id,input.versionId);sequenceMetadata.set(file,version);files.set(id,file)
    }
    return file
  }
  const result={...document} as unknown as SequenceDraft
  for(const key of fileKeys)result[key]=document[key]?await load(document[key]!,key):null
  for(const key of filesKeys){const items:File[]=[];for(const input of document[key])items.push(await load(input,key));result[key]=items}
  if(result.combinedParams&&(!result.combinedFile||sequenceMetadata.get(result.combinedFile)?.metadata.width!==result.combinedParams.outW||sequenceMetadata.get(result.combinedFile)?.metadata.height!==result.combinedParams.outH))throw new Error('SEQUENCE_DOCUMENT_OUTPUT_SIZE')
  delete (result as unknown as Partial<StoredSequence>).formatVersion
  return result
}
function checkResourceKind(version:ManagedVersion,key:FileKey|FilesKey){
  const {kind,extension}=version.metadata
  if((key==='gifFile'||key==='gifResultFile')?extension!=='.gif'||!['image','animation'].includes(kind):key==='framesZipFile'?kind!=='archive'||extension!=='.zip':kind!=='image')throw new Error('SEQUENCE_DOCUMENT_RESOURCE_KIND')
}

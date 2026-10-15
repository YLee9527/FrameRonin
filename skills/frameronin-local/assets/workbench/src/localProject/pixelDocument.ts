import { cacheManagedInput, importManagedInputs, type ManagedVersion } from './managedTasks'
import { localFetch, localJson } from './api'

export type PixelTab='pixelate'|'mergeNearby'|'color16'|'advanced'|'perfectPixel'
export type NaturalRect={x:number;y:number;w:number;h:number}
export type PixelDraft={
  activeTab:PixelTab;file:File|null;resultFile:File|null;processingSize:{width:number;height:number}|null;
  pixelSize:number;mergeNearbyStrength:number;color16Method:'rgb'|'lab';color16Dither:boolean;
  advUpscale:number;advColors:number;advScaleResult:number;advTransparent:boolean;
  ppSample:'center'|'median'|'majority';ppMinSize:number;ppPeakWidth:number;ppRefine:number;ppFixSquare:boolean;
  ppManualGrid:boolean;ppGridCols:number;ppGridRows:number;previewSelection:NaturalRect|null;
}
type Resource={versionId:string;name:string;type:string}
export type StoredPixel=Omit<PixelDraft,'file'|'resultFile'> & {formatVersion:1;file:Resource|null;resultFile:Resource|null}
export const pixelMetadata=new WeakMap<File,ManagedVersion>()
export const initialPixelDraft=():PixelDraft=>({activeTab:'perfectPixel',file:null,resultFile:null,processingSize:null,
  pixelSize:8,mergeNearbyStrength:40,color16Method:'lab',color16Dither:true,advUpscale:3,advColors:64,advScaleResult:1,advTransparent:false,
  ppSample:'center',ppMinSize:4,ppPeakWidth:6,ppRefine:.25,ppFixSquare:true,ppManualGrid:false,ppGridCols:32,ppGridRows:32,previewSelection:null})
export const pixelFiles=(drafts:PixelDraft[])=>new Set(drafts.flatMap(draft=>[draft.file,draft.resultFile]).filter((file):file is File=>!!file))
const number=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
const integer=(v:unknown,min:number,max:number)=>number(v,min,max)&&Number.isInteger(v)
function resource(value:unknown):asserts value is Resource{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('PIXEL_RESOURCE_INVALID')
  const v=value as Resource
  if(Object.keys(v).sort().join(',')!=='name,type,versionId'||typeof v.versionId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.versionId)||
    typeof v.name!=='string'||!v.name.length||v.name.length>255||['.','..'].includes(v.name)||/[\\/]/.test(v.name)||[...v.name].some(c=>c.charCodeAt(0)<32)||
    typeof v.type!=='string'||v.type.length>100||[...v.type].some(c=>c.charCodeAt(0)<32))throw new Error('PIXEL_RESOURCE_INVALID')
}
export function validateStoredPixel(value:unknown):StoredPixel{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('PIXEL_DOCUMENT_INVALID')
  const v=value as StoredPixel
  if(Object.keys(v).sort().join(',')!==[...Object.keys(initialPixelDraft()),'formatVersion'].sort().join(',')||v.formatVersion!==1)throw new Error('PIXEL_DOCUMENT_FIELDS')
  if(!['pixelate','mergeNearby','color16','advanced','perfectPixel'].includes(v.activeTab)||!['rgb','lab'].includes(v.color16Method)||!['center','median','majority'].includes(v.ppSample))throw new Error('PIXEL_DOCUMENT_MODE')
  for(const key of ['color16Dither','advTransparent','ppFixSquare','ppManualGrid'] as const)if(typeof v[key]!=='boolean')throw new Error('PIXEL_DOCUMENT_BOOLEAN')
  for(const [key,min,max] of [['pixelSize',1,128],['advUpscale',1,7],['advColors',4,256],['advScaleResult',1,5],['ppMinSize',2,32],['ppGridCols',1,512],['ppGridRows',1,512]] as const){
    if(!integer(v[key],min,max))throw new Error('PIXEL_DOCUMENT_PARAMETERS')
  }
  if(!number(v.mergeNearbyStrength,0,100)||!number(v.ppPeakWidth,3,20)||!number(v.ppRefine,0,.5))throw new Error('PIXEL_DOCUMENT_PARAMETERS')
  if(v.file!==null)resource(v.file)
  if(v.resultFile!==null){resource(v.resultFile);if(v.file===null)throw new Error('PIXEL_DOCUMENT_RESULT_SOURCE')}
  if(v.processingSize!==null){
    const size=v.processingSize
    if(!v.resultFile||!size||typeof size!=='object'||Object.keys(size).sort().join(',')!=='height,width'||!integer(size.width,1,30000)||!integer(size.height,1,30000))throw new Error('PIXEL_DOCUMENT_PROCESSING_SIZE')
  }
  if(v.previewSelection!==null){
    const r=v.previewSelection
    if(!v.file||!r||typeof r!=='object'||Object.keys(r).sort().join(',')!=='h,w,x,y'||!integer(r.x,0,8191)||!integer(r.y,0,8191)||!integer(r.w,24,8192)||!integer(r.h,24,8192))throw new Error('PIXEL_DOCUMENT_REGION')
  }
  return v
}
function checkDraft(draft:PixelDraft){
  for(const file of pixelFiles([draft])){
    const meta=pixelMetadata.get(file)?.metadata
    if(meta?.kind!=='image'||!integer(meta.width,1,30000)||!integer(meta.height,1,30000)||meta.bytes!==file.size)throw new Error('PIXEL_DOCUMENT_RESOURCE_KIND')
  }
  if(draft.processingSize&&draft.file){
    const meta=pixelMetadata.get(draft.file)!.metadata
    if(draft.processingSize.width>meta.width!||draft.processingSize.height>meta.height!)throw new Error('PIXEL_DOCUMENT_PROCESSING_SIZE')
  }
  if(draft.previewSelection){
    const r=draft.previewSelection,meta=draft.file?pixelMetadata.get(draft.file)?.metadata:undefined
    if(!meta?.width||!meta.height||r.x+r.w>meta.width||r.y+r.h>meta.height)throw new Error('PIXEL_DOCUMENT_REGION_OUTSIDE_SOURCE')
  }
}
export async function serializePixelDocument(draft:PixelDraft):Promise<StoredPixel>{
  const placeholder={versionId:'00000000-0000-0000-0000-000000000000',name:'selected.png',type:'image/png'}
  validateStoredPixel({...draft,formatVersion:1,file:draft.file?placeholder:null,resultFile:draft.resultFile?placeholder:null})
  const files=[...pixelFiles([draft])],{versions}=await importManagedInputs(files)
  files.forEach((file,index)=>pixelMetadata.set(file,versions[index]));checkDraft(draft)
  const reference=(file:File|null)=>file?{versionId:pixelMetadata.get(file)!.id,name:file.name,type:file.type}:null
  return validateStoredPixel({...draft,formatVersion:1,file:reference(draft.file),resultFile:reference(draft.resultFile)})
}
export async function restorePixelDocument(value:unknown,retained:File[]=[]):Promise<PixelDraft>{
  const v=validateStoredPixel(value),{project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
  if(!Number.isFinite(memoryBudgetBytes)||memoryBudgetBytes<=0)throw new Error('PIXEL_DOCUMENT_BUDGET')
  const files=new Map<string,File>();let bytes=[...new Set(retained)].reduce((sum,file)=>sum+file.size*2,0)
  const load=async(resource:Resource|null)=>{
    if(!resource)return null
    const key=resource.versionId+'|'+resource.name+'|'+resource.type
    if(files.has(key))return files.get(key)!
    const version=await localJson<ManagedVersion>(`/api/versions/${resource.versionId}`)
    if(version.metadata.kind!=='image'||!integer(version.metadata.bytes,1,memoryBudgetBytes/4)||!integer(version.metadata.width,1,30000)||!integer(version.metadata.height,1,30000))throw new Error('PIXEL_DOCUMENT_RESOURCE_KIND')
    bytes+=version.metadata.bytes*2;if(bytes>memoryBudgetBytes/4)throw new Error('PIXEL_DOCUMENT_RESOURCE_LIMIT')
    const response=await localFetch(`/api/versions/${resource.versionId}/content`)
    if(!response.ok)throw new Error('PIXEL_DOCUMENT_RESOURCE_MISSING')
    const blob=await response.blob();if(blob.size!==version.metadata.bytes)throw new Error('PIXEL_DOCUMENT_RESOURCE_SIZE')
    const file=new File([blob],resource.name,{type:resource.type});cacheManagedInput(file,project.id,resource.versionId);pixelMetadata.set(file,version);files.set(key,file);return file
  }
  const draft={...v,file:await load(v.file),resultFile:await load(v.resultFile)} as PixelDraft & {formatVersion?:number}
  delete draft.formatVersion;checkDraft(draft);return draft
}

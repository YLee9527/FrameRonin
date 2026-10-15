import { localFetch, localJson } from './api'
import { cacheManagedInput, importManagedInputs, type ManagedVersion } from './managedTasks'

export type MapSide = 'top' | 'right' | 'bottom' | 'left'
export type MapTile = { x: number; y: number; w: number; h: number }
export type MapFeather = Record<MapSide, number>
export type MapImage = { file: File; url: string; image: HTMLImageElement; width: number; height: number; memoryBudgetBytes: number }
export type MapDraft = {
  source: MapImage | null; tiles: Record<string, MapTile>; tileUploads: Partial<Record<string, MapImage>>;
  tileFeathers: Partial<Record<string, MapFeather>>; horizontalOverlapPercent: number; verticalOverlapPercent: number;
  expandSplit: 4 | 8 | 12; hidePreviewBorders: boolean; hiddenPreviewTiles: Partial<Record<string, boolean>>
}
type StoredImage = { versionId: string; name: string }
export type StoredMap = Omit<MapDraft, 'source' | 'tileUploads'> & {
  formatVersion: 1; source: StoredImage | null; tileUploads: Record<string, StoredImage>
  view?: { pan: { x: number; y: number }; zoom: number; selectedKey: string | null }
}
export function mapTileKey(x: number, y: number): string {
  const fmt = (number: number) => { const value = number.toFixed(4).replace(/\.?0+$/, ''); return value === '-0' ? '0' : value }
  return `${fmt(x)},${fmt(y)}`
}
export function validateStoredMap(value: unknown): StoredMap {
  const object = (value: unknown, fields: string[]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('MAP_DOCUMENT_FIELD')
    return value as Record<string, unknown>
  }
  const document = object(value, ['formatVersion','source','tiles','tileUploads','tileFeathers','horizontalOverlapPercent','verticalOverlapPercent','expandSplit','hidePreviewBorders','hiddenPreviewTiles','view'])
  const finite = (value: unknown, minimum: number, maximum: number) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  const image = (value: unknown) => {
    const item = object(value, ['versionId','name'])
    if (!uuid(item.versionId) || typeof item.name !== 'string' || !item.name.length || item.name.length > 255 || /[\\/]/.test(item.name) || [...item.name].some(character => character.charCodeAt(0) < 32)) throw new Error('MAP_DOCUMENT_IMAGE')
  }
  if (document.formatVersion !== 1 || !finite(document.horizontalOverlapPercent,0,50) || !finite(document.verticalOverlapPercent,0,50) ||
      ![4,8,12].includes(document.expandSplit as number) || typeof document.hidePreviewBorders !== 'boolean') throw new Error('MAP_DOCUMENT_VALUE')
  if (document.source !== null) image(document.source)
  const tiles = object(document.tiles, Object.keys((document.tiles ?? {}) as object))
  if (Object.keys(tiles).length > 1000) throw new Error('MAP_DOCUMENT_TILE_LIMIT')
  const keys = new Set(['0,0'])
  for (const [key, value] of Object.entries(tiles)) {
    const tile = object(value,['x','y','w','h'])
    if (!finite(tile.x,-1000,1000) || !finite(tile.y,-1000,1000) || !finite(tile.w,0.001,100) || !finite(tile.h,0.001,100) ||
        key !== mapTileKey(tile.x as number,tile.y as number) || keys.has(key)) throw new Error('MAP_DOCUMENT_TILE')
    keys.add(key)
  }
  const uploads = object(document.tileUploads, Object.keys((document.tileUploads ?? {}) as object))
  for (const [key, value] of Object.entries(uploads)) { if (!keys.has(key) || key === '0,0') throw new Error('MAP_DOCUMENT_TILE_REFERENCE');image(value) }
  const feathers = object(document.tileFeathers, Object.keys((document.tileFeathers ?? {}) as object))
  for (const [key, value] of Object.entries(feathers)) {
    if (!keys.has(key)) throw new Error('MAP_DOCUMENT_TILE_REFERENCE')
    const feather = object(value,['top','right','bottom','left'])
    if (['top','right','bottom','left'].some(side => !finite(feather[side],0,50))) throw new Error('MAP_DOCUMENT_FEATHER')
  }
  const hidden = object(document.hiddenPreviewTiles,Object.keys((document.hiddenPreviewTiles ?? {}) as object))
  for (const [key, value] of Object.entries(hidden)) if (!keys.has(key) || typeof value !== 'boolean') throw new Error('MAP_DOCUMENT_PREVIEW')
  if(document.view!==undefined){
    const view=object(document.view,['pan','zoom','selectedKey']);const pan=object(view.pan,['x','y'])
    if(!finite(pan.x,-1000000,1000000)||!finite(pan.y,-1000000,1000000)||!finite(view.zoom,0.05,8)||
      !(view.selectedKey===null||(typeof view.selectedKey==='string'&&keys.has(view.selectedKey))))throw new Error('MAP_DOCUMENT_VIEW')
  }
  return document as unknown as StoredMap
}
export async function loadMapImage(file: File, retained: MapImage[] = [], signal?: AbortSignal): Promise<MapImage> {
  const { inputs, memoryBudgetBytes } = await importManagedInputs([file],signal)
  const version = await localJson<ManagedVersion>(`/api/versions/${inputs[0]}`,{signal})
  if (version.metadata.kind !== 'image' || !version.metadata.width || !version.metadata.height) throw new Error('MAP_IMAGE_INVALID')
  const previous=[...new Set(retained)].reduce((bytes,image)=>bytes+image.width*image.height*32+image.file.size*2,0)
  if (previous+version.metadata.width * version.metadata.height * 32+file.size*2 > memoryBudgetBytes / 4) throw new Error('MAP_PREVIEW_LIMIT: image exceeds the decoded preview budget; choose a smaller image')
  return new Promise((resolve,reject) => {
    signal?.throwIfAborted()
    const url=URL.createObjectURL(file);const image=new Image()
    const abort=()=>{image.onload=null;image.onerror=null;image.src='';URL.revokeObjectURL(url);reject(new DOMException('Map import canceled','AbortError'))}
    signal?.addEventListener('abort',abort,{once:true})
    image.onload=()=>{
      signal?.removeEventListener('abort',abort)
      if(image.naturalWidth!==version.metadata.width||image.naturalHeight!==version.metadata.height){URL.revokeObjectURL(url);reject(new Error('MAP_IMAGE_DIMENSION_MISMATCH'));return}
      resolve({file,url,image,width:image.naturalWidth,height:image.naturalHeight,memoryBudgetBytes})
    }
    image.onerror=()=>{signal?.removeEventListener('abort',abort);URL.revokeObjectURL(url);reject(new Error('MAP_IMAGE_DECODE'))};image.src=url
  })
}
export function validateMapDraft(draft:MapDraft,view?:StoredMap['view']):void {
  const placeholder=(image:MapImage):StoredImage=>({versionId:'00000000-0000-4000-8000-000000000001',name:image.file.name})
  validateStoredMap({...draft,view,formatVersion:1,source:draft.source?placeholder(draft.source):null,
    tileUploads:Object.fromEntries(Object.entries(draft.tileUploads).flatMap(([key,image])=>image?[[key,placeholder(image)]]:[]))})
}
export async function serializeMapDocument(draft: MapDraft): Promise<StoredMap> {
  validateMapDraft(draft)
  const images = [draft.source, ...Object.values(draft.tileUploads)].filter((image): image is MapImage => !!image)
  const { inputs } = await importManagedInputs(images.map(image => image.file))
  const versions = new Map(images.map((image,index)=>[image,inputs[index]]))
  const stored = (image: MapImage): StoredImage => ({versionId:versions.get(image)!,name:image.file.name})
  return validateStoredMap({...draft,formatVersion:1,source:draft.source?stored(draft.source):null,
    tileUploads:Object.fromEntries(Object.entries(draft.tileUploads).flatMap(([key,image])=>image?[[key,stored(image)]]:[]))})
}
export async function restoreMapDocument(value: unknown, retained: MapImage[] = []): Promise<MapDraft> {
  const document=validateStoredMap(value)
  const {project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
  const created: MapImage[]=[];let bytes=0
  const restore=async(input:StoredImage)=>{
    const version=await localJson<ManagedVersion>(`/api/versions/${input.versionId}`)
    bytes+=(version.metadata.width??0)*(version.metadata.height??0)*4*8
    if (!Number.isFinite(memoryBudgetBytes) || bytes>memoryBudgetBytes/4 || version.metadata.kind!=='image' || !version.metadata.width || !version.metadata.height) throw new Error('MAP_DOCUMENT_RESOURCE_LIMIT')
    const response=await localFetch(`/api/versions/${input.versionId}/content`);if(!response.ok)throw new Error('MAP_DOCUMENT_RESOURCE_MISSING')
    const file=new File([await response.blob()],input.name,{type:version.metadata.extension==='.webp'?'image/webp':['.jpg','.jpeg'].includes(version.metadata.extension??'')?'image/jpeg':'image/png'});cacheManagedInput(file,project.id,input.versionId)
    const image=await loadMapImage(file,[...retained,...created]);created.push(image);return image
  }
  try {
    const source=document.source?await restore(document.source):null
    const uploads:Record<string,MapImage>={}
    for(const [key,value]of Object.entries(document.tileUploads))uploads[key]=await restore(value)
    const {formatVersion:_version,view:_view,...draft}=document;void _version;void _view
    return {...draft,source,tileUploads:uploads}
  } catch(error){created.forEach(image=>URL.revokeObjectURL(image.url));throw error}
}

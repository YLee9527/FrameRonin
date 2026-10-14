import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type SetStateAction, type WheelEvent as ReactWheelEvent } from 'react'
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExpandOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { Alert, Button, message, Select, Slider, Space, Typography } from 'antd'
import { runMapArchive } from '../lib/mapArchive'
import { localJson } from '../localProject/api'
import { cacheManagedInput, runManagedTask } from '../localProject/managedTasks'
import { expansionTilesFrom,isOutwardExpansionTile,tilesRecord } from '../lib/mapLayout'
import { mapFeatherPreview } from '../lib/mapPreview'
import type { MapRenderLayout } from '../lib/mapRender'
import { useLanguage } from '../i18n/context'
import { mapText } from '../i18n/mapText'
import type { Lang } from '../i18n/locales'
import DocumentSaveBar from '../localProject/DocumentSaveBar'
import { loadMapImage, serializeMapDocument, restoreMapDocument, validateMapDraft, validateStoredMap, type MapDraft, type MapImage, type StoredMap } from '../localProject/mapDocument'
import { createMapHistory, mapHistoryReducer, mapImages } from '../localProject/mapHistory'

const { Text, Title } = Typography

type Side = 'top' | 'right' | 'bottom' | 'left'
type TileKey = string
type ExpandSplit = 4 | 8 | 12

type LoadedImage = MapImage

type Tile = {
  x: number
  y: number
  w: number
  h: number
}

type Feather = Record<Side, number>

const MAX_IMAGE_MB = 30
const CENTER_KEY: TileKey = '0,0'
const CENTER_TILE: Tile = { x: 0, y: 0, w: 1, h: 1 }
const DEFAULT_FEATHER: Feather = { top: 0, right: 0, bottom: 0, left: 0 }
const FEATHER_STEP = 5
const MAX_FEATHER = 50
const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const WHEEL_ZOOM_SENSITIVITY = 0.0015
const GENERATE_STITCH_URL = '#imagegen/map-stitch'
const STATE_ARCHIVE_VERSION = 2

type SavedImageState = {
  fileName?: string
  type?: string
  size?: number
  width?: number
  height?: number
  path?: string
  dataUrl?: string
}

type SavedMapStitchState = {
  version?: number
  source?: SavedImageState
  tiles?: Record<string, Partial<Tile>>
  tileUploads?: Record<string, SavedImageState>
  tileFeathers?: Partial<Record<TileKey, Partial<Feather>>>
  selectedKey?: unknown
  horizontalOverlapPercent?: unknown
  verticalOverlapPercent?: unknown
  expandSplit?: unknown
  pan?: unknown
  zoom?: unknown
  hidePreviewBorders?: unknown
  hiddenPreviewTiles?: unknown
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

function tileKey(x: number, y: number): TileKey {
  const fmt = (n: number) => {
    const fixed = n.toFixed(4).replace(/\.?0+$/, '')
    return fixed === '-0' ? '0' : fixed
  }
  return `${fmt(x)},${fmt(y)}`
}

function FeatheredPreviewImage({
  upload,
  width,
  height,
  feather,
  alt,
}: {
  upload: LoadedImage
  width: number
  height: number
  feather: Feather
  alt: string
}) {
  const hasFeather = feather.top !== 0 || feather.right !== 0 || feather.bottom !== 0 || feather.left !== 0
  const previewKey = `${upload.url}:${width}:${height}:${feather.top}:${feather.right}:${feather.bottom}:${feather.left}`
  const [generatedPreview, setGeneratedPreview] = useState<{ key: string; url: string } | null>(null)

  useEffect(() => {
    if (!hasFeather) return
    let revokedUrl: string | null = null
    const controller=new AbortController()
    void mapFeatherPreview(upload.file,Math.max(1,Math.round(width)),Math.max(1,Math.round(height)),feather,upload.memoryBudgetBytes,controller.signal)
      .then(blob=>{
        if(controller.signal.aborted)return
        revokedUrl=URL.createObjectURL(blob);setGeneratedPreview({key:previewKey,url:revokedUrl})
      }).catch(error=>{if(!controller.signal.aborted)message.error(String(error))})
    return()=>{controller.abort();if(revokedUrl)URL.revokeObjectURL(revokedUrl)}
  },[feather,hasFeather,height,previewKey,upload.file,upload.memoryBudgetBytes,width])

  const src = hasFeather && generatedPreview?.key === previewKey ? generatedPreview.url : upload.url
  return <img src={src} alt={alt} />
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function fileExtensionFor(file: File): string {
  const fromName = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase()
  if (fromName && ['.png', '.jpg', '.jpeg', '.webp'].includes(fromName)) return fromName
  if (file.type === 'image/jpeg') return '.jpg'
  if (file.type === 'image/webp') return '.webp'
  return '.png'
}

function uniqueArchiveImagePath(used: Set<string>, baseName: string, file: File): string {
  const ext = fileExtensionFor(file)
  const safeBase = safeFilename(baseName.replace(/\.[^.]+$/, ''))
  let index = 0
  let name = `${safeBase}${ext}`
  while (used.has(`images/${name}`)) {
    index += 1
    name = `${safeBase}_${index}${ext}`
  }
  const path = `images/${name}`
  used.add(path)
  return path
}

async function savedImageStateToFile(image:SavedImageState|undefined,_fallbackName:string,images?:Record<string,File>):Promise<File>{
  if(!image?.path||!images?.[image.path])throw new Error('MAP_ARCHIVE_IMAGE_MISSING')
  return images[image.path]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanRecord(value: unknown): Partial<Record<TileKey, boolean>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'boolean')) as Partial<Record<TileKey, boolean>>
}

function normalizeTilesState(value: unknown): Record<TileKey, Tile> {
  if (!isRecord(value)) throw new Error('拼接状态缺少地图块数据')
  const entries = Object.entries(value).flatMap(([key, raw]) => {
    if (!isRecord(raw)) return []
    const tile = {
      x: numberOr(raw.x, Number.NaN),
      y: numberOr(raw.y, Number.NaN),
      w: numberOr(raw.w, Number.NaN),
      h: numberOr(raw.h, Number.NaN),
    }
    return Number.isFinite(tile.x) && Number.isFinite(tile.y) && tile.w > 0 && tile.h > 0 ? [[key, tile] as const] : []
  })
  if (entries.length === 0) throw new Error('拼接状态中的地图块数据无效')
  return Object.fromEntries(entries) as Record<TileKey, Tile>
}

function normalizeFeathersState(value: unknown): Partial<Record<TileKey, Feather>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (!isRecord(raw)) return []
      return [[
        key,
        {
          top: Math.max(0, Math.min(MAX_FEATHER, numberOr(raw.top, 0))),
          right: Math.max(0, Math.min(MAX_FEATHER, numberOr(raw.right, 0))),
          bottom: Math.max(0, Math.min(MAX_FEATHER, numberOr(raw.bottom, 0))),
          left: Math.max(0, Math.min(MAX_FEATHER, numberOr(raw.left, 0))),
        },
      ] as const]
    }),
  ) as Partial<Record<TileKey, Feather>>
}

function getBaseName(file: File | null): string {
  return file?.name.replace(/\.[^.]+$/, '') || 'map_tile'
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'tile'
}

function toneForTile(tile: Tile): Side {
  if (Math.abs(tile.x) >= Math.abs(tile.y) && tile.x !== 0) return tile.x > 0 ? 'right' : 'left'
  if (tile.y !== 0) return tile.y > 0 ? 'bottom' : 'top'
  return 'right'
}

function labelForTile(tile: Tile,lang:Lang): string {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0001
  if (near(tile.x, 0) && tile.y < 0 && near(tile.w, 1) && near(tile.h, 1)) return mapText('上方',lang)
  if (tile.x > 0 && near(tile.y, 0) && near(tile.w, 1) && near(tile.h, 1)) return mapText('右侧',lang)
  if (near(tile.x, 0) && tile.y > 0 && near(tile.w, 1) && near(tile.h, 1)) return mapText('下方',lang)
  if (tile.x < 0 && near(tile.y, 0) && near(tile.w, 1) && near(tile.h, 1)) return mapText('左侧',lang)
  const format = (n: number) => Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toFixed(2)
  const xText = tile.x === 0 ? '' : tile.x > 0 ? `${mapText('右侧',lang)} ${format(tile.x)}` : `${mapText('左侧',lang)} ${format(tile.x)}`
  const yText = tile.y === 0 ? '' : tile.y > 0 ? `${mapText('下方',lang)} ${format(tile.y)}` : `${mapText('上方',lang)} ${format(tile.y)}`
  return [xText, yText].filter(Boolean).join(' ')
}

interface Props {
  onBack: () => void
}

export default function MapStitch({ onBack }: Props) {
  const { lang,setLang } = useLanguage()
  const [history,dispatchHistory]=useReducer(mapHistoryReducer,undefined,()=>createMapHistory({
    source:null,tiles:tilesRecord(expansionTilesFrom(CENTER_TILE,4,0.15,0.15)),tileUploads:{},tileFeathers:{},
    horizontalOverlapPercent:15,verticalOverlapPercent:15,expandSplit:4,hidePreviewBorders:false,hiddenPreviewTiles:{},
  }))
  const {source,tiles,tileUploads,tileFeathers,horizontalOverlapPercent,verticalOverlapPercent,expandSplit,hidePreviewBorders,hiddenPreviewTiles}=history.present
  const updateMap=useCallback((update:(draft:MapDraft)=>MapDraft)=>dispatchHistory({type:'change',update}),[])
  const setter=useCallback(<K extends keyof MapDraft>(key:K)=>(value:SetStateAction<MapDraft[K]>)=>updateMap(draft=>({...draft,
    [key]:typeof value==='function'?(value as (current:MapDraft[K])=>MapDraft[K])(draft[key]):value})),[updateMap])
  const setTiles=useMemo(()=>setter('tiles'),[setter])
  const setTileUploads=useMemo(()=>setter('tileUploads'),[setter])
  const setTileFeathers=useMemo(()=>setter('tileFeathers'),[setter])
  const setHorizontalOverlapPercent=useMemo(()=>setter('horizontalOverlapPercent'),[setter])
  const setVerticalOverlapPercent=useMemo(()=>setter('verticalOverlapPercent'),[setter])
  const setExpandSplit=useMemo(()=>setter('expandSplit'),[setter])
  const setHidePreviewBorders=useMemo(()=>setter('hidePreviewBorders'),[setter])
  const setHiddenPreviewTiles=useMemo(()=>setter('hiddenPreviewTiles'),[setter])
  const [selectedKey,setSelectedKey]=useState<TileKey|null>(null)
  const [processingKey, setProcessingKey] = useState<TileKey | null>(null)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [pendingUploadKey, setPendingUploadKey] = useState<TileKey | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tileFileInputRef = useRef<HTMLInputElement>(null)
  const stateFileInputRef = useRef<HTMLInputElement>(null)
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const currentDraft=useRef(history.present)
  useLayoutEffect(()=>{currentDraft.current=history.present},[history.present])
  const loadImageFile=(file:File,prepared:LoadedImage[]=[],signal?:AbortSignal)=>loadMapImage(file,[...ownedImages.current,...prepared],signal)
  const snapshot=useMemo(()=>({draft:history.present,view:{pan,zoom,selectedKey:selectedKey===CENTER_KEY||(selectedKey&&history.present.tiles[selectedKey])?selectedKey:null}}),[history.present,pan,zoom,selectedKey])
  const archiveViews=useRef(new WeakMap<MapDraft,NonNullable<StoredMap['view']>>())
  const currentView=useRef(snapshot.view)
  useLayoutEffect(()=>{currentView.current=snapshot.view},[snapshot.view])
  const moveHistory=useCallback((type:'undo'|'redo')=>{
    const next=mapHistoryReducer(history,{type})
    const view=archiveViews.current.get(next.present)
    if(view){setPan(view.pan);setZoom(view.zoom);setSelectedKey(view.selectedKey)}
    dispatchHistory({type})
  },[history])
  const ownedImages=useRef(new Set<LoadedImage>())
  useLayoutEffect(()=>{
    const retained=mapImages([history.present,...history.past,...history.future,...(history.checkpoint?[history.checkpoint]:[])])
    for(const image of ownedImages.current)if(!retained.has(image))URL.revokeObjectURL(image.url)
    ownedImages.current=retained
  },[history])
  useEffect(()=>()=>{for(const image of ownedImages.current)URL.revokeObjectURL(image.url);ownedImages.current.clear()},[])
  useEffect(()=>{
    const onResize=()=>setViewport({width:window.innerWidth,height:window.innerHeight})
    window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize)
  },[])
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.isComposing||!(event.metaKey||event.ctrlKey)||event.altKey)return
      const target=event.target as HTMLElement
      if(target.closest('input,textarea,select,[contenteditable="true"]'))return
      if(event.code==='KeyZ'||event.code==='KeyY'){event.preventDefault();moveHistory(event.shiftKey||event.code==='KeyY'?'redo':'undo')}
    }
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)
  },[moveHistory])

  const allTiles = useMemo(() => [CENTER_TILE, ...Object.values(tiles)], [tiles])
  const horizontalOverlapRatio = horizontalOverlapPercent / 100
  const verticalOverlapRatio = verticalOverlapPercent / 100
  const initialTilesForSplit = useMemo(
    () => expansionTilesFrom(CENTER_TILE, expandSplit, horizontalOverlapRatio, verticalOverlapRatio),
    [expandSplit, horizontalOverlapRatio, verticalOverlapRatio],
  )

  const stage = useMemo(() => {
    if (!source) return null
    const minX = Math.min(...allTiles.map((tile) => tile.x))
    const maxX = Math.max(...allTiles.map((tile) => tile.x + tile.w))
    const minY = Math.min(...allTiles.map((tile) => tile.y))
    const maxY = Math.max(...allTiles.map((tile) => tile.y + tile.h))
    const stageW = (maxX - minX) * source.width
    const stageH = (maxY - minY) * source.height
    return {
      stageW,
      stageH,
      scale: zoom,
      unitW: source.width,
      unitH: source.height,
      minX,
      minY,
    }
  }, [source, allTiles, zoom])

  const completedImageForKey = (key: TileKey): LoadedImage | null => {
    if (key === CENTER_KEY) return source
    return tileUploads[key] ?? null
  }

  const hasCompletedImage = (key: TileKey): boolean => Boolean(completedImageForKey(key))

  const featherForKey = (key: TileKey): Feather => tileFeathers[key] ?? DEFAULT_FEATHER

  const completedTiles = () => allTiles.filter((tile) => hasCompletedImage(tileKey(tile.x, tile.y)))

  const tilePosition = (tile: Tile) => {
    if (!stage) return {}
    return {
      left: (tile.x - stage.minX) * stage.unitW,
      top: (tile.y - stage.minY) * stage.unitH,
    }
  }

  const tileRect = (tile: Tile) => {
    if (!stage) return null
    const left = (tile.x - stage.minX) * stage.unitW
    const top = (tile.y - stage.minY) * stage.unitH
    const width = tile.w * stage.unitW
    const height = tile.h * stage.unitH
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }
  }

  const tilesIntersect = (a: Tile, b: Tile): boolean => {
    const ar = tileRect(a)
    const br = tileRect(b)
    if (!ar || !br) return false
    return ar.left < br.right && ar.right > br.left && ar.top < br.bottom && ar.bottom > br.top
  }

  const selectSource = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      message.error(mapText('请选择图片文件',lang))
      return
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      message.error(lang==='zh'?`图片不能超过 ${MAX_IMAGE_MB}MB`:lang==='ja'?`画像は ${MAX_IMAGE_MB}MB 以下にしてください`:`Images must be at most ${MAX_IMAGE_MB}MB`)
      return
    }
    const before=currentDraft.current
    try {
      const loaded = await loadImageFile(file)
      if(!alive.current||currentDraft.current!==before){URL.revokeObjectURL(loaded.url);throw new Error('Map changed while loading; retry the selected import')}
      const initTiles = [CENTER_TILE, ...initialTilesForSplit]
      const minX = Math.min(...initTiles.map((tile) => tile.x))
      const maxX = Math.max(...initTiles.map((tile) => tile.x + tile.w))
      const minY = Math.min(...initTiles.map((tile) => tile.y))
      const maxY = Math.max(...initTiles.map((tile) => tile.y + tile.h))
      const initialStageW = (maxX - minX) * loaded.width
      const initialStageH = (maxY - minY) * loaded.height
      const availableW = Math.max(320, viewport.width - 48)
      const availableH = Math.max(320, viewport.height - 160)
      updateMap(draft=>({...draft,source:loaded,tiles:tilesRecord(initialTilesForSplit),tileUploads:{},tileFeathers:{},
        hiddenPreviewTiles:{},hidePreviewBorders:false}))
      setSelectedKey(null);setPan({x:0,y:0});setZoom(clampZoom(Math.min(1,availableW/initialStageW,availableH/initialStageH)))
    } catch (error) {
      message.error(String(error))
    }
  }

  const selectTileUpload = async (key: TileKey, file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      message.error(mapText('请选择图片文件',lang))
      return
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      message.error(lang==='zh'?`图片不能超过 ${MAX_IMAGE_MB}MB`:lang==='ja'?`画像は ${MAX_IMAGE_MB}MB 以下にしてください`:`Images must be at most ${MAX_IMAGE_MB}MB`)
      return
    }
    const before=currentDraft.current
    try {
      const upload = await loadImageFile(file)
      if(!alive.current||currentDraft.current!==before){URL.revokeObjectURL(upload.url);throw new Error('Map changed while loading; retry the selected import')}
      setTileUploads((prev) => {
        return { ...prev, [key]: upload }
      })
      setSelectedKey(key)
    } catch (error) {
      message.error(String(error))
    }
  }

  const openTileUpload = (key: TileKey) => {
    setPendingUploadKey(key)
    tileFileInputRef.current?.click()
  }

  const findTemplateNeighbors = (target: Tile): Array<{ image: LoadedImage; tile: Tile }> => {
    const targetKey = tileKey(target.x, target.y)
    const neighbors: Array<{ image: LoadedImage; tile: Tile }> = []
    for (const completedTile of allTiles) {
      const completedKey = tileKey(completedTile.x, completedTile.y)
      if (completedKey === targetKey) continue
      const image = completedImageForKey(completedKey)
      if (!image) continue
      if (tilesIntersect(target, completedTile)) neighbors.push({ image, tile: completedTile })
    }
    return neighbors
  }

  const downloadTileTemplate = async (key: TileKey) => {
    const tile = tiles[key]
    if (!tile) return
    try {
      const neighbors = findTemplateNeighbors(tile)
      if (neighbors.length === 0) {
        message.warning(mapText('周边没有可用于生成重叠像素的已完成图片',lang))
        return
      }
      await runMapExport('template',tile)
    } catch (error) {
      message.error(String(error))
    }
  }

  const removeWatermarkForTile = async (key: TileKey) => {
    const upload = tileUploads[key]
    if (!upload||exportExecution.current) return
    const before=currentDraft.current
    const controller=new AbortController();exportExecution.current=controller
    setProcessingKey(key);setExporting(true);setExportProgress(0);setExportError('')
    try {
      const {outputs}=await runManagedTask('workflow.legacy',[upload.file],{graph:{version:7,nodes:[{id:'watermark',type:'geminiWatermarkRemove',params:{}}],edges:[]}},
        {signal:controller.signal,onProgress:value=>{if(alive.current)setExportProgress(value)},outputFilter:version=>version.metadata.kind==='image'})
      if(!alive.current||currentDraft.current!==before)throw new Error('Map changed while processing; result remains in Project assets')
      const blob=outputs[0].blob
      const cleanFile = new File([blob], `${getBaseName(upload.file)}_no_watermark.png`, { type: 'image/png' })
      const {project}=await localJson<{project:{id:string}}>('/api/project')
      cacheManagedInput(cleanFile,project.id,outputs[0].version.id)
      const cleanImage = await loadImageFile(cleanFile,[],controller.signal)
      if(!alive.current||currentDraft.current!==before){URL.revokeObjectURL(cleanImage.url);throw new Error('Map changed while processing; result remains in Project assets')}
      setTileUploads((prev) => {
        return { ...prev, [key]: cleanImage }
      })
      message.success(mapText('去水印完成',lang))
    } catch (error) {
      if(alive.current)setExportError(`${mapText('去水印失败',lang)}: ${String(error)}`)
    } finally {
      if(exportExecution.current===controller)exportExecution.current=null
      if(alive.current){setProcessingKey(null);setExporting(false)}
    }
  }

  const increaseFeather = (key: TileKey, side: Side) => {
    setTileFeathers((prev) => {
      const current = prev[key] ?? DEFAULT_FEATHER
      return {
        ...prev,
        [key]: {
          ...current,
          [side]: Math.min(MAX_FEATHER, current[side] + FEATHER_STEP),
        },
      }
    })
  }

  const decreaseFeather = (key: TileKey, side: Side) => {
    setTileFeathers((prev) => {
      const current = prev[key] ?? DEFAULT_FEATHER
      return {
        ...prev,
        [key]: {
          ...current,
          [side]: Math.max(0, current[side] - FEATHER_STEP),
        },
      }
    })
  }

  const togglePreviewTileVisibility = (key: TileKey) => {
    setHiddenPreviewTiles((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const unloadTileUpload = (key: TileKey) => {
    updateMap(draft=>{
      const uploads={...draft.tileUploads};const feathers={...draft.tileFeathers};const hidden={...draft.hiddenPreviewTiles}
      delete uploads[key];delete feathers[key];delete hidden[key]
      return {...draft,tileUploads:uploads,tileFeathers:feathers,hiddenPreviewTiles:hidden}
    })
    message.success(mapText('图片已卸载',lang))
  }

  const expandFromTile = (key: TileKey) => {
    const origin = key === CENTER_KEY ? CENTER_TILE : tiles[key]
    if (!origin || !hasCompletedImage(key)) return
    const split = key === CENTER_KEY ? expandSplit : 4
    const next = { ...tiles }
    let added = 0
    for (const target of expansionTilesFrom(origin, split, horizontalOverlapRatio, verticalOverlapRatio)) {
      if (!isOutwardExpansionTile(origin, target)) continue
      const targetKey = tileKey(target.x, target.y)
      if (hasCompletedImage(targetKey) || next[targetKey]) continue
      next[targetKey] = target
      added += 1
    }
    if(Object.keys(next).length>1000){message.error('MAP_DOCUMENT_TILE_LIMIT');return}
    if(added) setTiles(next)
    if (added > 0) message.success(lang==='zh'?`已扩展 ${added} 个空框`:lang==='ja'?`${added} 個のタイルを追加`:`Added ${added} empty tiles`)
    else message.info(mapText('周边已有空框或已完成图片，无需扩展',lang))
  }

  const exportExecution=useRef<AbortController|null>(null)
  const archiveExecution=useRef<AbortController|null>(null)
  const alive=useRef(true)
  const [exporting,setExporting]=useState(false)
  const [exportProgress,setExportProgress]=useState(0)
  const [exportError,setExportError]=useState('')
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;archiveExecution.current?.abort()}},[])
  const runMapExport=async(format:'png'|'psd'|'godot'|'template',target?:Tile)=>{
    if(!source||exportExecution.current)return
    const controller=new AbortController();exportExecution.current=controller
    setExporting(true);setExportProgress(0);setExportError('')
    const images=completedTiles().map(tile=>({tile,key:tileKey(tile.x,tile.y),image:completedImageForKey(tileKey(tile.x,tile.y))!}))
    const layout:MapRenderLayout={sourceName:source.file.name,width:source.width,height:source.height,horizontalOverlapPercent,verticalOverlapPercent,
      layers:images.map(({tile,key},inputIndex)=>({tile,key,inputIndex,feather:featherForKey(key)}))}
    const frontendBytes=Math.ceil([...ownedImages.current].reduce((bytes,image)=>bytes+image.width*image.height*32+image.file.size*2,0))
    const extension=format==='psd'?'.psd':format==='godot'?'.zip':'.png'
    try{
      const {outputs}=await runManagedTask(format==='template'?'map.template':'map.export',images.map(item=>item.image.file),
        format==='template'?{layout,target,frontendBytes}:{layout,format,frontendBytes},
        {signal:controller.signal,onProgress:value=>{if(alive.current)setExportProgress(value)},outputFilter:version=>version.metadata.extension===extension})
      if(controller.signal.aborted||!alive.current)return
      if(outputs.length!==1)throw new Error('MAP_EXPORT_RESULT_INVALID')
      const suffix=format==='godot'?'godot_package.zip':format==='template'?`${tileKey(target!.x,target!.y).replace(',', '_')}_overlap_template.png`:`stitched${extension}`
      downloadBlob(outputs[0].blob,`${getBaseName(source.file)}_${suffix}`)
      message.success(lang==='zh'?'地图已导出并保存到项目':lang==='ja'?'マップを出力してプロジェクトに保存しました':'Map exported and saved to project')
    }catch(error){if(alive.current){
      if(error instanceof DOMException&&error.name==='AbortError')message.info(mapText('导出已取消',lang))
      else setExportError(String(error))
    }}
    finally{if(exportExecution.current===controller)exportExecution.current=null;if(alive.current)setExporting(false)}
  }
  const downloadStitchedPng=()=>runMapExport('png')
  const downloadStitchedPsd=()=>runMapExport('psd')
  const downloadGodotPackage=()=>runMapExport('godot')

  const downloadEditStateJson = async () => {
    if (!source||exportExecution.current) return
    try {
      const archiveImages:Record<string,Blob>={}
      const controller=new AbortController();exportExecution.current=controller;archiveExecution.current=controller
      setExporting(true);setExportProgress(0);setExportError('')

      const usedImagePaths = new Set<string>()
      const addImageToArchive = (image: LoadedImage, baseName: string): SavedImageState => {
        const path = uniqueArchiveImagePath(usedImagePaths, baseName, image.file)
        archiveImages[path]=image.file
        return {
          fileName: image.file.name,
          type: image.file.type,
          size: image.file.size,
          width: image.width,
          height: image.height,
          path,
        }
      }

      const uploads = Object.entries(tileUploads).flatMap(([key, upload]) => {
        if (!upload) return []
        return [[key, addImageToArchive(upload, `tile_${key.replace(',', '_')}_${upload.file.name}`)] as const]
      })

      const state = {
        version: STATE_ARCHIVE_VERSION,
        savedAt: new Date().toISOString(),
        format: 'pixelwork-map-stitch-state',
        source: addImageToArchive(source, `source_${source.file.name}`),
        tiles,
        tileUploads: Object.fromEntries(uploads),
        tileFeathers,
        selectedKey,
        horizontalOverlapPercent,
        verticalOverlapPercent,
        expandSplit,
        pan,
        zoom,
        hidePreviewBorders,
        hiddenPreviewTiles,
      }

      const archive=await runMapArchive<Blob>({action:'write',files:archiveImages,state,budgetBytes:source.memoryBudgetBytes},controller.signal)
      if(!alive.current||controller.signal.aborted)return
      downloadBlob(
        archive,
        `${safeFilename(getBaseName(source.file))}_map_stitch_state.zip`,
      )
      message.success(mapText('拼接状态已保存',lang))
    } catch (error) {
      if(!alive.current)return
      setExportError(`${mapText('保存拼接状态失败',lang)}: ${String(error)}`)
    }finally{exportExecution.current=null;archiveExecution.current=null;if(alive.current)setExporting(false)}
  }

  const applyEditState = async (state: SavedMapStitchState, archiveImages:Record<string,File>,before:MapDraft,signal:AbortSignal) => {
    if ((state.version !== 1 && state.version !== STATE_ARCHIVE_VERSION) || !state.source) throw new Error('不是有效的拼接状态文件')
    signal.throwIfAborted()
    const created:LoadedImage[]=[]
    try {
      signal.throwIfAborted()
      const nextSource=await loadImageFile(await savedImageStateToFile(state.source,'map_tile.png',archiveImages),created,signal)
      created.push(nextSource)
      const nextTiles=normalizeTilesState(state.tiles)
      const nextTileUploads:Partial<Record<TileKey,LoadedImage>>={}
      for(const [key,upload]of Object.entries(state.tileUploads??{})){
        signal.throwIfAborted()
        if(!nextTiles[key])throw new Error('MAP_DOCUMENT_TILE_REFERENCE')
        const loaded=await loadImageFile(await savedImageStateToFile(upload,`tile_${key.replace(',', '_')}.png`,archiveImages),created,signal)
        created.push(loaded);nextTileUploads[key]=loaded
      }
      signal.throwIfAborted()
      if(!alive.current||currentDraft.current!==before)throw new Error('Map changed while loading; current edits are preserved')
      const nextExpandSplit:ExpandSplit=state.expandSplit===8||state.expandSplit===12?state.expandSplit:4
      const nextPan=isRecord(state.pan)?{x:numberOr(state.pan.x,0),y:numberOr(state.pan.y,0)}:{x:0,y:0}
      const keys=new Set([CENTER_KEY,...Object.keys(nextTiles)])
      const restored:MapDraft={source:nextSource,tileUploads:nextTileUploads,tiles:nextTiles,
        tileFeathers:Object.fromEntries(Object.entries(normalizeFeathersState(state.tileFeathers)).filter(([key])=>keys.has(key))),
        horizontalOverlapPercent:Math.max(0,Math.min(50,numberOr(state.horizontalOverlapPercent,15))),
        verticalOverlapPercent:Math.max(0,Math.min(50,numberOr(state.verticalOverlapPercent,15))),expandSplit:nextExpandSplit,
        hidePreviewBorders:typeof state.hidePreviewBorders==='boolean'?state.hidePreviewBorders:false,
        hiddenPreviewTiles:Object.fromEntries(Object.entries(booleanRecord(state.hiddenPreviewTiles)).filter(([key])=>keys.has(key))),
      }
      const nextView={pan:nextPan,zoom:clampZoom(numberOr(state.zoom,1)),selectedKey:typeof state.selectedKey==='string'&&keys.has(state.selectedKey)?state.selectedKey:null}
      validateMapDraft(restored,nextView)
      archiveViews.current.set(before,currentView.current);archiveViews.current.set(restored,nextView)
      updateMap(()=>restored)
      setSelectedKey(nextView.selectedKey);setPan(nextView.pan);setZoom(nextView.zoom)
      setProcessingKey(null);setPendingUploadKey(null)
    }catch(error){created.forEach(image=>URL.revokeObjectURL(image.url));throw error}
  }

  const loadEditStateJson = async (file: File | null) => {
    if (!file||exportExecution.current) return
    const before=currentDraft.current
    try {
      const controller=new AbortController();exportExecution.current=controller;archiveExecution.current=controller;setExporting(true);setExportError('')
      const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project')
      const {state,images}=await runMapArchive<{state:SavedMapStitchState;images:Record<string,File>}>({action:'read',file,budgetBytes:memoryBudgetBytes},controller.signal)
      controller.signal.throwIfAborted()
      await applyEditState(state,images,before,controller.signal)
      message.success(mapText('拼接状态已加载',lang))
    } catch (error) {
      if(!alive.current)return
      setExportError(`${mapText('加载拼接状态失败',lang)}: ${String(error)}`)
    }finally{exportExecution.current=null;archiveExecution.current=null;if(alive.current)setExporting(false)}
  }

  const handlePanMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    panDragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
  }

  const handlePanMouseMove = (event: React.MouseEvent<HTMLElement>) => {
    const drag = panDragRef.current
    if (!drag) return
    event.preventDefault()
    setPan({
      x: drag.panX + event.clientX - drag.startX,
      y: drag.panY + event.clientY - drag.startY,
    })
  }

  const stopPan = () => {
    panDragRef.current = null
  }

  const handleWorkspaceWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!stage) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const oldZoom = zoom
    const deltaPx = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * rect.height : event.deltaY
    const nextZoom = clampZoom(oldZoom * Math.exp(-deltaPx * WHEEL_ZOOM_SENSITIVITY))
    if (Math.abs(nextZoom - oldZoom) < 0.0001) return

    const baseLeft = rect.left + (rect.width - stage.stageW * oldZoom) / 2
    const baseTop = rect.top + (rect.height - stage.stageH * oldZoom) / 2
    const worldX = (event.clientX - baseLeft - pan.x) / oldZoom
    const worldY = (event.clientY - baseTop - pan.y) / oldZoom
    const nextBaseLeft = rect.left + (rect.width - stage.stageW * nextZoom) / 2
    const nextBaseTop = rect.top + (rect.height - stage.stageH * nextZoom) / 2

    setZoom(nextZoom)
    setPan({
      x: event.clientX - nextBaseLeft - worldX * nextZoom,
      y: event.clientY - nextBaseTop - worldY * nextZoom,
    })
  }

  return (
    <div className="map-stitch-fullscreen">
      <div className="map-stitch-float-actions">
        <Button
          className="map-stitch-generate-float"
        type="primary"
        href={GENERATE_STITCH_URL}
        target="_blank"
        rel="noreferrer"
        >
          {mapText('生成拼接',lang)}
        </Button>
        <Button
          className="map-stitch-generate-float"
          type="primary"
          icon={<UploadOutlined />}
          onClick={() => stateFileInputRef.current?.click()}
        >
          {mapText('加载拼接状态',lang)}
        </Button>
        <Button
          className="map-stitch-generate-float"
          type="primary"
          disabled={!source||exporting}
          icon={<DownloadOutlined />}
          onClick={() => void downloadEditStateJson()}
        >
          {mapText('保存拼接状态',lang)}
        </Button>
        <Button
          className="map-stitch-generate-float"
          type="primary"
          disabled={!source||exporting}
          icon={<DownloadOutlined />}
          onClick={() => void downloadGodotPackage()}
        >
          {mapText('godot打包下载',lang)}
        </Button>
      </div>
      <header className="map-stitch-toolbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
          {mapText('返回首页',lang)}
        </Button>
        <div className="map-stitch-title">
          <Title level={4}>{mapText('地图拼接',lang)}</Title>
          <Text type="secondary" className="map-stitch-title-hint">
            {mapText('右键拖动画布，滚轮缩放视图',lang)}
          </Text>
        </div>
        <Space wrap>
          <Select aria-label="Language" value={lang} onChange={setLang}
            getPopupContainer={trigger => trigger.parentElement ?? document.body}
            options={[{value:'zh',label:'中文'},{value:'en',label:'English'},{value:'ja',label:'日本語'}]}/>
          <div className="map-stitch-split-control">
            <Text type="secondary">{mapText('扩图细分数',lang)}</Text>
            <Select<ExpandSplit>
              value={expandSplit}
              onChange={setExpandSplit}
              popupClassName="map-stitch-split-popup"
              getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
              options={[
                { value: 4, label: mapText('4分扩图',lang) },
                { value: 8, label: mapText('8分扩图',lang) },
                { value: 12, label: mapText('12分扩图',lang) },
              ]}
            />
          </div>
          <div className="map-stitch-overlap-control">
            <Text type="secondary">{mapText('左右重叠',lang)} {horizontalOverlapPercent}%</Text>
            <Slider
              min={0}
              max={50}
              step={1}
              value={horizontalOverlapPercent}
              onChange={value=>{dispatchHistory({type:'begin'});setHorizontalOverlapPercent(value)}}
              onChangeComplete={()=>dispatchHistory({type:'end'})}
              tooltip={{ formatter: (value) => `${value}%` }}
            />
          </div>
          <div className="map-stitch-overlap-control">
            <Text type="secondary">{mapText('上下重叠',lang)} {verticalOverlapPercent}%</Text>
            <Slider
              min={0}
              max={50}
              step={1}
              value={verticalOverlapPercent}
              onChange={value=>{dispatchHistory({type:'begin'});setVerticalOverlapPercent(value)}}
              onChangeComplete={()=>dispatchHistory({type:'end'})}
              tooltip={{ formatter: (value) => `${value}%` }}
            />
          </div>
          <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
            {source ? mapText('重新导入图片',lang) : mapText('导入图片',lang)}
          </Button>
          <Button icon={<DownloadOutlined />} disabled={!source||exporting} onClick={() => void downloadStitchedPng()}>
            {mapText('下载全部PNG',lang)}
          </Button>
          <Button icon={<DownloadOutlined />} disabled={!source||exporting} onClick={() => void downloadStitchedPsd()}>
            {mapText('下载PSD',lang)}
          </Button>
        </Space>
      </header>
      <div className="map-stitch-project-toolbar">
        <DocumentSaveBar<typeof snapshot,StoredMap> kind="map" snapshot={snapshot}
          sameSnapshot={(a,b)=>a.draft===b.draft&&a.view.pan===b.view.pan&&a.view.zoom===b.view.zoom&&a.view.selectedKey===b.view.selectedKey}
          serialize={async value=>validateStoredMap({...await serializeMapDocument(value.draft),view:value.view})}
          restore={async value=>({draft:await restoreMapDocument(value,[...ownedImages.current]),view:value.view??{pan:{x:0,y:0},zoom:1,selectedKey:null}})}
          discardSnapshot={value=>{for(const image of mapImages([value.draft]))URL.revokeObjectURL(image.url)}}
          applySnapshot={value=>{archiveViews.current=new WeakMap();dispatchHistory({type:'restore',draft:value.draft});setSelectedKey(value.view.selectedKey);setPan(value.view.pan);setZoom(value.view.zoom);setProcessingKey(null)}} />
        <Space>
          <Button disabled={!history.past.length} onClick={()=>moveHistory('undo')}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
          <Button disabled={!history.future.length} onClick={()=>moveHistory('redo')}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
          {exporting&&<Button danger onClick={()=>exportExecution.current?.abort()}>{lang==='zh'?'取消导出':lang==='ja'?'出力を中止':'Cancel export'} · {Math.round(exportProgress*100)}%</Button>}
        </Space>
      </div>
      {exportError&&<Alert type="error" showIcon closable onClose={()=>setExportError('')} message={exportError} />}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          void selectSource(event.target.files?.[0] ?? null)
          event.currentTarget.value = ''
        }}
      />

      <input
        ref={tileFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          if (pendingUploadKey) {
            void selectTileUpload(pendingUploadKey, event.target.files?.[0] ?? null)
          }
          event.currentTarget.value = ''
          setPendingUploadKey(null)
        }}
      />

      <input
        ref={stateFileInputRef}
        type="file"
        accept="application/zip,application/x-zip-compressed,application/json,.zip,.json"
        hidden
        onChange={(event) => {
          void loadEditStateJson(event.target.files?.[0] ?? null)
          event.currentTarget.value = ''
        }}
      />

      {!source || !stage ? (
        <main
          className="map-stitch-empty"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void selectSource(event.dataTransfer.files?.[0] ?? null)
          }}
        >
          <UploadOutlined />
          <Title level={3}>{mapText('导入地图图片',lang)}</Title>
          <Button type="primary" size="large" icon={<UploadOutlined />}>
            {mapText('点击上传图片',lang)}
          </Button>
          <Text type="secondary">{mapText('也可以把 PNG / JPG / WebP 拖到这里上传。',lang)}</Text>
        </main>
      ) : (
        <main
          className="map-stitch-workspace"
          onContextMenu={(event) => event.preventDefault()}
          onMouseDown={handlePanMouseDown}
          onMouseMove={handlePanMouseMove}
          onMouseUp={stopPan}
          onMouseLeave={stopPan}
          onWheel={handleWorkspaceWheel}
        >
          <div
            className="map-stitch-stage-shell"
            style={{
              width: stage.stageW * stage.scale,
              height: stage.stageH * stage.scale,
              transform: `translate(${pan.x}px, ${pan.y}px)`,
            }}
          >
            <div
              className={`map-stitch-stage ${hidePreviewBorders ? 'map-stitch-stage-hide-borders' : ''}`}
              style={{
                width: stage.stageW,
                height: stage.stageH,
                transform: `scale(${stage.scale})`,
              }}
            >
              <div
                className="map-stitch-source-frame"
                style={{
                  ...tilePosition(CENTER_TILE),
                  width: stage.unitW,
                  height: stage.unitH,
                }}
              >
                <img src={source.url} alt={mapText('原图',lang)} />
              </div>

              {Object.entries(tiles).map(([key, tile]) => {
                const tileId = key as TileKey
                const upload = tileUploads[tileId]
                const isSelected = selectedKey === tileId
                const tone = toneForTile(tile)
                const rect = tileRect(tile)
                const feather = featherForKey(tileId)
                const isImageHidden = Boolean(hiddenPreviewTiles[tileId])
                return (
                  <div
                    key={tileId}
                    role="button"
                    aria-label={`${labelForTile(tile,lang)} · ${tileId}`}
                    aria-pressed={isSelected}
                    tabIndex={0}
                    className={`map-stitch-neighbor-frame map-stitch-neighbor-${tone} ${upload ? 'map-stitch-neighbor-uploaded' : ''} ${isSelected ? 'selected' : ''} ${isImageHidden ? 'map-stitch-tile-image-hidden' : ''}`}
                    style={{
                      ...tilePosition(tile),
                      width: rect?.width ?? stage.unitW,
                      height: rect?.height ?? stage.unitH,
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      setSelectedKey(tileId)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setSelectedKey(tileId)
                    }}
                  >
                    {upload && rect ? (
                      <FeatheredPreviewImage upload={upload} width={rect.width} height={rect.height} feather={feather} alt={`${labelForTile(tile,lang)} preview`} />
                    ) : upload ? (
                      <img src={upload.url} alt={`${labelForTile(tile,lang)}预览`} />
                    ) : null}
                    <span
                      className="map-stitch-frame-label"
                      style={{ transform: `translate(-50%, -50%) scale(${1 / stage.scale})` }}
                    >
                      {labelForTile(tile,lang)}
                      {!isSelected && <strong>{upload ? mapText('点击操作',lang) : mapText('点击激活',lang)}</strong>}
                      <small>{upload ? mapText('已上传，可去水印或扩展',lang) : mapText('上传或下载透明模板',lang)}</small>
                    </span>
                    {isSelected && createPortal(
                      <span
                        className={`map-stitch-frame-actions map-stitch-inspector ${upload ? 'map-stitch-frame-actions-wide' : ''}`}
                        role="group" aria-label={mapText('图块参数',lang)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Text style={{gridColumn:'1 / -1'}}>{labelForTile(tile,lang)} · {tileId}</Text>
                        <Button
                          className="map-stitch-action-btn"
                          icon={<UploadOutlined />}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            openTileUpload(tileId)
                          }}
                        >
                          {mapText('上传',lang)}
                        </Button>
                        <Button className="map-stitch-action-btn" type="primary" icon={<DownloadOutlined />} onClick={() => void downloadTileTemplate(tileId)}>
                          {mapText('下载',lang)}
                        </Button>
                        {upload && (
                          <>
                            <Button
                              className="map-stitch-action-btn"
                              loading={processingKey === tileId}
                              onClick={() => void removeWatermarkForTile(tileId)}
                            >
                              {mapText('去水印',lang)}
                            </Button>
                            <Button className="map-stitch-action-btn" icon={<ExpandOutlined />} onClick={() => expandFromTile(tileId)}>
                              {mapText('扩展',lang)}
                            </Button>
                            <Button
                              className="map-stitch-unload-btn"
                              danger
                              icon={<DeleteOutlined />}
                              title={mapText('卸载图片',lang)}
                              onClick={(event) => {
                                event.stopPropagation()
                                unloadTileUpload(tileId)
                              }}
                            >
                              {mapText('卸载图片',lang)}
                            </Button>
                          </>
                        )}
                        {upload && (
                          <span className="map-stitch-feather-actions">
                            <Button
                              className="map-stitch-feather-btn map-stitch-feather-top"
                              icon={<ArrowUpOutlined />}
                              title={mapText('左键增加羽化，右键减少羽化',lang)}
                              onClick={() => increaseFeather(tileId, 'top')}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                decreaseFeather(tileId, 'top')
                              }}
                            >
                              {feather.top}%
                            </Button>
                            <span className="map-stitch-feather-cell map-stitch-feather-left">
                              <Button
                                className="map-stitch-feather-btn"
                                icon={<ArrowLeftOutlined />}
                                title={mapText('左键增加羽化，右键减少羽化',lang)}
                                onClick={() => increaseFeather(tileId, 'left')}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  decreaseFeather(tileId, 'left')
                                }}
                              >
                                {feather.left}%
                              </Button>
                              <Button
                                className="map-stitch-feather-image-toggle"
                                icon={isImageHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                                title={isImageHidden ? mapText('显示图片',lang) : mapText('隐藏图片',lang)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  togglePreviewTileVisibility(tileId)
                                }}
                              />
                            </span>
                            <Button
                              className="map-stitch-feather-border-toggle"
                              type={hidePreviewBorders ? 'primary' : 'default'}
                              onClick={() => setHidePreviewBorders((prev) => !prev)}
                            >
                              {mapText('不显示边框',lang)}
                            </Button>
                            <Button
                              className="map-stitch-feather-btn map-stitch-feather-right"
                              icon={<ArrowRightOutlined />}
                              title={mapText('左键增加羽化，右键减少羽化',lang)}
                              onClick={() => increaseFeather(tileId, 'right')}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                decreaseFeather(tileId, 'right')
                              }}
                            >
                              {feather.right}%
                            </Button>
                            <span className="map-stitch-feather-cell map-stitch-feather-bottom">
                              <Button
                                className="map-stitch-feather-btn"
                                icon={<ArrowDownOutlined />}
                                title={mapText('左键增加羽化，右键减少羽化',lang)}
                                onClick={() => increaseFeather(tileId, 'bottom')}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  decreaseFeather(tileId, 'bottom')
                                }}
                              >
                                {feather.bottom}%
                              </Button>
                              <Button
                                className="map-stitch-feather-image-toggle"
                                icon={isImageHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                                title={isImageHidden ? mapText('显示图片',lang) : mapText('隐藏图片',lang)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  togglePreviewTileVisibility(tileId)
                                }}
                              />
                            </span>
                          </span>
                        )}
                        <Button style={{gridColumn:'1 / -1'}} onClick={()=>setSelectedKey(null)}>{mapText('关闭图块参数',lang)}</Button>
                      </span>,document.body
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </main>
      )}
    </div>
  )
}

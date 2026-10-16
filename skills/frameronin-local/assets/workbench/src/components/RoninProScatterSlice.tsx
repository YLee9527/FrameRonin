import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Slider,
  Space,
  Typography,
  Upload,
  message,
} from 'antd'
import type { UploadFile } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {flushSync} from 'react-dom'
import {MAX_SCATTER_BOXES,orderedScatterBoxes,reviewScatterExport,validateScatterBoxes} from '../lib/scatterSlice'
import {scatterSourceWorker} from '../lib/scatterSourceWorker'
import {useScatterDocument} from '../localProject/useScatterDocument'
import {scatterReports} from '../localProject/scatterDocument'
import {ScatterDocumentSurface} from '../localProject/ScatterDocumentSurface'
import {useScatterSource} from '../localProject/useScatterSource'
import {prepareFineInput} from '../localProject/fineEditInput'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {cacheManagedInput,runManagedTask} from '../localProject/managedTasks'
import {Progress} from 'antd'
import type { Lang } from '../i18n/locales'
import { useLanguage } from '../i18n/context'
import StashDropZone from './StashDropZone'

const { Dragger } = Upload
const { Paragraph, Text, Title } = Typography
const { TextArea } = Input

type ToolMode = 'edit' | 'add'
type ExportFormat = 'png' | 'jpeg' | 'webp'
type OrderMode = 'row-major' | 'column-major'
type DetectMode = 'auto' | 'alpha' | 'colorkey'
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

interface LoadedImageInfo {
  width: number
  height: number
  fileNameBase: string
}

interface DetectConfig {
  mode: DetectMode
  colorKey: string
  threshold: number
  mergeGap: number
  minPixels: number
  minSide: number
}

interface SliceBox {
  id: string
  x: number
  y: number
  w: number
  h: number
  row?: number
  col?: number
  kind?: 'grid' | 'sprite'
  name?: string
}

interface Point {
  x: number
  y: number
}

interface DisplayMetrics {
  scale: number
  pixelRatio: number
}

type InteractionState =
  | null
  | { type: 'add'; start: Point; previewBox: SliceBox }
  | { type: 'move'; start: Point; origin: SliceBox }
  | { type: 'resize'; handle: ResizeHandle; origin: SliceBox }

interface UiText {
  moduleTitle: string
  moduleLead: string
  uploadTitle: string
  uploadHint: string
  uploadSubHint: string
  demo: string
  clearImage: string
  exportTitle: string
  exportFormat: string
  exportQuality: string
  exportNames: string
  exportNamesPlaceholder: string
  exportOrder: string
  exportOrderRow: string
  exportOrderCol: string
  exportNamePerRow: string
  modeGrid: string
  modeSprites: string
  gridTitle: string
  spriteTitle: string
  cols: string
  rows: string
  gapX: string
  gapY: string
  offsetX: string
  offsetY: string
  updatePreview: string
  calibrateX: string
  calibrateY: string
  downloadGridZip: string
  detectMode: string
  detectModeAuto: string
  detectModeAlpha: string
  detectModeColorKey: string
  colorKey: string
  threshold: string
  mergeGap: string
  minPixels: string
  minSide: string
  autoDetect: string
  editTool: string
  addTool: string
  deleteSelected: string
  clearAll: string
  selectedName: string
  selectedNamePlaceholder: string
  downloadSpriteZip: string
  statusTitle: string
  statusDefault: string
  previewTitleIdle: string
  previewTitleGrid: string
  previewTitleSprites: string
  showResolution: string
  resolutionFontSize: string
  zoom: string
  zoomFit: string
  frameCount: string
  selection: string
  gridSelection: string
  none: string
  instructions: string
  toolAddState: string
  toolEditState: string
  notLoaded: string
  loadedOk: string
  loadFailed: string
  detectNeedImage: string
  detectDone: string
  calibrateNeedAlpha: string
  calibrateDoneX: string
  calibrateDoneY: string
  addedBox: string
  deletedBox: string
  needSelect: string
  clearedBoxes: string
  noExportSlices: string
  exportPreparingGrid: string
  exportPreparingSprites: string
  exportDoneGrid: string
  exportDoneSprites: string
  uploadRemoved: string
  previewUpdated: string
  zoomSwitchedFit: string
  zoomSwitchedPct: string
  resolutionShown: string
  resolutionHidden: string
  resolutionFontUpdated: string
}

const UI_TEXT: Record<Lang, UiText> = {
  zh: {
    moduleTitle: '零散切图',
    moduleLead: '上传单张图后，自动识别零散区域并在画布上手动增删改框，按顺序与名称批量打包导出。',
    uploadTitle: '源图',
    uploadHint: '点击、拖入或从暂存区拖入 PNG / JPG / WebP',
    uploadSubHint: '仅在本机处理，素材副本保存在当前项目。',
    demo: '加载演示图',
    clearImage: '清空图片',
    exportTitle: '导出',
    exportFormat: '格式',
    exportQuality: '质量',
    exportNames: '文件名列表',
    exportNamesPlaceholder: '如：idle, attack, hit 或按行填写角色名',
    exportOrder: '排序',
    exportOrderRow: '按行，从左到右',
    exportOrderCol: '按列，从上到下',
    exportNamePerRow: '按行命名',
    modeGrid: '网格切图',
    modeSprites: '零散切图',
    gridTitle: '固定行列切图',
    spriteTitle: '识别并编辑零散区域',
    cols: '列数',
    rows: '行数',
    gapX: 'Gap X',
    gapY: 'Gap Y',
    offsetX: 'Offset X',
    offsetY: 'Offset Y',
    updatePreview: '更新预览',
    calibrateX: '校准 X',
    calibrateY: '校准 Y',
    downloadGridZip: '下载网格 ZIP',
    detectMode: '识别模式',
    detectModeAuto: '自动',
    detectModeAlpha: 'Alpha',
    detectModeColorKey: '色键',
    colorKey: '色键颜色',
    threshold: '阈值',
    mergeGap: '合并间距',
    minPixels: '最少像素',
    minSide: '最小边长',
    autoDetect: '自动识别',
    editTool: '编辑',
    addTool: '新增',
    deleteSelected: '删除当前',
    clearAll: '清空全部',
    selectedName: '当前选中名称',
    selectedNamePlaceholder: '可覆盖导出文件名',
    downloadSpriteZip: '下载零散 ZIP',
    statusTitle: '当前状态',
    statusDefault: '先加载图片，识别或手动添加零散框后预览与导出。',
    previewTitleIdle: '等待加载图片',
    previewTitleGrid: '网格切图预览',
    previewTitleSprites: '零散切图预览',
    showResolution: '显示尺寸',
    resolutionFontSize: '尺寸字号',
    zoom: '缩放',
    zoomFit: '自适应',
    frameCount: '框数量',
    selection: '当前选中',
    gridSelection: '网格',
    none: '-',
    instructions: '零散模式下，编辑工具可拖动或缩放已有框；新增工具可在画布上拖出一个新框。',
    toolAddState: '新增工具',
    toolEditState: '编辑工具',
    notLoaded: '未加载图片',
    loadedOk: '图片已加载，正在准备预览。',
    loadFailed: '图片加载失败。',
    detectNeedImage: '请先加载图片，再执行自动识别。',
    detectDone: '识别完成，共得到 {count} 个零散框。',
    calibrateNeedAlpha: '校准需要图片中存在可见像素。',
    calibrateDoneX: 'X 偏移已校准为 {value}。',
    calibrateDoneY: 'Y 偏移已校准为 {value}。',
    addedBox: '已新增一个零散框。',
    deletedBox: '已删除当前零散框。',
    needSelect: '请先选中一个零散框。',
    clearedBoxes: '已清空全部零散框。',
    noExportSlices: '当前模式下没有可导出的切片。',
    exportPreparingGrid: '正在准备导出 {count} 个网格切片。',
    exportPreparingSprites: '正在准备导出 {count} 个零散切片。',
    exportDoneGrid: '已导出 {count} 个网格切片。',
    exportDoneSprites: '已导出 {count} 个零散切片。',
    uploadRemoved: '已清空当前图片。',
    previewUpdated: '预览已更新。',
    zoomSwitchedFit: '预览已切换为自适应缩放。',
    zoomSwitchedPct: '预览已切换为 {value}%。',
    resolutionShown: '已显示框尺寸。',
    resolutionHidden: '已隐藏框尺寸。',
    resolutionFontUpdated: '尺寸字号已调整为 {value}。',
  },
  en: {
    moduleTitle: 'Scatter Slice',
    moduleLead: 'Load one image, detect scattered regions, edit boxes on the canvas, then export an ordered and named ZIP.',
    uploadTitle: 'Source',
    uploadHint: 'Click, drop, or drag from stash: PNG / JPG / WebP',
    uploadSubHint: 'Processed on this computer; selected copies are saved in the current project.',
    demo: 'Load demo',
    clearImage: 'Clear image',
    exportTitle: 'Export',
    exportFormat: 'Format',
    exportQuality: 'Quality',
    exportNames: 'File names',
    exportNamesPlaceholder: 'Example: idle, attack, hit or one name per row',
    exportOrder: 'Order',
    exportOrderRow: 'Row major',
    exportOrderCol: 'Column major',
    exportNamePerRow: 'Name by row',
    modeGrid: 'Grid Slice',
    modeSprites: 'Scatter Slice',
    gridTitle: 'Fixed grid slicing',
    spriteTitle: 'Detect and edit scattered regions',
    cols: 'Cols',
    rows: 'Rows',
    gapX: 'Gap X',
    gapY: 'Gap Y',
    offsetX: 'Offset X',
    offsetY: 'Offset Y',
    updatePreview: 'Refresh',
    calibrateX: 'Calibrate X',
    calibrateY: 'Calibrate Y',
    downloadGridZip: 'Download grid ZIP',
    detectMode: 'Detect mode',
    detectModeAuto: 'Auto',
    detectModeAlpha: 'Alpha',
    detectModeColorKey: 'Color key',
    colorKey: 'Key color',
    threshold: 'Threshold',
    mergeGap: 'Merge gap',
    minPixels: 'Min pixels',
    minSide: 'Min side',
    autoDetect: 'Auto detect',
    editTool: 'Edit',
    addTool: 'Add',
    deleteSelected: 'Delete current',
    clearAll: 'Clear all',
    selectedName: 'Selected name',
    selectedNamePlaceholder: 'Override exported file name',
    downloadSpriteZip: 'Download scatter ZIP',
    statusTitle: 'Status',
    statusDefault: 'Load an image, detect or draw scattered regions, then preview and export.',
    previewTitleIdle: 'Waiting for an image',
    previewTitleGrid: 'Grid preview',
    previewTitleSprites: 'Scatter preview',
    showResolution: 'Show size',
    resolutionFontSize: 'Label size',
    zoom: 'Zoom',
    zoomFit: 'Fit',
    frameCount: 'Boxes',
    selection: 'Selected',
    gridSelection: 'Grid',
    none: '-',
    instructions: 'In scatter mode, Edit moves or resizes the active box; Add lets you drag out a new box.',
    toolAddState: 'Add tool',
    toolEditState: 'Edit tool',
    notLoaded: 'No image loaded',
    loadedOk: 'Image loaded. Preparing preview.',
    loadFailed: 'Failed to load image.',
    detectNeedImage: 'Load an image before running auto-detect.',
    detectDone: 'Detection finished. Found {count} boxes.',
    calibrateNeedAlpha: 'Calibration requires visible pixels in the image.',
    calibrateDoneX: 'X offset calibrated to {value}.',
    calibrateDoneY: 'Y offset calibrated to {value}.',
    addedBox: 'Added one scatter box.',
    deletedBox: 'Deleted the current scatter box.',
    needSelect: 'Select a scatter box first.',
    clearedBoxes: 'Cleared all scatter boxes.',
    noExportSlices: 'No slices available to export in the current mode.',
    exportPreparingGrid: 'Preparing {count} grid slices for export.',
    exportPreparingSprites: 'Preparing {count} scatter slices for export.',
    exportDoneGrid: 'Exported {count} grid slices.',
    exportDoneSprites: 'Exported {count} scatter slices.',
    uploadRemoved: 'Current image cleared.',
    previewUpdated: 'Preview updated.',
    zoomSwitchedFit: 'Zoom switched to fit.',
    zoomSwitchedPct: 'Zoom switched to {value}%.',
    resolutionShown: 'Box sizes are visible.',
    resolutionHidden: 'Box sizes are hidden.',
    resolutionFontUpdated: 'Label size set to {value}.',
  },
  ja: {
    moduleTitle: '零散切り出し',
    moduleLead: '画像から散在する領域を検出し、キャンバスで枠を編集して、順序と名前を指定した ZIP に書き出します。',
    uploadTitle: '元画像',
    uploadHint: 'クリック・ドロップ・スタッシュから PNG / JPG / WebP',
    uploadSubHint: 'このコンピュータで処理し、選択した画像のコピーをプロジェクトに保存します。',
    demo: 'デモ読込',
    clearImage: '画像をクリア',
    exportTitle: '書き出し',
    exportFormat: '形式',
    exportQuality: '品質',
    exportNames: 'ファイル名一覧',
    exportNamesPlaceholder: '例: idle, attack, hit または行ごとに名前',
    exportOrder: '順序',
    exportOrderRow: '行優先',
    exportOrderCol: '列優先',
    exportNamePerRow: '行ごと命名',
    modeGrid: 'グリッド切り出し',
    modeSprites: '零散切り出し',
    gridTitle: '固定行列で分割',
    spriteTitle: '零散領域を検出して編集',
    cols: '列数',
    rows: '行数',
    gapX: 'Gap X',
    gapY: 'Gap Y',
    offsetX: 'Offset X',
    offsetY: 'Offset Y',
    updatePreview: 'プレビュー更新',
    calibrateX: 'X 補正',
    calibrateY: 'Y 補正',
    downloadGridZip: 'グリッド ZIP',
    detectMode: '検出モード',
    detectModeAuto: '自動',
    detectModeAlpha: 'Alpha',
    detectModeColorKey: '色キー',
    colorKey: 'キー色',
    threshold: 'しきい値',
    mergeGap: '結合距離',
    minPixels: '最小ピクセル数',
    minSide: '最小辺',
    autoDetect: '自動検出',
    editTool: '編集',
    addTool: '追加',
    deleteSelected: '現在を削除',
    clearAll: '全削除',
    selectedName: '選択名',
    selectedNamePlaceholder: '書き出し名を上書き',
    downloadSpriteZip: '零散 ZIP',
    statusTitle: '状態',
    statusDefault: '画像を読み込み、領域を検出または手動追加して、プレビューと書き出しを行ってください。',
    previewTitleIdle: '画像を待機中',
    previewTitleGrid: 'グリッドプレビュー',
    previewTitleSprites: '零散プレビュー',
    showResolution: 'サイズ表示',
    resolutionFontSize: '文字サイズ',
    zoom: '拡大率',
    zoomFit: '自動',
    frameCount: '枠数',
    selection: '選択中',
    gridSelection: 'グリッド',
    none: '-',
    instructions: '零散モードでは、編集ツールで現在の枠を移動・拡縮し、追加ツールで新しい枠をドラッグ作成します。',
    toolAddState: '追加ツール',
    toolEditState: '編集ツール',
    notLoaded: '画像未読込',
    loadedOk: '画像を読み込みました。プレビューを準備中です。',
    loadFailed: '画像の読込に失敗しました。',
    detectNeedImage: '自動検出の前に画像を読み込んでください。',
    detectDone: '検出完了。{count} 個の枠を取得しました。',
    calibrateNeedAlpha: '補正には可視ピクセルが必要です。',
    calibrateDoneX: 'X オフセットを {value} に補正しました。',
    calibrateDoneY: 'Y オフセットを {value} に補正しました。',
    addedBox: '零散枠を 1 つ追加しました。',
    deletedBox: '現在の零散枠を削除しました。',
    needSelect: '先に零散枠を選択してください。',
    clearedBoxes: '零散枠をすべて削除しました。',
    noExportSlices: '現在のモードでは書き出せる切片がありません。',
    exportPreparingGrid: '{count} 個のグリッド切片を準備中です。',
    exportPreparingSprites: '{count} 個の零散切片を準備中です。',
    exportDoneGrid: '{count} 個のグリッド切片を書き出しました。',
    exportDoneSprites: '{count} 個の零散切片を書き出しました。',
    uploadRemoved: '現在の画像をクリアしました。',
    previewUpdated: 'プレビューを更新しました。',
    zoomSwitchedFit: '拡大率を自動に切り替えました。',
    zoomSwitchedPct: '拡大率を {value}% に切り替えました。',
    resolutionShown: '枠サイズを表示しました。',
    resolutionHidden: '枠サイズを非表示にしました。',
    resolutionFontUpdated: '文字サイズを {value} にしました。',
  },
}

const PANEL_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(245,239,231,0.94))',
  border: '1px solid rgba(125, 83, 48, 0.16)',
  boxShadow: '0 16px 42px rgba(89, 58, 29, 0.12)',
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number) {
  return Math.round(value)
}

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `slice-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sanitizeFileName(value: string | undefined, fallback: string) {
  const cleaned = String(value || '')
    .trim()
    .split('').map(character=>character.charCodeAt(0)<32?'-':character).join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || fallback
}

function normalizeRect(a: Point, b: Point): SliceBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(a.x - b.x)
  const h = Math.abs(a.y - b.y)
  return { id: makeId(), x, y, w, h, name: '' }
}

function hitHandle(box: SliceBox, point: Point, displayScale: number): ResizeHandle | null {
  const hitRadius = 8 / Math.max(displayScale, 0.1)
  const handles: Array<{ name: ResizeHandle; x: number; y: number }> = [
    { name: 'nw', x: box.x, y: box.y },
    { name: 'ne', x: box.x + box.w, y: box.y },
    { name: 'sw', x: box.x, y: box.y + box.h },
    { name: 'se', x: box.x + box.w, y: box.y + box.h },
  ]
  return handles.find((handle) => Math.abs(handle.x - point.x) <= hitRadius && Math.abs(handle.y - point.y) <= hitRadius)?.name ?? null
}

function resizeSprite(origin: SliceBox, handle: ResizeHandle, point: Point, image: LoadedImageInfo): SliceBox {
  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.w
  let bottom = origin.y + origin.h

  if (handle.includes('n')) top = point.y
  if (handle.includes('s')) bottom = point.y
  if (handle.includes('w')) left = point.x
  if (handle.includes('e')) right = point.x

  const x = clamp(Math.min(left, right), 0, image.width-1)
  const y = clamp(Math.min(top, bottom), 0, image.height-1)
  const w = clamp(Math.abs(right - left), 1, image.width - x)
  const h = clamp(Math.abs(bottom - top), 1, image.height - y)
  return { ...origin, x, y, w, h }
}

function formatText(template: string, params?: Record<string, string | number>) {
  let output = template
  if (!params) return output
  for (const [key, value] of Object.entries(params)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
  }
  return output
}

export default function RoninProScatterSlice() {
  const { lang } = useLanguage()
  const text = UI_TEXT[lang]
  const [messageApi, contextHolder] = message.useMessage()

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const displayMetricsRef = useRef<DisplayMetrics>({ scale: 1, pixelRatio: 1 })

  const model=useScatterDocument(),{settings,source:uploadFile,info:imageInfo,boxes:sprites,selectedId}=model.draft
  const {tool,format,quality,namesText,order,namePerRow,detect,zoom,showResolution,resolutionFontSize}=settings
  const setSprites=model.boxes,setSelectedId=model.select,setting=model.setting
  const setTool=(v:ToolMode)=>setting('tool',v),setFormat=(v:ExportFormat)=>setting('format',v),setQuality=(v:number)=>setting('quality',v)
  const setNamesText=(v:string)=>setting('namesText',v),setOrder=(v:OrderMode)=>setting('order',v),setNamePerRow=(v:boolean)=>setting('namePerRow',v)
  const setDetect=(v:DetectConfig|((old:DetectConfig)=>DetectConfig))=>setting('detect',v),setZoom=(v:'fit'|'1'|'2'|'4'|'8')=>setting('zoom',v)
  const setShowResolution=(v:boolean)=>setting('showResolution',v),setResolutionFontSize=(v:number)=>setting('resolutionFontSize',v)
  const retainedFiles=model.retained,dispatch=model.dispatch
  const retainedBytes=useCallback(()=>96*1024**2+[...retainedFiles()].reduce((sum,file)=>sum+file.size*2,0),[retainedFiles])
  const source=useScatterSource(uploadFile,retainedBytes)
  const sourceSizeChanged=!!(source.raster&&imageInfo&&(source.raster.width!==imageInfo.width||source.raster.height!==imageInfo.height))
  const raster=sourceSizeChanged?null:source.raster
  const [busy,setBusy]=useState<'detect'|'export'|null>(null),[progress,setProgress]=useState(0),[canceling,setCanceling]=useState(false),[preparing,setPreparing]=useState(false)
  const controller=useRef<AbortController|null>(null),incoming=useRef<{controller:AbortController;promise:Promise<void>}|null>(null),alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;incoming.current?.controller.abort()}},[])
  const [statusText, setStatusText] = useState('')
  const [interaction, setInteraction] = useState<InteractionState>(null)

  const setStatus = useCallback((value: string) => {
    setStatusText(value)
  }, [])

  const selectedSprite = useMemo(
    () => sprites.find((sprite) => sprite.id === selectedId) ?? null,
    [sprites, selectedId],
  )

  const selectedName=selectedSprite?.name??''
  const orderedBoxes=useCallback((boxes:SliceBox[])=>orderedScatterBoxes(boxes,order),[order])

  const currentBoxes = useMemo(() => orderedBoxes(sprites), [orderedBoxes, sprites])
  const currentExport=useMemo(()=>{
    if(!imageInfo||!sprites.length)return null
    // Incomplete names are editable; execution displays the validation error.
    try{return reviewScatterExport({boxes:sprites,format,quality,namesText,namePerRow,order},imageInfo.width,imageInfo.height)}catch{return null}
  },[imageInfo,sprites,format,quality,namesText,namePerRow,order])
  const archiveReport=model.draft.archive?scatterReports.get(model.draft.archive.report):undefined
  const archiveParameters=archiveReport?.parameters as {layout?:unknown}|undefined
  const archiveOutdated=model.draft.archive&&(!currentExport||JSON.stringify(currentExport)!==JSON.stringify(archiveParameters?.layout))

  const currentSelectionLabel = useMemo(() => {
    const index = sprites.findIndex((sprite) => sprite.id === selectedId)
    return index >= 0 ? `#${index + 1}` : text.none
  }, [selectedId, sprites, text.none])

  const stageTitle = imageInfo ? text.previewTitleSprites : text.previewTitleIdle

  const pointFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
      const canvas = overlayCanvasRef.current
      if (!canvas || !imageInfo) return null
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      return {
        x: clamp((event.clientX - rect.left) * (imageInfo.width / rect.width), 0, imageInfo.width),
        y: clamp((event.clientY - rect.top) * (imageInfo.height / rect.height), 0, imageInfo.height),
      }
    },
    [imageInfo],
  )

  const hitSprite = useCallback(
    (point: Point) => {
      for (let index = sprites.length - 1; index >= 0; index -= 1) {
        const sprite = sprites[index]!
        if (
          point.x >= sprite.x &&
          point.x <= sprite.x + sprite.w &&
          point.y >= sprite.y &&
          point.y <= sprite.y + sprite.h
        ) {
          return sprite
        }
      }
      return null
    },
    [sprites],
  )

  const renderAll = useCallback(() => {
    const imageCanvas = imageCanvasRef.current
    const overlayCanvas = overlayCanvasRef.current
    const wrap = wrapRef.current
    if (!imageCanvas || !overlayCanvas || !wrap) return

    const imageCtx = imageCanvas.getContext('2d')
    const overlayCtx = overlayCanvas.getContext('2d')
    if (!imageCtx || !overlayCtx) return

    if (!imageInfo) {
      imageCanvas.width = 1
      imageCanvas.height = 1
      overlayCanvas.width = 1
      overlayCanvas.height = 1
      imageCanvas.style.width = '1px'
      imageCanvas.style.height = '1px'
      overlayCanvas.style.width = '1px'
      overlayCanvas.style.height = '1px'
      return
    }

    const wrapRect = wrap.getBoundingClientRect()
    const maxWidth = Math.max(80, wrapRect.width)
    const maxHeight = Math.max(80, wrapRect.height)
    const fitScale = Math.min(maxWidth / imageInfo.width, maxHeight / imageInfo.height, 8)
    const selectedScale = zoom === 'fit' ? fitScale : Number(zoom)
    const scale = Math.min(selectedScale, fitScale)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3)
    const displayWidth = Math.max(1, Math.round(imageInfo.width * scale))
    const displayHeight = Math.max(1, Math.round(imageInfo.height * scale))
    displayMetricsRef.current = { scale, pixelRatio }

    ;[imageCanvas, overlayCanvas].forEach((canvas) => {
      canvas.width = Math.max(1, Math.round(displayWidth * pixelRatio))
      canvas.height = Math.max(1, Math.round(displayHeight * pixelRatio))
      canvas.style.width = `${displayWidth}px`
      canvas.style.height = `${displayHeight}px`
      canvas.style.imageRendering = scale >= 2 ? 'pixelated' : 'auto'
      canvas.style.gridArea = '1 / 1'
      canvas.style.maxWidth = '100%'
      canvas.style.maxHeight = '100%'
    })

    imageCtx.setTransform(1, 0, 0, 1, 0, 0)
    imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height)
    imageCtx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0)
    imageCtx.imageSmoothingEnabled = scale < 2
    if(raster?.bitmap.width)imageCtx.drawImage(raster.bitmap,0,0,imageInfo.width,imageInfo.height)

    overlayCtx.setTransform(1, 0, 0, 1, 0, 0)
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    overlayCtx.save()
    overlayCtx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0)
    overlayCtx.lineJoin = 'round'
    currentBoxes.forEach((box, index) => {
      const selected = box.id === selectedId
      overlayCtx.fillStyle = selected ? 'rgba(26, 116, 95, 0.24)' : 'rgba(26, 116, 95, 0.12)'
      overlayCtx.strokeStyle = selected ? '#fef2dc' : 'rgba(44, 63, 57, 0.92)'
      overlayCtx.lineWidth = Math.max(1, (selected ? 2.2 : 1.4) / scale)
      overlayCtx.beginPath()
      overlayCtx.rect(box.x, box.y, box.w, box.h)
      overlayCtx.fill()
      overlayCtx.stroke()

      overlayCtx.font = `700 ${Math.max(11, 14 / scale)}px ui-monospace, "SFMono-Regular", Consolas, monospace`
      overlayCtx.lineWidth = Math.max(2, 3 / scale)
      overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
      overlayCtx.strokeText(String(index + 1), box.x + 4 / scale, box.y + 15 / scale)
      overlayCtx.fillStyle = selected ? '#fff7e1' : 'rgba(44, 63, 57, 0.95)'
      overlayCtx.fillText(String(index + 1), box.x + 4 / scale, box.y + 15 / scale)

      if (showResolution) {
        const fontSize = resolutionFontSize / scale
        overlayCtx.fillStyle = selected ? '#ffb3ad' : '#c43a2f'
        overlayCtx.font = `${fontSize}px ui-monospace, "SFMono-Regular", Consolas, monospace`
        overlayCtx.fillText(`${box.w} x ${box.h}`, box.x + 4 / scale, box.y + (resolutionFontSize + 14) / scale)
      }

      if (selected) {
        const size = 7 / Math.max(scale, 0.1)
        const drawHandle = (x: number, y: number) => {
          overlayCtx.beginPath()
          overlayCtx.rect(x - size / 2, y - size / 2, size, size)
          overlayCtx.fillStyle = '#fff8e0'
          overlayCtx.strokeStyle = 'rgba(25, 33, 31, 0.9)'
          overlayCtx.lineWidth = Math.max(1, 1.25 / scale)
          overlayCtx.fill()
          overlayCtx.stroke()
        }
        drawHandle(box.x, box.y)
        drawHandle(box.x + box.w, box.y)
        drawHandle(box.x, box.y + box.h)
        drawHandle(box.x + box.w, box.y + box.h)
      }
    })

    if (interaction?.type === 'add') {
      const previewBox = interaction.previewBox
      overlayCtx.strokeStyle = '#d78a25'
      overlayCtx.lineWidth = Math.max(1, 2 / scale)
      overlayCtx.setLineDash([8 / scale, 6 / scale])
      overlayCtx.strokeRect(previewBox.x, previewBox.y, previewBox.w, previewBox.h)
      overlayCtx.setLineDash([])
    }

    overlayCtx.restore()
  }, [
    currentBoxes,
    raster,
    imageInfo,
    interaction,
    resolutionFontSize,
    selectedId,
    showResolution,
    zoom,
  ])

  useEffect(() => {
    renderAll()
  }, [renderAll])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => renderAll())
    observer.observe(wrap)
    const onResize = () => renderAll()
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [renderAll])

  const interactionRef=useRef(interaction),finishRef=useRef<()=>void>(()=>{})
  const beforeAction=useCallback(async()=>{flushSync(()=>finishRef.current());await incoming.current?.promise;dispatch({type:'end'})},[dispatch])
  const hasPendingEdits=useCallback(()=>interactionRef.current!==null||incoming.current!==null,[])
  const clearImage=()=>{
    incoming.current?.controller.abort()
    model.change(draft=>({...draft,source:null,info:null,boxes:[],selectedId:null,detection:null,archive:null}))
    setInteraction(null);setStatus(text.uploadRemoved)
  }
  const applyLoadedImage=(file:File)=>{
    incoming.current?.controller.abort()
    const operation={controller:new AbortController(),promise:Promise.resolve()};incoming.current=operation;setPreparing(true)
    const work=(async()=>{
      const before=model.current()
      const prepared=await prepareFineInput(file,retainedBytes())
      operation.controller.signal.throwIfAborted()
      const next=await scatterSourceWorker(file,prepared.memoryBudgetBytes,retainedBytes(),operation.controller.signal)
      if(!alive.current||operation.controller.signal.aborted||incoming.current!==operation||model.current()!==before){next.bitmap.close();if(alive.current&&!operation.controller.signal.aborted)messageApi.warning(lang==='zh'?'文档已改变，请重新选择素材':lang==='ja'?'文書が変わりました。素材を選び直してください':'The document changed; select the image again');return}
      const color='#'+next.color.slice(0,3).map(value=>value.toString(16).padStart(2,'0')).join('')
      source.accept(next)
      model.change(draft=>({...draft,source:file,info:{width:next.width,height:next.height,fileNameBase:file.name.replace(/\.[^.]+$/,'')||'scatter-slice'},boxes:[],selectedId:null,detection:null,archive:null,settings:{...draft.settings,tool:'edit',detect:{...draft.settings.detect,colorKey:color}}}))
      setInteraction(null);setStatus(text.loadedOk)
    })().catch(error=>{if(alive.current&&!operation.controller.signal.aborted){messageApi.error(String(error));setStatus(`${text.loadFailed} ${String(error)}`)}})
    // Stop waiting immediately when a selection is canceled. A source import
    // already accepted by the project remains an immutable input copy.
    const canceled=new Promise<void>(resolve=>operation.controller.signal.addEventListener('abort',()=>resolve(),{once:true}))
    operation.promise=Promise.race([work,canceled]).finally(()=>{if(incoming.current===operation){incoming.current=null;if(alive.current)setPreparing(false)}})
    return operation.promise
  }
  const runTask=async(mode:'detect'|'export')=>{
    if(controller.current||!raster||preparing)return
    const abort=new AbortController();controller.current=abort;setBusy(mode);setProgress(0);setCanceling(false)
    try{
      await beforeAction();abort.signal.throwIfAborted()
      const before=model.current();if(!before.source||!before.info)return
      const operation=mode==='detect'?'image.scatterDetect':'image.scatterExport'
      const parameters=mode==='detect'?{detect:before.settings.detect,order:before.settings.order}:{layout:reviewScatterExport({boxes:before.boxes,format:before.settings.format,quality:before.settings.quality,namesText:before.settings.namesText,namePerRow:before.settings.namePerRow,order:before.settings.order},before.info.width,before.info.height)}
      const completed=await runManagedTask(operation,[before.source],{...parameters,renderer:'browser-worker',frontendBytes:retainedBytes()},{signal:abort.signal,onProgress:value=>{if(alive.current)setProgress(old=>Math.max(old,value))},outputFilter:()=>alive.current})
      if(!alive.current)return
      if(model.current()!==before){messageApi.warning(lang==='zh'?'编辑已改变，结果保留在项目中':lang==='ja'?'編集が変わりました。結果はプロジェクトに保存されています':'Edits changed; results remain in Project assets');return}
      if(completed.outputs.length!==2)throw new Error('SCATTER_RESULT_COUNT')
      const files=completed.outputs.map((output,index)=>{
        const file=new File([output.blob],index===1?'scatter-report.json':mode==='detect'?'scatter-detection.json':'scatter-slices.zip',{type:index===0&&mode==='export'?'application/zip':'application/json'})
        imageToolMetadata.set(file,output.version);cacheManagedInput(file,completed.project.id,output.version.id);return file
      })
      const result={data:files[0],report:files[1],taskId:completed.taskId},report=JSON.parse(await files[1].text())
      if(report.operation!==operation)throw new Error('SCATTER_REPORT_OPERATION')
      scatterReports.set(files[1],report)
      let boxes:SliceBox[]|undefined
      if(mode==='detect'){
        const data=JSON.parse(await files[0].text())
        if(data.formatVersion!==1||data.width!==before.info.width||data.height!==before.info.height)throw new Error('SCATTER_DETECTION_DIMENSIONS')
        validateScatterBoxes(data.boxes,data.width,data.height);boxes=data.boxes
      }
      abort.signal.throwIfAborted();if(!alive.current||model.current()!==before)return
      model.change(draft=>mode==='detect'?{...draft,boxes:boxes!,selectedId:boxes![0]?.id??null,detection:result,settings:{...draft.settings,tool:'edit'}}:{...draft,archive:result})
      if(mode==='detect')setStatus(formatText(text.detectDone,{count:boxes!.length}))
      else{
        const url=URL.createObjectURL(result.data),link=document.createElement('a');link.href=url;link.download=sanitizeFileName(before.info.fileNameBase,'scatter-slice')+'-sprites.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
        setStatus(formatText(text.exportDoneSprites,{count:report.exportedSlices}));messageApi.success(formatText(text.exportDoneSprites,{count:report.exportedSlices}))
      }
    }catch(error){if(alive.current){
      if(error instanceof DOMException&&error.name==='AbortError'){
        const label=lang==='zh'?'加工已取消':lang==='ja'?'処理を取り消しました':'Processing canceled';messageApi.info(label);setStatus(label)
      }else{
        const raw=String(error),label=raw.includes('FILENAME_COLLISION')?lang==='zh'?'切片名称重复或过长，请修改后导出。':lang==='ja'?'ファイル名が重複しているか長すぎます。修正して再実行してください。':'Slice filenames collide or are too long. Rename them before exporting.':raw
        messageApi.error(label);setStatus(label)
      }
    }}
    finally{controller.current=null;if(alive.current){setBusy(null);setCanceling(false)}}
  }
  const detectSprites=()=>{void runTask('detect')}
  const downloadZip=()=>runTask('export')
  const downloadArchive=()=>{
    if(!model.draft.archive||!imageInfo)return
    const url=URL.createObjectURL(model.draft.archive.data),link=document.createElement('a');link.href=url;link.download=sanitizeFileName(imageInfo.fileNameBase,'scatter-slice')+'-sprites.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const cancelTask=()=>{if(controller.current){setCanceling(true);controller.current.abort()}}

  const updateSelectedName = useCallback(
    (value: string) => {
      setSprites((prev) => prev.map((item) => (item.id === selectedId ? { ...item, name: value } : item)))
    },
    [selectedId,setSprites],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!imageInfo||!raster||busy) return
      const point = pointFromEvent(event)
      if (!point) return
      if(tool==='add'&&sprites.length>=MAX_SCATTER_BOXES){
        setStatus(lang==='zh'?'最多保留 4096 个切片框，请先删除部分画框。':lang==='ja'?'枠は 4096 個までです。枠を削除してから追加してください。':'Use at most 4096 slice boxes. Delete a box before adding another.')
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      if (tool === 'add') {
        setInteraction({ type: 'add', start: point, previewBox: { id: makeId(), x: point.x, y: point.y, w: 0, h: 0, name: '' } })
        return
      }
      const currentSelected = sprites.find((sprite) => sprite.id === selectedId) ?? null
      const handle = currentSelected ? hitHandle(currentSelected, point, displayMetricsRef.current.scale) : null
      if (currentSelected && handle) {
        setInteraction({ type: 'resize', handle, origin: { ...currentSelected } })
        return
      }
      const hit = hitSprite(point)
      if (hit) {
        setSelectedId(hit.id)
        setInteraction({ type: 'move', start: point, origin: { ...hit } })
      } else {
        setSelectedId(null)
        setInteraction(null)
      }
    },
    [hitSprite, imageInfo, pointFromEvent, selectedId, sprites, tool,raster,busy,setSelectedId,lang,setStatus],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!imageInfo || !interaction) return
      const point = pointFromEvent(event)
      if (!point) return
      if (interaction.type === 'add') {
        setInteraction({ ...interaction, previewBox: normalizeRect(interaction.start, point) })
        return
      }
      if (interaction.type === 'move') {
        const dx = point.x - interaction.start.x
        const dy = point.y - interaction.start.y
        setSprites((prev) =>
          prev.map((item) =>
            item.id === selectedId
              ? {
                  ...item,
                  x: clamp(interaction.origin.x + dx, 0, imageInfo.width - interaction.origin.w),
                  y: clamp(interaction.origin.y + dy, 0, imageInfo.height - interaction.origin.h),
                }
              : item,
          ),
        )
        return
      }
      if (interaction.type === 'resize') {
        setSprites((prev) =>
          prev.map((item) => (item.id === selectedId ? resizeSprite(interaction.origin, interaction.handle, point, imageInfo) : item)),
        )
      }
    },
    [imageInfo, interaction, pointFromEvent, selectedId,setSprites],
  )

  const handlePointerUp = useCallback(() => {
    if (interaction?.type === 'add') {
      const { x, y, w, h } = interaction.previewBox
      if (w >= 4 && h >= 4) {
        const left=clamp(round(x),0,imageInfo!.width-1),top=clamp(round(y),0,imageInfo!.height-1)
        const nextBox: SliceBox = { id: makeId(), x:left,y:top,w:clamp(round(w),1,imageInfo!.width-left),h:clamp(round(h),1,imageInfo!.height-top),kind:'sprite',name:'' }
        setSprites((prev) => [...prev, nextBox])
        setSelectedId(nextBox.id)
        setStatus(text.addedBox)
      }
    }
    setInteraction(null)
  }, [interaction, setStatus, text.addedBox,setSprites,setSelectedId,imageInfo])

  useLayoutEffect(()=>{interactionRef.current=interaction;finishRef.current=handlePointerUp},[interaction,handlePointerUp])

  const uploadFileList = uploadFile
    ? ([{ uid: 'scatter-source', name: uploadFile.name, originFileObj: uploadFile }] as UploadFile[])
    : []

  return (
    <ScatterDocumentSurface model={model} beforeAction={beforeAction} hasPendingEdits={hasPendingEdits}><div style={{ width: '100%' }}>
      {contextHolder}
      {(busy||preparing||source.loading)&&<Space style={{marginBottom:12}}><Progress percent={Math.round(progress*100)} style={{width:180}}/><Button loading={canceling} onClick={()=>{if(busy)cancelTask();else if(preparing)incoming.current?.controller.abort();else source.cancel()}}>{lang==='zh'?'取消加工':lang==='ja'?'処理を取消':'Cancel processing'}</Button></Space>}
      {(source.error||sourceSizeChanged)&&<Space><Text role="alert">{sourceSizeChanged?'SCATTER_SOURCE_SIZE_CHANGED':source.error}</Text><Button onClick={source.retry}>{lang==='zh'?'重试预览':lang==='ja'?'再試行':'Retry preview'}</Button></Space>}
      <div style={{ marginBottom: 18 }}>
        <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>{text.moduleTitle}</Title>
        <Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 860, lineHeight: 1.7 }}>
          {text.moduleLead}
        </Paragraph>
      </div>

      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Row gutter={[18, 18]}>
          <Col span={24}>
            <Card styles={{ body: { padding: 14 } }} style={PANEL_STYLE}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
                  <div>
                    <Text strong>{text.uploadTitle}</Text>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>{text.uploadSubHint}</Text>
                    </div>
                  </div>
                  <Space wrap size={[8, 8]}>
                    <Button size="small" onClick={clearImage} disabled={!imageInfo}>{text.clearImage}</Button>
                  </Space>
                </div>
                <StashDropZone onStashDrop={applyLoadedImage}>
                  <Dragger
                    accept=".png,.jpg,.jpeg,.webp"
                    maxCount={1}
                    multiple={false}
                    beforeUpload={(file) => {
                      void applyLoadedImage(file)
                      return false
                    }}
                    onRemove={() => {
                      clearImage()
                      return true
                    }}
                    fileList={uploadFileList}
                    style={{ padding: '2px 0' }}
                  >
                    <p className="ant-upload-drag-icon" style={{ marginBottom: 8 }}><UploadOutlined /></p>
                    <p className="ant-upload-text" style={{ marginBottom: 0, fontSize: 13 }}>{text.uploadHint}</p>
                  </Dragger>
                </StashDropZone>

                <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid rgba(110, 79, 47, 0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    <Text strong>{text.spriteTitle}</Text>
                    <Text type="secondary">{tool === 'add' ? text.toolAddState : text.toolEditState}</Text>
                  </div>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.detectMode}</Text>
                      <Select
                        aria-label={text.detectMode}
                        value={detect.mode}
                        onChange={(value) => setDetect((prev) => ({ ...prev, mode: value }))}
                        style={{ width: '100%', marginTop: 6 }}
                        options={[
                          { value: 'auto', label: text.detectModeAuto },
                          { value: 'alpha', label: text.detectModeAlpha },
                          { value: 'colorkey', label: text.detectModeColorKey },
                        ]}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.colorKey}</Text>
                      <Input
                        type="color"
                        aria-label={text.colorKey}
                        value={detect.colorKey}
                        onChange={(e) => setDetect((prev) => ({ ...prev, colorKey: e.target.value }))}
                        style={{ width: '100%', marginTop: 6, padding: 4, height: 32 }}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.selectedName}</Text>
                      <Input
                        aria-label={text.selectedName}
                        maxLength={1000}
                        value={selectedName}
                        onChange={(e) => updateSelectedName(e.target.value)}
                        placeholder={text.selectedNamePlaceholder}
                        style={{ marginTop: 6 }}
                        disabled={!selectedSprite}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.threshold}</Text>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <Slider
                          min={1}
                          max={120}
                          value={detect.threshold}
                          onChange={(value) => setDetect((prev) => ({ ...prev, threshold: Array.isArray(value) ? value[0] ?? prev.threshold : value }))}
                          style={{ flex: 1, margin: 0 }}
                        />
                        <Text style={{ minWidth: 24, textAlign: 'right' }}>{detect.threshold}</Text>
                      </div>
                    </Col>
                    <Col xs={24} md={12}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.mergeGap}</Text>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <Slider
                          min={0}
                          max={24}
                          value={detect.mergeGap}
                          onChange={(value) => setDetect((prev) => ({ ...prev, mergeGap: Array.isArray(value) ? value[0] ?? prev.mergeGap : value }))}
                          style={{ flex: 1, margin: 0 }}
                        />
                        <Text style={{ minWidth: 24, textAlign: 'right' }}>{detect.mergeGap}</Text>
                      </div>
                    </Col>
                    <Col xs={12} md={6}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.minPixels}</Text>
                      <InputNumber
                        min={1} max={900000000} precision={0} aria-label={text.minPixels}
                        value={detect.minPixels}
                        onChange={(v) => setDetect((prev) => ({ ...prev, minPixels: Math.max(1, Number(v) || 1) }))}
                        style={{ width: '100%', marginTop: 6 }}
                      />
                    </Col>
                    <Col xs={12} md={6}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{text.minSide}</Text>
                      <InputNumber
                        min={1} max={30000} precision={0} aria-label={text.minSide}
                        value={detect.minSide}
                        onChange={(v) => setDetect((prev) => ({ ...prev, minSide: Math.max(1, Number(v) || 1) }))}
                        style={{ width: '100%', marginTop: 6 }}
                      />
                    </Col>
                    <Col xs={24} md={12} style={{ display: 'flex', alignItems: 'end' }}>
                      <Space wrap>
                        <Button disabled={!raster||!!busy||preparing} loading={busy==='detect'} onClick={detectSprites}>{text.autoDetect}</Button>
                        <Button type={tool === 'edit' ? 'primary' : 'default'} icon={<EditOutlined />} onClick={() => setTool('edit')}>
                          {text.editTool}
                        </Button>
                        <Button type={tool === 'add' ? 'primary' : 'default'} icon={<PlusOutlined />} onClick={() => setTool('add')}>
                          {text.addTool}
                        </Button>
                        <Button
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            if (!selectedId) {
                              messageApi.warning(text.needSelect)
                              setStatus(text.needSelect)
                              return
                            }
                            const remaining = sprites.filter((item) => item.id !== selectedId)
                            model.change(draft=>({...draft,boxes:remaining,selectedId:remaining[0]?.id??null}))
                            setStatus(text.deletedBox)
                          }}
                        >
                          {text.deleteSelected}
                        </Button>
                        <Button onClick={() => { model.change(draft=>({...draft,boxes:[],selectedId:null}));setStatus(text.clearedBoxes) }}>
                          {text.clearAll}
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[18, 18]}>
          <Col span={24}>
            <Card styles={{ body: { padding: 18 } }} style={{ ...PANEL_STYLE, minHeight: 760, background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,236,224,0.96))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', letterSpacing: 0.3 }}>{lang==='zh'?'预览':lang==='ja'?'プレビュー':'Preview'}</Text>
                <Title level={4} style={{ margin: '6px 0 0', fontSize: 28 }}>{stageTitle}</Title>
              </div>
              <Space wrap size={[12, 8]} style={{ justifyContent: 'flex-end' }}>
                <Checkbox checked={showResolution} onChange={(e) => { setShowResolution(e.target.checked); setStatus(e.target.checked ? text.resolutionShown : text.resolutionHidden) }}>{text.showResolution}</Checkbox>
                <div style={{ minWidth: 160 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{text.resolutionFontSize}</Text>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Slider
                      min={8}
                      max={48}
                      step={1}
                      value={resolutionFontSize}
                      onChange={(value) => {
                        const next = Array.isArray(value) ? value[0] ?? 16 : value
                        setResolutionFontSize(next)
                        setStatus(formatText(text.resolutionFontUpdated, { value: next }))
                      }}
                      style={{ flex: 1, margin: 0 }}
                    />
                    <Text style={{ minWidth: 24, textAlign: 'right' }}>{resolutionFontSize}</Text>
                  </div>
                </div>
                <div style={{ minWidth: 120 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{text.zoom}</Text>
                  <Select
                    aria-label={text.zoom}
                    value={zoom}
                    onChange={(value) => {
                      setZoom(value)
                      setStatus(value === 'fit' ? text.zoomSwitchedFit : formatText(text.zoomSwitchedPct, { value: Number(value) * 100 }))
                    }}
                    style={{ width: '100%', marginTop: 4 }}
                    options={[
                      { value: 'fit', label: text.zoomFit },
                      { value: '1', label: '100%' },
                      { value: '2', label: '200%' },
                      { value: '4', label: '400%' },
                      { value: '8', label: '800%' },
                    ]}
                  />
                </div>
                <div style={{ minWidth: 90, borderRadius: 16, padding: '8px 10px', background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(110, 79, 47, 0.12)' }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{text.frameCount}</Text>
                  <Text strong>{currentBoxes.length}</Text>
                </div>
                <div style={{ minWidth: 90, borderRadius: 16, padding: '8px 10px', background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(110, 79, 47, 0.12)' }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{text.selection}</Text>
                  <Text strong>{currentSelectionLabel}</Text>
                </div>
              </Space>
            </div>

            <div style={{ marginTop: 18, borderRadius: 26, minHeight: 620, position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.72)', background: 'linear-gradient(135deg, rgba(255,255,255,0.76), rgba(227,241,236,0.48)), linear-gradient(45deg, rgba(17,29,25,0.08) 25%, transparent 25%, transparent 50%, rgba(17,29,25,0.08) 50%, rgba(17,29,25,0.08) 75%, transparent 75%, transparent)', backgroundSize: 'auto, 24px 24px' }}>
              <div ref={wrapRef} style={{ position: 'absolute', inset: 18, display: 'grid', placeItems: 'center' }}>
                <canvas ref={imageCanvasRef} />
                <canvas
                  ref={overlayCanvasRef}
                  aria-label={text.previewTitleSprites}
                  tabIndex={0}
                  style={{ cursor: tool === 'add' ? 'crosshair' : 'default' }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />
              </div>
            </div>

            <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, lineHeight: 1.7 }}>{text.instructions}</Paragraph>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              {imageInfo ? `${imageInfo.width} x ${imageInfo.height}` : text.notLoaded}
            </Text>
          </Card>
          </Col>
        </Row>

        <Row gutter={[18, 18]}>
          <Col xs={24} xl={8}>
            <Card styles={{ body: { padding: 18 } }} style={PANEL_STYLE}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>{text.statusTitle}</Text>
                <Text type="secondary" style={{ lineHeight: 1.7 }}>{statusText||(imageInfo?(lang==='zh'?'已读取项目文档':lang==='ja'?'プロジェクト文書を読み込みました':'Project document loaded'):text.statusDefault)}</Text>
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={16}>
            <Card styles={{ body: { padding: 14 } }} style={PANEL_STYLE}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>{text.exportTitle}</Text>
                <Row gutter={[12, 10]}>
                  <Col xs={24} md={8}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{text.exportFormat}</Text>
                    <Select
                      aria-label={text.exportFormat}
                      value={format}
                      onChange={(value) => setFormat(value)}
                      style={{ width: '100%', marginTop: 4 }}
                      options={[
                        { value: 'png', label: 'PNG' },
                        { value: 'jpeg', label: 'JPEG' },
                        { value: 'webp', label: 'WebP' },
                      ]}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{text.exportOrder}</Text>
                    <Select
                      aria-label={text.exportOrder}
                      value={order}
                      onChange={(value) => setOrder(value)}
                      style={{ width: '100%', marginTop: 4 }}
                      options={[
                        { value: 'row-major', label: text.exportOrderRow },
                        { value: 'column-major', label: text.exportOrderCol },
                      ]}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{text.exportQuality}</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <Slider
                        min={0.4}
                        max={1}
                        step={0.01}
                        value={quality}
                        onChange={(value) => setQuality(Array.isArray(value) ? value[0] ?? 0.92 : value)}
                        style={{ flex: 1, margin: 0 }}
                      />
                      <Text style={{ minWidth: 36, textAlign: 'right' }}>{quality.toFixed(2)}</Text>
                    </div>
                  </Col>
                  <Col xs={24} md={16}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{text.exportNames}</Text>
                    <TextArea
                      maxLength={256*1024} aria-label={text.exportNames}
                      value={namesText}
                      onChange={(e) => setNamesText(e.target.value)}
                      rows={2}
                      placeholder={text.exportNamesPlaceholder}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col xs={24} md={8} style={{ display: 'flex', alignItems: 'end' }}>
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      {model.draft.archive&&<>
                        <Text type="secondary">{String(archiveReport?.format??'').toUpperCase()} · {String(archiveReport?.exportedSlices??'')} {lang==='zh'?'个已有切片':lang==='ja'?'枚の保存済み画像':'saved slices'}</Text>
                        {archiveOutdated&&<Text type="secondary">{lang==='zh'?'已有 ZIP 来自上次导出；应用新参数请重新执行。':lang==='ja'?'前回の ZIP です。新しい設定を適用するには再実行してください。':'The saved ZIP is from the previous export. Run again to apply current settings.'}</Text>}
                        <Button icon={<DownloadOutlined/>} onClick={downloadArchive}>{lang==='zh'?'下载已有 ZIP':lang==='ja'?'保存済み ZIP をダウンロード':'Download saved ZIP'}</Button>
                      </>}
                      <Checkbox disabled={!sprites.some(box=>box.kind==='grid')} title={lang==='zh'?'按行命名用于网格切片；零散区域使用文件名列表。':lang==='ja'?'行名はグリッド用です。散在領域はファイル名リストを使います。':'Row names apply to grid cells; scattered regions use the filename list.'} checked={namePerRow} onChange={(e) => setNamePerRow(e.target.checked)}>
                        {text.exportNamePerRow}
                      </Checkbox>
                      <Button type="primary" icon={<DownloadOutlined />} disabled={!raster||!!busy||preparing||!sprites.length} loading={busy==='export'} onClick={() => void downloadZip()} block>
                        {text.downloadSpriteZip}
                      </Button>
                    </Space>
                  </Col>
                </Row>
              </Space>
            </Card>
          </Col>
        </Row>
      </Space>
    </div></ScatterDocumentSurface>
  )
}

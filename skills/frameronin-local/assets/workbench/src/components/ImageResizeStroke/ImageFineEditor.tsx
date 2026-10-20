import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,type Ref } from 'react'
import {flushSync} from 'react-dom'
import { Alert,Button, ColorPicker, message, Slider, Space, Typography } from 'antd'
import {
  AimOutlined,
  BorderOuterOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  InboxOutlined,
  UndoOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import { useLanguage } from '../../i18n/context'
import { useImageStash } from '../../stash/context'
import {localJson} from '../../localProject/api'
import {runFineEditorWorker} from '../../lib/fineEditorWorker'
import {checkFineEditorBudget,stampFineCircle} from '../../lib/fineEditorPixels'
import type {FineEditorRequest,FineEditorResult} from '../../lib/fineEditor.worker'

const { Text } = Typography

type Tool = 'brush' | 'eraser' | 'superEraser' | 'selectMove' | 'eyedropper'

type SelRect = { x: number; y: number; w: number; h: number }

function pointInSelRect(px: number, py: number, r: SelRect): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h
}

export type ImageFineEditorHandle={flush:()=>Promise<void>;hasPendingEdits:()=>boolean}
type EditorBinding={file:File;onCommit:(file:File)=>void;onReset:()=>void;retainedBytes:()=>number}
interface ImageFineEditorProps {
  imageUrl: string
  onExport?: (blob: Blob) => void
  binding?:EditorBinding
  disabled?:boolean
  onPixelDirtyChange?:(dirty:boolean)=>void
  ref?:Ref<ImageFineEditorHandle>
}

export default function ImageFineEditor({ imageUrl, onExport,binding,disabled=false,ref,onPixelDirtyChange }: ImageFineEditorProps) {
  const { t,lang } = useLanguage()
  const { addImage } = useImageStash()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<Tool>('eraser')
  const [brushColor, setBrushColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(4)
  const [eraserSize, setEraserSize] = useState(8)
  const [superEraserTolerance, setSuperEraserTolerance] = useState(30)
  const [bgColorEnabled, setBgColorEnabled] = useState(false)
  const [bgColor, setBgColor] = useState('#22c55e')
  const [drawing, setDrawing] = useState(false)
  const [panning, setPanning] = useState(false)
  const lastPanRef = useRef({ x: 0, y: 0 })
  const [selectionRect, setSelectionRect] = useState<SelRect | null>(null)
  const [marqueeActive, setMarqueeActive] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(null)
  const [moveDrag, setMoveDrag] = useState<{ scx: number; scy: number; dix: number; diy: number } | null>(null)
  const selectionRectRef = useRef<SelRect | null>(null)
  const moveDragRef = useRef<typeof moveDrag>(null)
  const marqueeRef = useRef<typeof marqueeActive>(null)
  selectionRectRef.current = selectionRect
  moveDragRef.current = moveDrag
  marqueeRef.current = marqueeActive
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [fitScale, setFitScale] = useState(1)
  const [zoomFactor, setZoomFactor] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const saveDataRef = useRef<ImageData | null>(null)
  const historyRef = useRef<ImageData[]>([])
  const redoRef=useRef<ImageData[]>([])
  const [historyLength, setHistoryLength] = useState(0)
  const [redoLength,setRedoLength]=useState(0)
  const [working,setWorking]=useState(false),[loading,setLoading]=useState(false),[editError,setEditError]=useState('')
  const liveBinding=useRef(binding);liveBinding.current=binding
  const dirtyListener=useRef(onPixelDirtyChange);dirtyListener.current=onPixelDirtyChange
  const alive=useRef(true),generation=useRef(0),dirtyPixels=useRef(false),selfCommitted=useRef<File|null>(null)
  const operation=useRef<{controller:AbortController;promise:Promise<unknown>}|null>(null)
  const loadRequest=useRef<{controller:AbortController;promise:Promise<void>}|null>(null)
  const finishGesture=useRef<()=>Promise<void>>(async()=>{})
  const externalFile=binding?.file,source=externalFile??imageUrl
  const sourceIdentity=useRef(source);sourceIdentity.current=source
  const blocked=disabled||working||loading||loadError
  const status=lang==='zh'?{working:'正在保存或加工画布',loading:'正在读取画布',cancel:'取消画布任务',retry:'重试画布保存',undo:'撤销',redo:'重做',pending:'画布尚有未保存修改；请重试保存。',discard:'放弃未保存绘制'}
    :lang==='ja'?{working:'キャンバスを保存・処理中',loading:'キャンバスを読込中',cancel:'キャンバス処理を取消',retry:'保存を再試行',undo:'元に戻す',redo:'やり直す',pending:'未保存の描画があります。保存を再試行してください。',discard:'未保存の描画を破棄'}
      :{working:'Saving or processing canvas',loading:'Loading canvas',cancel:'Cancel canvas task',retry:'Retry canvas save',undo:'Undo',redo:'Redo',pending:'The canvas has unsaved edits. Retry saving.',discard:'Discard unsaved painting'}
  const MAX_HISTORY = 30
  const zoomFactorRef = useRef(1)
  const fitScaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  zoomFactorRef.current = zoomFactor
  fitScaleRef.current = fitScale
  offsetRef.current = offset

  const displayScale = fitScale * zoomFactor
  const markDirty=useCallback((value:boolean)=>{dirtyPixels.current=value;dirtyListener.current?.(value)},[])

  const eraserCursor = useCallback(() => {
    const d = Math.min(128, Math.max(2, Math.ceil(eraserSize * displayScale)))
    const r = d / 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${r}" cy="${r}" r="${r - 1}" fill="none" stroke="#333" stroke-width="2"/></svg>`
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${r} ${r}, cell`
  }, [eraserSize, displayScale])

  const eyedropperCursor = useCallback(() => {
    // 简单显示器滴管形状；精细指针不追求像素完美，仅提示工具状态
    const d = Math.min(128, Math.max(2, Math.ceil(brushSize * displayScale)))
    const r = d / 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">
      <path d="M ${r} ${r - d * 0.25} L ${r + d * 0.18} ${r - d * 0.43} L ${r + d * 0.05} ${r - d * 0.30} Z" fill="#b55233" stroke="#63321f" stroke-width="1"/>
      <circle cx="${r}" cy="${r}" r="${Math.max(1, r - 1)}" fill="none" stroke="#333" stroke-width="2"/>
    </svg>`
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${r} ${r}, cell`
  }, [brushSize, displayScale])

  useLayoutEffect(()=>{
    alive.current=true
    const invalidate=()=>{alive.current=false;generation.current++;operation.current?.controller.abort()}
    return invalidate
  },[])
  const retainedBytes=useCallback(()=>liveBinding.current?.retainedBytes()??[...historyRef.current,...redoRef.current,...(saveDataRef.current?[saveDataRef.current]:[])].reduce((sum,image)=>sum+image.data.byteLength,0),[])
  const execute=useCallback(<T,>(work:(signal:AbortSignal,version:number)=>Promise<T>):Promise<T>=>{
    if(operation.current)return Promise.reject(new Error('FINE_EDITOR_BUSY'))
    const controller=new AbortController(),version=++generation.current
    setWorking(true);setEditError('');dirtyListener.current?.(true)
    const promise=(async()=>{
      try{return await work(controller.signal,version)}
      catch(error){if(alive.current)setEditError(String(error));throw error}
      finally{if(operation.current?.controller===controller)operation.current=null;if(alive.current){setWorking(false);dirtyListener.current?.(dirtyPixels.current)}}
    })()
    operation.current={controller,promise};return promise
  },[])
  const pixelRequest=useCallback(async(action:'encode'|'erase'|'move',signal:AbortSignal,version:number,extra:object={}):Promise<FineEditorResult>=>{
    const inputSource=sourceIdentity.current
    const {memoryBudgetBytes:budget}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal})
    signal.throwIfAborted()
    const canvas=canvasRef.current,context=canvas?.getContext('2d')
    if(!canvas||!context)throw new Error('FINE_EDITOR_CANVAS_UNAVAILABLE')
    const width=canvas.width,height=canvas.height,retained=retainedBytes()
    checkFineEditorBudget(width,height,0,budget,retained)
    const pixels=context.getImageData(0,0,width,height).data
    const result=await runFineEditorWorker({action,width,height,pixels,budget,retained,...extra} as FineEditorRequest,signal,version)
    signal.throwIfAborted()
    if(!alive.current||generation.current!==version||sourceIdentity.current!==inputSource)throw new DOMException('Canvas changed','AbortError')
    return result
  },[retainedBytes])
  const acceptFile=useCallback((blob:Blob)=>{
    const current=liveBinding.current
    if(current){
      const file=new File([blob],'fine-edited.png',{type:'image/png'})
      selfCommitted.current=file
      flushSync(()=>current.onCommit(file))
    }
    markDirty(false)
  },[markDirty])
  const flushPixels=useCallback(async()=>{
    if(operation.current)await operation.current.promise
    if(!dirtyPixels.current)return
    await execute(async(signal,version)=>{
      const result=await pixelRequest('encode',signal,version)
      if(!result.blob)throw new Error('FINE_EDITOR_OUTPUT_INVALID')
      acceptFile(result.blob)
    })
  },[execute,pixelRequest,acceptFile])
  useImperativeHandle(ref,()=>({hasPendingEdits:()=>dirtyPixels.current||!!operation.current,flush:async()=>{
    // A failed view decode cannot discard edits. Unedited formal references
    // remain saveable, and users may replace an unreadable image.
    if(loadRequest.current)await loadRequest.current.promise
    await finishGesture.current();await flushPixels()
  }}),[flushPixels])
  useEffect(()=>{
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirtyPixels.current||operation.current){event.preventDefault();event.returnValue=''}}
    window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload)
  },[])

  useEffect(() => {
    if(externalFile&&selfCommitted.current===externalFile){selfCommitted.current=null;return}
    const controller=new AbortController(),version=++generation.current
    operation.current?.controller.abort();markDirty(false)
    setLoading(true);setLoadError(false);setEditError('')
    const promise=(async()=>{
      const {memoryBudgetBytes:budget}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:controller.signal})
      const file=source instanceof Blob?source:await (await fetch(source,{signal:controller.signal})).blob()
      const result=await runFineEditorWorker({action:'decode',file,budget,retained:retainedBytes()},controller.signal,version)
      if(controller.signal.aborted||generation.current!==version||!alive.current)return
      const canvas=canvasRef.current,context=canvas?.getContext('2d')
      if(!canvas||!context||!result.pixels)throw new Error('FINE_EDITOR_CANVAS_UNAVAILABLE')
      const id=new ImageData(result.pixels as Uint8ClampedArray<ArrayBuffer>,result.width,result.height)
      canvas.width=result.width;canvas.height=result.height;context.putImageData(id,0,0)
      saveDataRef.current=liveBinding.current?null:id
      historyRef.current=[];redoRef.current=[];setHistoryLength(0);setRedoLength(0)
      setSelectionRect(null);setMarqueeActive(null);setMoveDrag(null);setDrawing(false)
      setImgSize({w:result.width,h:result.height})
    })().catch(error=>{if(!controller.signal.aborted&&alive.current){setLoadError(true);setEditError(String(error))}})
      .finally(()=>{if(loadRequest.current?.controller===controller)loadRequest.current=null;if(!controller.signal.aborted&&alive.current)setLoading(false)})
    loadRequest.current={controller,promise}
    return()=>controller.abort()
  }, [source,externalFile,reloadKey,retainedBytes,markDirty])

  useEffect(() => {
    if (!containerRef.current || !imgSize) return
    const el = containerRef.current
    const updateFitScale = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (cw <= 0 || ch <= 0) return
      const sx = cw / imgSize.w
      const sy = ch / imgSize.h
      const s = Math.min(sx, sy)
      const z = zoomFactorRef.current
      const ds = s * z
      const off = { x: (cw - imgSize.w * ds) / 2, y: (ch - imgSize.h * ds) / 2 }
      fitScaleRef.current = s
      offsetRef.current = off
      setFitScale(s)
      setOffset(off)
    }
    updateFitScale()
    const ro = new ResizeObserver(updateFitScale)
    ro.observe(el)
    return () => ro.disconnect()
  }, [imgSize])

  const pushHistory = useCallback(() => {
    if(liveBinding.current)return
    const canvas=canvasRef.current,context=canvas?.getContext('2d')
    if(!context||!canvas)return
    const size=canvas.width*canvas.height*4
    const limit=Math.min(MAX_HISTORY,Math.floor((256*1024**2-size*3)/size))
    if(limit<1)throw new Error('FINE_EDITOR_HISTORY_RESOURCE_LIMIT')
    historyRef.current.push(context.getImageData(0,0,canvas.width,canvas.height))
    if(historyRef.current.length>limit)historyRef.current=historyRef.current.slice(-limit)
    redoRef.current=[];setHistoryLength(historyRef.current.length);setRedoLength(0)
  }, [])
  const handleUndo=useCallback(()=>{
    if(liveBinding.current||operation.current||dirtyPixels.current)return
    const context=canvasRef.current?.getContext('2d'),previous=historyRef.current.pop()
    if(!context||!previous)return
    redoRef.current.push(context.getImageData(0,0,previous.width,previous.height));context.putImageData(previous,0,0)
    setHistoryLength(historyRef.current.length);setRedoLength(redoRef.current.length);clearSelectUiRef.current()
  },[])
  const handleRedo=useCallback(()=>{
    if(liveBinding.current||operation.current||dirtyPixels.current)return
    const context=canvasRef.current?.getContext('2d'),next=redoRef.current.pop()
    if(!context||!next)return
    historyRef.current.push(context.getImageData(0,0,next.width,next.height));context.putImageData(next,0,0)
    setHistoryLength(historyRef.current.length);setRedoLength(redoRef.current.length);clearSelectUiRef.current()
  },[])
  const clearSelectUiRef=useRef(()=>{})

  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current || !containerRef.current) return null
      const el = containerRef.current
      const rect = el.getBoundingClientRect()
      const cx = clientX - rect.left - el.clientLeft
      const cy = clientY - rect.top - el.clientTop
      const x = (cx - offset.x) / displayScale
      const y = (cy - offset.y) / displayScale
      if (x < 0 || x >= (imgSize?.w ?? 0) || y < 0 || y >= (imgSize?.h ?? 0)) return null
      return { x: Math.floor(x), y: Math.floor(y) }
    },
    [offset, displayScale, imgSize]
  )

  /** 画布像素坐标，越界返回 null（用于点击落笔） */
  const canvasPxFromClient = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!containerRef.current || !imgSize) return null
      const el = containerRef.current
      const rect = el.getBoundingClientRect()
      const cx = clientX - rect.left - el.clientLeft
      const cy = clientY - rect.top - el.clientTop
      const x = (cx - offset.x) / displayScale
      const y = (cy - offset.y) / displayScale
      const ix = Math.floor(x)
      const iy = Math.floor(y)
      if (ix < 0 || ix >= imgSize.w || iy < 0 || iy >= imgSize.h) return null
      return { x: ix, y: iy }
    },
    [offset, displayScale, imgSize],
  )

  /** 框选拖拽：坐标钳在图内 */
  const canvasPxFromClientClamped = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!containerRef.current || !imgSize) return null
      const el = containerRef.current
      const rect = el.getBoundingClientRect()
      const cx = clientX - rect.left - el.clientLeft
      const cy = clientY - rect.top - el.clientTop
      const x = (cx - offset.x) / displayScale
      const y = (cy - offset.y) / displayScale
      const ix = Math.max(0, Math.min(imgSize.w - 1, Math.floor(x)))
      const iy = Math.max(0, Math.min(imgSize.h - 1, Math.floor(y)))
      return { x: ix, y: iy }
    },
    [offset, displayScale, imgSize],
  )

  const clearSelectUi = useCallback(() => {
    selectionRectRef.current=null;marqueeRef.current=null;moveDragRef.current=null
    setSelectionRect(null)
    setMarqueeActive(null)
    setMoveDrag(null)
  }, [])

  const switchTool = useCallback(
    (next: Tool) => {
      if (next !== 'selectMove') clearSelectUi()
      setTool(next)
    },
    [clearSelectUi],
  )

  clearSelectUiRef.current=clearSelectUi
  const commitSelectMove=useCallback(async(sel:SelRect,dx:number,dy:number)=>{
    if(operation.current||disabled||!imgSize)return
    const x=Math.max(0,Math.min(sel.x+dx,imgSize.w-sel.w)),y=Math.max(0,Math.min(sel.y+dy,imgSize.h-sel.h))
    if(x===sel.x&&y===sel.y)return
    await execute(async(signal,version)=>{
      const result=await pixelRequest('move',signal,version,{rect:sel,dx,dy})
      if(!result.pixels||!result.blob||!result.rect)throw new Error('FINE_EDITOR_OUTPUT_INVALID')
      pushHistory();canvasRef.current!.getContext('2d')!.putImageData(new ImageData(result.pixels as Uint8ClampedArray<ArrayBuffer>,result.width,result.height),0,0)
      setSelectionRect(result.rect);acceptFile(result.blob)
    })
  },[disabled,imgSize,execute,pixelRequest,pushHistory,acceptFile])
  const superEraserAt=useCallback(async(x:number,y:number)=>{
    await execute(async(signal,version)=>{
      const result=await pixelRequest('erase',signal,version,{x,y,tolerance:superEraserTolerance})
      if(!result.pixels||!result.blob)throw new Error('FINE_EDITOR_OUTPUT_INVALID')
      pushHistory();canvasRef.current!.getContext('2d')!.putImageData(new ImageData(result.pixels as Uint8ClampedArray<ArrayBuffer>,result.width,result.height),0,0)
      acceptFile(result.blob)
    })
  },[execute,pixelRequest,pushHistory,acceptFile,superEraserTolerance])

  const drawAt=useCallback((px:number,py:number)=>{
    const canvas=canvasRef.current,context=canvas?.getContext('2d')
    if(!canvas||!context||!imgSize)return
    const color=String(brushColor).match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    // ColorPicker emits six-digit hex; retain the original Canvas fallback.
    let rgb=color?color.slice(1).map(value=>parseInt(value,16)):[0,0,0]
    if(tool==='brush'&&!color){
      const temporary=document.createElement('canvas');temporary.width=temporary.height=1
      const ctx=temporary.getContext('2d')!
      ctx.fillStyle=brushColor;ctx.fillRect(0,0,1,1);rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3)
    }
    stampFineCircle(context,imgSize.w,imgSize.h,px,py,tool==='brush'?brushSize:eraserSize,tool==='brush'?rgb:null)
    context.globalCompositeOperation='source-over';markDirty(true)
  },[tool,brushSize,eraserSize,imgSize,brushColor,markDirty])

  finishGesture.current=async()=>{
    setDrawing(false);setPanning(false)
    const move=moveDragRef.current,selection=selectionRectRef.current
    moveDragRef.current=null;setMoveDrag(null)
    if(move&&selection&&(move.dix||move.diy))await commitSelectMove(selection,move.dix,move.diy)
    await flushPixels()
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!imgSize||blocked||operation.current||loadRequest.current) return
      containerRef.current?.focus({preventScroll:true})
      e.preventDefault()
      if (e.button === 2) {
        setPanning(true)
        lastPanRef.current = { x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 0 && tool === 'selectMove') {
        const p = canvasPxFromClient(e.clientX, e.clientY)
        if (!p) return
        const sel = selectionRectRef.current
        if (sel && pointInSelRect(p.x, p.y, sel)) {
          setMoveDrag({ scx: e.clientX, scy: e.clientY, dix: 0, diy: 0 })
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
        setSelectionRect(null)
        setMarqueeActive({ ax: p.x, ay: p.y, bx: p.x, by: p.y })
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 0) {
        const pt = screenToCanvas(e.clientX, e.clientY)
        if (pt) {
          if (tool === 'eyedropper') {
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')
            if (!ctx) return
            const data = ctx.getImageData(pt.x, pt.y, 1, 1).data
            const r = data[0]!
            const g = data[1]!
            const b = data[2]!
            setBrushColor(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
            switchTool('brush')
            return
          }
          if (tool === 'superEraser') {
            void superEraserAt(pt.x,pt.y).catch(()=>{})
          } else {
            try{pushHistory();setDrawing(true);drawAt(pt.x,pt.y)}catch(error){setEditError(String(error))}
          }
        }
      }
    },
    [imgSize, blocked,tool, screenToCanvas, canvasPxFromClient, drawAt, superEraserAt, pushHistory, switchTool]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if(blocked||operation.current||loadRequest.current)return
      if (panning) {
        e.preventDefault()
        const dx = e.clientX - lastPanRef.current.x
        const dy = e.clientY - lastPanRef.current.y
        lastPanRef.current = { x: e.clientX, y: e.clientY }
        setOffset((off) => ({ x: off.x + dx, y: off.y + dy }))
        return
      }
      if (marqueeActive) {
        e.preventDefault()
        const p = canvasPxFromClientClamped(e.clientX, e.clientY)
        if (p) setMarqueeActive((m) => (m ? { ...m, bx: p.x, by: p.y } : null))
        return
      }
      if (moveDrag) {
        e.preventDefault()
        setMoveDrag((m) => {
          if (!m) return null
          const next={...m,dix:Math.round((e.clientX-m.scx)/displayScale),diy:Math.round((e.clientY-m.scy)/displayScale)}
          moveDragRef.current=next;return next
        })
        return
      }
      if (drawing && imgSize && tool !== 'superEraser') {
        e.preventDefault()
        const pt = screenToCanvas(e.clientX, e.clientY)
        if (pt) drawAt(pt.x, pt.y)
      }
    },
    [blocked,panning, drawing, imgSize, tool, marqueeActive, moveDrag, displayScale, screenToCanvas, drawAt, canvasPxFromClientClamped]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) {
        setPanning(false)
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
      }
      if (e.button === 0) {
        setDrawing(false)
        const mq = marqueeRef.current
        if (mq) {
          const x0 = Math.min(mq.ax, mq.bx)
          const y0 = Math.min(mq.ay, mq.by)
          const x1 = Math.max(mq.ax, mq.bx)
          const y1 = Math.max(mq.ay, mq.by)
          const w = x1 - x0 + 1
          const h = y1 - y0 + 1
          if (w >= 2 && h >= 2) setSelectionRect({ x: x0, y: y0, w, h })
          setMarqueeActive(null)
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }
        const md = moveDragRef.current
        const sel = selectionRectRef.current
        if (md && sel) {
          moveDragRef.current=null
          if (md.dix !== 0 || md.diy !== 0) void commitSelectMove(sel,md.dix,md.diy).catch(()=>{})
          setMoveDrag(null)
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }
        void flushPixels().catch(()=>{})
      }
    },
    [commitSelectMove,flushPixels],
  )

  const handlePointerLeave = useCallback(() => {
    // Match the original gesture cancellation: keep already drawn pixels, but
    // discard an uncommitted marquee or selection drag.
    moveDragRef.current=null;marqueeRef.current=null
    void flushPixels().catch(()=>{})
    setDrawing(false)
    setPanning(false)
    setMarqueeActive(null)
    setMoveDrag(null)
  }, [flushPixels])

  useEffect(() => {
    if (!drawing && !panning) return
    const onUp = () => {
      void finishGesture.current().catch(()=>{})
    }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drawing, panning])

  useEffect(() => {
    if (!marqueeActive && !moveDrag) return
    const onCancel = () => {
      marqueeRef.current=null;moveDragRef.current=null
      setMarqueeActive(null)
      setMoveDrag(null)
    }
    window.addEventListener('pointercancel', onCancel)
    return () => window.removeEventListener('pointercancel', onCancel)
  }, [marqueeActive, moveDrag])

  /** WASD：与右键拖拽相同，按屏幕像素平移 offset */
  useEffect(() => {
    if (!imgSize) return
    const keys = new Set<string>()
    let rafId = 0
    let last = performance.now()
    const PAN_PX_PER_SEC = 520

    const step = (now: number) => {
      rafId = requestAnimationFrame(step)
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      if (keys.size === 0) return
      let dx = 0
      let dy = 0
      if (keys.has('a')) dx -= PAN_PX_PER_SEC * dt
      if (keys.has('d')) dx += PAN_PX_PER_SEC * dt
      if (keys.has('w')) dy -= PAN_PX_PER_SEC * dt
      if (keys.has('s')) dy += PAN_PX_PER_SEC * dt
      if (dx === 0 && dy === 0) return
      setOffset((off) => {
        const n = { x: off.x + dx, y: off.y + dy }
        offsetRef.current = n
        return n
      })
    }

    const targetOk = (el: EventTarget | null) => {
      const t = el as HTMLElement
      if (!t) return true
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return false
      if (t.isContentEditable) return false
      return true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)||e.isComposing||!targetOk(e.target)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const c = e.code
      if (c !== 'KeyW' && c !== 'KeyA' && c !== 'KeyS' && c !== 'KeyD') return
      const k = c === 'KeyW' ? 'w' : c === 'KeyA' ? 'a' : c === 'KeyS' ? 's' : 'd'
      keys.add(k)
      e.preventDefault()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const c = e.code
      if (c === 'KeyW') keys.delete('w')
      else if (c === 'KeyA') keys.delete('a')
      else if (c === 'KeyS') keys.delete('s')
      else if (c === 'KeyD') keys.delete('d')
    }

    const clearKeys = () => keys.clear()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearKeys)
    rafId = requestAnimationFrame(step)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
      cancelAnimationFrame(rafId)
    }
  }, [imgSize])

  useEffect(() => {
    if (!imgSize) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (liveBinding.current||e.isComposing||e.defaultPrevented||blocked)return
      if ((e.ctrlKey || e.metaKey) && (e.code==='KeyZ'||e.code==='KeyY')) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        e.preventDefault()
        if(e.shiftKey||e.code==='KeyY')handleRedo();else handleUndo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [imgSize, handleUndo,handleRedo,blocked])

  useEffect(() => {
    if (tool !== 'selectMove') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)||e.isComposing||e.key !== 'Escape') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      e.preventDefault()
      clearSelectUi()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tool, clearSelectUi])

  /** 框选移动：方向键按像素平移选区（与鼠标拖动同一套 commit）；Shift=大步 8px */
  useEffect(() => {
    if (!imgSize || tool !== 'selectMove') return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
        return
      if (!containerRef.current?.contains(document.activeElement)||marqueeRef.current || moveDragRef.current) return
      const sel = selectionRectRef.current
      if (!sel) return
      const code = e.code
      if (
        code !== 'ArrowUp' &&
        code !== 'ArrowDown' &&
        code !== 'ArrowLeft' &&
        code !== 'ArrowRight'
      )
        return
      if (e.isComposing||blocked||e.ctrlKey || e.metaKey || e.altKey) return
      const step = e.shiftKey ? 8 : 1
      let dx = 0
      let dy = 0
      if (code === 'ArrowLeft') dx = -step
      else if (code === 'ArrowRight') dx = step
      else if (code === 'ArrowUp') dy = -step
      else dy = step
      e.preventDefault()
      void commitSelectMove(sel,dx,dy).catch(()=>{})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [imgSize, tool, commitSelectMove,blocked])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !imgSize) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left - el.clientLeft
      const cy = e.clientY - rect.top - el.clientTop
      const delta = -Math.sign(e.deltaY) * 0.15
      const fit = fitScaleRef.current
      const off = offsetRef.current
      const z = zoomFactorRef.current
      const zNew = Math.max(0.25, Math.min(4, z * (1 + delta)))
      const scaleOld = fit * z
      const scaleNew = fit * zNew
      if (scaleOld > 0) {
        const ratio = scaleNew / scaleOld
        const offNew = {
          x: cx - (cx - off.x) * ratio,
          y: cy - (cy - off.y) * ratio,
        }
        setOffset(offNew)
        offsetRef.current = offNew
      }
      setZoomFactor(zNew)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [imgSize])

  const handleReset=useCallback(async()=>{
    await finishGesture.current()
    if(liveBinding.current){liveBinding.current.onReset();return}
    const original=saveDataRef.current,context=canvasRef.current?.getContext('2d')
    if(original&&context){pushHistory();context.putImageData(original,0,0);clearSelectUi();markDirty(false)}
    zoomFactorRef.current=1;setZoomFactor(1)
  },[pushHistory,clearSelectUi,markDirty])
  const exportBlob=useCallback(async()=>{
    await finishGesture.current()
    // Every fine-editor download is PNG, including an untouched JPEG/WebP
    // source. Preserve the original version while encoding the visible canvas.
    return await execute(async(signal,version)=>{
      const result=await pixelRequest('encode',signal,version)
      if(!result.blob)throw new Error('FINE_EDITOR_OUTPUT_INVALID')
      return result.blob
    })
  },[execute,pixelRequest])
  const handleDownload=useCallback(async()=>{
    try{
      const blob=await exportBlob();onExport?.(blob)
      const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='fine-edited.png';link.click();URL.revokeObjectURL(link.href)
    }catch(error){setEditError(String(error))}
  },[exportBlob,onExport])
  const handleSendToStash=useCallback(async()=>{
    try{const blob=await exportBlob();await addImage(URL.createObjectURL(blob),'fine-edited.png',true);message.success(t('imgFineEditorSendToStashSuccess'))}
    catch(error){setEditError(String(error))}
  },[exportBlob,addImage,t])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
      {(working||loading)&&<Space><Text>{working?status.working:status.loading}</Text><Button onClick={()=>{
        generation.current++
        if(operation.current)operation.current.controller.abort()
        else if(loadRequest.current){loadRequest.current.controller.abort();setLoading(false);setLoadError(true);setEditError('FINE_EDITOR_LOAD_CANCELED')}
      }}>{status.cancel}</Button></Space>}
      {editError&&<Alert type="error" title={editError} description={dirtyPixels.current?status.pending:undefined} action={<Space>
        <Button onClick={()=>{if(loadError)setReloadKey(value=>value+1);else void finishGesture.current().catch(()=>{})}}>{status.retry}</Button>
        {dirtyPixels.current&&<Button onClick={()=>{generation.current++;operation.current?.controller.abort();markDirty(false);setReloadKey(value=>value+1)}}>{status.discard}</Button>}
      </Space>}/>}
      <fieldset disabled={blocked} style={{border:0,padding:0,margin:0,pointerEvents:blocked?'none':undefined}}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <Space wrap>
          <Button
            type={tool === 'brush' ? 'primary' : 'default'}
            icon={<EditOutlined />}
            onClick={() => switchTool('brush')}
          >
            {t('imgFineEditorBrush')}
          </Button>
          <Button
            type={tool === 'eraser' ? 'primary' : 'default'}
            icon={<DeleteOutlined />}
            onClick={() => switchTool('eraser')}
          >
            {t('imgFineEditorEraser')}
          </Button>
          <Button
            type={tool === 'eyedropper' ? 'primary' : 'default'}
            icon={<EyeOutlined />}
            onClick={() => switchTool('eyedropper')}
          >
            {t('imgFineEditorEyedropper')}
          </Button>
          <Button
            type={tool === 'superEraser' ? 'primary' : 'default'}
            icon={<AimOutlined />}
            onClick={() => switchTool('superEraser')}
          >
            {t('imgFineEditorSuperEraser')}
          </Button>
          <Button
            type={tool === 'selectMove' ? 'primary' : 'default'}
            icon={<BorderOuterOutlined />}
            onClick={() => switchTool('selectMove')}
          >
            {t('imgFineEditorSelectMove')}
          </Button>
        </Space>
        {tool === 'brush' && (
          <Space wrap align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>{t('imgFineEditorBrushColor')}:</Text>
            <ColorPicker
              value={brushColor}
              onChange={(_: unknown, hex: string) => setBrushColor(hex || '#000000')}
              showText
              size="small"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{t('imgFineEditorBrushSize')}:</Text>
            <Slider min={1} max={32} value={brushSize} onChange={setBrushSize} style={{ width: 80 }} />
          </Space>
        )}
        {tool === 'eraser' && (
          <Space wrap align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>{t('imgFineEditorEraserSize')}:</Text>
            <Slider min={1} max={64} value={eraserSize} onChange={setEraserSize} style={{ width: 80 }} />
          </Space>
        )}
        {tool === 'superEraser' && (
          <Space wrap align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>{t('imgFineEditorSuperEraserTolerance')}:</Text>
            <Slider min={1} max={100} value={superEraserTolerance} onChange={setSuperEraserTolerance} style={{ width: 80 }} />
          </Space>
        )}
        {tool === 'selectMove' && (
          <Text type="secondary" style={{ fontSize: 12, maxWidth: 420 }}>
            {t('imgFineEditorSelectMoveHint')}
          </Text>
        )}
        <Space wrap align="center">
          <Button size="small" type={bgColorEnabled ? 'primary' : 'default'} onClick={() => setBgColorEnabled(true)}>
            {t('imgFineEditorBgOn')}
          </Button>
          <Button size="small" type={!bgColorEnabled ? 'primary' : 'default'} onClick={() => setBgColorEnabled(false)}>
            {t('imgFineEditorBgOff')}
          </Button>
          {bgColorEnabled && (
            <ColorPicker
              value={bgColor}
              onChange={(_: unknown, hex: string) => setBgColor(hex || '#ffffff')}
              showText
              size="small"
            />
          )}
        </Space>
        <Space wrap>
          {!binding&&<><Button size="small" icon={<UndoOutlined/>} onClick={handleUndo} disabled={historyLength===0}>{status.undo}</Button>
          <Button size="small" icon={<RedoOutlined/>} onClick={handleRedo} disabled={redoLength===0}>{status.redo}</Button></>}
          <Button size="small" icon={<DeleteOutlined />} onClick={()=>{void handleReset().catch(error=>setEditError(String(error)))}}>
            {t('imgFineEditorReset')}
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
            {t('imgDownload')}
          </Button>
          <Button icon={<InboxOutlined />} onClick={handleSendToStash}>
            {t('imgFineEditorSendToStash')}
          </Button>
        </Space>
      </div></fieldset>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
        {t('imgFineEditorViewControls')}
      </Text>
      <div
        ref={containerRef}
        role="region" aria-label={t('imgFineProcess')} aria-busy={working||loading}
        style={{
          width: '100%',
          height: 480,
          minHeight: 320,
          background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
          borderRadius: 8,
          border: '1px solid #9a8b78',
          overflow: 'hidden',
          position: 'relative',
          cursor: imgSize
            ? panning
              ? 'grabbing'
              : tool === 'selectMove'
                ? moveDrag
                  ? 'move'
                  : 'crosshair'
                : tool === 'eyedropper'
                  ? eyedropperCursor()
                : tool === 'brush' || tool === 'superEraser'
                  ? 'crosshair'
                  : tool === 'eraser'
                    ? eraserCursor()
                    : 'grab'
            : 'default',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!imgSize && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', zIndex: 1 }}>
            {t('imgFineEditorLoading')}
          </div>
        )}
        {imgSize && bgColorEnabled && (
          <div
            style={{
              position: 'absolute',
              left: offset.x,
              top: offset.y,
              width: imgSize.w * displayScale,
              height: imgSize.h * displayScale,
              backgroundColor: bgColor,
              pointerEvents: 'none',
            }}
          />
        )}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            left: offset.x,
            top: offset.y,
            width: imgSize ? imgSize.w * displayScale : 0,
            height: imgSize ? imgSize.h * displayScale : 0,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
          }}
        />
        {imgSize && tool === 'selectMove' && marqueeActive && (() => {
          const x = Math.min(marqueeActive.ax, marqueeActive.bx)
          const y = Math.min(marqueeActive.ay, marqueeActive.by)
          const w = Math.abs(marqueeActive.bx - marqueeActive.ax) + 1
          const h = Math.abs(marqueeActive.by - marqueeActive.ay) + 1
          return (
            <div
              style={{
                position: 'absolute',
                left: offset.x + x * displayScale,
                top: offset.y + y * displayScale,
                width: w * displayScale,
                height: h * displayScale,
                border: '2px dashed #0ea5e9',
                boxSizing: 'border-box',
                pointerEvents: 'none',
                zIndex: 3,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.35) inset',
              }}
            />
          )
        })()}
        {imgSize && tool === 'selectMove' && selectionRect && !marqueeActive && (() => {
          const dx = moveDrag?.dix ?? 0
          const dy = moveDrag?.diy ?? 0
          let vx = selectionRect.x + dx
          let vy = selectionRect.y + dy
          vx = Math.max(0, Math.min(vx, imgSize.w - selectionRect.w))
          vy = Math.max(0, Math.min(vy, imgSize.h - selectionRect.h))
          return (
            <div
              style={{
                position: 'absolute',
                left: offset.x + vx * displayScale,
                top: offset.y + vy * displayScale,
                width: selectionRect.w * displayScale,
                height: selectionRect.h * displayScale,
                border: '2px dashed #f59e0b',
                boxSizing: 'border-box',
                pointerEvents: 'none',
                zIndex: 3,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.25) inset',
              }}
            />
          )
        })()}
      </div>
    </div>
  )
}

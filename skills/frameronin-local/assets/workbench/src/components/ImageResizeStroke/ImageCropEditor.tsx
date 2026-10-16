import { useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type Ref } from 'react'
import {flushSync} from 'react-dom'
import { useLanguage } from '../../i18n/context'
import {localJson} from '../../localProject/api'
import {runNormalSourceWorker} from '../../lib/normalImageSourceWorker'
import {Button,Space,Typography} from 'antd'

const HANDLE_SIZE = 12
type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move' | null
export type ImageCropEditorHandle={finishGesture:()=>Promise<void>;hasPendingEdits:()=>boolean;cancelPending:()=>void}

interface Props {
  ref?:Ref<ImageCropEditorHandle>
  file:File
  retainedBytes:()=>number
  onReadyChange?:(ready:boolean)=>void
  onSamplingChange?:(pending:boolean)=>void
  allowPick?:boolean
  imageSize: { w: number; h: number }
  cropRegion: { left: number; top: number; right: number; bottom: number }
  onChange: (r: { left: number; top: number; right: number; bottom: number }) => void
  onPickColor?: (r: number, g: number, b: number) => void
  pickingColor?: boolean
}

export default function ImageCropEditor({
  ref,
  file,
  retainedBytes,
  onReadyChange,
  onSamplingChange,
  allowPick=true,
  imageSize,
  cropRegion,
  onChange,
  onPickColor,
  pickingColor,
}: Props) {
  const {t,lang}=useLanguage()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = useState<CropHandle>(null)
  const [startPos, setStartPos] = useState<{
    x: number
    y: number
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const [hoverHandle, setHoverHandle] = useState<CropHandle>(null)
  const pending=useRef(false),currentFile=useRef(file),dragSource=useRef<File|null>(null),retained=useRef(retainedBytes)
  const sample=useRef<{controller:AbortController;promise:Promise<void>}|null>(null),budget=useRef(0),picker=useRef({pickingColor,onPickColor})
  const previewController=useRef<AbortController|null>(null),readyListener=useRef(onReadyChange)
  const samplingListener=useRef(onSamplingChange)
  const alive=useRef(true)
  const [preview,setPreview]=useState<{file:File;bitmap:ImageBitmap;width:number;height:number}|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0)
  const [canceled,setCanceled]=useState(false),[isSampling,setIsSampling]=useState(false)
  useLayoutEffect(()=>{currentFile.current=file;retained.current=retainedBytes;picker.current={pickingColor,onPickColor};readyListener.current=onReadyChange;samplingListener.current=onSamplingChange})
  const ready=preview?.file===file&&preview.width===imageSize.w&&preview.height===imageSize.h
  useImperativeHandle(ref,()=>({finishGesture:async()=>{pending.current=false;flushSync(()=>{setDragging(null);setStartPos(null)});await sample.current?.promise},hasPendingEdits:()=>pending.current||sample.current!==null,cancelPending:()=>sample.current?.controller.abort()}),[])
  useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;previewController.current?.abort();sample.current?.controller.abort()}},[])
  useEffect(()=>{
    const controller=new AbortController();previewController.current=controller;let owned:ImageBitmap|undefined
    readyListener.current?.(false)
    void(async()=>{
      const context=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:controller.signal});budget.current=context.memoryBudgetBytes
      const result=await runNormalSourceWorker(file,'preview',context.memoryBudgetBytes,retained.current(),controller.signal)
      if(!alive.current||controller.signal.aborted||currentFile.current!==file){result.bitmap?.close();return}
      if(result.width!==imageSize.w||result.height!==imageSize.h){result.bitmap?.close();throw new Error('NORMAL_SOURCE_DIMENSIONS_CHANGED: reimport the selected image to refresh its orientation metadata')}
      owned=result.bitmap!;setPreview({file,bitmap:owned,width:result.width,height:result.height});setError('');setCanceled(false);readyListener.current?.(true)
    })().catch(error=>{if(!controller.signal.aborted&&currentFile.current===file)setError(String(error))})
    return()=>{controller.abort();sample.current?.controller.abort();owned?.close()}
  },[file,reload,imageSize.w,imageSize.h])

  const hitTest = (vx: number, vy: number): CropHandle => {
    const { left, top, right, bottom } = cropRegion
    const r = imageSize.w - left - right
    const b = imageSize.h - top - bottom
    const hs = HANDLE_SIZE
    if (vx >= left - hs && vx <= left + hs && vy >= top - hs && vy <= top + hs) return 'nw'
    if (vx >= left + r - hs && vx <= left + r + hs && vy >= top - hs && vy <= top + hs) return 'ne'
    if (vx >= left - hs && vx <= left + hs && vy >= top + b - hs && vy <= top + b + hs) return 'sw'
    if (vx >= left + r - hs && vx <= left + r + hs && vy >= top + b - hs && vy <= top + b + hs) return 'se'
    if (vx >= left - hs && vx <= left + hs && vy >= top && vy <= top + b) return 'w'
    if (vx >= left + r - hs && vx <= left + r + hs && vy >= top && vy <= top + b) return 'e'
    if (vx >= left && vx <= left + r && vy >= top - hs && vy <= top + hs) return 'n'
    if (vx >= left && vx <= left + r && vy >= top + b - hs && vy <= top + b + hs) return 's'
    if (vx >= left && vx <= left + r && vy >= top && vy <= top + b) return 'move'
    return null
  }

  const toImageCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { vx: 0, vy: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = imageSize.w / rect.width
    const scaleY = imageSize.h / rect.height
    return {
      vx: Math.round((clientX - rect.left) * scaleX),
      vy: Math.round((clientY - rect.top) * scaleY),
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { vx, vy } = toImageCoords(e.clientX, e.clientY)
    if(!ready)return
    if (pickingColor && onPickColor) {
      if(!allowPick)return
      const canvas=canvasRef.current;if(!canvas)return
      const rect=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(imageSize.w-1,Math.floor((e.clientX-rect.left)*imageSize.w/rect.width))),y=Math.max(0,Math.min(imageSize.h-1,Math.floor((e.clientY-rect.top)*imageSize.h/rect.height)))
      sample.current?.controller.abort()
      setIsSampling(true);setError('');samplingListener.current?.(true)
      const operation={controller:new AbortController(),promise:Promise.resolve()};sample.current=operation
      operation.promise=runNormalSourceWorker(file,'sample',budget.current,retained.current(),operation.controller.signal,x,y).then(result=>{
        if(alive.current&&!operation.controller.signal.aborted&&sample.current===operation&&currentFile.current===file&&picker.current.pickingColor){
          const [r,g,b]=result.color!;flushSync(()=>picker.current.onPickColor?.(r,g,b))
        }
      }).catch(error=>{if(!operation.controller.signal.aborted&&currentFile.current===file)setError(String(error))}).finally(()=>{if(sample.current===operation){sample.current=null;if(alive.current){setIsSampling(false);samplingListener.current?.(false)}}})
      return
    }
    const handle = hitTest(vx, vy)
    pending.current=!!handle;dragSource.current=file
    setDragging(handle)
    setStartPos({ x: vx, y: vy, ...cropRegion })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if(!ready||dragging&&dragSource.current!==file)return
    const coords = toImageCoords(e.clientX, e.clientY)
    if (!dragging || !startPos) {
      setHoverHandle(pickingColor ? null : hitTest(coords.vx, coords.vy))
      return
    }
    const dx = coords.vx - startPos.x
    const dy = coords.vy - startPos.y
    let { left, top, right, bottom } = startPos
    if (dragging === 'move') {
      const w = imageSize.w - startPos.left - startPos.right
      const h = imageSize.h - startPos.top - startPos.bottom
      left = Math.max(0, Math.min(imageSize.w - w - 1, startPos.left + dx))
      top = Math.max(0, Math.min(imageSize.h - h - 1, startPos.top + dy))
      right = imageSize.w - left - w
      bottom = imageSize.h - top - h
    } else {
      const minW = 1
      const minH = 1
      if (dragging.includes('w'))
        left = Math.max(0, Math.min(imageSize.w - startPos.right - minW, startPos.left + dx))
      if (dragging.includes('e'))
        right = Math.max(0, Math.min(imageSize.w - startPos.left - minW, startPos.right - dx))
      if (dragging.includes('n'))
        top = Math.max(0, Math.min(imageSize.h - startPos.bottom - minH, startPos.top + dy))
      if (dragging.includes('s'))
        bottom = Math.max(0, Math.min(imageSize.h - startPos.top - minH, startPos.bottom - dy))
    }
    onChange({ left, top, right, bottom })
  }

  const handleMouseUp = () => {
    pending.current=false
    setDragging(null)
    setStartPos(null)
  }

  const getCursor = () => {
    if (pickingColor) return 'crosshair'
    if (dragging) return 'grabbing'
    const h = hoverHandle ?? null
    const map: Record<string, string> = {
      move: 'grab',
      n: 'n-resize',
      s: 's-resize',
      e: 'e-resize',
      w: 'w-resize',
      ne: 'ne-resize',
      nw: 'nw-resize',
      se: 'se-resize',
      sw: 'sw-resize',
    }
    return (h && map[h]) ?? 'crosshair'
  }

  useEffect(()=>{
    const canvas=canvasRef.current
    if(!canvas||!ready||preview?.file!==file)return
    const bitmap=preview.bitmap,ctx=canvas.getContext('2d');if(!ctx)return
    canvas.width=bitmap.width;canvas.height=bitmap.height;ctx.drawImage(bitmap,0,0)
    ctx.save();ctx.scale(bitmap.width/imageSize.w,bitmap.height/imageSize.h)
      const { left, top, right, bottom } = cropRegion
      const w = imageSize.w - left - right
      const h = imageSize.h - top - bottom
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      if (left > 0) ctx.fillRect(0, 0, left, imageSize.h)
      if (right > 0) ctx.fillRect(imageSize.w - right, 0, right, imageSize.h)
      if (top > 0) ctx.fillRect(left, 0, w, top)
      if (bottom > 0) ctx.fillRect(left, imageSize.h - bottom, w, bottom)
      ctx.strokeStyle = '#b55233'
      ctx.lineWidth = 2
      ctx.strokeRect(left, top, w, h)
      ctx.fillStyle = '#b55233'
      ;[
        [left, top],
        [left + w, top],
        [left + w, top + h],
        [left, top + h],
        [left + w / 2, top],
        [left + w / 2, top + h],
        [left, top + h / 2],
        [left + w, top + h / 2],
      ].forEach(([x, y]) => {
        ctx.fillRect(x - 4, y - 4, 8, 8)
      })
    ctx.restore()
  },[preview,file,imageSize,cropRegion,ready])

  return (
    <div>
      {error&&<p role="alert">{t('errImageLoad')}: {error}</p>}
      {isSampling&&<Space style={{marginBottom:8}}><Typography.Text role="status">{lang==='zh'?'正在读取原图颜色':lang==='ja'?'元画像の色を取得中':'Sampling the original image'}</Typography.Text><Button onClick={()=>sample.current?.controller.abort()}>{lang==='zh'?'取消取色':lang==='ja'?'色取得を取消':'Cancel color sample'}</Button></Space>}
      {!ready&&<Space style={{marginBottom:8}}>
        {canceled&&<Typography.Text role="status">{lang==='zh'?'预览已取消':lang==='ja'?'プレビューを取り消しました':'Preview canceled'}</Typography.Text>}
        {!error&&!canceled&&<><Typography.Text role="status">{lang==='zh'?'正在读取预览':lang==='ja'?'プレビューを読込中':'Loading preview'}</Typography.Text>
        <Button onClick={()=>{previewController.current?.abort();setError('');setCanceled(true)}}>{lang==='zh'?'取消预览':lang==='ja'?'プレビューを取消':'Cancel preview'}</Button></>}
        <Button onClick={()=>{setError('');setCanceled(false);setReload(value=>value+1)}}>{lang==='zh'?'重试预览':lang==='ja'?'プレビューを再試行':'Retry preview'}</Button>
      </Space>}
      <div
      style={{
        overflow: 'auto',
        maxHeight: 400,
        border: '1px solid #9a8b78',
        borderRadius: 8,
        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
      }}
    >
      <canvas
        ref={canvasRef}
        width={ready?preview.bitmap.width:1}
        height={ready?preview.bitmap.height:1}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        aria-label={t('imgOriginalPreview')}
        style={{width:imageSize.w,maxWidth:'100%',height:'auto',aspectRatio:`${imageSize.w} / ${imageSize.h}`,cursor:ready?getCursor():'wait',display:'block',imageRendering:'pixelated'}}
      />
      </div>
    </div>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Alert, Button, Checkbox, InputNumber, message, Radio, Slider, Space, Tabs, Typography, Upload } from 'antd'
import { BorderOutlined, DownloadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import { maxSafeUpscaleForImage } from '../lib/pixellise/safeUpscale'
import { cacheManagedInput, importManagedInputs, runManagedTask, type ManagedVersion } from '../localProject/managedTasks'

import DocumentSaveBar from '../localProject/DocumentSaveBar'
import { initialPixelDraft, pixelFiles, pixelMetadata, serializePixelDocument, restorePixelDocument, type PixelDraft, type NaturalRect } from '../localProject/pixelDocument'
import { createPixelHistory, pixelHistoryReducer } from '../localProject/pixelHistory'

const { Dragger } = Upload
const { Text } = Typography

const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']
const IMAGE_MAX_MB = 20
/** 高级像素化框选：原图像素最小边长 */
const PREVIEW_SELECTION_MIN_SIDE = 24

function clientToNaturalPoint(img: HTMLImageElement, clientX: number, clientY: number, dimensions:{w:number;h:number}|null): { nx: number; ny: number } {
  const r = img.getBoundingClientRect()
  const nw = dimensions?.w??img.naturalWidth
  const nh = dimensions?.h??img.naturalHeight
  if (nw < 1 || nh < 1 || r.width < 1 || r.height < 1) return { nx: 0, ny: 0 }
  const nx = ((clientX - r.left) / r.width) * nw
  const ny = ((clientY - r.top) / r.height) * nh
  return {
    nx: Math.max(0, Math.min(nw - 1, nx)),
    ny: Math.max(0, Math.min(nh - 1, ny)),
  }
}

function normalizeNaturalRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  nw: number,
  nh: number,
): NaturalRect {
  let x = Math.min(x0, x1)
  let y = Math.min(y0, y1)
  let w = Math.abs(x1 - x0)
  let h = Math.abs(y1 - y0)
  x = Math.floor(x)
  y = Math.floor(y)
  w = Math.ceil(w)
  h = Math.ceil(h)
  x = Math.max(0, Math.min(nw - 1, x))
  y = Math.max(0, Math.min(nh - 1, y))
  w = Math.min(w, nw - x)
  h = Math.min(h, nh - y)
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) }
}

export default function ImagePixelate() {
  const { t, lang } = useLanguage()
  const computation = useRef<AbortController | null>(null)
  const mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const [history,dispatchHistory]=useReducer(pixelHistoryReducer,undefined,()=>createPixelHistory(initialPixelDraft()))
  const updatePixel=useCallback((update:(value:PixelDraft)=>PixelDraft)=>dispatchHistory({type:'change',update}),[])
  const setter=useCallback(<K extends keyof PixelDraft,>(key:K)=>(value:PixelDraft[K]|((old:PixelDraft[K])=>PixelDraft[K]))=>{
    updatePixel(current=>({...current,[key]:typeof value==='function'?(value as (old:PixelDraft[K])=>PixelDraft[K])(current[key]):value}))
  },[updatePixel])
  const {activeTab,file,resultFile:resultBlob,processingSize,pixelSize,mergeNearbyStrength,color16Method,color16Dither,
    advUpscale,advColors,advScaleResult,advTransparent,ppSample,ppMinSize,ppPeakWidth,ppRefine,ppFixSquare,ppManualGrid,ppGridCols,ppGridRows,previewSelection}=history.present
  const setActiveTab=(activeTab:PixelDraft['activeTab'])=>dispatchHistory({type:'view',activeTab})
  const setFile=(file:File|null)=>updatePixel(current=>({...current,file,resultFile:null,processingSize:null,previewSelection:null}))
  const setColor16Method=useMemo(()=>setter('color16Method'),[setter])
  const setColor16Dither=useMemo(()=>setter('color16Dither'),[setter])
  const setPixelSize=useMemo(()=>setter('pixelSize'),[setter])
  const setMergeNearbyStrength=useMemo(()=>setter('mergeNearbyStrength'),[setter])
  const setAdvColors=useMemo(()=>setter('advColors'),[setter])
  const setAdvScaleResult=useMemo(()=>setter('advScaleResult'),[setter])
  const setAdvTransparent=useMemo(()=>setter('advTransparent'),[setter])
  const setPpSample=useMemo(()=>setter('ppSample'),[setter])
  const setPpMinSize=useMemo(()=>setter('ppMinSize'),[setter])
  const setPpPeakWidth=useMemo(()=>setter('ppPeakWidth'),[setter])
  const setPpRefine=useMemo(()=>setter('ppRefine'),[setter])
  const setPpFixSquare=useMemo(()=>setter('ppFixSquare'),[setter])
  const setPpManualGrid=useMemo(()=>setter('ppManualGrid'),[setter])
  const setPpGridCols=useMemo(()=>setter('ppGridCols'),[setter])
  const setPpGridRows=useMemo(()=>setter('ppGridRows'),[setter])
  const setPreviewSelection=useMemo(()=>setter('previewSelection'),[setter])
  const setResultBlob=useMemo(()=>setter('resultFile'),[setter])
  const setAdvUpscale=useMemo(()=>setter('advUpscale'),[setter])
  const resultVersion=resultBlob?pixelMetadata.get(resultBlob):undefined
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [advUpscaleCeiling, setAdvUpscaleCeiling] = useState(7)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [taskProgress,setTaskProgress]=useState(0)
  const [canceling,setCanceling]=useState(false)
  const [taskError,setTaskError]=useState('')
  const [previewBudget,setPreviewBudget]=useState<number|null>(null)
  const [originalStashUrl,setOriginalStashUrl]=useState<string|null>(null)
  const [inputVersion,setInputVersion]=useState<ManagedVersion|null>(null)
  const [naturalWH, setNaturalWH] = useState<{ w: number; h: number } | null>(null)
  const [previewSelectActive, setPreviewSelectActive] = useState(false)
  const [draftSelection, setDraftSelection] = useState<NaturalRect | null>(null)
  const previewImgRef = useRef<HTMLImageElement>(null)
  const selectDragRef = useRef<{ nx0: number; ny0: number } | null>(null)
  const urlsRef = useRef({ originalUrl: null as string | null, resultUrl: null as string | null })
  urlsRef.current = { originalUrl, resultUrl }

  useEffect(()=>{
    let canceled=false
    setOriginalUrl(null);setNaturalWH(null);setInputVersion(null);setOriginalStashUrl(null)
    if(!file)return
    const url=URL.createObjectURL(file)
    importManagedInputs([file]).then(({versions,memoryBudgetBytes})=>{
      if(canceled)return
      const version=versions[0],meta=version.metadata
      if(meta.kind!=='image'||!meta.width||!meta.height)throw new Error('Select a decodable static image')
      pixelMetadata.set(file,version);setInputVersion(version);setNaturalWH({w:meta.width,h:meta.height});setPreviewBudget(memoryBudgetBytes)
      setOriginalStashUrl(url)
      const full=meta.width*meta.height*16+file.size*2<=memoryBudgetBytes/8
      if(!full&&!meta.thumbnailDataUrl?.startsWith('data:image/png;base64,'))throw new Error('Image thumbnail unavailable')
      setOriginalUrl(full?url:meta.thumbnailDataUrl!)
    }).catch(error=>{if(!canceled)setTaskError(String(error))})
    return()=>{canceled=true;URL.revokeObjectURL(url)}
  },[file])

  useEffect(
    () => () => {
      if (urlsRef.current.originalUrl) URL.revokeObjectURL(urlsRef.current.originalUrl)
      if (urlsRef.current.resultUrl) URL.revokeObjectURL(urlsRef.current.resultUrl)
    },
    [],
  )

  useEffect(() => {
    setPreviewSelectActive(false)
    setDraftSelection(null)
    selectDragRef.current = null
  }, [file])

  useEffect(() => {
    if (!naturalWH) {
      setAdvUpscaleCeiling(7)
      return
    }
    const w = previewSelection?.w ?? naturalWH.w
    const h = previewSelection?.h ?? naturalWH.h
    const maxU = maxSafeUpscaleForImage(w, h)
    setAdvUpscaleCeiling(maxU)
    dispatchHistory({type:'normalize',update:current=>({...current,advUpscale:Math.min(current.advUpscale,maxU)})})
  }, [naturalWH, previewSelection])

  useEffect(()=>{
    const url=resultBlob?URL.createObjectURL(resultBlob):null
    setResultUrl(url)
    return()=>{if(url)URL.revokeObjectURL(url)}
  },[resultBlob])
  useEffect(()=>{
    const end=()=>dispatchHistory({type:'end'})
    const key=(event:KeyboardEvent)=>{
      if(event.isComposing||!(event.metaKey||event.ctrlKey)||event.altKey||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return
      if(event.code==='KeyZ'||event.code==='KeyY'){event.preventDefault();dispatchHistory({type:event.code==='KeyY'||event.shiftKey?'redo':'undo'})}
    }
    window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('keydown',key)
    return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('keydown',key)}
  },[])

  const updateDraftFromPointer = (clientX: number, clientY: number) => {
    const img = previewImgRef.current
    const drag = selectDragRef.current
    if (!img || !drag) return
    const { nx, ny } = clientToNaturalPoint(img, clientX, clientY,naturalWH)
    const nw = naturalWH?.w??img.naturalWidth
    const nh = naturalWH?.h??img.naturalHeight
    setDraftSelection(normalizeNaturalRect(drag.nx0, drag.ny0, nx, ny, nw, nh))
  }

  const finishPreviewSelect = (e: React.PointerEvent, clientX: number, clientY: number) => {
    const img = previewImgRef.current
    const drag = selectDragRef.current
    if (!previewSelectActive || !img || !drag) return
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    const { nx, ny } = clientToNaturalPoint(img, clientX, clientY,naturalWH)
    const nw = naturalWH?.w??img.naturalWidth
    const nh = naturalWH?.h??img.naturalHeight
    const rect = normalizeNaturalRect(drag.nx0, drag.ny0, nx, ny, nw, nh)
    selectDragRef.current = null
    setDraftSelection(null)
    setPreviewSelectActive(false)
    if (rect.w < PREVIEW_SELECTION_MIN_SIDE || rect.h < PREVIEW_SELECTION_MIN_SIDE) {
      message.warning(t('pixelatePreviewSelectTooSmall', { n: PREVIEW_SELECTION_MIN_SIDE }))
      return
    }
    setPreviewSelection(rect)
  }

  const signature=JSON.stringify([pixelSize,mergeNearbyStrength,color16Method,color16Dither,advUpscale,advColors,advScaleResult,advTransparent,
    ppSample,ppMinSize,ppPeakWidth,ppRefine,ppFixSquare,ppManualGrid,ppGridCols,ppGridRows,previewSelection])
  const latest=useRef({file,signature,resultBlob})
  useLayoutEffect(()=>{latest.current={file,signature,resultBlob}},[file,signature,resultBlob])
  const taskText=lang==='zh'?{cancel:'取消加工',canceling:'正在核对取消',canceled:'加工已取消',stale:'输入或参数已改变，结果保留在项目素材中',size:'实际处理尺寸',thumbnail:'为控制内存，此处显示缩略图；选区使用原图坐标，加工及拖入暂存保留原文件。'}
    :lang==='ja'?{cancel:'処理を取消',canceling:'取消を確認中',canceled:'処理を取り消しました',stale:'入力または設定が変わりました。結果はプロジェクトに保存されています',size:'実際の処理サイズ',thumbnail:'メモリ使用量を抑えるためサムネイルを表示しています。選択範囲は元画像の座標で、処理と一時保管には元画像を使います。'}
      :{cancel:'Cancel processing',canceling:'Confirming cancellation',canceled:'Processing canceled',stale:'Inputs or settings changed; results remain in Project assets',size:'Actual processing dimensions',thumbnail:'A thumbnail limits memory use. Selection uses original coordinates; processing and stash retain the original file.'}
  const selectedRegion=()=>previewSelection?{regionX:previewSelection.x,regionY:previewSelection.y,regionWidth:previewSelection.w,regionHeight:previewSelection.h}:{}
  const runPixelTask=async(operation:string,parameters:object,success:string)=>{
    if(!file||computation.current||!inputVersion||!previewBudget)return
    const selected=file,before=latest.current,controller=new AbortController()
    computation.current=controller;setLoading(true);setTaskError('');setTaskProgress(0);setCanceling(false)
    try{
      let frontendBytes=96*1024**2+[...pixelFiles([history.present,...history.past,...history.future,...(history.checkpoint?[history.checkpoint]:[])])].reduce((total,file)=>total+file.size*2,0)
      if(originalUrl===originalStashUrl)frontendBytes+=(inputVersion.metadata.width??0)*(inputVersion.metadata.height??0)*16
      else frontendBytes+=128*128*16
      frontendBytes+=(resultVersion?.metadata.width??0)*(resultVersion?.metadata.height??0)*16
      const {project,outputs}=await runManagedTask(operation,[selected],{...parameters,frontendBytes},{signal:controller.signal,
        onProgress:value=>{if(mounted.current)setTaskProgress(Math.round(value*100))},
        outputFilter:version=>mounted.current&&(version.metadata.kind==='image'||version.metadata.extension==='.json')})
      controller.signal.throwIfAborted()
      if(!mounted.current)return
      if(latest.current.file!==before.file||latest.current.signature!==before.signature||latest.current.resultBlob!==before.resultBlob)throw new Error(taskText.stale)
      const result=outputs.find(output=>output.version.metadata.kind==='image')
      if(!result)throw new Error('The registered pixel result is incomplete')
      const outputWidth=result.version.metadata.width,outputHeight=result.version.metadata.height
      if(typeof outputWidth!=='number'||typeof outputHeight!=='number'||!Number.isInteger(outputWidth)||!Number.isInteger(outputHeight)||outputWidth<1||outputHeight<1)throw new Error('The pixel result dimensions are invalid')
      const reportOutput=outputs.find(output=>output.version.metadata.extension==='.json')
      const report=reportOutput?JSON.parse(await reportOutput.blob.text()):{}
      controller.signal.throwIfAborted()
      if(!mounted.current)return
      if(latest.current.file!==before.file||latest.current.signature!==before.signature||latest.current.resultBlob!==before.resultBlob)throw new Error(taskText.stale)
      const dimensions=report.processingDimensions
      const processed=new File([result.blob],selected.name.replace(/\.[^.]+$/,'').slice(0,200)+'_'+operation.replace('image.','')+'.png',{type:'image/png'})
      cacheManagedInput(processed,project.id,result.version.id);pixelMetadata.set(processed,result.version)
      const capped=operation==='image.pixellise'&&report.upscaleCapped&&Number.isInteger(report.upscaleUsed)&&report.upscaleUsed>=1&&report.upscaleUsed<=7
      updatePixel(current=>({...current,resultFile:processed,processingSize:dimensions&&Number.isInteger(dimensions.width)&&Number.isInteger(dimensions.height)?dimensions:null,
        ...(capped?{advUpscale:report.upscaleUsed}:{})}))
      if(capped){
        message.success(t('pixelateAdvancedSuccessWithCap',{from:report.upscaleRequested,to:report.upscaleUsed}))
      }else if(operation==='image.perfectPixel')message.success(t('pixelatePerfectPixelSuccess',{w:outputWidth,h:outputHeight}))
      else message.success(success)
    }catch(error){if(mounted.current)setTaskError(controller.signal.aborted&&error instanceof DOMException&&error.name==='AbortError'?taskText.canceled:String(error))}
    finally{if(computation.current===controller)computation.current=null;if(mounted.current){setLoading(false);setCanceling(false)}}
  }
  const runPixelate=()=>runPixelTask('image.pixelate',{pixelSize},t('pixelateSuccess'))
  const runMergeNearby=()=>runPixelTask('image.mergeNearby',{strength:mergeNearbyStrength},t('pixelateMergeNearbySuccess'))
  const run16Color=()=>runPixelTask('image.palette16',{method:color16Method,dither:color16Dither},t('pixelate16ColorSuccess'))
  const runAdvancedPixellise=()=>runPixelTask('image.pixellise',{...selectedRegion(),upscale:advUpscale,numColors:advColors,scaleResult:advScaleResult,transparentBackground:advTransparent},t('pixelateAdvancedSuccess'))
  const runPerfectPixel=()=>runPixelTask('image.perfectPixel',{...selectedRegion(),sampleMethod:ppSample,gridCols:ppManualGrid?ppGridCols:0,gridRows:ppManualGrid?ppGridRows:0,minSize:ppMinSize,peakWidth:ppPeakWidth,refineIntensity:ppRefine,fixSquare:ppFixSquare},t('pixelatePerfectPixelSuccess',{w:ppGridCols,h:ppGridRows}))

  const download = () => {
    if (!resultBlob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(resultBlob)
    a.download = (file?.name?.replace(/\.[^.]+$/, '') || 'pixelated') + '.png'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <DocumentSaveBar kind="pixel" snapshot={history.present} serialize={serializePixelDocument}
        restore={value=>restorePixelDocument(value,[...pixelFiles([history.present,...history.past,...history.future])])}
        applySnapshot={draft=>dispatchHistory({type:'restore',draft})}/>
      <Space>
        <Button disabled={!history.past.length&&!history.checkpoint} onClick={()=>dispatchHistory({type:'undo'})}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
        <Button disabled={!history.future.length} onClick={()=>dispatchHistory({type:'redo'})}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
      </Space>
      <StashDropZone
        onStashDrop={(f) => {
          setFile(f)
          setResultUrl((old) => {
            if (old) URL.revokeObjectURL(old)
            return null
          })
          setResultBlob(null)
        }}
        maxSizeMB={IMAGE_MAX_MB}
        onSizeError={() => message.error(t('imageSizeError'))}
      >
        <Dragger
          accept={IMAGE_ACCEPT.join(',')}
          maxCount={1}
          fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
          beforeUpload={(f) => {
            if (f.size > IMAGE_MAX_MB * 1024 * 1024) {
              message.error(t('imageSizeError'))
              return false
            }
            setFile(f)
            setResultUrl((old) => {
              if (old) URL.revokeObjectURL(old)
              return null
            })
            setResultBlob(null)
            return false
          }}
          onRemove={() => setFile(null)}
        >
          <p className="ant-upload-text">{t('imageUploadHint')}</p>
          <p className="ant-upload-hint">{t('imageFormats')}</p>
        </Dragger>
      </StashDropZone>
      {file && originalUrl && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text strong style={{ display: 'block', marginBottom: 0 }}>{t('imgOriginalPreview')}</Text>
            {originalUrl!==originalStashUrl&&<Text type="secondary">{taskText.thumbnail}</Text>}
            <Space wrap size="small">
              <Button
                size="small"
                type={previewSelectActive ? 'primary' : 'default'}
                icon={<BorderOutlined />}
                disabled={!naturalWH}
                onClick={() => {
                  if (previewSelectActive) {
                    selectDragRef.current = null
                    setDraftSelection(null)
                  }
                  setPreviewSelectActive((a) => !a)
                }}
              >
                {previewSelectActive ? t('pixelatePreviewSelectCancel') : t('pixelatePreviewSelectStart')}
              </Button>
              <Button size="small" disabled={!previewSelection} onClick={() => setPreviewSelection(null)}>
                {t('pixelatePreviewSelectClear')}
              </Button>
            </Space>
          </div>
          {previewSelectActive && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
              {t('pixelatePreviewSelectHint')}
            </Text>
          )}
          {previewSelection && !previewSelectActive && naturalWH && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
              {t('pixelatePreviewSelectRegionInfo', {
                w: previewSelection.w,
                h: previewSelection.h,
              })}
            </Text>
          )}
          <div
            style={{
              padding: 16,
              width: '100%',
              boxSizing: 'border-box',
              background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
              borderRadius: 8,
              border: '1px solid #9a8b78',
            }}
          >
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
              <StashableImage
                ref={previewImgRef}
                src={originalUrl}
                stashSrc={originalStashUrl??undefined}
                alt=""
                draggable={!previewSelectActive}
                style={{
                  maxWidth: '100%',
                  width: naturalWH?Math.min(naturalWH.w,naturalWH.w/naturalWH.h*440):'auto',
                  height: 'auto',
                  maxHeight: 440,
                  display: 'block',
                  imageRendering: 'auto',
                  verticalAlign: 'top',
                }}
              />
              {naturalWH && previewSelection && !previewSelectActive && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(previewSelection.x / naturalWH.w) * 100}%`,
                    top: `${(previewSelection.y / naturalWH.h) * 100}%`,
                    width: `${(previewSelection.w / naturalWH.w) * 100}%`,
                    height: `${(previewSelection.h / naturalWH.h) * 100}%`,
                    border: '2px solid #c2410c',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                    background: 'rgba(194, 65, 12, 0.12)',
                  }}
                />
              )}
              {naturalWH && draftSelection && previewSelectActive && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(draftSelection.x / naturalWH.w) * 100}%`,
                    top: `${(draftSelection.y / naturalWH.h) * 100}%`,
                    width: `${(draftSelection.w / naturalWH.w) * 100}%`,
                    height: `${(draftSelection.h / naturalWH.h) * 100}%`,
                    border: '2px dashed #c2410c',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                    background: 'rgba(194, 65, 12, 0.08)',
                  }}
                />
              )}
              <div
                role="presentation"
                style={{
                  position: 'absolute',
                  inset: 0,
                  cursor: previewSelectActive ? 'crosshair' : 'default',
                  touchAction: 'none',
                  pointerEvents: previewSelectActive ? 'auto' : 'none',
                }}
                onPointerDown={(e) => {
                  if (!previewSelectActive || !previewImgRef.current) return
                  e.preventDefault()
                  const { nx, ny } = clientToNaturalPoint(previewImgRef.current, e.clientX, e.clientY,naturalWH)
                  selectDragRef.current = { nx0: nx, ny0: ny }
                  e.currentTarget.setPointerCapture(e.pointerId)
                  const nw = naturalWH?.w??previewImgRef.current.naturalWidth
                  const nh = naturalWH?.h??previewImgRef.current.naturalHeight
                  setDraftSelection(normalizeNaturalRect(nx, ny, nx, ny, nw, nh))
                }}
                onPointerMove={(e) => {
                  if (selectDragRef.current) updateDraftFromPointer(e.clientX, e.clientY)
                }}
                onPointerUp={(e) => {
                  if (selectDragRef.current) finishPreviewSelect(e, e.clientX, e.clientY)
                }}
                onPointerCancel={(e) => {
                  selectDragRef.current = null
                  setDraftSelection(null)
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId)
                  } catch {
                    /* noop */
                  }
                }}
              />
            </div>
          </div>
        </>
      )}
      <div onPointerDownCapture={()=>dispatchHistory({type:'begin'})}><Tabs
        activeKey={activeTab}
        onChange={(k) =>
          setActiveTab(k as 'pixelate' | 'mergeNearby' | 'color16' | 'advanced' | 'perfectPixel')
        }
        items={[
          {
            key: 'pixelate',
            label: t('pixelateTabBlock'),
            children: (
              <>
                <Text type="secondary" style={{ display: 'block' }}>{t('pixelateHint')}</Text>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('pixelateSize')}</Text>
                  <Space wrap>
                    <Slider
                      min={2}
                      max={64}
                      value={pixelSize}
                      onChange={setPixelSize}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber precision={0} min={2} max={128} value={pixelSize} onChange={(v) => setPixelSize(v ?? 8)} style={{ width: 90 }} />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{t('pixelateSizeHint')}</Text>
                </div>
              </>
            ),
          },
          {
            key: 'mergeNearby',
            label: t('pixelateTabMergeNearby'),
            children: (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Text type="secondary" style={{ display: 'block' }}>{t('pixelateMergeNearbyModuleHint')}</Text>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('pixelateMergeNearbyStrength')}</Text>
                  <Space wrap>
                    <Slider
                      min={1}
                      max={100}
                      value={mergeNearbyStrength}
                      onChange={setMergeNearbyStrength}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber min={1} max={100} value={mergeNearbyStrength} onChange={(v) => setMergeNearbyStrength(v ?? 40)} style={{ width: 90 }} />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{t('pixelateMergeNearbyHint')}</Text>
                </div>
              </Space>
            ),
          },
          {
            key: 'color16',
            label: t('pixelateTab16Color'),
            children: (
              <Space direction="vertical" size="middle">
                <Text type="secondary" style={{ display: 'block' }}>{t('pixelate16ColorHint')}</Text>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>{t('pixelate16ColorMethod')}</Text>
                  <Radio.Group value={color16Method} onChange={(e) => setColor16Method(e.target.value)}>
                    <Radio value="rgb">{t('pixelate16ColorMethodRgb')}</Radio>
                    <Radio value="lab">{t('pixelate16ColorMethodLab')}</Radio>
                  </Radio.Group>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{t('pixelate16ColorMethodLabHint')}</Text>
                </div>
                <Checkbox checked={color16Dither} onChange={(e) => setColor16Dither(e.target.checked)}>
                  {t('pixelate16ColorDither')}
                </Checkbox>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('pixelate16ColorDitherHint')}</Text>
              </Space>
            ),
          },
          {
            key: 'advanced',
            label: t('pixelateTabAdvanced'),
            children: (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {previewSelection && (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {t('pixelateAdvancedRegionOnly')}
                  </Text>
                )}
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('pixelateAdvancedUpscale')}</Text>
                  <Space wrap>
                    <Slider
                      min={1}
                      max={advUpscaleCeiling}
                      step={1}
                      value={advUpscale}
                      onChange={(v) => setAdvUpscale(v as number)}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber
                      precision={0}
                      min={1}
                      max={advUpscaleCeiling}
                      value={advUpscale}
                      onChange={(v) =>
                        setAdvUpscale(
                          Math.min(advUpscaleCeiling, Math.max(1, typeof v === 'number' ? v : 3)),
                        )
                      }
                      style={{ width: 90 }}
                    />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{t('pixelateAdvancedUpscaleHint')}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('pixelateAdvancedColors')}</Text>
                  <Space wrap>
                    <Slider
                      min={4}
                      max={64}
                      value={advColors}
                      onChange={setAdvColors}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber precision={0} min={4} max={256} value={advColors} onChange={(v) => setAdvColors(v ?? 64)} style={{ width: 90 }} />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{t('pixelateAdvancedColorsHint')}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('pixelateAdvancedScaleResult')}</Text>
                  <Space wrap>
                    <Slider
                      min={1}
                      max={5}
                      step={1}
                      value={advScaleResult}
                      onChange={(v) => setAdvScaleResult(v as number)}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber precision={0} min={1} max={5} value={advScaleResult} onChange={(v) => setAdvScaleResult(v ?? 1)} style={{ width: 90 }} />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{t('pixelateAdvancedScaleResultHint')}</Text>
                </div>
                <Checkbox checked={advTransparent} onChange={(e) => setAdvTransparent(e.target.checked)}>
                  {t('pixelateAdvancedTransparent')}
                </Checkbox>
                <Text type="secondary" style={{ display: 'block' }}>{t('pixelateAdvancedHint')}</Text>
                <Text type="secondary" style={{ display: 'block' }}>{t('pixelateAdvancedDesc')}</Text>
              </Space>
            ),
          },
          {
            key: 'perfectPixel',
            label: t('pixelateTabPerfectPixel'),
            children: (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Text type="secondary" style={{ display: 'block' }}>
                  {t('pixelatePerfectPixelHint')}
                </Text>
                {previewSelection && (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {t('pixelateAdvancedRegionOnly')}
                  </Text>
                )}
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {t('pixelatePerfectPixelSample')}
                  </Text>
                  <Radio.Group value={ppSample} onChange={(e) => setPpSample(e.target.value)}>
                    <Radio value="center">{t('pixelatePerfectPixelCenter')}</Radio>
                    <Radio value="median">{t('pixelatePerfectPixelMedian')}</Radio>
                    <Radio value="majority">{t('pixelatePerfectPixelMajority')}</Radio>
                  </Radio.Group>
                </div>
                <Checkbox checked={ppManualGrid} onChange={(e) => setPpManualGrid(e.target.checked)}>
                  {t('pixelatePerfectPixelManualGrid')}
                </Checkbox>
                {ppManualGrid && (
                  <Space wrap>
                    <span>
                      <Text type="secondary">{t('pixelatePerfectPixelGridCols')}</Text>
                      <InputNumber
                        min={2}
                        max={512}
                        value={ppGridCols}
                        onChange={(v) => setPpGridCols(v ?? 32)}
                        style={{ width: 88, marginLeft: 8 }}
                      />
                    </span>
                    <span>
                      <Text type="secondary">{t('pixelatePerfectPixelGridRows')}</Text>
                      <InputNumber
                        min={2}
                        max={512}
                        value={ppGridRows}
                        onChange={(v) => setPpGridRows(v ?? 32)}
                        style={{ width: 88, marginLeft: 8 }}
                      />
                    </span>
                  </Space>
                )}
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {t('pixelatePerfectPixelMinSize')}
                  </Text>
                  <Space wrap>
                    <Slider
                      min={2}
                      max={16}
                      step={1}
                      value={ppMinSize}
                      onChange={setPpMinSize}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber precision={0} min={2} max={32} value={ppMinSize} onChange={(v) => setPpMinSize(v ?? 4)} style={{ width: 90 }} />
                  </Space>
                </div>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {t('pixelatePerfectPixelPeakWidth')}
                  </Text>
                  <Space wrap>
                    <Slider
                      min={3}
                      max={12}
                      step={1}
                      value={ppPeakWidth}
                      onChange={setPpPeakWidth}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber min={3} max={20} value={ppPeakWidth} onChange={(v) => setPpPeakWidth(v ?? 6)} style={{ width: 90 }} />
                  </Space>
                </div>
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {t('pixelatePerfectPixelRefine')}
                  </Text>
                  <Space wrap>
                    <Slider
                      min={0}
                      max={0.5}
                      step={0.05}
                      value={ppRefine}
                      onChange={setPpRefine}
                      style={{ width: 200, marginRight: 16 }}
                    />
                    <InputNumber
                      min={0}
                      max={0.5}
                      step={0.05}
                      value={ppRefine}
                      onChange={(v) => setPpRefine(typeof v === 'number' ? v : 0.25)}
                      style={{ width: 90 }}
                    />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {t('pixelatePerfectPixelRefineHint')}
                  </Text>
                </div>
                <Checkbox checked={ppFixSquare} onChange={(e) => setPpFixSquare(e.target.checked)}>
                  {t('pixelatePerfectPixelFixSquare')}
                </Checkbox>
              </Space>
            ),
          },
        ]}
      /></div>
      <Space wrap>
        {activeTab === 'pixelate' && (
          <Button type="primary" loading={loading} onClick={runPixelate} disabled={!file||!inputVersion}>
            {t('pixelateApply')}
          </Button>
        )}
        {activeTab === 'mergeNearby' && (
          <Button type="primary" loading={loading} onClick={runMergeNearby} disabled={!file||!inputVersion}>
            {t('pixelateMergeNearbyApply')}
          </Button>
        )}
        {activeTab === 'color16' && (
          <Button type="primary" loading={loading} onClick={run16Color} disabled={!file||!inputVersion}>
            {t('pixelate16ColorApply')}
          </Button>
        )}
        {activeTab === 'advanced' && (
          <Button type="primary" loading={loading} onClick={runAdvancedPixellise} disabled={!file||!inputVersion}>
            {t('pixelateAdvancedApply')}
          </Button>
        )}
        {activeTab === 'perfectPixel' && (
          <Button type="primary" loading={loading} onClick={runPerfectPixel} disabled={!file||!inputVersion}>
            {t('pixelatePerfectPixelApply')}
          </Button>
        )}
        {loading&&<>
          <Text>{taskProgress}%</Text>
          <Button disabled={canceling} onClick={()=>{setCanceling(true);computation.current?.abort()}}>{canceling?taskText.canceling:taskText.cancel}</Button>
        </>}
        {resultUrl && (
          <Button icon={<DownloadOutlined />} onClick={download}>
            {t('imgDownload')}
          </Button>
        )}
      </Space>
      {taskError&&<Alert type="error" title={taskError}/>}
      {resultUrl && (
        <>
          {processingSize&&<Text type="secondary">{taskText.size}: {processingSize.width} × {processingSize.height}</Text>}
          <Text strong style={{ display: 'block' }}>{t('imgPreview')}</Text>
          <div
            style={{
              padding: 16,
              background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
              borderRadius: 8,
              border: '1px solid #9a8b78',
              display: 'inline-block',
            }}
          >
            <StashableImage src={resultUrl} alt="" style={{ maxWidth: '100%', maxHeight: 400, display: 'block', imageRendering: 'pixelated' }} />
          </div>
        </>
      )}
    </Space>
  )
}

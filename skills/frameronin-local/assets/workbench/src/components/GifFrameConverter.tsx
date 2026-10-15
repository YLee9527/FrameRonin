import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { Alert, Button, Pagination, InputNumber, message, Radio, Slider, Space, Tabs, Tooltip, Typography, Upload } from 'antd'
import { CaretLeftOutlined, CaretRightOutlined, DeleteOutlined, DownloadOutlined, DragOutlined, FileImageOutlined, LayoutOutlined, PictureOutlined, MergeCellsOutlined, PlusOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import CropPreview from './CropPreview'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import { cacheManagedInput, importManagedInputs, runManagedTask, type ManagedVersion } from '../localProject/managedTasks'
import { localJson } from '../localProject/api'
import DocumentSaveBar from '../localProject/DocumentSaveBar'
import { initialSequenceDraft, restoreSequenceDocument, serializeSequenceDocument, sequenceFiles, sequenceMetadata, type SequenceDraft } from '../localProject/sequenceDocument'
import { createSequenceHistory, sequenceHistoryReducer } from '../localProject/sequenceHistory'

const { Dragger } = Upload
const { Text } = Typography

const GIF_ACCEPT = '.gif'
const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']
const PREVIEW_PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

export default function GifFrameConverter() {
  const { t, lang } = useLanguage()
  const [history, dispatchHistory] = useReducer(sequenceHistoryReducer, undefined, () => createSequenceHistory(initialSequenceDraft()))
  const { activeTab, gifFile, frameFiles, frameDelay, frameCols, combineFiles, combineCols, imagesToSingleInputMode,
    splitFile, splitRows, splitCols, cropTop, cropBottom, cropLeft, cropRight, stitchFiles, stitchDirection,
    extractedFrameFiles, framesZipFile, gifResultFile, combinedFile, combinedParams, stitchedFile } = history.present
  const updateSequence = useCallback((update:(value:SequenceDraft)=>SequenceDraft) => dispatchHistory({type:'change',update}), [])
  const setter = useCallback(<K extends keyof SequenceDraft,>(key:K) => (value:SetStateAction<SequenceDraft[K]>) => {
    updateSequence(current => ({...current,[key]:typeof value==='function'?(value as (previous:SequenceDraft[K])=>SequenceDraft[K])(current[key]):value}))
  }, [updateSequence])
  const setActiveTab = (value:SequenceDraft['activeTab']) => dispatchHistory({type:'view',activeTab:value})
  const setGifFile = useMemo(() => setter('gifFile'), [setter])
  const setFrameFiles = useMemo(() => setter('frameFiles'), [setter])
  const setFrameDelay = useMemo(() => setter('frameDelay'), [setter])
  const setFrameCols = useMemo(() => setter('frameCols'), [setter])
  const setCombineFiles = useMemo(() => setter('combineFiles'), [setter])
  const setCombineCols = useMemo(() => setter('combineCols'), [setter])
  const setImagesToSingleInputMode = useMemo(() => setter('imagesToSingleInputMode'), [setter])
  const setSplitFile = useMemo(() => setter('splitFile'), [setter])
  const setSplitRows = useMemo(() => setter('splitRows'), [setter])
  const setSplitCols = useMemo(() => setter('splitCols'), [setter])
  const setCropTop = useMemo(() => setter('cropTop'), [setter])
  const setCropBottom = useMemo(() => setter('cropBottom'), [setter])
  const setCropLeft = useMemo(() => setter('cropLeft'), [setter])
  const setCropRight = useMemo(() => setter('cropRight'), [setter])
  const setStitchFiles = useMemo(() => setter('stitchFiles'), [setter])
  const setStitchDirection = useMemo(() => setter('stitchDirection'), [setter])
  const setGifResultFile = useMemo(() => setter('gifResultFile'), [setter])
  const setStitchedFile = useMemo(() => setter('stitchedFile'), [setter])
  const [loading, setLoading] = useState(false)
  const [addingBlankFrame, setAddingBlankFrame] = useState(false)
  const [frameDragReorderIdx, setFrameDragReorderIdx] = useState<number|null>(null)
  const [dragReorderIdx, setDragReorderIdx] = useState<number|null>(null)
  const [cropPreviewIndex, setCropPreviewIndex] = useState(0)
  const [framePage,setFramePage] = useState(1)
  const [combinePage,setCombinePage] = useState(1)
  const [stitchPage,setStitchPage] = useState(1)
  const [metadataRevision,setMetadataRevision] = useState(0)
  const [previewBudget,setPreviewBudget] = useState<number|null>(null)
  const framePageSize=Math.max(frameCols,Math.floor(24/frameCols)*frameCols)
  const combinePageSize=Math.max(combineCols,Math.floor(24/combineCols)*combineCols)
  const framePageValue=Math.min(framePage,Math.max(1,Math.ceil(frameFiles.length/framePageSize)))
  const combinePageValue=Math.min(combinePage,Math.max(1,Math.ceil(combineFiles.length/combinePageSize)))
  const stitchPageValue=Math.min(stitchPage,Math.max(1,Math.ceil(stitchFiles.length/24)))
  const fileUrls = useMemo(()=>[...new Set([gifFile,splitFile,...frameFiles,...combineFiles,...stitchFiles,...extractedFrameFiles,framesZipFile,gifResultFile,combinedFile,stitchedFile].filter((file):file is File=>!!file))]
    .map(file=>({file,url:URL.createObjectURL(file)})),[gifFile,splitFile,frameFiles,combineFiles,stitchFiles,extractedFrameFiles,framesZipFile,gifResultFile,combinedFile,stitchedFile])
  useEffect(()=>()=>fileUrls.forEach(item=>URL.revokeObjectURL(item.url)),[fileUrls])
  const fileUrlIndex=useMemo(()=>new Map(fileUrls.map(item=>[item.file,item.url])),[fileUrls])
  const urlFor=(file:File|null)=>file?fileUrlIndex.get(file)??null:null
  const thumbnailFor=(file:File)=>{
    const value=sequenceMetadata.get(file)?.metadata.thumbnailDataUrl
    return value?.startsWith('data:image/png;base64,')?value:null
  }
  const frameStart=(framePageValue-1)*framePageSize,combineStart=(combinePageValue-1)*combinePageSize,stitchStart=(stitchPageValue-1)*24
  const frameInputUrls=frameFiles.slice(frameStart,frameStart+framePageSize).map((file,index)=>({file,index:frameStart+index,url:thumbnailFor(file),stashUrl:urlFor(file)!}))
  const combineInputUrls=combineFiles.slice(combineStart,combineStart+combinePageSize).map((file,index)=>({file,index:combineStart+index,url:thumbnailFor(file),stashUrl:urlFor(file)!}))
  const stitchInputUrls=stitchFiles.slice(stitchStart,stitchStart+24).map((file,index)=>({file,index:stitchStart+index,url:thumbnailFor(file),stashUrl:urlFor(file)!}))
  const extractedFrameUrls=extractedFrameFiles.slice(0,24).map(file=>thumbnailFor(file)).filter((url):url is string=>!!url)
  const usesStaticPreview=(file:File|null)=>{
    const version=file?sequenceMetadata.get(file):undefined
    return !!file&&!!version&&!!previewBudget&&
      (version.metadata.width??0)*(version.metadata.height??0)*(version.metadata.frames??1)*16+file.size*2>previewBudget/8
  }
  const previewFor=(file:File|null)=>{
    if(!file)return null
    const version=sequenceMetadata.get(file)
    if(!version||!previewBudget)return null
    return usesStaticPreview(file)?thumbnailFor(file):urlFor(file)
  }
  const gifPreviewUrl=previewFor(gifFile),gifUrl=previewFor(gifResultFile),framesZipUrl=urlFor(framesZipFile),combinedUrl=previewFor(combinedFile),stitchResultUrl=previewFor(stitchedFile)
  const splitFileUrl=splitFile?thumbnailFor(splitFile):null
  const cropFile=combineFiles[Math.min(cropPreviewIndex,combineFiles.length-1)]
  const cropThumbnail=cropFile?thumbnailFor(cropFile):null
  const cropMetadata=cropFile?sequenceMetadata.get(cropFile)?.metadata:undefined
  const firstMetadata=combineFiles[0]?sequenceMetadata.get(combineFiles[0])?.metadata:undefined
  const firstImageSize=firstMetadata?.width&&firstMetadata?.height?{w:firstMetadata.width,h:firstMetadata.height}:null
  const currentDraft=useRef(history.present)
  useLayoutEffect(()=>{currentDraft.current=history.present},[history.present])
  const pendingFocus=useRef<{group:'frame'|'combine';index:number}|null>(null)
  useLayoutEffect(()=>{
    const target=pendingFocus.current
    if(target){document.querySelector<HTMLElement>(`[data-sequence-handle="${target.group}:${target.index}"]`)?.focus();pendingFocus.current=null}
  },[frameFiles,combineFiles,framePageValue,combinePageValue])
  const moveFrame=(group:'frame'|'combine',from:number,to:number)=>{
    const key=group==='frame'?'frameFiles':'combineFiles',files=currentDraft.current[key]
    to=Math.max(0,Math.min(files.length-1,to));if(to===from)return
    updateSequence(current=>{const next=[...current[key]],removed=next.splice(from,1)[0];next.splice(to,0,removed);return {...current,[key]:next}})
    pendingFocus.current={group,index:to}
    if(group==='frame')setFramePage(Math.floor(to/framePageSize)+1);else setCombinePage(Math.floor(to/combinePageSize)+1)
  }
  const reorderKey=(event:React.KeyboardEvent,group:'frame'|'combine',index:number)=>{
    const files=group==='frame'?frameFiles:combineFiles,columns=group==='frame'?frameCols:combineCols
    const target=event.key==='ArrowLeft'?index-1:event.key==='ArrowRight'?index+1:event.key==='ArrowUp'?index-columns:event.key==='ArrowDown'?index+columns:event.key==='Home'?0:event.key==='End'?files.length-1:null
    if(target!==null&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();moveFrame(group,index,target)}
  }
  // Metadata changes update thumbnail views without changing the document or undo history.
  void metadataRevision
  useEffect(()=>setCropPreviewIndex(value=>Math.min(value,Math.max(0,combineFiles.length-1))),[combineFiles.length])

  const execution = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const [taskProgress, setTaskProgress] = useState(0)
  const [canceling, setCanceling] = useState(false)
  const [taskError, setTaskError] = useState('')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const taskText = lang === 'zh' ? { cancel: '取消加工', canceling: '正在核对取消', stale: '输入已改变，结果保留在项目素材中', canceled: '加工已取消' }
    : lang === 'ja' ? { cancel: '処理を取消', canceling: '取消を確認中', stale: '入力が変更されました。結果はプロジェクトに保存されています', canceled: '処理を取り消しました' }
      : { cancel: 'Cancel processing', canceling: 'Confirming cancellation', stale: 'Inputs changed; the result remains in Project assets', canceled: 'Processing canceled' }
  const staticPreviewText=lang==='zh'?'为控制内存，此处显示静态缩略图；下载保留完整尺寸和全部帧。'
    :lang==='ja'?'メモリ使用量を抑えるため静止サムネイルを表示しています。ダウンロードは元のサイズと全フレームを保持します。'
      :'A static thumbnail is shown to limit memory use. Downloads retain full dimensions and every frame.'
  const rememberVersion = (file:File,version:ManagedVersion) => {
    if(sequenceMetadata.get(file)?.id===version.id)return
    sequenceMetadata.set(file,version)
    if(mounted.current)setMetadataRevision(value=>value+1)
  }
  const prepareSequenceTask = async (signal: AbortSignal) => {
    const { project, memoryBudgetBytes } = await importManagedInputs([...sequenceFiles([currentDraft.current])], signal,
      (file,version)=>rememberVersion(file as File,version))
    if(mounted.current)setPreviewBudget(memoryBudgetBytes)
    const retained=sequenceFiles([history.present,...history.past,...history.future,...(history.checkpoint?[history.checkpoint]:[])])
    let frontendBytes=[...retained].reduce((total,file)=>total+file.size*2,0)
    // Visible thumbnails, crop preview and potentially animated result previews.
    frontendBytes += [...retained].reduce((total,file)=>{const meta=sequenceMetadata.get(file)?.metadata;return total+Math.min(128,meta?.width??128)*Math.min(128,meta?.height??128)*16},0)
    for(const file of [gifFile,gifResultFile,combinedFile,stitchedFile]){
      if(!file)continue
      const version=sequenceMetadata.get(file)
      const estimate=(version?.metadata.width??0)*(version?.metadata.height??0)*(version?.metadata.frames??1)*16
      if(estimate+file.size*2<=memoryBudgetBytes/8)frontendBytes+=estimate
    }
    if(frontendBytes>memoryBudgetBytes/4)throw new Error('SEQUENCE_FRONTEND_RESOURCE_LIMIT')
    return { project, frontendBytes }
  }
  const runSequenceTask = async (operation:string,files:File[],parameters:object,fields:(keyof SequenceDraft)[],
    accept:(outputs:{file:File;version:ManagedVersion}[],before:SequenceDraft)=>void,success:string,
    name:(index:number,version:ManagedVersion)=>string= index=>`frame_${String(index).padStart(3,'0')}.png`) => {
    if(execution.current||!files.length)return
    const before=currentDraft.current
    const controller=new AbortController();execution.current=controller
    setLoading(true);setCanceling(false);setTaskProgress(0);setTaskError('')
    try{
      const {project,frontendBytes}=await prepareSequenceTask(controller.signal)
      const {outputs}=await runManagedTask(operation,files,{...parameters,frontendBytes},{signal:controller.signal,
        onProgress:value=>{if(mounted.current)setTaskProgress(value)},
        outputFilter:version=>version.metadata.kind==='image'||version.metadata.extension==='.gif'||version.metadata.extension==='.zip'})
      if(!mounted.current)return
      if(fields.some(field=>currentDraft.current[field]!==before[field]))throw new Error(taskText.stale)
      const results=outputs.map((output,index)=>{
        const type=output.version.metadata.extension==='.gif'?'image/gif':output.version.metadata.extension==='.zip'?'application/zip':'image/png'
        const file=new File([output.blob],name(index,output.version),{type})
        cacheManagedInput(file,project.id,output.version.id);rememberVersion(file,output.version)
        return {file,version:output.version}
      })
      if(!results.length)throw new Error('SEQUENCE_RESULT_INCOMPLETE')
      accept(results,before);message.success(success)
    }catch(error){if(mounted.current)setTaskError(controller.signal.aborted&&error instanceof DOMException&&error.name==='AbortError'?taskText.canceled:String(error))}
    finally{if(execution.current===controller)execution.current=null;if(mounted.current){setLoading(false);setCanceling(false);setAddingBlankFrame(false)}}
  }

  useEffect(()=>{
    localJson<{memoryBudgetBytes:number}>('/api/project/context').then(value=>{
      if(mounted.current&&Number.isFinite(value.memoryBudgetBytes)&&value.memoryBudgetBytes>0)setPreviewBudget(value.memoryBudgetBytes)
    }).catch(error=>{if(mounted.current)setTaskError(String(error))})
  },[])
  useEffect(()=>{
    const end=()=>dispatchHistory({type:'end'})
    window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end)
    return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end)}
  },[])
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.isComposing||!(event.metaKey||event.ctrlKey)||event.altKey)return
      const target=event.target as HTMLElement
      if(target.closest('input,textarea,select,[contenteditable="true"]'))return
      if(event.code==='KeyZ'||event.code==='KeyY'){
        event.preventDefault();dispatchHistory({type:event.code==='KeyY'||event.shiftKey?'redo':'undo'})
      }
    }
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)
  },[])

  const runSplitSingleImage = () => {
    if(!splitFile)return
    const base=splitFile.name.replace(/\.[^.]+$/,'')
    return runSequenceTask('image.sliceBrowser',[splitFile],{rows:splitRows,columns:splitCols},['splitFile','splitRows','splitCols'],outputs=>{
      updateSequence(current=>({...current,combineFiles:outputs.map(output=>output.file),combinedFile:null,combinedParams:null}))
    },t('imagesToSingleSplitSuccess',{n:splitRows*splitCols}),index=>`${base}_${Math.floor(index/splitCols)}_${index%splitCols}.png`)
  }
  const runSuperSplitSingleImage = () => {
    if(!splitFile)return
    const base=splitFile.name.replace(/\.[^.]+$/,'')
    return runSequenceTask('image.superSlice',[splitFile],{},['splitFile'],outputs=>{
      updateSequence(current=>({...current,combineFiles:outputs.map(output=>output.file),imagesToSingleInputMode:'multi',combinedFile:null,combinedParams:null}))
    },t('imagesToSingleSuccess'),index=>`${base}_super_${index}.png`)
  }
  const runImagesToSingle = () => runSequenceTask('sequence.combine',combineFiles,{columns:combineCols,cropTop,cropBottom,cropLeft,cropRight},
    ['combineFiles','combineCols','cropTop','cropBottom','cropLeft','cropRight'],(outputs,before)=>{
      const output=outputs[0],metadata=output.version.metadata
      updateSequence(current=>({...current,combinedFile:output.file,combinedParams:{cols:before.combineCols,rows:Math.ceil(before.combineFiles.length/before.combineCols),
        outW:metadata.width!,outH:metadata.height!,cropTop:before.cropTop,cropBottom:before.cropBottom,cropLeft:before.cropLeft,cropRight:before.cropRight}}))
    },t('imagesToSingleSuccess'),()=> 'combined.png')
  const addBlankCombineFrame = () => {
    if(!combineFiles.length||execution.current)return
    setAddingBlankFrame(true)
    return runSequenceTask('image.blank',[combineFiles[0]],{},['combineFiles'],outputs=>{
      updateSequence(current=>({...current,combineFiles:[...current.combineFiles,outputs[0].file]}))
    },t('imagesToSingleSuccess'),()=>`blank_${String(combineFiles.length+1).padStart(3,'0')}.png`)
  }

  const downloadCombined = () => {
    if (!combinedFile) return
    const a = document.createElement('a')
    a.href = urlFor(combinedFile)!
    const p = combinedParams
    const name = p
      ? `combined_${p.cols}x${p.rows}_${p.outW}x${p.outH}_T${p.cropTop}B${p.cropBottom}L${p.cropLeft}R${p.cropRight}.png`
      : 'combined.png'
    a.download = name
    a.click()
  }

  const runGifToFrames = () => {
    if(!gifFile)return
    const base=gifFile.name.replace(/\.gif$/i,'')||'frames'
    return runSequenceTask('gif.split',[gifFile],{renderer:'browser'},['gifFile'],outputs=>{
      const archive=outputs.find(output=>output.version.metadata.extension==='.zip')
      const frames=outputs.filter(output=>output.version.metadata.kind==='image').map(output=>output.file)
      if(!archive||!frames.length)throw new Error('GIF_RESULT_INCOMPLETE')
      updateSequence(current=>({...current,extractedFrameFiles:frames,framesZipFile:archive.file}))
    },t('imagesToSingleSuccess'),(index,version)=>version.metadata.extension==='.zip'?`${base}_frames.zip`:`${base}_frame_${String(index).padStart(3,'0')}.png`)
  }
  const runFramesToGif = () => runSequenceTask('sequence.gif',frameFiles,{duration:frameDelay,renderer:'browser',sizePolicy:'first'},
    ['frameFiles','frameDelay'],outputs=>setGifResultFile(outputs[0].file),t('gifEncodeSuccess'),()=> 'output.gif')

  const downloadZip = () => {
    if (!framesZipUrl) return
    const a = document.createElement('a')
    a.href = framesZipUrl
    a.download = (gifFile?.name?.replace(/\.gif$/i, '') || 'frames') + '_frames.zip'
    a.click()
  }

  const importFramesToCombine = () => {
    if(!extractedFrameFiles.length)return
    updateSequence(current=>({...current,combineFiles:current.extractedFrameFiles,imagesToSingleInputMode:'multi',combinedFile:null,combinedParams:null,
      cropTop:0,cropBottom:0,cropLeft:0,cropRight:0,activeTab:'images2single'}))
    message.success(t('gifFramesToCombineSuccess',{n:extractedFrameFiles.length}))
  }

  const downloadGif = () => {
    if (!gifResultFile) return
    const a = document.createElement('a')
    a.href = urlFor(gifResultFile)!
    a.download = 'output.gif'
    a.click()
  }

  const runSimpleStitch = () => runSequenceTask('sequence.stitch',stitchFiles,{direction:stitchDirection},['stitchFiles','stitchDirection'],
    outputs=>setStitchedFile(outputs[0].file),t('simpleStitchSuccess'),()=> 'stitched.png')

  const downloadStitch = () => {
    if (!stitchedFile) return
    const a = document.createElement('a')
    a.href = urlFor(stitchedFile)!
    a.download = 'stitched.png'
    a.click()
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%', paddingTop: 8 }}>
      <DocumentSaveBar kind="sequence" snapshot={history.present}
        serialize={draft=>serializeSequenceDocument(draft,rememberVersion)}
        restore={value=>restoreSequenceDocument(value,[...sequenceFiles([history.present,...history.past,...history.future])])}
        applySnapshot={draft=>dispatchHistory({type:'restore',draft})}/>
      <Space>
        <Button disabled={!history.past.length&&!history.checkpoint} onClick={()=>dispatchHistory({type:'undo'})}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
        <Button disabled={!history.future.length} onClick={()=>dispatchHistory({type:'redo'})}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
      </Space>
      {execution.current && <Button disabled={canceling} onClick={() => { setCanceling(true); execution.current?.abort() }}>
        {canceling ? taskText.canceling : taskText.cancel} · {Math.round(taskProgress * 100)}%
      </Button>}
      {taskError && <Alert type="error" title={taskError} />}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'gif2frames' | 'frames2gif' | 'images2single' | 'simpleStitch')}
        items={[
          {
            key: 'gif2frames',
            label: (
              <span>
                <FileImageOutlined /> {t('gifToFrames')}
              </span>
            ),
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{t('gifToFramesHint')}</Text>
                <StashDropZone
                  onStashDrop={(f) => updateSequence(current=>({...current,gifFile:f,extractedFrameFiles:[],framesZipFile:null}))}
                >
                  <Dragger
                    accept={GIF_ACCEPT}
                    maxCount={1}
                    fileList={gifFile ? [{ uid: '1', name: gifFile.name } as UploadFile] : []}
                    beforeUpload={(f) => {
                      updateSequence(current=>({...current,gifFile:f,extractedFrameFiles:[],framesZipFile:null}))
                      return false
                    }}
                    onRemove={() => setGifFile(null)}
                  >
                    <p className="ant-upload-text">{t('gifUploadHint')}</p>
                  </Dragger>
                </StashDropZone>
                {gifFile && gifPreviewUrl && (
                  <>
                    <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>{t('imgOriginalPreview')}</Text>
                    {usesStaticPreview(gifFile)&&<Text type="secondary" style={{display:'block',marginBottom:8}}>{staticPreviewText}</Text>}
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        display: 'inline-block',
                      }}
                    >
                      <StashableImage
                        src={gifPreviewUrl}
                        alt=""
                        style={{ maxWidth: 320, maxHeight: 240, display: 'block' }}
                      />
                    </div>
                  </>
                )}
                <Space style={{ marginTop: 16 }} wrap>
                  <Button type="primary" loading={loading} onClick={runGifToFrames} disabled={!gifFile}>
                    {t('gifToFrames')}
                  </Button>
                  {framesZipUrl && (
                    <Button icon={<DownloadOutlined />} onClick={downloadZip}>
                      {t('gifDownloadFrames')}
                    </Button>
                  )}
                  {extractedFrameFiles.length > 0 && (
                    <Button icon={<MergeCellsOutlined />} onClick={importFramesToCombine}>
                      {t('gifFramesToCombine')}
                    </Button>
                  )}
                </Space>
                {extractedFrameUrls.length > 0 && (
                  <>
                    <Text strong style={{ display: 'block', marginTop: 24, marginBottom: 8 }}>{t('imgPreview')}</Text>
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        display: 'inline-block',
                        maxWidth: '100%',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 320, overflow: 'auto' }}>
                        {extractedFrameUrls.map((url, i) => (
                          <StashableImage
                            key={i}
                            src={url??PREVIEW_PLACEHOLDER}
                            stashSrc={urlFor(extractedFrameFiles[i])!}
                            aria-busy={!url}
                            alt={`${t('frame')} ${i + 1}`}
                            style={{ maxWidth: 120, maxHeight: 120, imageRendering: 'pixelated', border: '1px solid rgba(0,0,0,0.1)' }}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            ),
          },
          {
            key: 'frames2gif',
            label: (
              <span>
                <PictureOutlined /> {t('framesToGif')}
              </span>
            ),
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{t('framesToGifHint')}</Text>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('gifFrameDelay')}:</Text>
                <div onPointerDownCapture={()=>dispatchHistory({type:'begin'})}>
                  <Slider min={20} max={500} value={frameDelay} onChange={setFrameDelay} style={{ maxWidth: 200, marginBottom: 16 }} />
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>{frameDelay} ms</Text>
                {frameFiles.length > 0 && (
                  <Space wrap align="center" style={{ marginBottom: 12 }}>
                    <Text type="secondary">{t('gifFrameCols')}:</Text>
                    <InputNumber min={1} max={16} precision={0} value={frameCols} onChange={(v) => setFrameCols(v ?? 6)} style={{ width: 64 }} />
                  </Space>
                )}
                <StashDropZone
                  onStashDrop={(f) => setFrameFiles((prev) => [...prev, f])}
                >
                  <Dragger
                    accept={IMAGE_ACCEPT.join(',')}
                    multiple
                    fileList={frameInputUrls.map(({file:f,index:i}) => ({ uid: String(i), name: f.name } as UploadFile))}
                    beforeUpload={(f, selected) => {
                      if(f===selected[0]) setFrameFiles(prev=>[...prev,...selected])
                      return false
                    }}
                    onRemove={(file) => {
                      const idx = frameFiles.findIndex((_, i) => String(i) === file.uid)
                      if (idx >= 0) setFrameFiles((prev) => prev.filter((_, i) => i !== idx))
                    }}
                    style={{ marginTop: 16 }}
                  >
                    <p className="ant-upload-text">{t('framesUploadHint')}</p>
                  </Dragger>
                </StashDropZone>
                {frameInputUrls.length > 0 && (
                  <>
                    <Pagination aria-label="frame preview page" current={framePageValue} total={frameFiles.length} pageSize={framePageSize} showSizeChanger={false} onChange={setFramePage} size="small" />
                    <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>{t('imgOriginalPreview')}</Text>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>{t('gifFrameReorderHint')}</Text>
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        width: '100%',
                        maxWidth: 720,
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(${Math.max(1, frameCols)}, 1fr)`,
                          gap: 12,
                          maxHeight: 400,
                          overflow: 'auto',
                        }}
                      >
                        {frameInputUrls.map(({url,index:i,stashUrl}) => (
                          <div
                            key={i}
                            style={{
                              position: 'relative',
                              display: 'inline-block',
                              opacity: frameDragReorderIdx === i ? 0.6 : 1,
                              border: frameDragReorderIdx === i ? '2px dashed #b55233' : 'none',
                              borderRadius: 4,
                            }}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              e.dataTransfer.dropEffect = 'move'
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              const from = frameDragReorderIdx
                              if (from === null || from === i) return
                              setFrameFiles((prev) => {
                                const next = [...prev]
                                const [item] = next.splice(from, 1)
                                next.splice(i, 0, item!)
                                return next
                              })
                              setFrameDragReorderIdx(null)
                            }}
                            onDragLeave={() => {}}
                          >
                            <StashableImage
                              src={url??PREVIEW_PLACEHOLDER}
                              stashSrc={stashUrl}
                              aria-busy={!url}
                              alt={`${t('frame')} ${i + 1}`}
                              draggable={false}
                              style={{ maxWidth: 120, maxHeight: 120, width: '100%', objectFit: 'contain', imageRendering: 'pixelated', border: '1px solid rgba(0,0,0,0.1)', display: 'block' }}
                            />
                            <span
                              role="button" tabIndex={0} data-sequence-handle={`frame:${i}`}
                              aria-label={`${t('frame')} ${i+1} · ${lang==='zh'?'排序':lang==='ja'?'並べ替え':'Reorder'}`}
                              onKeyDown={event=>reorderKey(event,'frame',i)}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation()
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('text/plain', String(i))
                                setFrameDragReorderIdx(i)
                              }}
                              onDragEnd={() => setFrameDragReorderIdx(null)}
                              style={{
                                position: 'absolute',
                                top: 2,
                                left: 2,
                                width: 18,
                                height: 18,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'rgba(0,0,0,0.5)',
                                cursor: 'grab',
                                background: 'rgba(255,255,255,0.8)',
                                borderRadius: 2,
                                zIndex: 1,
                              }}
                            >
                              <DragOutlined style={{ fontSize: 12 }} />
                            </span>
                            <Button
                              type="primary"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={(e) => {
                                e.stopPropagation()
                                setFrameFiles((prev) => prev.filter((_, idx) => idx !== i))
                              }}
                              style={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                width: 18,
                                height: 18,
                                minWidth: 18,
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: 0.9,
                                fontSize: 10,
                              }}
                            />
                            {i % frameCols === 0 && (
                              <Tooltip title={t('gifFrameDeleteRow')}>
                                <Button
                                  type="primary"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const rowStart = Math.floor(i / frameCols) * frameCols
                                    const rowEnd = Math.min(rowStart + frameCols, frameFiles.length)
                                    setFrameFiles((prev) => prev.filter((_, idx) => idx < rowStart || idx >= rowEnd))
                                  }}
                                  style={{
                                    position: 'absolute',
                                    bottom: 2,
                                    left: 2,
                                    width: 18,
                                    height: 18,
                                    minWidth: 18,
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: 0.9,
                                    fontSize: 10,
                                  }}
                                />
                              </Tooltip>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <Space style={{ marginTop: 16 }}>
                  <Button type="primary" loading={loading} onClick={runFramesToGif} disabled={frameFiles.length === 0}>
                    {t('framesToGif')}
                  </Button>
                  {gifUrl && (
                    <Button icon={<DownloadOutlined />} onClick={downloadGif}>
                      {t('gifDownloadGif')}
                    </Button>
                  )}
                </Space>
                {gifUrl && (
                  <>
                    <Text strong style={{ display: 'block', marginTop: 24, marginBottom: 8 }}>{t('imgPreview')}</Text>
                    {usesStaticPreview(gifResultFile)&&<Text type="secondary" style={{display:'block',marginBottom:8}}>{staticPreviewText}</Text>}
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        display: 'inline-block',
                      }}
                    >
                      <StashableImage
                        src={gifUrl}
                        alt={t('imgPreview')}
                        style={{ maxWidth: '100%', maxHeight: 320, display: 'block', imageRendering: 'auto' }}
                      />
                    </div>
                  </>
                )}
              </>
            ),
          },
          {
            key: 'images2single',
            label: (
              <span>
                <MergeCellsOutlined /> {t('imagesToSingle')}
              </span>
            ),
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{t('imagesToSingleHint')}</Text>
                <Space wrap align="center" style={{ marginBottom: 12 }}>
                  <Text type="secondary">{t('imagesToSingleCols')}:</Text>
                  <InputNumber min={1} max={64} precision={0} value={combineCols} onChange={(v) => setCombineCols(v ?? 4)} style={{ width: 72 }} />
                </Space>
                <Space wrap align="center" style={{ marginBottom: 12 }}>
                  <Text type="secondary">{t('imagesToSingleInputMode')}:</Text>
                  <Radio.Group
                    value={imagesToSingleInputMode}
                    onChange={(e) => setImagesToSingleInputMode(e.target.value)}
                    optionType="button"
                    size="small"
                  >
                    <Radio.Button value="multi">{t('imagesToSingleInputMulti')}</Radio.Button>
                    <Radio.Button value="split">{t('imagesToSingleInputSplit')}</Radio.Button>
                  </Radio.Group>
                </Space>
                {imagesToSingleInputMode === 'split' && (
                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('imagesToSingleSplitHint')}</Text>
                    <Space wrap align="center" style={{ marginBottom: 8 }}>
                      <InputNumber min={1} max={32} precision={0} value={splitRows} onChange={(v) => setSplitRows(v ?? 2)} style={{ width: 64 }} addonBefore={t('imagesToSingleSplitRows')} />
                      <InputNumber min={1} max={32} precision={0} value={splitCols} onChange={(v) => setSplitCols(v ?? 2)} style={{ width: 64 }} addonBefore={t('imagesToSingleSplitCols')} />
                    </Space>
                    <StashDropZone onStashDrop={(f) => setSplitFile(f)}>
                      <Dragger
                        accept={IMAGE_ACCEPT.join(',')}
                        maxCount={1}
                        fileList={splitFile ? [{ uid: 'split-1', name: splitFile.name } as UploadFile] : []}
                        beforeUpload={(f) => {
                          setSplitFile(f)
                          return false
                        }}
                        onRemove={() => setSplitFile(null)}
                      >
                        <p className="ant-upload-text">{t('imagesToSingleSplitUploadHint')}</p>
                      </Dragger>
                    </StashDropZone>
                    {splitFileUrl && (
                      <div style={{ marginTop: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('imgOriginalPreview')}:</Text>
                        <div style={{ marginTop: 4, display: 'inline-block', padding: 8, background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px', borderRadius: 4, border: '1px solid #9a8b78' }}>
                          <StashableImage src={splitFileUrl} alt="" style={{ maxWidth: 200, maxHeight: 120, display: 'block' }} />
                        </div>
                      </div>
                    )}
                    <Space style={{ marginTop: 8 }}>
                      <Button
                        type="primary"
                        loading={loading}
                        onClick={runSplitSingleImage}
                        disabled={!splitFile}
                      >
                        {loading ? t('imagesToSingleSplitBtnLoading') : t('imagesToSingleSplitBtn')}
                      </Button>
                      <Button
                        loading={loading}
                        disabled={!splitFile}
                        onClick={runSuperSplitSingleImage}
                      >
                        {t('imagesToSingleSuperSplitBtn')}
                      </Button>
                    </Space>
                  </div>
                )}
                {imagesToSingleInputMode === 'multi' && (
                  <StashDropZone onStashDrop={(f) => setCombineFiles((prev) => [...prev, f])}>
                    <Dragger
                      accept={IMAGE_ACCEPT.join(',')}
                      multiple
                      fileList={combineInputUrls.map(({file:f,index:i}) => ({ uid: `c-${i}`, name: f.name } as UploadFile))}
                      beforeUpload={(f, selected) => {
                        if(f===selected[0]) setCombineFiles(prev=>[...prev,...selected])
                        return false
                      }}
                      onRemove={(file) => {
                        const idx = combineFiles.findIndex((_, i) => `c-${i}` === file.uid)
                        if (idx >= 0) setCombineFiles((prev) => prev.filter((_, i) => i !== idx))
                      }}
                    >
                      <p className="ant-upload-text">{t('framesUploadHint')}</p>
                    </Dragger>
                  </StashDropZone>
                )}
                {combineFiles.length > 0 && combineInputUrls.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('imagesToSingleCropHint')}</Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }} onPointerDownCapture={()=>dispatchHistory({type:'begin'})}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Button
                            type="text"
                            size="small"
                            icon={<CaretLeftOutlined />}
                            disabled={combineFiles.length <= 1 || cropPreviewIndex <= 0}
                            onClick={() => setCropPreviewIndex((i) => Math.max(0, i - 1))}
                          />
                          {cropThumbnail && <CropPreview
                            key={cropPreviewIndex}
                            imageUrl={cropThumbnail}
                            imageDimensions={cropMetadata?.width&&cropMetadata?.height?{w:cropMetadata.width,h:cropMetadata.height}:undefined}
                            cropTop={cropTop}
                            cropBottom={cropBottom}
                            cropLeft={cropLeft}
                            cropRight={cropRight}
                            onChange={({ top, bottom, left, right }) => updateSequence(current=>({...current,cropTop:top,cropBottom:bottom,cropLeft:left,cropRight:right}))}
                            loadingText={t('cropPreviewLoading')}
                            allowNegative
                          />}
                          <Button
                            type="text"
                            size="small"
                            icon={<CaretRightOutlined />}
                            disabled={combineFiles.length <= 1 || cropPreviewIndex >= combineFiles.length - 1}
                            onClick={() => setCropPreviewIndex((i) => Math.min(combineFiles.length - 1, i + 1))}
                          />
                        </div>
                        {combineFiles.length > 1 && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('imagesToSingleCropPreviewN', { current: cropPreviewIndex + 1, total: combineFiles.length })}
                          </Text>
                        )}
                        {(cropTop < 0 || cropBottom < 0 || cropLeft < 0 || cropRight < 0) && (
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('imagesToSingleCropNegativeHint')}</Text>
                        )}
                      </div>
                      <div style={{ alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Space wrap align="center">
                          <InputNumber min={-999} value={cropTop} onChange={(v) => setCropTop(v ?? 0)} style={{ width: 64 }} addonBefore={t('batchCropTop')} />
                          <InputNumber min={-999} value={cropBottom} onChange={(v) => setCropBottom(v ?? 0)} style={{ width: 64 }} addonBefore={t('batchCropBottom')} />
                          <InputNumber min={-999} value={cropLeft} onChange={(v) => setCropLeft(v ?? 0)} style={{ width: 64 }} addonBefore={t('batchCropLeft')} />
                          <InputNumber min={-999} value={cropRight} onChange={(v) => setCropRight(v ?? 0)} style={{ width: 64 }} addonBefore={t('batchCropRight')} />
                        </Space>
                        {firstImageSize && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('imagesToSingleCropRemaining', {
                              w: Math.max(1, firstImageSize.w - cropLeft - cropRight),
                              h: Math.max(1, firstImageSize.h - cropTop - cropBottom),
                            })}
                          </Text>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {combineInputUrls.length > 0 && (
                  <>
                    <Pagination aria-label="combine preview page" current={combinePageValue} total={combineFiles.length} pageSize={combinePageSize} showSizeChanger={false} onChange={setCombinePage} size="small" />
                    <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>{t('imgOriginalPreview')}</Text>
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        width: '100%',
                        maxWidth: 720,
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(${Math.max(1, combineCols)}, 1fr)`,
                          gap: 12,
                          maxHeight: 600,
                          overflow: 'auto',
                        }}
                      >
                        {combineInputUrls.map(({url,index:i,stashUrl}) => (
                          <div
                            key={i}
                            style={{
                              position: 'relative',
                              display: 'inline-block',
                              opacity: dragReorderIdx === i ? 0.6 : 1,
                              border: dragReorderIdx === i ? '2px dashed #b55233' : 'none',
                              borderRadius: 4,
                            }}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              e.dataTransfer.dropEffect = 'move'
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              const from = dragReorderIdx
                              if (from === null || from === i) return
                              setCombineFiles((prev) => {
                                const next = [...prev]
                                const [item] = next.splice(from, 1)
                                next.splice(i, 0, item!)
                                return next
                              })
                              setDragReorderIdx(null)
                            }}
                            onDragLeave={() => {}}
                          >
                            <StashableImage
                              src={url??PREVIEW_PLACEHOLDER}
                              stashSrc={stashUrl}
                              aria-busy={!url}
                              alt={`${t('frame')} ${i + 1}`}
                              draggable={false}
                              style={{ maxWidth: 120, maxHeight: 120, width: '100%', objectFit: 'contain', imageRendering: 'pixelated', border: '1px solid rgba(0,0,0,0.1)', display: 'block' }}
                            />
                            <span
                              role="button" tabIndex={0} data-sequence-handle={`combine:${i}`}
                              aria-label={`${t('frame')} ${i+1} · ${lang==='zh'?'排序':lang==='ja'?'並べ替え':'Reorder'}`}
                              onKeyDown={event=>reorderKey(event,'combine',i)}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation()
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('text/plain', String(i))
                                setDragReorderIdx(i)
                              }}
                              onDragEnd={() => setDragReorderIdx(null)}
                              style={{
                                position: 'absolute',
                                top: 2,
                                left: 2,
                                width: 18,
                                height: 18,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'rgba(0,0,0,0.5)',
                                cursor: 'grab',
                                background: 'rgba(255,255,255,0.8)',
                                borderRadius: 2,
                                zIndex: 1,
                              }}
                            >
                              <DragOutlined style={{ fontSize: 12 }} />
                            </span>
                            <Button
                              type="primary"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={(e) => {
                                e.stopPropagation()
                                setCombineFiles((prev) => prev.filter((_, idx) => idx !== i))
                              }}
                              style={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                width: 18,
                                height: 18,
                                minWidth: 18,
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: 0.9,
                                fontSize: 10,
                              }}
                            />
                            {i % combineCols === 0 && (
                              <Tooltip title={t('imagesToSingleDeleteRow')}>
                                <Button
                                  type="primary"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const rowStart = Math.floor(i / combineCols) * combineCols
                                    const rowEnd = Math.min(rowStart + combineCols, combineFiles.length)
                                    setCombineFiles((prev) => prev.filter((_, idx) => idx < rowStart || idx >= rowEnd))
                                  }}
                                  style={{
                                    position: 'absolute',
                                    bottom: 2,
                                    left: 2,
                                    width: 18,
                                    height: 18,
                                    minWidth: 18,
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: 0.9,
                                    fontSize: 10,
                                  }}
                                />
                              </Tooltip>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <Space style={{ marginTop: 12 }}>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={addBlankCombineFrame}
                        disabled={combineFiles.length === 0}
                        loading={addingBlankFrame}
                      >
                        {t('imagesToSingleAddBlank')}
                      </Button>
                    </Space>
                  </>
                )}
                <Space wrap style={{ marginTop: 16 }} align="center">
                  <Button type="primary" loading={loading} onClick={runImagesToSingle} disabled={combineFiles.length === 0}>
                    {loading ? t('imagesToSingleCombining') : t('imagesToSingleCombine')}
                  </Button>
                  {combinedUrl && (
                    <>
                      <Button icon={<DownloadOutlined />} onClick={downloadCombined}>
                        {t('imagesToSingleDownload')}
                      </Button>
                      {combinedParams && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('imagesToSingleParams', {
                            cols: combinedParams.cols,
                            rows: combinedParams.rows,
                            w: combinedParams.outW,
                            h: combinedParams.outH,
                            t: combinedParams.cropTop,
                            b: combinedParams.cropBottom,
                            l: combinedParams.cropLeft,
                            r: combinedParams.cropRight,
                          })}
                        </Text>
                      )}
                    </>
                  )}
                </Space>
                {combinedUrl && (
                  <>
                    <Text strong style={{ display: 'block', marginTop: 24, marginBottom: 8 }}>{t('imgPreview')}</Text>
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        display: 'inline-block',
                      }}
                    >
                      <StashableImage
                        src={combinedUrl}
                        alt={t('imgPreview')}
                        style={{ maxWidth: '100%', maxHeight: 400, display: 'block', imageRendering: 'pixelated' }}
                      />
                    </div>
                  </>
                )}
              </>
            ),
          },
          {
            key: 'simpleStitch',
            label: (
              <span>
                <LayoutOutlined /> {t('simpleStitch')}
              </span>
            ),
            children: (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{t('simpleStitchHint')}</Text>
                <Space wrap align="center" style={{ marginBottom: 12 }}>
                  <Text type="secondary">{t('simpleStitchDirection')}:</Text>
                  <Radio.Group
                    value={stitchDirection}
                    onChange={(e) => setStitchDirection(e.target.value)}
                    optionType="button"
                    size="small"
                  >
                    <Radio.Button value="vertical">{t('simpleStitchVertical')}</Radio.Button>
                    <Radio.Button value="horizontal">{t('simpleStitchHorizontal')}</Radio.Button>
                    <Radio.Button value="overlay">{t('simpleStitchOverlay')}</Radio.Button>
                  </Radio.Group>
                </Space>
                <StashDropZone onStashDrop={(f) => setStitchFiles((prev) => [...prev, f])}>
                  <Dragger
                    accept={IMAGE_ACCEPT.join(',')}
                    multiple
                    fileList={stitchInputUrls.map(({file:f,index:i}) => ({ uid: `s-${i}`, name: f.name } as UploadFile))}
                    beforeUpload={(f, selected) => {
                      if(f===selected[0]) setStitchFiles(prev=>[...prev,...selected])
                      return false
                    }}
                    onRemove={(file) => {
                      const idx = stitchFiles.findIndex((_, i) => `s-${i}` === file.uid)
                      if (idx >= 0) setStitchFiles((prev) => prev.filter((_, i) => i !== idx))
                    }}
                  >
                    <p className="ant-upload-text">{t('simpleStitchUploadHint')}</p>
                  </Dragger>
                </StashDropZone>
                {stitchInputUrls.length > 0 && (
                  <>
                    <Pagination aria-label="stitch preview page" current={stitchPageValue} total={stitchFiles.length} pageSize={24} showSizeChanger={false} onChange={setStitchPage} size="small" />
                    <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>{t('imgOriginalPreview')}</Text>
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        display: 'inline-block',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 200, overflow: 'auto' }}>
                        {stitchInputUrls.map(({url,index:i,stashUrl}) => (
                          <StashableImage
                            key={i}
                            src={url??PREVIEW_PLACEHOLDER}
                            stashSrc={stashUrl}
                            aria-busy={!url}
                            alt={`${t('frame')} ${i + 1}`}
                            style={{ maxWidth: 80, maxHeight: 80, objectFit: 'contain', border: '1px solid rgba(0,0,0,0.1)' }}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <Space style={{ marginTop: 16 }}>
                  <Button type="primary" loading={loading} onClick={runSimpleStitch} disabled={stitchFiles.length === 0}>
                    {t('simpleStitchRun')}
                  </Button>
                  {stitchResultUrl && (
                    <Button icon={<DownloadOutlined />} onClick={downloadStitch}>
                      {t('simpleStitchDownload')}
                    </Button>
                  )}
                </Space>
                {stitchResultUrl && (
                  <>
                    <Text strong style={{ display: 'block', marginTop: 24, marginBottom: 8 }}>{t('imgPreview')}</Text>
                    <div
                      style={{
                        padding: 16,
                        background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                        borderRadius: 8,
                        border: '1px solid #9a8b78',
                        display: 'inline-block',
                      }}
                    >
                      <StashableImage
                        src={stitchResultUrl}
                        alt={t('imgPreview')}
                        style={{ maxWidth: '100%', maxHeight: 400, display: 'block', imageRendering: 'pixelated' }}
                      />
                    </div>
                  </>
                )}
              </>
            ),
          },
        ]}
      />
    </Space>
  )
}

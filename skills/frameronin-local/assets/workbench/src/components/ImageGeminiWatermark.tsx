/** Visible Gemini mark only; reverse-alpha algorithm from allenk/GeminiWatermarkTool (MIT).
 * This does not remove invisible SynthID marks. */
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {Button,Radio,Space,Typography,Upload} from 'antd'
import {DownloadOutlined} from '@ant-design/icons'
import type {UploadFile} from 'antd'
import {useLanguage} from '../i18n/context'
import StashDropZone from './StashDropZone'
import StashableImage from './StashableImage'
import {useImageToolDocument} from '../localProject/useImageToolDocument'
import {ImageToolDocumentSurface} from '../localProject/ImageToolDocumentSurface'
import {useImageToolUrls,useManagedImageTool} from '../localProject/useManagedImageTool'
import {prepareFineInput} from '../localProject/fineEditInput'
import ManagedImageToolStatus from './ManagedImageToolStatus'

const {Dragger}=Upload,{Text}=Typography
export default function ImageGeminiWatermark(){
 const {t,lang}=useLanguage(),model=useImageToolDocument('visibleWatermark')
 const {files,parameters}=model.draft,file=files[0]??null
 const tool=useManagedImageTool(files,parameters,undefined,model)
 const source=useImageToolUrls(files,tool.versions)[0]
 const outputs=useMemo(()=>tool.results.map(r=>r.file),[tool.results]),result=useImageToolUrls(outputs,tool.results.map(r=>r.version))[0]
 const alive=useRef(true),incoming=useRef<{controller:AbortController;promise:Promise<boolean>}|null>(null)
 const [checking,setChecking]=useState(false),[error,setError]=useState('')
 const text=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;incoming.current?.controller.abort()}},[])
 const beforeAction=useCallback(async()=>{await incoming.current?.promise},[])
 const hasPendingEdits=useCallback(()=>incoming.current!==null,[])
 const handleFile=(next:File|null)=>{
  incoming.current?.controller.abort()
  if(!next){model.setFiles([]);setError('');return Promise.resolve(true)}
  const request={controller:new AbortController(),promise:Promise.resolve(false)},before=model.current();incoming.current=request;setChecking(true);setError('')
  const work=(async()=>{
   const prepared=await prepareFineInput(next,[...model.retained()].reduce((sum,f)=>sum+f.size*2,0),request.controller.signal);request.controller.signal.throwIfAborted()
   if((prepared.version.metadata.frames??1)!==1)throw new Error('WATERMARK_STATIC_IMAGE_REQUIRED')
   if(!alive.current||model.current()!==before)throw new Error('WATERMARK_INPUT_EDITS_CHANGED')
   model.setFiles([next]);return true
  })().catch(reason=>{if(alive.current&&!request.controller.signal.aborted)setError(String(reason));return false})
  const canceled=new Promise<boolean>(resolve=>request.controller.signal.addEventListener('abort',()=>resolve(false),{once:true}))
  request.promise=Promise.race([work,canceled]).finally(()=>{if(incoming.current===request){incoming.current=null;if(alive.current)setChecking(false)}})
  return request.promise
 }
 const processImage=async()=>{await beforeAction();if(!incoming.current)await tool.run('image.visibleWatermark',{renderer:'browser-worker'})}
 const download=()=>{
  if(!outputs[0])return
  const url=URL.createObjectURL(outputs[0]),a=document.createElement('a');a.href=url;a.download=(file?.name.replace(/\.[^.]+$/,'')||'image')+'-no-watermark.png';a.click();URL.revokeObjectURL(url)
 }
 return <ImageToolDocumentSurface model={model} beforeAction={beforeAction} pendingEdits={checking} hasPendingEdits={hasPendingEdits}>
  <Space direction="vertical" size="large" style={{width:'100%',maxWidth:720,marginTop:16}}>
   <ManagedImageToolStatus tool={tool}/>
   {checking&&<Space><Text role="status">{text('正在核验选定素材','Checking selected image','素材を検証中')}</Text><Button onClick={()=>incoming.current?.controller.abort()}>{text('取消素材准备','Cancel input preparation','素材の準備を取消')}</Button></Space>}
   {error&&<Text role="alert">{error}</Text>}
   <Text type="secondary">{t('geminiWatermarkHint')}</Text>
   <StashDropZone onStashDrop={handleFile} maxSizeMB={20}>
    <Dragger accept=".png,.jpg,.jpeg,.webp" maxCount={1} fileList={file?[{uid:'1',name:file.name} as UploadFile]:[]}
     beforeUpload={async f=>await handleFile(f)?false:Upload.LIST_IGNORE} onRemove={()=>handleFile(null)}>
     <p className="ant-upload-text">{t('imageUploadHint')}</p><p className="ant-upload-hint">{t('imageFormats')}</p>
    </Dragger>
   </StashDropZone>
   {file&&<>
    <Space wrap><Text type="secondary">{t('geminiWatermarkSize')}:</Text><Radio.Group value={parameters.sizeMode} aria-label={t('geminiWatermarkSize')} onChange={e=>model.setParameter('sizeMode',e.target.value)} optionType="button" size="small">
     <Radio.Button value="auto">{t('geminiWatermarkSizeAuto')}</Radio.Button><Radio.Button value="48">48×48</Radio.Button><Radio.Button value="96">96×96</Radio.Button>
    </Radio.Group></Space>
    <Space wrap><Button type="primary" onClick={processImage} disabled={!tool.ready||!!tool.busy||checking} loading={!!tool.busy}>{t('geminiWatermarkRemove')}</Button>
     {outputs.length>0&&<Button icon={<DownloadOutlined/>} onClick={download}>{t('geminiWatermarkDownload')}</Button>}
    </Space>
    <Space wrap align="start">
     {source?.preview&&<div><Text strong>{t('geminiWatermarkOriginal')}</Text><StashableImage src={source.preview} stashSrc={source.raw} alt={t('geminiWatermarkOriginal')} style={{display:'block',maxWidth:320,maxHeight:320,borderRadius:8,border:'1px solid #9a8b78'}}/></div>}
     {result?.preview&&<div><Text strong>{t('geminiWatermarkResult')}</Text><StashableImage src={result.preview} stashSrc={result.raw} alt={t('geminiWatermarkResult')} style={{display:'block',maxWidth:320,maxHeight:320,borderRadius:8,border:'1px solid #9a8b78'}}/></div>}
    </Space><Text type="secondary">{t('geminiWatermarkDisclaimer')}</Text>
   </>}
  </Space>
 </ImageToolDocumentSurface>
}

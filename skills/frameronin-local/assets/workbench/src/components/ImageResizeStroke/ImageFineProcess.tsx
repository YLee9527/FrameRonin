import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {Upload,message,Button,Typography} from 'antd'
import {InboxOutlined} from '@ant-design/icons'
import type {UploadFile} from 'antd'
import {useLanguage} from '../../i18n/context'
import StashDropZone from '../StashDropZone'
import ImageFineEditor,{type ImageFineEditorHandle} from './ImageFineEditor'
import {useImageToolDocument} from '../../localProject/useImageToolDocument'
import {ImageToolDocumentSurface} from '../../localProject/ImageToolDocumentSurface'
import {imageToolMetadata} from '../../localProject/imageToolDocument'
import {useImageToolUrls} from '../../localProject/useManagedImageTool'
import {prepareFineInput} from '../../localProject/fineEditInput'
import {checkFineEditorBudget,fineEditorDimensions} from '../../lib/fineEditorPixels'

const {Dragger}=Upload
const IMAGE_ALLOWED=['.png','.jpg','.jpeg','.webp']
const IMAGE_MAX_MB=20
export interface ImageFineProcessProps{handoffFile?:File|null;onHandoffConsumed?:()=>void}

export default function ImageFineProcess({handoffFile=null,onHandoffConsumed}:ImageFineProcessProps={}){
  const {t,lang}=useLanguage()
  const model=useImageToolDocument('fineEdit'),{draft,change,setFiles,current,retained}=model
  const [preparing,setPreparing]=useState(false),[pendingEdits,setPendingEdits]=useState(false)
  const editor=useRef<ImageFineEditorHandle>(null),request=useRef(0),alive=useRef(true),consumed=useRef(onHandoffConsumed)
  consumed.current=onHandoffConsumed
  useLayoutEffect(()=>{alive.current=true;const invalidate=()=>{alive.current=false;request.current++};return invalidate},[])
  const flush=useCallback(async()=>{await editor.current?.flush()},[])
  const hasPendingEdits=useCallback(()=>editor.current?.hasPendingEdits()??false,[])
  const retainedBytes=useCallback(()=>[...retained()].reduce((sum,file)=>sum+file.size*2,0),[retained])
  const handleFile=useCallback(async(file:File|null)=>{
    const generation=++request.current,previous=current().files
    setPreparing(!!file)
    try{
      const prepared=file?await prepareFineInput(file,retainedBytes()):null
      if(!alive.current||generation!==request.current||current().files!==previous)return false
      await flush()
      if(!alive.current||generation!==request.current||current().files!==previous)return false
      if(file&&prepared){const size=fineEditorDimensions(prepared.version.metadata);checkFineEditorBudget(size.width!,size.height!,file.size,prepared.memoryBudgetBytes,retainedBytes())}
      setFiles(file?[file]:[]);return true
    }catch(error){if(alive.current&&generation===request.current)message.error(String(error));return false}
    finally{if(alive.current&&generation===request.current)setPreparing(false)}
  },[current,retainedBytes,flush,setFiles])
  useEffect(()=>{
    if(handoffFile)void handleFile(handoffFile).then(accepted=>{if(accepted&&alive.current)consumed.current?.()})
  },[handoffFile,handleFile])
  const source=draft.files[0],displayed=draft.editedFile??source
  const displayedFiles=useMemo(()=>displayed?[displayed]:[],[displayed])
  const url=useImageToolUrls(displayedFiles,displayedFiles.map(file=>imageToolMetadata.get(file)))[0]?.raw
  const commit=useCallback((file:File)=>change(value=>({...value,editedFile:file})),[change])
  return <ImageToolDocumentSurface model={model} beforeAction={flush} pendingEdits={pendingEdits} hasPendingEdits={hasPendingEdits}>
    {preparing&&<Typography.Paragraph role="status">{lang==='zh'?'正在核验选定素材':lang==='ja'?'選択した素材を検証中':'Checking the selected image'}</Typography.Paragraph>}
    {handoffFile&&!preparing&&<Button onClick={()=>{void handleFile(handoffFile).then(accepted=>{if(accepted)consumed.current?.()})}}>
      {lang==='zh'?'重试转入素材':lang==='ja'?'引き継ぎを再試行':'Retry image handoff'}
    </Button>}
    <StashDropZone onStashDrop={file=>{void handleFile(file)}} maxSizeMB={IMAGE_MAX_MB} onSizeError={()=>message.error(t('imageSizeError'))}>
      <Dragger name="file" multiple={false} accept={IMAGE_ALLOWED.join(',')} maxCount={1}
        fileList={source?[{uid:'1',name:source.name,size:source.size} as UploadFile]:[]}
        beforeUpload={async file=>await handleFile(file)?false:Upload.LIST_IGNORE}
        onRemove={()=>handleFile(null)} style={{padding:48}}>
        <p className="ant-upload-drag-icon"><InboxOutlined style={{fontSize:64,color:'#b55233'}}/></p>
        <p className="ant-upload-text">{t('imageUploadHint')}</p><p className="ant-upload-hint">{t('imageFormats')}</p>
      </Dragger>
    </StashDropZone>
    {url&&displayed&&<div style={{marginTop:24}}><ImageFineEditor ref={editor} imageUrl={url} onPixelDirtyChange={setPendingEdits}
      binding={{file:displayed,onCommit:commit,onReset:()=>change(value=>({...value,editedFile:null})),retainedBytes}}/></div>}
  </ImageToolDocumentSurface>
}

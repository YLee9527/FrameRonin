import {useEffect,useMemo,useRef,useState} from 'react'
import { Button, InputNumber, message, Space, Typography, Upload } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import {useImageToolDocument} from '../localProject/useImageToolDocument'
import {ImageToolDocumentSurface} from '../localProject/ImageToolDocumentSurface'
import {useManagedImageTool,useImageToolUrls} from '../localProject/useManagedImageTool'
import ManagedImageToolStatus from './ManagedImageToolStatus'
import {prepareFineInput} from '../localProject/fineEditInput'

const { Dragger } = Upload
const { Text } = Typography

const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']
const IMAGE_MAX_MB = 20

export default function ImageExpandShrink() {
  const {t,lang}=useLanguage(),model=useImageToolDocument('expandShrink')
  const {files,parameters}=model.draft,file=files[0]??null
  const {columns:cols,rows,cellWidth:cellW,cellHeight:cellH}=parameters
  const setCols=(value:number)=>model.setParameter('columns',value),setRows=(value:number)=>model.setParameter('rows',value)
  const setCellW=(value:number)=>model.setParameter('cellWidth',value),setCellH=(value:number)=>model.setParameter('cellHeight',value)
  const tool=useManagedImageTool(files,parameters,undefined,model)
  const source=useImageToolUrls(files,tool.versions)[0]
  const resultFiles=useMemo(()=>tool.results.map(result=>result.file),[tool.results])
  const result=useImageToolUrls(resultFiles,tool.results.map(result=>result.version))[0]
  const originalUrl=source?.preview,resultUrl=result?.preview,resultBlob=resultFiles[0],loading=!!tool.busy
  const [checking,setChecking]=useState(false),request=useRef(0),alive=useRef(true)
  useEffect(()=>{alive.current=true;const invalidate=()=>{alive.current=false;request.current++};return invalidate},[])
  const handleFile=async(next:File|null)=>{
    const generation=++request.current,before=model.current();setChecking(!!next)
    try{
      if(next)await prepareFineInput(next,[...model.retained()].reduce((sum,file)=>sum+file.size*2,0))
      if(!alive.current||generation!==request.current)return false
      if(model.current()!==before){message.warning(lang==='zh'?'核验期间文档已改变，请重新选择素材':lang==='ja'?'検証中に文書が変わりました。素材を選び直してください':'The document changed while checking the image; select it again');return false}
      model.setFiles(next?[next]:[]);return true
    }catch(error){if(alive.current&&generation===request.current)message.error(String(error));return false}
    finally{if(alive.current&&generation===request.current)setChecking(false)}
  }
  const runProcess=async()=>{if(checking)return;if(await tool.run('image.expandShrink',{renderer:'browser-worker'}))message.success(t('expandShrinkSuccess'))}

  const download = () => {
    if (!resultBlob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(resultBlob)
    a.download = (file?.name?.replace(/\.[^.]+$/, '') || 'result') + '_expand_shrink.png'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <ImageToolDocumentSurface model={model}><Space direction="vertical" size="large" style={{ width: '100%' }}>
      <ManagedImageToolStatus tool={tool}/>
      {checking&&<Text role="status">{lang==='zh'?'正在核验选定素材':lang==='ja'?'素材を検証中':'Checking selected image'}</Text>}
      <Text type="secondary" style={{ display: 'block' }}>{t('expandShrinkHint')}</Text>
      <Space wrap>
        <span>
          <Text type="secondary">{t('spriteColumns')} N:</Text>
          <InputNumber min={1} max={64} value={cols} onChange={(v) => setCols(v ?? 4)} style={{ width: 72, marginLeft: 8 }} />
        </span>
        <span>
          <Text type="secondary">{t('spriteRows')} M:</Text>
          <InputNumber min={1} max={64} value={rows} onChange={(v) => setRows(v ?? 4)} style={{ width: 72, marginLeft: 8 }} />
        </span>
        <span>
          <Text type="secondary">{t('expandShrinkCellW')}:</Text>
          <InputNumber min={1} max={512} value={cellW} onChange={(v) => setCellW(v ?? 32)} style={{ width: 72, marginLeft: 8 }} />
        </span>
        <span>
          <Text type="secondary">{t('expandShrinkCellH')}:</Text>
          <InputNumber min={1} max={512} value={cellH} onChange={(v) => setCellH(v ?? 32)} style={{ width: 72, marginLeft: 8 }} />
        </span>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('expandShrinkHintDetail')}</Text>
      <StashDropZone
        onStashDrop={handleFile}
        maxSizeMB={IMAGE_MAX_MB}
        onSizeError={() => message.error(t('imageSizeError'))}
      >
        <Dragger
          accept={IMAGE_ACCEPT.join(',')}
          maxCount={1}
          fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
          beforeUpload={async file=>await handleFile(file)?false:Upload.LIST_IGNORE}
          onRemove={()=>handleFile(null)}
        >
          <p className="ant-upload-text">{t('imageUploadHint')}</p>
          <p className="ant-upload-hint">{t('imageFormats')}</p>
        </Dragger>
      </StashDropZone>
      {file && originalUrl && (
        <>
          <Text strong style={{ display: 'block' }}>{t('imgOriginalPreview')}</Text>
          <div
            style={{
              padding: 16,
              background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
              borderRadius: 8,
              border: '1px solid #9a8b78',
              display: 'inline-block',
            }}
          >
            <img src={originalUrl} alt="" style={{ maxWidth: 320, maxHeight: 240, display: 'block', imageRendering: 'auto' }} />
          </div>
        </>
      )}
      <Space wrap>
        <Button type="primary" loading={loading} onClick={runProcess} disabled={!tool.ready||loading||checking}>
          {t('expandShrinkProcess')}
        </Button>
        {resultUrl && (
          <Button icon={<DownloadOutlined />} onClick={download}>
            {t('imgDownload')}
          </Button>
        )}
      </Space>
      {resultUrl && (
        <>
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
            <StashableImage src={resultUrl} stashSrc={result?.raw} alt="" style={{ maxWidth: '100%', maxHeight: 400, display: 'block', imageRendering: 'auto' }} />
          </div>
        </>
      )}
    </Space></ImageToolDocumentSurface>
  )
}

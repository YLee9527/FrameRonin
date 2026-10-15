import { useMemo, useState } from 'react'
import { Button, InputNumber, message, Pagination, Select, Space, Typography, Upload } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import ManagedImageToolStatus from './ManagedImageToolStatus'
import { useManagedImageTool, useImageToolUrls } from '../localProject/useManagedImageTool'

const { Dragger } = Upload
const { Text } = Typography
const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']
type UnifyPadH = 'left' | 'center' | 'right'
type UnifyPadV = 'top' | 'center' | 'bottom'

export default function RoninProUnifySize() {
  const { t,lang } = useLanguage()
  const [files,setFiles]=useState<File[]>([]),[page,setPage]=useState(1)
  const [cols,setCols]=useState(4),[padH,setPadH]=useState<UnifyPadH>('center'),[padV,setPadV]=useState<UnifyPadV>('bottom')
  const tool=useManagedImageTool(files,{columns:cols,horizontal:padH,vertical:padV})
  const previews=useImageToolUrls(files,tool.versions)
  const resultFiles=useMemo(()=>tool.results.map(result=>result.file),[tool.results])
  const result=useImageToolUrls(resultFiles,tool.results.map(result=>result.version))[0]
  const resultUrl=result?.preview,loading=!!tool.busy
  const widths=tool.versions.map(version=>version?.metadata.width??0),heights=tool.versions.map(version=>version?.metadata.height??0)
  const dims=tool.ready?{maxW:Math.max(...widths),maxH:Math.max(...heights)}:null
  const currentPage=Math.min(page,Math.max(1,Math.ceil(files.length/24))),offset=(currentPage-1)*24
  const appendFiles=(incoming:File[])=>{
    if(files.length+incoming.length>1000){message.error(lang==='zh'?'每次最多处理 1000 张图片':lang==='ja'?'一度に処理できる画像は最大 1000 枚です':'Select at most 1000 images');return}
    setFiles(previous=>[...previous,...incoming])
  }
  const runUnify=async()=>{if(await tool.run('sequence.unifySize'))message.success(t('roninProUnifySizeSuccess'))}
  const downloadResult=()=>{
    if(!result?.raw)return
    const anchor=document.createElement('a');anchor.href=result.raw;anchor.download=`unify_${files.length}_images.png`;anchor.click()
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">{t('roninProUnifySizeHint')}</Text>
      <ManagedImageToolStatus tool={tool}/>
      {files.length>24&&<Pagination current={currentPage} pageSize={24} total={files.length} onChange={setPage} showSizeChanger={false}/>}

      <StashDropZone onStashDrop={(file)=>appendFiles([file])}>
        <Dragger
          accept={IMAGE_ACCEPT.join(',')}
          multiple
          fileList={files.slice(offset,offset+24).map((file,index)=>({uid:String(offset+index),name:file.name,status:'done'} as UploadFile))}
          beforeUpload={(file,batch)=>{if(file===batch[0])appendFiles(batch);return false}}
          onRemove={item=>setFiles(previous=>previous.filter((_,index)=>index!==Number(item.uid)))}
        >
          <p className="ant-upload-text">{t('roninProUnifySizeUploadHint')}</p>
        </Dragger>
      </StashDropZone>

      {files.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <span>
                <Text type="secondary">{t('roninProUnifySizeCols')}:</Text>
                <InputNumber
                  min={1}
                  max={64}
                  value={cols}
                  onChange={(v) => setCols(v ?? 4)}
                  style={{ width: 64, marginLeft: 8 }}
                />
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Text type="secondary">{t('roninProUnifySizePadH')}:</Text>
                <Select<UnifyPadH>
                  value={padH}
                  onChange={setPadH}
                  style={{ width: 120 }}
                  options={[
                    { value: 'left', label: t('roninProUnifySizePadHLeft') },
                    { value: 'center', label: t('roninProUnifySizePadHCenter') },
                    { value: 'right', label: t('roninProUnifySizePadHRight') },
                  ]}
                />
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Text type="secondary">{t('roninProUnifySizePadV')}:</Text>
                <Select<UnifyPadV>
                  value={padV}
                  onChange={setPadV}
                  style={{ width: 120 }}
                  options={[
                    { value: 'top', label: t('roninProUnifySizePadVTop') },
                    { value: 'center', label: t('roninProUnifySizePadVCenter') },
                    { value: 'bottom', label: t('roninProUnifySizePadVBottom') },
                  ]}
                />
              </span>
            </div>
            <Text type="secondary" style={{ fontSize: 12, margin: 0 }}>
              {t('roninProUnifySizePadExplain')}
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <Button type="primary" loading={loading} disabled={!tool.ready||loading} onClick={runUnify}>
              {t('roninProUnifySizeRun')}
            </Button>
            {resultUrl && (
              <Button icon={<DownloadOutlined />} onClick={downloadResult}>
                {t('roninProUnifySizeDownload')}
              </Button>
            )}
            </div>
          </div>
          {dims && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('roninProUnifySizeSizeHint', {
                cellW: dims.maxW,
                cellH: dims.maxH,
                outW: Math.max(1, Math.min(64, cols)) * dims.maxW,
                outH: Math.ceil(files.length / Math.max(1, Math.min(64, cols))) * dims.maxH,
              })}
            </Text>
          )}

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('imgPreview')}</Text>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                maxHeight: 200,
                overflow: 'auto',
                padding: 8,
                background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                borderRadius: 8,
                border: '1px solid #9a8b78',
              }}
            >
              {previews.slice(offset,offset+24).map((preview,localIndex) => { const i=offset+localIndex;return (
                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                  {preview.preview&&<StashableImage
                    src={preview.preview}
                    stashSrc={preview.raw}
                    alt={`${i + 1}`}
                    style={{
                      width: 48,
                      height: 48,
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                      border: '1px solid rgba(0,0,0,0.2)',
                    }}
                  />}
                  <span
                    style={{
                      position: 'absolute',
                      left: 2,
                      top: 2,
                      fontSize: 10,
                      fontWeight: 'bold',
                      color: '#fff',
                      textShadow: '0 0 2px #000',
                    }}
                  >
                    {i + 1}
                  </span>
                </div>
              )})}
            </div>
          </div>

          {resultUrl && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('roninProUnifySizeResult')}</Text>
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
                  src={resultUrl}
                  stashSrc={result?.raw}
                  alt={t('roninProUnifySizeResult')}
                  style={{ maxWidth: 400, maxHeight: 300, display: 'block', imageRendering: 'pixelated' }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </Space>
  )
}

import { useMemo, useRef, useState } from 'react'
import { Button, Checkbox, InputNumber, message, Radio, Space, Typography, Upload } from 'antd'
import { ExpandOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import ImageFineEditor from './ImageResizeStroke/ImageFineEditor'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import ManagedImageToolStatus from './ManagedImageToolStatus'
import { useManagedImageTool, useImageToolUrls } from '../localProject/useManagedImageTool'
import type { ScalePreset } from '../lib/roninImageTools'

const { Dragger } = Upload
const { Text } = Typography
const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']

export default function RoninProCustomScale() {
  const { t } = useLanguage()
  const [file,setFile]=useState<File|null>(null)
  const [targetW,setTargetW]=useState(256),[targetH,setTargetH]=useState(256)
  const [keepAspect,setKeepAspect]=useState(true),[pixelated,setPixelated]=useState(true)
  const [matteAlgorithm,setMatteAlgorithm]=useState<'contiguous'|'chromaKey'|'chromaKeyAdaptive'>('contiguous')
  const [nonContiguousTolerance,setNonContiguousTolerance]=useState(5)
  const selected=useMemo(()=>file?[file]:[],[file])
  const initialized=useRef<File|null>(null)
  const tool=useManagedImageTool(selected,{width:targetW,height:targetH,keepAspect,pixelated,matteAlgorithm,nonContiguousTolerance},(source,version)=>{
    if(initialized.current!==source&&version.metadata.width&&version.metadata.height){
      initialized.current=source
      if(keepAspect){setTargetW(version.metadata.width);setTargetH(version.metadata.height)}
    }
  })
  const previews=useImageToolUrls(selected,tool.versions)
  const original=tool.versions[0]?.metadata
  const originalSize=original?.width&&original?.height?{w:original.width,h:original.height}:null
  const previewUrl=previews[0]?.preview,sourceUrl=previews[0]?.raw
  const resultFiles=useMemo(()=>tool.results.map(result=>result.file),[tool.results])
  const resultUrl=useImageToolUrls(resultFiles,tool.results.map(result=>result.version))[0]?.raw
  const runPreset=async(mode:ScalePreset)=>{
    const renderer=mode==='resize'&&!pixelated?'browser-worker':'native'
    const side=mode.startsWith('f')?256:mode==='bebe'?190:192
    const preset=mode==='resize'?{}:{width:side,height:side,keepAspect:false,pixelated:true}
    if(await tool.run('image.customScale',{...preset,mode,renderer},mode))message.success(t('imgResizeSuccess'))
  }
  const loading=tool.busy==='resize',ffffLoading=tool.busy==='ffff',fffbLoading=tool.busy==='fffb',fbfbLoading=tool.busy==='fbfb',fbffLoading=tool.busy==='fbff'
  const c0c0Loading=tool.busy==='c0c0',c0beLoading=tool.busy==='c0be',bebeLoading=tool.busy==='bebe',bec0Loading=tool.busy==='bec0'
  const runScale=()=>runPreset('resize'),runFfff=()=>runPreset('ffff'),runFffb=()=>runPreset('fffb'),runFbfb=()=>runPreset('fbfb'),runFbff=()=>runPreset('fbff')
  const runC0c0=()=>runPreset('c0c0'),runC0be=()=>runPreset('c0be'),runBebe=()=>runPreset('bebe'),runBec0=()=>runPreset('bec0')

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Text type="secondary">{t('roninProCustomScaleHint')}</Text>
      <ManagedImageToolStatus tool={tool}/>

      <Space wrap>
        <span>
          <Text type="secondary">{t('roninProCustomScaleTargetW')}:</Text>
          <InputNumber
            min={1}
            max={4096}
            value={targetW}
            onChange={(v) => setTargetW(v ?? 256)}
            style={{ width: 90, marginLeft: 8 }}
          />
        </span>
        <span>
          <Text type="secondary">{t('roninProCustomScaleTargetH')}:</Text>
          <InputNumber
            min={1}
            max={4096}
            value={targetH}
            onChange={(v) => setTargetH(v ?? 256)}
            style={{ width: 90, marginLeft: 8 }}
          />
        </span>
        <Checkbox checked={keepAspect} onChange={(e) => setKeepAspect(e.target.checked)}>
          {t('roninProCustomScaleKeepAspect')}
        </Checkbox>
        <Checkbox checked={pixelated} onChange={(e) => setPixelated(e.target.checked)}>
          {t('imgPixelated')}
        </Checkbox>
      </Space>

      <StashDropZone
        onStashDrop={(f) => {
          setFile(f)
        }}
      >
        <Dragger
          accept={IMAGE_ACCEPT.join(',')}
          maxCount={1}
          fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
          beforeUpload={(f) => {
            setFile(f)
            return false
          }}
          onRemove={() => setFile(null)}
        >
          <p className="ant-upload-text">{t('spriteUploadHint')}</p>
        </Dragger>
      </StashDropZone>

      {file && previewUrl && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <span>
              <Text type="secondary" style={{ marginRight: 8 }}>{t('roninProMatteAlgorithm')}:</Text>
              <Radio.Group
                value={matteAlgorithm}
                onChange={(e) => setMatteAlgorithm(e.target.value)}
                options={[
                  { label: t('roninProMatteContiguous'), value: 'contiguous' },
                  { label: t('roninProMatteChromaKey'), value: 'chromaKey' },
                  { label: t('roninProMatteChromaKeyAdaptive'), value: 'chromaKeyAdaptive' },
                ]}
              />
            </span>
            {(matteAlgorithm === 'chromaKey' || matteAlgorithm === 'chromaKeyAdaptive') && (
              <span>
                <Text type="secondary" style={{ marginRight: 8 }}>{t('roninProNonContiguousTolerance')}:</Text>
                <InputNumber
                  min={0}
                  max={100}
                  value={nonContiguousTolerance}
                  onChange={(v) => setNonContiguousTolerance(v ?? 5)}
                  style={{ width: 72 }}
                />
              </span>
            )}
          </div>
          <Text strong>
            {t('imgOriginalPreview')}
            {originalSize && (
              <Text type="secondary" style={{ marginLeft: 8, fontWeight: 'normal' }}>
                {originalSize.w} × {originalSize.h}
              </Text>
            )}
          </Text>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
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
                src={previewUrl}
                stashSrc={sourceUrl}
                alt=""
                style={{ maxWidth: 320, maxHeight: 240, display: 'block', imageRendering: 'pixelated' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Space direction="vertical" size={8}>
                <Button type="primary" loading={ffffLoading} onClick={runFfff} disabled={!tool.ready||!!tool.busy}>
                  FFFF
                </Button>
                <Button type="primary" loading={fffbLoading} onClick={runFffb} disabled={!tool.ready||!!tool.busy}>
                  FFFB
                </Button>
                <Button type="primary" loading={fbfbLoading} onClick={runFbfb} disabled={!tool.ready||!!tool.busy}>
                  FBFB
                </Button>
                <Button type="primary" loading={fbffLoading} onClick={runFbff} disabled={!tool.ready||!!tool.busy}>
                  FBFF
                </Button>
              </Space>
              <Space direction="vertical" size={8}>
                <Button type="primary" loading={c0c0Loading} onClick={runC0c0} disabled={!tool.ready||!!tool.busy}>
                  C0C0
                </Button>
                <Button type="primary" loading={c0beLoading} onClick={runC0be} disabled={!tool.ready||!!tool.busy}>
                  C0BE
                </Button>
                <Button type="primary" loading={bebeLoading} onClick={runBebe} disabled={!tool.ready||!!tool.busy}>
                  BEBE
                </Button>
                <Button type="primary" loading={bec0Loading} onClick={runBec0} disabled={!tool.ready||!!tool.busy}>
                  BEC0
                </Button>
              </Space>
            </div>
          </div>
        </>
      )}

      <Space>
        <Button type="primary" loading={loading} onClick={runScale} disabled={!tool.ready||!!tool.busy} icon={<ExpandOutlined />}>
          {t('roninProCustomScaleApply')}
        </Button>
      </Space>

      {resultUrl && (
        <>
          <Text strong>{t('imgPreview')}</Text>
          <ImageFineEditor imageUrl={resultUrl} />
        </>
      )}
    </Space>
  )
}

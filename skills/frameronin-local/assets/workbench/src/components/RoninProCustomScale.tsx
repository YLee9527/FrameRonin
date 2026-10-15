import { useCallback,useMemo, useRef,useState } from 'react'
import { Button, Checkbox, InputNumber, message, Radio, Space, Typography, Upload } from 'antd'
import { ExpandOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import ImageFineEditor,{type ImageFineEditorHandle} from './ImageResizeStroke/ImageFineEditor'
import {useImageToolDocument} from '../localProject/useImageToolDocument'
import {ImageToolDocumentSurface} from '../localProject/ImageToolDocumentSurface'
import type {ImageToolParameters} from '../localProject/imageToolDocument'
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
  const model=useImageToolDocument('customScale'),{files:selected,parameters,editedFile}=model.draft,file=selected[0]??null
  const {width:targetW,height:targetH,keepAspect,pixelated,matteAlgorithm,nonContiguousTolerance}=parameters
  const setTargetW=(value:number)=>model.setParameter('width',value),setTargetH=(value:number)=>model.setParameter('height',value)
  const setKeepAspect=(value:boolean)=>model.setParameter('keepAspect',value),setPixelated=(value:boolean)=>model.setParameter('pixelated',value)
  const setMatteAlgorithm=(value:ImageToolParameters['customScale']['matteAlgorithm'])=>model.setParameter('matteAlgorithm',value)
  const setNonContiguousTolerance=(value:number)=>model.setParameter('nonContiguousTolerance',value)
  const editor=useRef<ImageFineEditorHandle>(null)
  const [pendingEdits,setPendingEdits]=useState(false)
  const flush=useCallback(async()=>{await editor.current?.flush()},[])
  const hasPendingEdits=useCallback(()=>editor.current?.hasPendingEdits()??false,[])
  const initialize=useRef<{file:File;parameters:ImageToolParameters['customScale']}|null>(null)
  const setFile=async(next:File|null)=>{
    try{
      await flush()
      initialize.current=next?{file:next,parameters:model.current().parameters}:null
      model.setFiles(next?[next]:[]);return true
    }catch(error){message.error(String(error));return false}
  }
  const tool=useManagedImageTool(selected,parameters,(source,version)=>{
    const pending=initialize.current
    if(pending?.file!==source)return
    initialize.current=null
    if(version.metadata.width&&version.metadata.height&&pending.parameters.keepAspect){
      model.normalize(draft=>draft.files[0]===source&&draft.parameters===pending.parameters?{...draft,parameters:{...draft.parameters,width:Math.min(4096,version.metadata.width!),height:Math.min(4096,version.metadata.height!)}}:draft)
    }
  },model)
  const previews=useImageToolUrls(selected,tool.versions)
  const original=tool.versions[0]?.metadata
  const originalSize=original?.width&&original?.height?{w:original.width,h:original.height}:null
  const previewUrl=previews[0]?.preview,sourceUrl=previews[0]?.raw
  const resultFiles=useMemo(()=>tool.results.map(result=>result.file),[tool.results])
  const displayed=useMemo(()=>editedFile?[editedFile]:resultFiles,[editedFile,resultFiles])
  const resultUrl=useImageToolUrls(displayed,editedFile?[]:tool.results.map(result=>result.version))[0]?.raw
  const {change,retained}=model
  const commitEdit=useCallback((next:File)=>change(draft=>({...draft,editedFile:next})),[change])
  const retainedBytes=useCallback(()=>[...retained()].reduce((sum,file)=>sum+file.size*2,0),[retained])
  const runPreset=async(mode:ScalePreset)=>{
    const before=model.current()
    try{await flush()}catch(error){message.error(String(error));return}
    if(before.files!==model.current().files||before.parameters!==model.current().parameters){message.warning('Inputs or settings changed; run again.');return}
    const renderer=mode==='resize'&&!model.current().parameters.pixelated?'browser-worker':'native'
    const side=mode.startsWith('f')?256:mode==='bebe'?190:192
    const preset=mode==='resize'?{}:{width:side,height:side,keepAspect:false,pixelated:true}
    if(await tool.run('image.customScale',{...preset,mode,renderer},mode))message.success(t('imgResizeSuccess'))
  }
  const loading=tool.busy==='resize',ffffLoading=tool.busy==='ffff',fffbLoading=tool.busy==='fffb',fbfbLoading=tool.busy==='fbfb',fbffLoading=tool.busy==='fbff'
  const c0c0Loading=tool.busy==='c0c0',c0beLoading=tool.busy==='c0be',bebeLoading=tool.busy==='bebe',bec0Loading=tool.busy==='bec0'
  const runScale=()=>runPreset('resize'),runFfff=()=>runPreset('ffff'),runFffb=()=>runPreset('fffb'),runFbfb=()=>runPreset('fbfb'),runFbff=()=>runPreset('fbff')
  const runC0c0=()=>runPreset('c0c0'),runC0be=()=>runPreset('c0be'),runBebe=()=>runPreset('bebe'),runBec0=()=>runPreset('bec0')

  return (
    <ImageToolDocumentSurface model={model} beforeAction={flush} pendingEdits={pendingEdits} hasPendingEdits={hasPendingEdits}><Space direction="vertical" size="large" style={{ width: '100%' }}>
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
          void setFile(f)
        }}
      >
        <Dragger
          accept={IMAGE_ACCEPT.join(',')}
          maxCount={1}
          fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
          beforeUpload={async(f)=>{await setFile(f);return false}}
          onRemove={()=>setFile(null)}
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
          <Text type="secondary">{tool.results[0]?.version.metadata.width} × {tool.results[0]?.version.metadata.height}</Text>
          <ImageFineEditor ref={editor} imageUrl={resultUrl} disabled={!!tool.busy} onPixelDirtyChange={setPendingEdits}
            binding={{file:displayed[0],onCommit:commitEdit,onReset:()=>model.change(draft=>({...draft,editedFile:null})),retainedBytes}}/>
        </>
      )}
    </Space></ImageToolDocumentSurface>
  )
}

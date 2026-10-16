import { useCallback,useEffect,useMemo,useRef,useState } from 'react'
import { Button, Col, ColorPicker, Divider, InputNumber, message, Row, Slider, Space, Typography } from 'antd'
import { DownloadOutlined, EditOutlined, InboxOutlined } from '@ant-design/icons'
import { Checkbox } from 'antd'
import { Upload } from 'antd'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import ImageCropEditor,{type ImageCropEditorHandle} from './ImageResizeStroke/ImageCropEditor'
import {useNormalImageDocument} from '../localProject/useNormalImageDocument'
import NormalImageDocumentSurface from '../localProject/NormalImageDocumentSurface'
import {normalImageDefaults,normalImageReports,type NormalImageSettings} from '../localProject/normalImageDocument'
import type {NormalImageMode} from '../lib/normalImageTools'
import {prepareFineInput} from '../localProject/fineEditInput'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {runManagedTask,cacheManagedInput} from '../localProject/managedTasks'
import {useImageToolUrls} from '../localProject/useManagedImageTool'
import {Progress} from 'antd'

const { Dragger } = Upload
const { Text } = Typography

const IMAGE_ALLOWED = ['.png', '.jpg', '.jpeg', '.webp']
const IMAGE_MAX_MB = 20

export interface ImageResizeStrokeProps {
  /** 将当前生成预览（Blob）转入精细处理子模块 */
  onSendToFineProcess?: (blob: Blob, suggestedFilename: string) => boolean|void|Promise<boolean|void>
}

export default function ImageResizeStroke({ onSendToFineProcess }: ImageResizeStrokeProps = {}) {
  const {t,lang}=useLanguage(),model=useNormalImageDocument(),{source:file,settings,preview,matte}=model.draft
  const {width:targetW,height:targetH,keepAspect,pixelated,background:bgColor,tolerance:matteTolerance,feather:matteFeather,enableMatte,strokeWidth,strokeColor}=settings
  const cropRegion=useMemo(()=>({left:settings.cropLeft,right:settings.cropRight,top:settings.cropTop,bottom:settings.cropBottom}),[settings.cropLeft,settings.cropRight,settings.cropTop,settings.cropBottom])
  const setField=<K extends keyof NormalImageSettings,>(key:K,value:NormalImageSettings[K])=>model.change(draft=>({...draft,settings:{...draft.settings,[key]:value}}))
  const setBgColor=(v:string)=>setField('background',v),setMatteTolerance=(v:number)=>setField('tolerance',v),setMatteFeather=(v:number)=>setField('feather',v)
  const setEnableMatte=(v:boolean)=>setField('enableMatte',v),setKeepAspect=(v:boolean)=>setField('keepAspect',v),setPixelated=(v:boolean)=>setField('pixelated',v)
  const setStrokeWidth=(v:number)=>setField('strokeWidth',v),setStrokeColor=(v:string)=>setField('strokeColor',v)
  const [pickingColor,setPickingColor]=useState(false),[preparing,setPreparing]=useState(false),[busy,setBusy]=useState<NormalImageMode|null>(null),[readySource,setReadySource]=useState<File|null>(null)
  const [canceling,setCanceling]=useState(false),[progress,setProgress]=useState(0)
  const [sampling,setSampling]=useState(false)
  const controller=useRef<AbortController|null>(null),alive=useRef(true),request=useRef(0),editor=useRef<ImageCropEditorHandle>(null)
  useEffect(()=>{alive.current=true;const invalidate=()=>{alive.current=false;request.current++};return invalidate},[])
  const flush=useCallback(async()=>{await editor.current?.finishGesture()},[])
  const hasPendingEdits=useCallback(()=>editor.current?.hasPendingEdits()??false,[])
  const previewFiles=useMemo(()=>preview?[preview.file]:[],[preview]),matteFiles=useMemo(()=>matte?[matte.file]:[],[matte])
  const outputUrl=useImageToolUrls(previewFiles,previewFiles.map(file=>imageToolMetadata.get(file)))[0]
  const matteUrl=useImageToolUrls(matteFiles,matteFiles.map(file=>imageToolMetadata.get(file)))[0]
  const previewBlob=preview?.file??null,previewUrl=outputUrl?.preview??null,mattePreviewUrl=matteUrl?.preview??null
  const resultParameters=(report:File|undefined)=>report?normalImageReports.get(report)?.parameters as Record<string,unknown>|undefined:undefined
  const previewParameters=resultParameters(preview?.report),matteParameters=resultParameters(matte?.report)
  const differs=(parameters:Record<string,unknown>|undefined,keys:(keyof NormalImageSettings)[])=>parameters&&keys.some(key=>JSON.stringify(parameters[key])!==JSON.stringify(settings[key]))
  const previewOutdated=previewParameters?.mode==='apply'&&differs(previewParameters,Object.keys(normalImageDefaults) as (keyof NormalImageSettings)[])
  const matteOutdated=differs(matteParameters,['cropLeft','cropRight','cropTop','cropBottom','background','tolerance','feather'])
  const previousResult=lang==='zh'?'当前显示上次加工结果；应用新参数请重新执行。':lang==='ja'?'前回の処理結果を表示しています。新しい設定を適用するには再実行してください。':'The previous result is shown. Run again to apply the current settings.'
  const metadata=file?imageToolMetadata.get(file)?.metadata:undefined,size=metadata?fineEditorDimensions(metadata):undefined
  const sourceKey=useMemo(()=>file?`${file.name}:${crypto.randomUUID()}`:'empty',[file])
  const originalSize=useMemo(()=>size?.width&&size.height?{w:size.width,h:size.height}:null,[size?.width,size?.height])
  const croppedW=originalSize?Math.max(1,originalSize.w-cropRegion.left-cropRegion.right):0,croppedH=originalSize?Math.max(1,originalSize.h-cropRegion.top-cropRegion.bottom):0
  const aspectRatio=croppedW>0&&croppedH>0?croppedH/croppedW:1
  const setCropRegion=(value:typeof cropRegion|((old:typeof cropRegion)=>typeof cropRegion))=>model.change(draft=>{
    const previous={left:draft.settings.cropLeft,right:draft.settings.cropRight,top:draft.settings.cropTop,bottom:draft.settings.cropBottom},next=typeof value==='function'?value(previous):value
    const meta=draft.source?imageToolMetadata.get(draft.source)?.metadata:undefined,source=meta?fineEditorDimensions(meta):undefined
    return {...draft,settings:{...draft.settings,cropLeft:next.left,cropRight:next.right,cropTop:next.top,cropBottom:next.bottom,
      width:Math.max(1,(source?.width??256)-next.left-next.right),height:Math.max(1,(source?.height??256)-next.top-next.bottom)}}
  })
  const handleFile=async(next:File|null)=>{
    const generation=++request.current,before=model.current();setPreparing(!!next)
    try{
      if(next)await prepareFineInput(next,[...model.retained()].reduce((sum,file)=>sum+file.size*2,0))
      if(!alive.current||generation!==request.current||model.current()!==before)return false
      await flush()
      if(!alive.current||generation!==request.current||model.current()!==before)return false
      const meta=next?imageToolMetadata.get(next)!.metadata:null,size=meta?fineEditorDimensions(meta):null
      model.change(draft=>({...draft,source:next,preview:null,matte:null,settings:{...draft.settings,cropLeft:0,cropRight:0,cropTop:0,cropBottom:0,
        width:size?.width??draft.settings.width,height:size?.height??draft.settings.height}}));setPickingColor(false);return true
    }catch(error){if(alive.current&&generation===request.current)message.error(String(error));return false}
    finally{if(alive.current&&generation===request.current)setPreparing(false)}
  }
  const handlePickColor=(r:number,g:number,b:number)=>{
    const color='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('')
    model.change(draft=>({...draft,settings:{...draft.settings,background:color,enableMatte:true}}));setPickingColor(false)
    message.success(t('pickedBgColor',{color:color.slice(1)}))
  }
  const handleTargetWChange=(width:number)=>{
    const height=keepAspect?Math.max(1,Math.round(width*aspectRatio)):targetH
    if(height>30000){message.error(lang==='zh'?'目标尺寸不能超过 30000 像素':lang==='ja'?'サイズは 30000 ピクセル以下にしてください':'Dimensions must be at most 30000 pixels');return}
    model.change(draft=>({...draft,settings:{...draft.settings,width,height}}))
  }
  const handleTargetHChange=(height:number)=>{
    const width=keepAspect?Math.max(1,Math.round(height/aspectRatio)):targetW
    if(width>30000){message.error(lang==='zh'?'目标尺寸不能超过 30000 像素':lang==='ja'?'サイズは 30000 ピクセル以下にしてください':'Dimensions must be at most 30000 pixels');return}
    model.change(draft=>({...draft,settings:{...draft.settings,width,height}}))
  }
  const run=async(mode:NormalImageMode)=>{
    if(controller.current||!model.current().source||preparing||sampling||readySource!==model.current().source)return
    if(mode==='extendBottom'&&!model.current().preview)return
    const abort=new AbortController();controller.current=abort;setBusy(mode);setCanceling(false);setProgress(0)
    try{
      await flush()
      abort.signal.throwIfAborted();setPickingColor(false)
      const before=model.current(),input=mode==='extendBottom'?before.preview?.file:before.source
      if(!input)return
      const retained=[...model.retained()],frontendBytes=96*1024**2+retained.reduce((sum,file)=>sum+file.size*2,0)
      const completed=await runManagedTask('image.normal',[input],{...before.settings,mode,renderer:'browser-worker',frontendBytes},{signal:abort.signal,
        onProgress:value=>{if(alive.current)setProgress(previous=>Math.max(previous,value))},outputFilter:()=>alive.current})
      if(!alive.current)return
      if(model.current()!==before){message.warning(lang==='zh'?'输入或参数已改变，结果保留在项目素材中':lang==='ja'?'入力または設定が変わりました。結果はプロジェクトに保存されています':'Inputs or settings changed; results remain in Project assets');return}
      let image:File|undefined,report:File|undefined
      for(const output of completed.outputs){
        const file=new File([output.blob],output.version.metadata.kind==='image'?'normal-'+mode+'.png':'normal-'+mode+'-report.json',{type:output.version.metadata.kind==='image'?'image/png':'application/json'})
        imageToolMetadata.set(file,output.version);cacheManagedInput(file,completed.project.id,output.version.id)
        if(output.version.metadata.kind==='image')image=file
        else if(output.version.metadata.extension==='.json')report=file
      }
      if(!image||!report)throw new Error('NORMAL_RESULT_MISSING')
      const details=JSON.parse(await report.text())
      if(!details||details.operation!=='image.normal'||details.outputFrames!==1||!details.parameters)throw new Error('NORMAL_REPORT_INVALID')
      abort.signal.throwIfAborted()
      if(!alive.current||model.current()!==before)return
      normalImageReports.set(report,details)
      const result={file:image,input,report,taskId:completed.taskId}
      model.change(draft=>mode==='mattePreview'?{...draft,matte:result}:{...draft,preview:result})
      message.success(t(mode==='mattePreview'?'matteSuccess':mode==='rpgMaker'?'imgOneClickSuccess':mode==='allActions'?'imgOneClickAllActionsSuccess':mode==='ancientCostume'?'imgAncientCostumeSuccess':mode==='extendBottom'?'imgExtendBottomSuccess':strokeWidth>0?'applyStrokeSuccess':'imgResizeSuccess',{n:1}))
    }catch(error){if(alive.current){if(error instanceof DOMException&&error.name==='AbortError')message.info(lang==='zh'?'加工已取消':lang==='ja'?'処理を取り消しました':'Processing canceled');else message.error(String(error))}}
    finally{controller.current=null;if(alive.current){setBusy(null);setCanceling(false)}}
  }
  const cancel=()=>{if(controller.current){setCanceling(true);controller.current.abort();editor.current?.cancelPending()}}
  const loading=busy==='apply',matteLoading=busy==='mattePreview',extendLoading=busy==='extendBottom',oneClickLoading=busy==='rpgMaker',oneClickAllActionsLoading=busy==='allActions',ancientCostumeLoading=busy==='ancientCostume',oneClickBusy=busy!==null||preparing||sampling||file!==readySource
  const applyPreview=()=>run('apply'),runMattePreview=()=>run('mattePreview'),handleExtendBottom=()=>run('extendBottom'),handleOneClickProcess=()=>run('rpgMaker'),handleOneClickAllActionsProcess=()=>run('allActions'),handleAncientCostumeProcess=()=>run('ancientCostume')
  const download=()=>{
    if(!previewBlob)return
    const url=URL.createObjectURL(previewBlob),link=document.createElement('a');link.href=url;link.download=(file?.name.replace(/\.[^.]+$/,'')??'output')+'_resized.png';link.click();URL.revokeObjectURL(url)
  }

  const hasCrop = cropRegion.left > 0 || cropRegion.top > 0 || cropRegion.right > 0 || cropRegion.bottom > 0

  return (
    <NormalImageDocumentSurface model={model} beforeAction={flush} hasPendingEdits={hasPendingEdits}><Space direction="vertical" size="large" style={{ width: '100%', paddingTop: 8 }}>
      {preparing&&<Text role="status">{lang==='zh'?'正在核验选定素材':lang==='ja'?'素材を検証中':'Checking selected image'}</Text>}
      {busy&&<Space><Progress percent={Math.round(progress*100)} style={{width:180}}/><Button loading={canceling} onClick={cancel}>{lang==='zh'?'取消加工':lang==='ja'?'処理を取消':'Cancel processing'}</Button></Space>}
      <StashDropZone
        onStashDrop={(f) => handleFile(f)}
        maxSizeMB={IMAGE_MAX_MB}
        onSizeError={() => message.error(t('imageSizeError'))}
      >
        <Dragger
          name="file"
          multiple={false}
          accept={IMAGE_ALLOWED.join(',')}
          maxCount={1}
          fileList={file ? [{ uid: '1', name: file.name, size: file.size } as UploadFile] : []}
          beforeUpload={async(f) => {
            const ext = '.' + (f.name.split('.').pop() || '').toLowerCase()
            if (!IMAGE_ALLOWED.includes(ext)) {
              message.error(t('imageFormatError'))
              return Upload.LIST_IGNORE
            }
            if (f.size > IMAGE_MAX_MB * 1024 * 1024) {
              message.error(t('imageSizeError'))
              return Upload.LIST_IGNORE
            }
            return await handleFile(f)?false:Upload.LIST_IGNORE
          }}
          onRemove={() => handleFile(null)}
          style={{ padding: 48 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ fontSize: 64, color: '#b55233' }} />
          </p>
          <p className="ant-upload-text">{t('imageUploadHint')}</p>
          <p className="ant-upload-hint">{t('imageFormats')}</p>
        </Dragger>
      </StashDropZone>

      {file && (
        <div style={{ marginTop: 16 }}>
          <Space wrap size="middle" align="start">
            <div>
              <Button
                type="primary"
                size="large"
                loading={oneClickLoading}
                onClick={handleOneClickProcess}
                disabled={oneClickBusy && !oneClickLoading}
                style={{ minWidth: 140 }}
              >
                {t('imgOneClickProcess')}
              </Button>
            </div>
            <div>
              <Button
                type="primary"
                size="large"
                loading={oneClickAllActionsLoading}
                onClick={handleOneClickAllActionsProcess}
                disabled={oneClickBusy && !oneClickAllActionsLoading}
                style={{ minWidth: 140 }}
              >
                {t('imgOneClickAllActionsProcess')}
              </Button>
            </div>
            <div>
              <Button
                type="primary"
                size="large"
                loading={ancientCostumeLoading}
                onClick={handleAncientCostumeProcess}
                disabled={oneClickBusy && !ancientCostumeLoading}
                style={{ minWidth: 140 }}
              >
                {t('imgAncientCostumeProcess')}
              </Button>
            </div>
          </Space>
        </div>
      )}

      {file && originalSize && (
        <>
          <Divider style={{ margin: '16px 0' }} />
          <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('imgOriginalPreview')}</Text>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {t('imgOriginalSize')}: {originalSize.w} × {originalSize.h}
          </Text>
          <Text type="secondary" style={{display:'block',marginBottom:12}}>{lang==='zh'?'预览最长边为 1024 像素；裁切坐标、取色和加工使用原图。':lang==='ja'?'プレビューは最大 1024 ピクセルです。切り抜き座標・色取得・処理には元画像を使います。':'Preview is limited to 1024 pixels per side; crop coordinates, sampled colors and processing use the original image.'}</Text>
          <Row gutter={24} align="top">
            <Col xs={24} md={14}>
              <ImageCropEditor
                key={sourceKey}
                ref={editor}
                file={file}
                retainedBytes={()=>[...model.retained()].reduce((sum,file)=>sum+file.size*2,0)}
                onReadyChange={ready=>setReadySource(ready?file:null)}
                onSamplingChange={setSampling}
                allowPick={!busy}
                imageSize={originalSize}
                cropRegion={cropRegion}
                onChange={setCropRegion}
                onPickColor={handlePickColor}
                pickingColor={pickingColor}
              />
              <Space style={{ marginTop: 8 }} wrap>
                <Button size="small" type={pickingColor ? 'primary' : 'default'} disabled={!!busy} onClick={() => setPickingColor(!pickingColor)}>
                  {t('imgPickColorHint')}
                </Button>
                {hasCrop && (
                  <Button size="small" onClick={() => setCropRegion({ left: 0, top: 0, right: 0, bottom: 0 })}>
                    {t('resetCrop')}
                  </Button>
                )}
              </Space>
            </Col>
            <Col xs={24} md={10}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('imgCropSection')}</Text>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {t('imgCropHint')}
              </Text>
              <Row gutter={8}>
                <Col span={12}>
                  <InputNumber
                    min={0}
                    max={originalSize.w - 1}
                    value={cropRegion.left}
                    onChange={(v) => setCropRegion((r) => ({ ...r, left: v ?? 0 }))}
                    addonBefore={t('left')}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                </Col>
                <Col span={12}>
                  <InputNumber
                    min={0}
                    max={originalSize.w - cropRegion.left - 1}
                    value={cropRegion.right}
                    onChange={(v) => setCropRegion((r) => ({ ...r, right: v ?? 0 }))}
                    addonBefore={t('right')}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                </Col>
                <Col span={12}>
                  <InputNumber
                    min={0}
                    max={originalSize.h - 1}
                    value={cropRegion.top}
                    onChange={(v) => setCropRegion((r) => ({ ...r, top: v ?? 0 }))}
                    addonBefore={t('top')}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                </Col>
                <Col span={12}>
                  <InputNumber
                    min={0}
                    max={originalSize.h - cropRegion.top - 1}
                    value={cropRegion.bottom}
                    onChange={(v) => setCropRegion((r) => ({ ...r, bottom: v ?? 0 }))}
                    addonBefore={t('bottom')}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                </Col>
              </Row>
              {hasCrop && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('cropResultSize')}: {croppedW} × {croppedH}
                </Text>
              )}
            </Col>
          </Row>

          <Divider style={{ margin: '20px 0 16px' }} />
          <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('imgMatteSection')}</Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {t('imgMatteHint')}
          </Text>
          <Space wrap align="center">
            <Checkbox checked={enableMatte} onChange={(e) => setEnableMatte(e.target.checked)}>
              {t('imgEnableMatte')}
            </Checkbox>
            <ColorPicker
              value={bgColor}
              onChange={(_: unknown, hex: string) => setBgColor(hex || '#ffffff')}
              showText
            />
            <Text type="secondary">{t('tolerance')}:</Text>
            <Slider min={1} max={100} value={matteTolerance} onChange={setMatteTolerance} style={{ width: 100 }} />
            <Text type="secondary">{t('featherEdge')}:</Text>
            <Slider min={0} max={30} value={matteFeather} onChange={setMatteFeather} style={{ width: 100 }} />
            <Button type="primary" loading={matteLoading} onClick={runMattePreview} disabled={!enableMatte||oneClickBusy&&!matteLoading}>
              {t('imgRunMatte')}
            </Button>
          </Space>
          {mattePreviewUrl && (
            <>
              <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>{t('imgMattePreview')}</Text>
              {matteOutdated&&<Text type="secondary">{previousResult}</Text>}
              <div
                style={{
                  padding: 16,
                  background: 'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',
                  borderRadius: 8,
                  border: '1px solid #9a8b78',
                  display: 'inline-block',
                }}
              >
                <img
                  src={mattePreviewUrl}
                  alt={t('imgMattePreview')}
                  style={{ maxWidth: '100%', maxHeight: 300, display: 'block', imageRendering: 'pixelated' }}
                />
              </div>
            </>
          )}

          <Divider style={{ margin: '20px 0 16px' }} />
          <Text strong style={{ display: 'block', marginBottom: 12 }}>{t('customSize')}</Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {t('aspectHint')}
          </Text>
          <Space wrap>
            <InputNumber
              min={1}
              max={30000}
              value={targetW}
              onChange={(v) => handleTargetWChange(v ?? 256)}
              addonBefore={t('width')}
              style={{ width: 120 }}
            />
            <InputNumber
              min={1}
              max={30000}
              value={targetH}
              onChange={(v) => handleTargetHChange(v ?? 256)}
              addonBefore={t('height')}
              style={{ width: 120 }}
            />
          </Space>
          <Space style={{ marginTop: 8 }} wrap>
            <Button size="small" type={keepAspect ? 'primary' : 'default'} onClick={() => setKeepAspect(true)}>
              {t('imgKeepAspect')}
            </Button>
            <Button size="small" type={!keepAspect ? 'primary' : 'default'} onClick={() => setKeepAspect(false)}>
              {t('imgStretch')}
            </Button>
            <Checkbox checked={pixelated} onChange={(e) => setPixelated(e.target.checked)}>
              {t('imgPixelated')}
            </Checkbox>
          </Space>

          <Divider style={{ margin: '20px 0 16px' }} />
          <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('imgStrokeSection')}</Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {t('imgStrokeHint')}
          </Text>
          <Space wrap align="center">
            <Text type="secondary">{t('strokeWidth')}:</Text>
            <Slider min={0} max={20} value={strokeWidth} onChange={setStrokeWidth} style={{ width: 120 }} />
            <Text type="secondary">{strokeWidth}</Text>
            <ColorPicker
              value={strokeColor}
              onChange={(_: unknown, hex: string) => setStrokeColor(hex || '#000000')}
              showText
            />
          </Space>

          <Button type="primary" icon={<DownloadOutlined />} onClick={applyPreview} loading={loading} disabled={oneClickBusy&&!loading}>
            {t('imgApplyPreview')}
          </Button>

          {previewUrl && (
            <>
              <Divider style={{ margin: '24px 0 16px' }} />
              <Text strong style={{ display: 'block', marginBottom: 12 }}>{t('imgPreview')}</Text>
              {previewOutdated&&<Text type="secondary">{previousResult}</Text>}
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
                  stashSrc={outputUrl?.raw}
                  alt={t('imgPreview')}
                  style={{ maxWidth: '100%', maxHeight: 400, display: 'block', imageRendering: 'pixelated' }}
                />
              </div>
              <div style={{ marginTop: 12 }}>
                <Space>
                  <Button type="primary" loading={extendLoading} onClick={handleExtendBottom} disabled={oneClickBusy&&!extendLoading}>
                    {t('imgExtendBottom')}
                  </Button>
                  <Button type="primary" icon={<DownloadOutlined />} onClick={download}>
                    {t('imgDownload')}
                  </Button>
                  {onSendToFineProcess && previewBlob && (
                    <Button
                      type="default"
                      icon={<EditOutlined />}
                      onClick={async() => {
                        const base = (file?.name?.replace(/\.[^.]+$/, '') || 'output') + '_for_fine.png'
                        if(await onSendToFineProcess(previewBlob,base)!==false)message.success(t('imgSendToFineProcessDone'))
                      }}
                    >
                      {t('imgSendToFineProcess')}
                    </Button>
                  )}
                </Space>
              </div>
            </>
          )}
        </>
      )}
    </Space></NormalImageDocumentSurface>
  )
}

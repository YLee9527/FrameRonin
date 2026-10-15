/** Local project task for the original temporal watermark detector/inpainting. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { InboxOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Progress, Space, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import { runManagedTask } from '../localProject/managedTasks'

const { Dragger } = Upload
const { Text } = Typography
const ALLOWED = ['.mp4', '.mov', '.webm', '.avi', '.mkv']
const MAX_MB = 200

export default function SeedanceWatermarkRemover() {
  const { t, lang } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<{blob:Blob;name:string}|null>(null)
  const resultUrl=useMemo(()=>result?URL.createObjectURL(result.blob):null,[result])
  useEffect(()=>()=>{if(resultUrl)URL.revokeObjectURL(resultUrl)},[resultUrl])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [canceling, setCanceling] = useState(false)
  const [error, setError] = useState('')
  const execution = useRef<AbortController|null>(null)
  const mounted = useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const text=lang==='zh'?{local:'使用本地项目运行时处理。离开页面后任务继续，结果保存在项目素材与任务中。',cancel:'取消任务',canceling:'正在核对取消',canceled:'任务已取消'}
    :lang==='ja'?{local:'ローカルプロジェクトで処理します。ページを離れても処理は続き、結果はプロジェクトに保存されます。',cancel:'処理を取消',canceling:'取消を確認中',canceled:'処理を取り消しました'}
      :{local:'Processing uses the local project runtime. Tasks continue after leaving this page; results remain in Project assets and tasks.',cancel:'Cancel task',canceling:'Confirming cancellation',canceled:'Task canceled'}

  const handleSubmit = async () => {
    if(!file||execution.current)return
    const selected=file,controller=new AbortController()
    execution.current=controller;setProcessing(true);setResult(null);setProgress(0);setError('');setCanceling(false)
    try{
      const {outputs}=await runManagedTask('video.watermark',[selected],{frontendBytes:selected.size*2},{
        signal:controller.signal,
        onProgress:value=>{if(mounted.current)setProgress(Math.round(value*100))},
        outputFilter:version=>mounted.current&&version.metadata.kind==='video',
      })
      controller.signal.throwIfAborted()
      if(!mounted.current)return
      if(outputs.length!==1)throw new Error('The registered video result is incomplete')
      setResult({blob:outputs[0].blob,name:selected.name.replace(/\.[^.]+$/,'')+'_clean.mp4'})
      message.success(t('seedanceWatermarkDone'))
    }catch(error){
      if(mounted.current)setError(controller.signal.aborted&&error instanceof DOMException&&error.name==='AbortError'?text.canceled:String(error))
    }finally{
      if(execution.current===controller)execution.current=null
      if(mounted.current){setProcessing(false);setCanceling(false)}
    }
  }
  const reset = () => {setFile(null);setResult(null);setError('');setProgress(0)}
  const download = () => {
    if(!result||!resultUrl)return
    const anchor=document.createElement('a')
    anchor.href=resultUrl;anchor.download=result.name;anchor.click()
  }
  return <div style={{width:'100%',maxWidth:640}}>
    <Space direction="vertical" size="large" style={{width:'100%'}}>
      <Alert type="info" title={text.local}/>
      <Text type="secondary">{t('seedanceWatermarkHint')}</Text>
      <Dragger name="file" multiple={false} accept={ALLOWED.join(',')} maxCount={1} disabled={processing}
        fileList={file?[{uid:'1',name:file.name,size:file.size} as UploadFile]:[]}
        beforeUpload={selected=>{
          const extension='.'+(selected.name.split('.').pop()||'').toLowerCase()
          if(!ALLOWED.includes(extension)){message.error(t('formatError',{formats:ALLOWED.join(' ')}));return Upload.LIST_IGNORE}
          if(selected.size>MAX_MB*1024*1024){message.error(t('sizeError'));return Upload.LIST_IGNORE}
          setFile(selected);setResult(null);setError('');return false
        }} onRemove={reset} style={{padding:32}}>
        <p className="ant-upload-drag-icon"><InboxOutlined style={{fontSize:48,color:'#b55233'}}/></p>
        <p className="ant-upload-text">{t('seedanceWatermarkUpload')}</p>
        <p className="ant-upload-hint">{t('uploadFormats')}</p>
      </Dragger>
      {file&&!result&&<Button type="primary" size="large" loading={processing} onClick={handleSubmit}>{t('seedanceWatermarkStart')}</Button>}
      {processing&&<Space direction="vertical" style={{width:'100%'}}>
        <Progress percent={progress} status="active"/>
        <Text type="secondary">{t('seedanceWatermarkProcessing')}</Text>
        <Button disabled={canceling} onClick={()=>{setCanceling(true);execution.current?.abort()}}>{canceling?text.canceling:text.cancel}</Button>
      </Space>}
      {error&&<Alert type="error" title={error}/>}
      {resultUrl&&<video aria-label={t('seedanceWatermarkDone')} controls preload="metadata" src={resultUrl} style={{width:'100%',maxHeight:360}}/>}
      {result&&<Space>
        <Button type="primary" icon={<DownloadOutlined/>} onClick={download}>{t('seedanceWatermarkDownload')}</Button>
        <Button icon={<ReloadOutlined/>} onClick={reset}>{t('seedanceWatermarkReset')}</Button>
      </Space>}
    </Space>
  </div>
}

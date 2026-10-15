import { useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import { useLanguage } from '../i18n/context'
import { cacheManagedInput, importManagedInputs, runManagedTask, type ManagedVersion } from './managedTasks'
import {imageToolMetadata as metadata,imageToolReports,imageToolReport,type ImageToolDraft} from './imageToolDocument'

export type ImageToolResult={file:File;version:ManagedVersion}
type DocumentBinding={draft:ImageToolDraft;retained:()=>Set<File>;accept:(result:{results:File[];reportFile:File;taskId:string})=>void}

/** Processing is owned by the project queue. Leaving the page detaches its view,
 * while explicit cancellation invalidates the task before stopping its process. */
export function useManagedImageTool(files:File[],parameters:object,onImported?:(file:File,version:ManagedVersion)=>void,binding?:DocumentBinding){
  const {lang}=useLanguage()
  const [preparing,setPreparing]=useState(false),[revision,setRevision]=useState(0)
  const [busy,setBusy]=useState<string|null>(null),[canceling,setCanceling]=useState(false),[progress,setProgress]=useState(0)
  const [localResults,setResults]=useState<ImageToolResult[]>([]),[localReport,setReport]=useState<Record<string,unknown>>({})
  const boundResults=binding?.draft.results
  const results=useMemo(()=>boundResults?boundResults.map(file=>({file,version:metadata.get(file)!})):localResults,[boundResults,localResults])
  const report=binding?(binding.draft.reportFile?imageToolReports.get(binding.draft.reportFile)??{}:{}):localReport
  const controller=useRef<AbortController|null>(null),mounted=useRef(true)
  const signature=JSON.stringify(parameters),latest=useRef({files,signature,snapshot:binding?.draft})
  const documentBinding=useRef(binding);documentBinding.current=binding
  const importListener=useRef(onImported);importListener.current=onImported
  latest.current={files,signature,snapshot:binding?.draft}
  const text=lang==='zh'?{cancel:'取消加工',canceling:'正在核对取消',canceled:'加工已取消',preparing:'正在导入素材',stale:'输入或参数已改变，结果保留在项目素材中',thumbnail:'预览使用缩略图；加工与暂存保留完整原图。'}
    :lang==='ja'?{cancel:'処理を取消',canceling:'取消を確認中',canceled:'処理を取り消しました',preparing:'素材を読み込み中',stale:'入力または設定が変わりました。結果はプロジェクトに保存されています',thumbnail:'プレビューはサムネイルです。処理と一時保管には元画像を使います。'}
      :{cancel:'Cancel processing',canceling:'Confirming cancellation',canceled:'Processing canceled',preparing:'Importing assets',stale:'Inputs or settings changed; results remain in Project assets',thumbnail:'Previews use thumbnails; processing and stash retain original images.'}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{
    const importController=new AbortController();let active=true
    setPreparing(files.length>0);setResults([]);setReport({})
    void importManagedInputs(files,importController.signal,(file,version)=>{
      if(file instanceof File)metadata.set(file,version)
      if(active&&file instanceof File)importListener.current?.(file,version)
    }).then(()=>{if(active)setRevision(value=>value+1)}).catch(error=>{
      if(active&&!importController.signal.aborted)message.error(String(error))
    }).finally(()=>{if(active)setPreparing(false)})
    return()=>{active=false;importController.abort()}
  },[files])
  const versions=files.map(file=>metadata.get(file))
  const ready=!preparing&&files.length>0&&versions.every(version=>version?.metadata.kind==='image')
  const run=async(operation:string,overrides:object={},label=operation)=>{
    if(controller.current||!ready)return null
    const before=latest.current,abort=new AbortController();controller.current=abort
    setBusy(label);setCanceling(false);setProgress(0)
    const current=()=>mounted.current&&latest.current.files===before.files&&latest.current.signature===before.signature&&latest.current.snapshot===before.snapshot
    try{
      const unique=new Set<Blob>(documentBinding.current?[...documentBinding.current.retained()]:[...files,...results.map(result=>result.file)])
      const frontendBytes=96*1024**2+[...unique].reduce((sum,file)=>sum+file.size*2,0)
        +versions.reduce((sum,version)=>sum+(version?.metadata.thumbnailDataUrl?.length??0)*2,0)
        +Math.max(0,...results.map(result=>(result.version.metadata.width??0)*(result.version.metadata.height??0)))*4*16
      const completed=await runManagedTask(operation,files,{...parameters,...overrides,frontendBytes},{signal:abort.signal,
        onProgress:value=>{if(mounted.current)setProgress(previous=>Math.max(previous,value))},outputFilter:()=>mounted.current})
      if(!current()){if(mounted.current)message.warning(text.stale);return null}
      const next:ImageToolResult[]=[];let nextReport:Record<string,unknown>={},reportFile:File|null=null
      for(const output of completed.outputs){
        if(output.version.metadata.kind==='image'){
          const file=new File([output.blob],`${operation.replace('.','-')}-${next.length}.png`,{type:'image/png'})
          metadata.set(file,output.version);cacheManagedInput(file,completed.project.id,output.version.id)
          next.push({file,version:output.version})
        }else if(output.version.metadata.extension==='.json'){
          reportFile=new File([output.blob],`${operation.replace('.','-')}-report.json`,{type:'application/json'})
          metadata.set(reportFile,output.version);cacheManagedInput(reportFile,completed.project.id,output.version.id)
          nextReport=JSON.parse(await reportFile.text());imageToolReports.set(reportFile,nextReport)
        }
      }
      if(!current()){if(mounted.current)message.warning(text.stale);return null}
      if(documentBinding.current){
        if(!reportFile)throw new Error('IMAGE_TOOL_REPORT_MISSING')
        await imageToolReport({...documentBinding.current.draft,results:next.map(result=>result.file),reportFile,taskId:completed.taskId})
        if(!current()){message.warning(text.stale);return null}
        documentBinding.current.accept({results:next.map(result=>result.file),reportFile,taskId:completed.taskId})
      }else{setResults(next);setReport(nextReport)}
      return {results:next,report:nextReport,taskId:completed.taskId}
    }catch(error){
      if(mounted.current){if(error instanceof DOMException&&error.name==='AbortError')message.info(text.canceled);else message.error(String(error))}
      return null
    }finally{controller.current=null;if(mounted.current){setBusy(null);setCanceling(false)}}
  }
  const cancel=()=>{if(!controller.current)return;setCanceling(true);controller.current.abort()}
  return {versions,ready,preparing,revision,busy,progress,canceling,results,report,text,run,cancel}
}

/** Keep a source URL for stash/download; render the bounded server thumbnail. */
export function useImageToolUrls(files:File[],versions:(ManagedVersion|undefined)[]){
  const [urls,setUrls]=useState<string[]>([])
  useEffect(()=>{
    let active=true;const next:string[]=[]
    void Promise.resolve().then(()=>{if(active){next.push(...files.map(file=>URL.createObjectURL(file)));setUrls(next)}})
    return()=>{active=false;next.forEach(URL.revokeObjectURL)}
  },[files])
  return files.map((_,index)=>({raw:urls[index],preview:versions[index]?.metadata.thumbnailDataUrl??''}))
}

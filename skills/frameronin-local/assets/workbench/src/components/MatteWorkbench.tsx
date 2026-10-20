import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type MouseEvent} from 'react'
import {flushSync} from 'react-dom'
import {Button,ColorPicker,InputNumber,message,Progress,Segmented,Slider,Space,Typography,Upload} from 'antd'
import type {UploadFile} from 'antd'
import {DownloadOutlined,InboxOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import {useImageStash} from '../stash/context'
import {useMatteDocument} from '../localProject/useMatteDocument'
import {MatteDocumentSurface} from '../localProject/MatteDocumentSurface'
import {matteInputs,matteLayout,matteReports,type MatteDraft,type MatteResult,type MatteSettings} from '../localProject/matteDocument'
import {prepareFineInput} from '../localProject/fineEditInput'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {runManagedTask,cacheManagedInput} from '../localProject/managedTasks'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {runNormalSourceWorker} from '../lib/normalImageSourceWorker'
import {checkMatteToolBudget,type MatteToolLayout} from '../lib/matteTool'
import {localJson} from '../localProject/api'
import {useImageToolUrls} from '../localProject/useManagedImageTool'
import StashDropZone from './StashDropZone'
import MattePreview from './MattePreview'

const {Dragger}=Upload,{Text}=Typography
type Role='source'|'black'|'white'
type Action='raw'|'repair'|'erosion'
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const hasInputs=(d:MatteDraft)=>matteInputs(d).length===(d.mode==='doubleBg'?2:1)

export default function MatteWorkbench(){
 const {t,lang}=useLanguage(),{addImage}=useImageStash(),model=useMatteDocument(),d=model.draft
 const text=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 const alive=useRef(true),active=useRef<AbortController|null>(null),incoming=useRef(new Map<Role,{controller:AbortController;promise:Promise<boolean>}>()),sample=useRef<{controller:AbortController;promise:Promise<void>}|null>(null)
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),wanted=useRef<Action|null>(null),kick=useRef<()=>void>(()=>{}),extra=useRef(0),interaction=useRef(false)
 const pan=useRef<{x:number;y:number;panX:number;panY:number}|null>(null),viewport=useRef<HTMLDivElement>(null),wheelTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const [busy,setBusy]=useState<Action|null>(null),[preparing,setPreparing]=useState(false),[sampling,setSampling]=useState(false),[progress,setProgress]=useState(0),[canceling,setCanceling]=useState(false),[status,setStatus]=useState('')
 const {retained:retainedFiles,dispatch,change}=model
 const retained=useCallback(()=>96*1024**2+3*1024**2*16+extra.current+[...retainedFiles()].reduce((n,f)=>n+f.size*2,0),[retainedFiles])
 const clearAuto=useCallback(()=>{wanted.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null},[])
 const finishGesture=useCallback(()=>{pan.current=null;if(wheelTimer.current)clearTimeout(wheelTimer.current);wheelTimer.current=null;flushSync(()=>dispatch({type:'end'}))},[dispatch])
 const beforeAction=useCallback(async()=>{finishGesture();await Promise.all([...incoming.current.values()].map(v=>v.promise));await sample.current?.promise},[finishGesture])
 const hasPendingEdits=useCallback(()=>incoming.current.size>0||sample.current!==null||pan.current!==null||interaction.current,[])
 const onInteractionChange=useCallback((v:boolean)=>{interaction.current=v},[])
 useEffect(()=>{alive.current=true;const pendingInputs=incoming.current;return()=>{alive.current=false;clearAuto();for(const value of pendingInputs.values())value.controller.abort();sample.current?.controller.abort();if(wheelTimer.current)clearTimeout(wheelTimer.current)}},[clearAuto])
 const result=d.eroded??d.repaired??d.raw,resultFile=result?.file??null
 const files=useMemo(()=>[d.source,d.black,d.white,resultFile].filter((f):f is File=>!!f),[d.source,d.black,d.white,resultFile])
 const urls=useImageToolUrls(files,files.map(f=>imageToolMetadata.get(f))),rawUrl=(file:File)=>urls[files.indexOf(file)]?.raw
 const originalLayout=d.raw?((matteReports.get(d.raw.report)?.parameters as {layout?:unknown}|undefined)?.layout):null
 const rawOutdated=!!d.raw&&!same(originalLayout,matteLayout(d))
 const erosionLayout=d.eroded?((matteReports.get(d.eroded.report)?.parameters as {layout?:{erosion:number}}|undefined)?.layout):null
 const erosionOutdated=!!d.eroded&&erosionLayout?.erosion!==d.settings.postErosion
 const readable=(error:unknown)=>{
  const s=String(error)
  if(s.includes('SIZE_MISMATCH'))return t('chromaDoubleBgSizeMismatch')
  if(s.includes('RESOURCE_LIMIT')||s.includes('RESOURCE_BUDGET_EXCEEDED'))return text('超出内存预算，请减小输入尺寸。','The memory budget is exceeded. Reduce the input dimensions.','メモリ予算を超えています。入力サイズを小さくしてください。')
  if(s.includes('WEBGL'))return text('当前图形环境无法完成原白底算法，请检查 WebGL 或调整尺寸后重试。','The current graphics environment cannot run the original white-background algorithm. Check WebGL or reduce dimensions.','現在の描画環境では元の白背景処理を実行できません。WebGL またはサイズを確認してください。')
  if(s.includes('MATTE_STATIC_IMAGE_REQUIRED')||s.includes('FINE_EDITOR_SOURCE_TYPE'))return text('请选择静态 PNG、JPEG 或 WebP。','Choose a static PNG, JPEG or WebP.','静止画の PNG、JPEG、WebP を選択してください。')
  return s
 }
 const perform=async(kind:Action)=>{
  if(active.current)return
  const abort=new AbortController();active.current=abort;extra.current=0;setBusy(kind);setCanceling(false);setProgress(0);setStatus('')
  try{
   finishGesture();await Promise.all([...incoming.current.values()].map(v=>v.promise));await sample.current?.promise;abort.signal.throwIfAborted()
   // Import/sampling may schedule the same action while this call waits for
   // them. This snapshot already includes those edits; consume that intent.
   // Edits made after the snapshot still enqueue a fresh action.
   if(wanted.current===kind)clearAuto()
   const before=model.current(),layout=matteLayout(before),inputs=matteInputs(before)
   if(!hasInputs(before)||kind!=='raw'&&(!before.raw||before.mode!=='doubleBg')||kind==='erosion'&&!before.repaired)return
   const run=async(stage:MatteToolLayout,selected:File[],keepForNext=false):Promise<MatteResult|null>=>{
    const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:abort.signal})
    checkMatteToolBudget(selected.map(file=>{const m=imageToolMetadata.get(file)!.metadata;return {...fineEditorDimensions(m),bytes:m.bytes} as {width:number;height:number;bytes:number}}),stage,memoryBudgetBytes,retained())
    if(alive.current){setProgress(0);setStatus(stage.mode==='repair'?t('chromaDoubleBgPostProcessBtn'):stage.mode==='frontier'?t('chromaDoubleBgPostErosion'):before.mode==='doubleBg'?t('chromaDoubleBgProcessing'):text('正在抠图','Matting image','背景を除去中'))}
    const completed=await runManagedTask('image.matteTool',selected,{layout:stage,renderer:'browser-worker',frontendBytes:retained()},{signal:abort.signal,onProgress:n=>{if(alive.current)setProgress(v=>Math.max(v,n))},outputFilter:()=>alive.current||keepForNext})
    if(!alive.current&&!keepForNext)return null
    if(completed.outputs.length!==2||completed.outputs[0].version.metadata.containerFormat!=='PNG'||completed.outputs[1].version.metadata.extension!=='.json')throw new Error('MATTE_RESULT_INVALID')
    const loaded=completed.outputs.map((o,i)=>{const file=new File([o.blob],i?'matte-report.json':`matte-${stage.mode}.png`,{type:i?'application/json':'image/png'});imageToolMetadata.set(file,o.version);cacheManagedInput(file,completed.project.id,o.version.id);extra.current+=file.size*2;return file})
    const report=JSON.parse(await loaded[1].text());if(report.operation!=='image.matteTool'||report.mode!==stage.mode||report.outputFrames!==1)throw new Error('MATTE_REPORT_INVALID')
    matteReports.set(loaded[1],report);return {file:loaded[0],report:loaded[1],inputs:selected,taskId:completed.taskId}
   }
   let raw=before.raw,repaired=before.repaired,eroded:MatteResult|null=null
   if(kind==='raw'){raw=await run(layout,inputs);repaired=null}
   else if(kind==='repair'){
    repaired=await run({mode:'repair'},[before.raw!.file],before.settings.postErosion>0)
    if(repaired&&before.settings.postErosion>0)eroded=await run({mode:'frontier',erosion:before.settings.postErosion},[repaired.file])
   }else if(before.settings.postErosion>0)eroded=await run({mode:'frontier',erosion:before.settings.postErosion},[before.repaired!.file])
   abort.signal.throwIfAborted();if(!alive.current)return
   const current=model.current(),unchanged=current.mode===before.mode&&same(matteLayout(current),layout)&&matteInputs(current).every((file,i)=>file===inputs[i])&&hasInputs(current)&&!incoming.current.size&&!sample.current
    &&(kind==='raw'||current.raw===before.raw&&current.settings.postErosion===before.settings.postErosion)&&(kind!=='erosion'||current.repaired===before.repaired)
   if(!unchanged){setStatus(text('输入或参数已改变，结果保留在项目中。','Inputs or settings changed; results remain in Project assets.','入力または設定が変わりました。結果はプロジェクトに保存されています。'));return}
   flushSync(()=>model.change(value=>({...value,raw,repaired,eroded})));setStatus(text('处理完成','Processing complete','処理が完了しました'))
  }catch(error){if(alive.current){const canceled=error instanceof DOMException&&error.name==='AbortError';setStatus(canceled?text('加工已取消','Processing canceled','処理を取り消しました'):readable(error));if(!canceled)message.error(readable(error))}}
  finally{active.current=null;extra.current=0;if(alive.current){setBusy(null);setCanceling(false);if(wanted.current)timer.current=setTimeout(()=>kick.current(),100)}}
 }
 const schedule=(kind:Action)=>{wanted.current=kind;if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>kick.current(),180)}
 useLayoutEffect(()=>{kick.current=()=>{timer.current=null;if(active.current||!wanted.current||!alive.current)return;const action=wanted.current;wanted.current=null;void perform(action)}})
 const setSetting=<K extends keyof MatteSettings>(key:K,value:MatteSettings[K])=>{
  if(Object.is(model.current().settings[key],value))return
  flushSync(()=>model.change(v=>({...v,settings:{...v.settings,[key]:value},...(key==='postErosion'&&value===0?{eroded:null}:{})})))
  if(key==='postErosion'){if(model.current().repaired&&!rawOutdated&&value!==0)schedule('erosion');else clearAuto()}
  else if(hasInputs(model.current()))schedule('raw')
 }
 const handleInput=(role:Role,file:File|null)=>{
  incoming.current.get(role)?.controller.abort();sample.current?.controller.abort();clearAuto();setStatus('')
  const prior=model.current(),old=prior[role],operation={controller:new AbortController(),promise:Promise.resolve(false)};incoming.current.set(role,operation);setPreparing(true)
  operation.promise=(async()=>{
   await Promise.resolve()
   if(file){const input=await prepareFineInput(file,retained(),operation.controller.signal);if((input.version.metadata.frames??1)!==1)throw new Error('MATTE_STATIC_IMAGE_REQUIRED')}
   operation.controller.signal.throwIfAborted();if(!alive.current||incoming.current.get(role)!==operation||model.current().mode!==prior.mode||model.current()[role]!==old)return false
   finishGesture();flushSync(()=>model.change(v=>({...v,[role]:file,raw:null,repaired:null,eroded:null,view:file?v.view:{...v.view,zoom:1,panX:0,panY:0}})))
   if(hasInputs(model.current()))schedule('raw');return true
  })().catch(error=>{if(alive.current&&!operation.controller.signal.aborted)message.error(readable(error));return false}).finally(()=>{if(incoming.current.get(role)===operation)incoming.current.delete(role);if(alive.current)setPreparing(incoming.current.size>0)})
  return operation.promise
 }
 const setMode=(mode:MatteDraft['mode'])=>{
  clearAuto();for(const value of incoming.current.values())value.controller.abort();sample.current?.controller.abort();finishGesture();setStatus('')
  flushSync(()=>model.change(v=>({...v,mode,source:mode==='doubleBg'?null:v.source,black:null,white:null,raw:null,repaired:null,eroded:null,view:{...v.view,zoom:1,panX:0,panY:0}})))
  if(hasInputs(model.current()))schedule('raw')
 }
 const pick=async(event:MouseEvent<HTMLCanvasElement>)=>{
  if(d.mode!=='chroma'||!d.source||sampling)return
  const before=model.current(),file=before.source!,rect=event.currentTarget.getBoundingClientRect(),meta=imageToolMetadata.get(file)!.metadata,size=fineEditorDimensions(meta)
  const x=Math.max(0,Math.min(size.width!-1,Math.floor((event.clientX-rect.left)/rect.width*size.width!))),y=Math.max(0,Math.min(size.height!-1,Math.floor((event.clientY-rect.top)/rect.height*size.height!)))
  const operation={controller:new AbortController(),promise:Promise.resolve()};sample.current=operation;setSampling(true)
  operation.promise=(async()=>{
   const {memoryBudgetBytes}=await localJson<{memoryBudgetBytes:number}>('/api/project/context',{signal:operation.controller.signal}),result=await runNormalSourceWorker(file,'sample',memoryBudgetBytes,retained(),operation.controller.signal,x,y)
   const current=model.current()
   if(alive.current&&!operation.controller.signal.aborted&&current.mode===before.mode&&current.source===file&&current.settings.keyColor===before.settings.keyColor&&!incoming.current.size){const color='#'+result.color!.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');setSetting('keyColor',color)}
  })().catch(error=>{if(alive.current&&!operation.controller.signal.aborted)message.error(readable(error))}).finally(()=>{if(sample.current===operation)sample.current=null;if(alive.current)setSampling(false)})
  await operation.promise
 }
 useEffect(()=>{
  const element=viewport.current;if(!element||d.mode!=='doubleBg')return
  const wheel=(event:WheelEvent)=>{event.preventDefault();dispatch({type:'begin'});change(v=>({...v,view:{...v.view,zoom:Math.max(.1,Math.min(5,v.view.zoom+(event.deltaY>0?-.15:.15)))}}));if(wheelTimer.current)clearTimeout(wheelTimer.current);wheelTimer.current=setTimeout(()=>{wheelTimer.current=null;dispatch({type:'end'})},180)}
  element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel)
 },[change,dispatch,d.mode,resultFile])
 const upload=(role:Role,label:string)=>{
  const file=d[role]
  return <div role="group" aria-label={label} style={{flex:1,minWidth:200}}><Text strong>{label}</Text><StashDropZone onStashDrop={f=>{void handleInput(role,f)}} maxSizeMB={20} onSizeError={()=>message.error(t('imageSizeError'))}><Dragger accept=".png,.jpg,.jpeg,.webp" maxCount={1} fileList={file?[{uid:role,name:file.name} as UploadFile]:[]} beforeUpload={f=>{void handleInput(role,f);return false}} onRemove={()=>handleInput(role,null)}><p>{t('imageUploadHint')}</p><p>{t('imageFormats')}</p></Dragger></StashDropZone>
   {file&&<MattePreview file={file} label={label+text('预览',' preview','プレビュー')} paused={!!busy||preparing} retained={retained} rawUrl={rawUrl(file)} onClick={role==='source'?event=>{void pick(event)}:undefined} style={{maxWidth:320,maxHeight:240,cursor:role==='source'&&d.mode==='chroma'?'crosshair':'default'}}/>}</div>
 }
 const slider=(key:Exclude<keyof MatteSettings,'keyColor'>,label:string,min:number,max:number,disabled=false)=><div style={{display:'flex',alignItems:'center',gap:12,minWidth:280,flex:1}}><Text style={{minWidth:90}}>{label}</Text><Slider aria-label={label} min={min} max={max} value={d.settings[key]} disabled={disabled} style={{flex:1,minWidth:100}} onChange={v=>setSetting(key,v)}/><InputNumber aria-label={label} min={min} max={max} value={d.settings[key]} disabled={disabled} onChange={v=>{if(v!==null&&v>=min&&v<=max)setSetting(key,v)}}/></div>
 const outputName=(d.mode==='doubleBg'?d.black:d.source)?.name.replace(/\.[^.]+$/,'')??'result',downloadName=outputName+(d.mode==='doubleBg'?'_doublebg.png':'_chroma.png')
 const pausePreview=!!busy||preparing
 return <MatteDocumentSurface model={model} beforeAction={beforeAction} invalidateScheduled={clearAuto} hasPendingEdits={hasPendingEdits} onInteractionChange={onInteractionChange}><div role="region" aria-label={text('抠图工作区','Matte workspace','背景除去ワークスペース')} tabIndex={-1} style={{outline:'none'}}><Space direction="vertical" size="large" style={{width:'100%'}}>
  <Text type="secondary">{t(d.mode==='doubleBg'?'chromaDoubleBgHint':d.mode==='whiteErode'?'chromaHintWhite':'chromaHint')}</Text>
  {d.mode==='doubleBg'&&<Text type="secondary">{t('chromaDoubleBgAttributionLine')}</Text>}
  <Segmented value={d.mode} onChange={v=>setMode(v as MatteDraft['mode'])} options={[{label:t('chromaAlgoChroma'),value:'chroma'},{label:t('chromaAlgoWhite'),value:'whiteErode'},{label:t('chromaAlgoDoubleBg'),value:'doubleBg'}]}/>
  {d.mode==='chroma'&&<Space><Button style={{background:'#00ff00'}} onClick={()=>setSetting('keyColor','#00ff00')}>{t('chromaGreen')}</Button><Button style={{background:'#0000ff',color:'#fff'}} onClick={()=>setSetting('keyColor','#0000ff')}>{t('chromaBlue')}</Button><ColorPicker value={d.settings.keyColor} showText onChange={(_,hex)=>{if(hex)setSetting('keyColor',hex)}}/></Space>}
  <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>{d.mode==='doubleBg'?<>{upload('black',t('chromaDoubleBgBlack'))}{upload('white',t('chromaDoubleBgWhite'))}</>:upload('source',text('原图','Source image','元画像'))}</div>
  {preparing&&<Button onClick={()=>{for(const value of incoming.current.values())value.controller.abort()}}>{text('取消导入','Cancel import','読み込みを取消')}</Button>}
  {sampling&&<Button onClick={()=>sample.current?.controller.abort()}>{text('取消取色','Cancel sampling','色取得を取消')}</Button>}
  <div role="group" aria-label={text('抠图参数','Matte parameters','背景除去の設定')} style={{display:'flex',gap:16,flexWrap:'wrap'}}>{d.mode==='doubleBg'?<>{slider('doubleTolerance',t('chromaDoubleBgTolerance'),50,100)}{slider('edgeContrast',t('chromaDoubleBgEdgeContrast'),50,100)}{slider('postErosion',t('chromaDoubleBgPostErosion'),0,100,!d.repaired||rawOutdated||!!busy)}</>:<>{slider('tolerance',t('chromaTolerance'),5,100)}{slider('smoothness',t('chromaSmoothness'),5,100)}{d.mode==='chroma'&&slider('spill',t('chromaSpill'),5,100)}{slider('erosion',t('chromaErosion'),0,100)}</>}</div>
  <Space wrap><Button type="primary" disabled={!hasInputs(d)||!!busy||preparing||sampling} onClick={()=>{clearAuto();void perform('raw')}}>{d.mode==='doubleBg'?t('chromaDoubleBgRedoBtn'):text('重新抠图','Run matte','背景を再計算')}</Button>
   {d.mode==='doubleBg'&&<Button disabled={!d.raw||rawOutdated||!!busy||preparing} onClick={()=>{clearAuto();void perform('repair')}}>{t('chromaDoubleBgPostProcessBtn')}</Button>}
   {resultFile&&rawUrl(resultFile)&&<Button icon={<DownloadOutlined/>} href={rawUrl(resultFile)} download={downloadName}>{t('imgDownload')}</Button>}
   {d.mode==='doubleBg'&&resultFile&&<Button icon={<InboxOutlined/>} onClick={async()=>{try{const transfer=URL.createObjectURL(resultFile);await addImage(transfer,downloadName,true);message.success(t('imgFineEditorSendToStashSuccess'))}catch(error){message.error(String(error))}}}>{t('imgFineEditorSendToStash')}</Button>}
  </Space>
  {busy&&<Space><Text>{status}</Text><Progress percent={Math.round(progress*100)} style={{width:160}}/><Button loading={canceling} onClick={()=>{setCanceling(true);clearAuto();active.current?.abort()}}>{text('取消加工','Cancel processing','処理を取消')}</Button></Space>}
  {!busy&&status&&<Text role="status">{status}</Text>}
  {(rawOutdated||erosionOutdated)&&<Text type="warning">{text('显示上次结果；当前参数尚未应用。','The previous result is shown; current settings have not been applied.','前回の結果を表示しています。現在の設定は未適用です。')}</Text>}
  {resultFile&&<><Space wrap><Text strong>{t('imgPreview')} · {d.eroded?t('chromaDoubleBgPostErosion'):d.repaired?t('chromaDoubleBgPostProcessBtn'):t('chromaAlgo'+(d.mode==='doubleBg'?'DoubleBg':d.mode==='chroma'?'Chroma':'White'))}</Text><Button size="small" type={d.view.backgroundActive?'primary':'default'} onClick={()=>model.change(v=>({...v,view:{...v.view,backgroundActive:!v.view.backgroundActive}}))}>{t('chromaBgBtn')}</Button>{d.view.backgroundActive&&<ColorPicker value={d.view.background} showText onChange={(_,hex)=>{if(hex)model.change(v=>({...v,view:{...v.view,background:hex}}))}}/>}</Space>
   <Text type="secondary">{text('预览最长边 1024；取色与导出保留原图像素。','Preview is limited to 1024 pixels per side; sampling and exports retain original pixels.','プレビューは最大 1024 ピクセルです。色取得と書き出しは元のピクセルを使います。')}</Text>
   <div ref={viewport} role="group" aria-label={text('结果画布','Result canvas','結果キャンバス')} style={{background:d.view.backgroundActive?d.view.background:'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',height:d.mode==='doubleBg'?'min(600px,60vh)':undefined,minHeight:d.mode==='doubleBg'?400:undefined,padding:16,overflow:'hidden',position:'relative',border:'1px solid #9a8b78',borderRadius:8,touchAction:'none'}} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(d.mode==='doubleBg'&&e.button===2){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);pan.current={x:e.clientX,y:e.clientY,panX:d.view.panX,panY:d.view.panY};model.dispatch({type:'begin'})}}} onPointerMove={e=>{const start=pan.current;if(start)model.change(v=>({...v,view:{...v.view,panX:Math.max(-1e6,Math.min(1e6,start.panX+e.clientX-start.x)),panY:Math.max(-1e6,Math.min(1e6,start.panY+e.clientY-start.y))}}))}} onPointerUp={()=>{pan.current=null;model.dispatch({type:'end'})}} onPointerCancel={()=>{pan.current=null;model.dispatch({type:'end'})}}>
    <div style={d.mode==='doubleBg'?{position:'absolute',inset:16,display:'flex',alignItems:'center',justifyContent:'center',transform:`translate(${d.view.panX}px,${d.view.panY}px) scale(${d.view.zoom})`,transformOrigin:'center'}:undefined}><MattePreview file={resultFile} label={text('抠图结果','Matte result','背景除去の結果')} paused={pausePreview} retained={retained} rawUrl={rawUrl(resultFile)}/></div>
   </div>
   {d.mode==='doubleBg'&&<Space wrap><Text>{text('缩放','Zoom','拡大率')}</Text><InputNumber aria-label={text('预览缩放','Preview zoom','プレビューの拡大率')} min={.1} max={5} step={.15} value={d.view.zoom} onChange={v=>{if(v!==null&&v>=.1&&v<=5)model.change(d=>({...d,view:{...d.view,zoom:v}}))}}/>{(['panX','panY'] as const).map((key,i)=><InputNumber key={key} aria-label={text(i?'纵向平移':'横向平移',i?'Pan Y':'Pan X',i?'縦の移動':'横の移動')} min={-1e6} max={1e6} value={d.view[key]} onChange={value=>{if(value!==null)model.change(d=>({...d,view:{...d.view,[key]:value}}))}}/>)}<Button onClick={()=>model.change(d=>({...d,view:{...d.view,zoom:1,panX:0,panY:0}}))}>{text('重置视图','Reset view','表示をリセット')}</Button></Space>}
  </>}
 </Space></div></MatteDocumentSurface>
}

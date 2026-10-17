import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react'
import {flushSync} from 'react-dom'
import {Button,InputNumber,message,Pagination,Progress,Slider,Space,Tabs,Tooltip,Typography,Upload} from 'antd'
import {DeleteOutlined,DownloadOutlined,DragOutlined,ExportOutlined,ScissorOutlined} from '@ant-design/icons'
import type {UploadFile} from 'antd'
import {useLanguage} from '../i18n/context'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'
import {checkCustomSliceBudget} from '../lib/customSlice'
import type {SpriteAssetRequest} from '../lib/spriteSheetAssets'
import {SpriteSheetDocumentSurface} from '../localProject/SpriteSheetDocumentSurface'
import {useSpriteSheetDocument} from '../localProject/useSpriteSheetDocument'
import {serializeSpriteSheet,spriteGifLayout,spriteSheetReports,type SpriteSheetDraft} from '../localProject/spriteSheetDocument'
import {useCustomSliceView} from '../localProject/useCustomSliceView'
import {useSpriteBlobUrls,useSpriteSheetAssets} from '../localProject/useSpriteSheetAssets'
import {useImageToolUrls} from '../localProject/useManagedImageTool'
import {cacheManagedInput,runManagedTask} from '../localProject/managedTasks'
import {imageToolMetadata} from '../localProject/imageToolDocument'
import {prepareFineInput} from '../localProject/fineEditInput'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import type {CustomResult} from '../localProject/customSliceDocument'

const {Dragger}=Upload,{Text}=Typography
const board:CSSProperties={padding:16,background:'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px',borderRadius:8,border:'1px solid #9a8b78',maxWidth:'100%',boxSizing:'border-box'}
type GifRow={width:number;height:number;frames:number;durationMs:number}
const EMPTY_ROWS:GifRow[]=[],EMPTY_NUMBERS:number[]=[]
export default function SpriteSheetTool(){
 const {t,lang}=useLanguage(),model=useSpriteSheetDocument(),d=model.draft
 const text=(zh:string,en:string,ja:string)=>lang==='zh'?zh:lang==='ja'?ja:en
 const alive=useRef(true),controller=useRef<AbortController|null>(null),incoming=useRef<{controller:AbortController;promise:Promise<boolean>}|null>(null),drag=useRef<number|null>(null),extra=useRef(0),focusFrame=useRef<number|null>(null),frameRoot=useRef<HTMLDivElement>(null)
 const [busy,setBusy]=useState<'split'|'frames'|'gifs'|null>(null),[progress,setProgress]=useState(0),[preparing,setPreparing]=useState(false),[canceling,setCanceling]=useState(false),[status,setStatus]=useState(''),[dragIndex,setDragIndex]=useState<number|null>(null),[framePage,setFramePage]=useState(1),[gifPage,setGifPage]=useState(1)
 const retained=model.retained,dispatch=model.dispatch
 const pendingInteraction=useRef(false)
 const interactionChange=useCallback((active:boolean)=>{pendingInteraction.current=active},[])
 const retainedBytes=useCallback(()=>96*1024**2+extra.current+[...retained()].reduce((n,f)=>n+f.size*2,0),[retained])
 const beforeAction=useCallback(async()=>{flushSync(()=>{drag.current=null;setDragIndex(null);dispatch({type:'end'})});await incoming.current?.promise},[dispatch])
 const hasPendingEdits=useCallback(()=>incoming.current!==null||drag.current!==null||pendingInteraction.current,[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;incoming.current?.controller.abort()}},[])
 const sources=useMemo(()=>d.source?[d.source]:[],[d.source]),sourceUrls=useImageToolUrls(sources,sources.map(f=>imageToolMetadata.get(f)))
 const activeArchive=d.activeTab==='split'?d.split?.data??null:d.frames?.data??null
 const archive=useCustomSliceView(activeArchive,'archive',retainedBytes)
 const pageSize=d.framesPerRow*Math.max(1,Math.floor(24/d.framesPerRow)),framePageValue=Math.min(framePage,Math.max(1,Math.ceil(d.order.length/pageSize))),frameStart=(framePageValue-1)*pageSize
 const frameIndices=useMemo(()=>d.activeTab==='togif'?d.order.slice(frameStart,frameStart+pageSize):EMPTY_NUMBERS,[d.activeTab,d.order,frameStart,pageSize])
 const frameRequest=useMemo<SpriteAssetRequest|null>(()=>{
  if(!archive.view||d.activeTab!=='togif'||!frameIndices.length)return null
  return {action:'preview',files:frameIndices.map(i=>archive.view!.assets[i]),sizes:frameIndices.map(i=>({...archive.view!.sizes[i],frames:1}))}
 },[archive.view,d.activeTab,frameIndices])
 const framesPreview=useSpriteSheetAssets(frameRequest,retainedBytes),framePreviewUrls=useSpriteBlobUrls(framesPreview.value.previews)
 const gifRows=(d.gifs?spriteSheetReports.get(d.gifs.report)?.gifRows:undefined) as GifRow[]|undefined,rows=gifRows??EMPTY_ROWS
 const gifRequest=useMemo<SpriteAssetRequest|null>(()=>d.activeTab==='togif'&&d.gifs?{action:'gifArchive',file:d.gifs.data,rowCount:rows.length}:null,[d.activeTab,d.gifs,rows.length])
 const gifsArchive=useSpriteSheetAssets(gifRequest,retainedBytes),gifUrls=useSpriteBlobUrls(gifsArchive.value.files)
 const gifPageValue=Math.min(gifPage,Math.max(1,Math.ceil(rows.length/12))),gifStart=(gifPageValue-1)*12
 const gifPreviewRequest=useMemo<SpriteAssetRequest|null>(()=>{
  if(!gifsArchive.value.files.length)return null
  return {action:'preview',files:gifsArchive.value.files.slice(gifStart,gifStart+12),sizes:rows.slice(gifStart,gifStart+12).map(r=>({w:r.width,h:r.height,frames:r.frames}))}
 },[gifsArchive.value.files,gifStart,rows])
 const gifPreviews=useSpriteSheetAssets(gifPreviewRequest,retainedBytes),gifPreviewUrls=useSpriteBlobUrls(gifPreviews.value.previews)
 const visibleGifBytes=rows.slice(gifStart,gifStart+12).reduce((n,r)=>n+r.width*r.height*r.frames*16,0),animateGifs=visibleGifBytes<=32*1024**2
 useLayoutEffect(()=>{extra.current=(archive.view?.bytes??0)+gifsArchive.value.files.reduce((n,f)=>n+f.size*2,0)+framesPreview.value.previews.reduce((n,f)=>n+f.size*2,0)+gifPreviews.value.previews.reduce((n,f)=>n+f.size*2,0)+(animateGifs?visibleGifBytes:12*128*128*16)},[archive.view,gifsArchive.value.files,framesPreview.value.previews,gifPreviews.value.previews,animateGifs,visibleGifBytes])
 useLayoutEffect(()=>{if(focusFrame.current!==null){const button=frameRoot.current?.querySelector<HTMLButtonElement>(`button[data-source-frame="${focusFrame.current}"]`);if(button){button.focus();focusFrame.current=null}}},[d.order,framePageValue])
 const changed=()=>text('编辑已改变；结果保留在项目中','Edits changed; results remain in Project assets','編集が変わりました。結果はプロジェクトに保存されています')
 const setGrid=(key:'columns'|'rows',value:number)=>model.change(prev=>{const n=Math.max(1,Math.min(64,Math.floor(value)));return prev[key]===n?prev:{...prev,[key]:n,frames:null,order:[],gifs:null}})
 const setSource=(file:File|null)=>{
  incoming.current?.controller.abort()
  if(!file){model.change(prev=>({...prev,source:null,info:null,split:null,frames:null,gifs:null,order:[]}));return Promise.resolve(true)}
  const request={controller:new AbortController(),promise:Promise.resolve(false)},before=model.current();incoming.current=request;setPreparing(true);setStatus('')
  const work=(async()=>{
   const prepared=await prepareFineInput(file,retainedBytes(),request.controller.signal);request.controller.signal.throwIfAborted()
   if((prepared.version.metadata.frames??1)!==1)throw new Error('SPRITE_STATIC_IMAGE_REQUIRED')
   const size=fineEditorDimensions(prepared.version.metadata);checkCustomSliceBudget(size.width!,size.height!,file.size,prepared.memoryBudgetBytes,retainedBytes())
   if(!alive.current||model.current()!==before){if(alive.current)message.warning(changed());return false}
   model.change(prev=>({...prev,source:file,info:{w:size.width!,h:size.height!},split:null,frames:null,gifs:null,order:[]}));return true
  })().catch(error=>{if(alive.current&&!request.controller.signal.aborted)setStatus(String(error));return false})
  const canceled=new Promise<boolean>(resolve=>request.controller.signal.addEventListener('abort',()=>resolve(false),{once:true}))
  request.promise=Promise.race([work,canceled]).finally(()=>{if(incoming.current===request){incoming.current=null;if(alive.current)setPreparing(false)}});return request.promise
 }
 const result=(completed:Awaited<ReturnType<typeof runManagedTask>>,kind:'split'|'frames'|'gifs'):CustomResult=>{
  if(completed.outputs.length!==2)throw new Error('SPRITE_RESULT_COUNT')
  const files=completed.outputs.map((o,i)=>{const file=new File([o.blob],i===1?'sprite-report.json':kind==='gifs'?'sprite-rows.zip':'sprite-frames.zip',{type:i===1?'application/json':'application/zip'});imageToolMetadata.set(file,o.version);cacheManagedInput(file,completed.project.id,o.version.id);return file})
  return {data:files[0],report:files[1],taskId:completed.taskId}
 }
 const run=async(kind:'split'|'frames'|'gifs')=>{
  if(controller.current)return
  const abort=new AbortController();controller.current=abort;setBusy(kind);setCanceling(false);setProgress(0)
  try{
   await beforeAction();abort.signal.throwIfAborted();const before=model.current();if(!before.source)return
   if(kind==='gifs'&&!before.frames)throw new Error('SPRITE_SPLIT_FIRST')
   const layout=kind==='gifs'?spriteGifLayout(before):{mode:'grid',columns:before.columns,rows:before.rows}
   const completed=await runManagedTask(kind==='gifs'?'image.spriteGifs':'image.customSlice',[before.source],{layout,renderer:'browser-worker',frontendBytes:retainedBytes()},{signal:abort.signal,onProgress:n=>{if(alive.current)setProgress(v=>Math.max(v,n))},outputFilter:()=>alive.current})
   if(!alive.current)return
   const value=result(completed,kind),report=JSON.parse(await value.report.text());spriteSheetReports.set(value.report,report)
   const candidate:SpriteSheetDraft=kind==='split'?{...before,split:value}:kind==='frames'?{...before,frames:value,order:Array.from({length:before.columns*before.rows},(_,i)=>i),gifs:null}:{...before,gifs:value}
   await serializeSpriteSheet(candidate);abort.signal.throwIfAborted()
   if(model.current()!==before||hasPendingEdits()){message.warning(changed());return}
   model.change(()=>candidate);setStatus(kind==='gifs'?t('spriteToGifSuccess'):t('spriteSplitSuccess',{n:before.columns*before.rows}))
  }catch(error){if(alive.current){const messageText=error instanceof DOMException&&error.name==='AbortError'?text('加工已取消','Processing canceled','処理を取り消しました'):String(error);setStatus(messageText)}}
  finally{controller.current=null;if(alive.current){setBusy(null);setCanceling(false)}}
 }
 const moveFrame=(from:number,to:number)=>{if(from===to||from<0||from>=d.order.length||to<0||to>=d.order.length)return;const source=d.order[from];model.change(prev=>{const next=[...prev.order],current=next.indexOf(source);if(current<0)return prev;const item=next.splice(current,1)[0];next.splice(Math.min(to,next.length),0,item);return {...prev,order:next}});focusFrame.current=source;setFramePage(Math.floor(to/pageSize)+1)}
 const endDrag=()=>{drag.current=null;setDragIndex(null);dispatch({type:'end'})}
 const download=(file:Blob,name:string)=>{const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
 const base=d.source?.name.replace(/\.[^.]+$/,'')||'sprite'
 const errors=[archive.error,framesPreview.error,gifsArchive.error,gifPreviews.error].filter(Boolean)
 const loadingPreviews=archive.loading||framesPreview.loading||gifsArchive.loading||gifPreviews.loading
 const outdatedSplit=!!d.split&&JSON.stringify((spriteSheetReports.get(d.split.report)?.parameters as {layout?:unknown}|undefined)?.layout)!==JSON.stringify({mode:'grid',columns:d.columns,rows:d.rows})
 const outdatedGifs=!!d.gifs&&JSON.stringify((spriteSheetReports.get(d.gifs.report)?.parameters as {layout?:unknown}|undefined)?.layout)!==JSON.stringify(spriteGifLayout(d))
 return <SpriteSheetDocumentSurface model={model} beforeAction={beforeAction} hasPendingEdits={hasPendingEdits} onInteractionChange={interactionChange}>
  <Space direction="vertical" size="large" style={{width:'100%',paddingTop:16}}>
   {status&&<Text role="status">{status}</Text>}
   {preparing&&<Space><Text>{text('正在准备素材','Preparing image','素材を準備中')}</Text><Button onClick={()=>{incoming.current?.controller.abort();setStatus(text('素材准备已取消；当前文档保留','Input preparation canceled; current document retained','素材の準備を取り消しました。現在の文書は保持されています'))}}>{text('取消素材准备','Cancel input preparation','素材の準備を取消')}</Button></Space>}
   {busy&&<Space><Progress percent={Math.round(progress*100)} style={{width:180}}/><Button loading={canceling} onClick={()=>{setCanceling(true);controller.current?.abort()}}>{text('取消加工','Cancel processing','処理を取消')}</Button></Space>}
   {loadingPreviews&&<Space><Text>{text('正在准备预览','Preparing previews','プレビューを準備中')}</Text><Button onClick={()=>{archive.cancel();framesPreview.cancel();gifsArchive.cancel();gifPreviews.cancel()}}>{text('取消预览','Cancel previews','プレビューを取消')}</Button></Space>}
   {errors.length>0&&<Space><Text role="alert">{errors.some(e=>e.endsWith('PREVIEW_CANCELED'))?text('预览已取消；原件和结果仍保留','Previews canceled; original files and results retained','プレビューを取り消しました。元ファイルと結果は保持されています'):errors.join('; ')}</Text><Button onClick={()=>{archive.retry();framesPreview.retry();gifsArchive.retry();gifPreviews.retry()}}>{text('重试预览','Retry previews','プレビューを再試行')}</Button></Space>}
   <Tabs activeKey={d.activeTab} onChange={v=>model.set('activeTab',v as SpriteSheetDraft['activeTab'])} items={[{key:'split',label:<><ScissorOutlined/> {t('spriteSplit')}</>},{key:'togif',label:<><ExportOutlined/> {t('spriteToGif')}</>}]}/>
   <Text type="secondary">{d.activeTab==='split'?t('spriteSplitHint'):t('spriteToGifHint')}</Text>
   <Space wrap><label>{t('spriteColumns')}: <InputNumber aria-label={t('spriteColumns')} min={1} max={64} value={d.columns} onChange={v=>setGrid('columns',v??8)}/></label><label>{t('spriteRows')}: <InputNumber aria-label={t('spriteRows')} min={1} max={64} value={d.rows} onChange={v=>setGrid('rows',v??4)}/></label></Space>
   <Text type="secondary">{t('spriteColumnsHint')} / {t('spriteRowsHint')}</Text>
   {d.activeTab==='togif'&&<div><Text>{t('gifFrameDelay')}: {d.duration} ms</Text><Slider ariaLabelForHandle={t('gifFrameDelay')} min={20} max={500} value={d.duration} onChange={v=>model.set('duration',v)} style={{maxWidth:240}}/></div>}
   <StashDropZone onStashDrop={setSource} maxSizeMB={20}><Dragger accept=".png,.jpg,.jpeg,.webp" maxCount={1} fileList={d.source?[{uid:'1',name:d.source.name} as UploadFile]:[]} beforeUpload={async f=>await setSource(f)?false:Upload.LIST_IGNORE} onRemove={()=>setSource(null)}><p className="ant-upload-text">{t('imageUploadHint')}</p><p className="ant-upload-hint">{t('imageFormats')}</p></Dragger></StashDropZone>
   {sourceUrls[0]?.preview&&<div><Text strong>{t('imgOriginalPreview')}</Text><StashableImage src={sourceUrls[0].preview} stashSrc={sourceUrls[0].raw} alt={t('imgOriginalPreview')} style={{display:'block',maxWidth:320,maxHeight:240,imageRendering:'pixelated'}}/></div>}
   {(d.activeTab==='split'?outdatedSplit:outdatedGifs)&&<Text type="secondary">{text('当前显示上次结果；重新执行才会应用新参数。','The previous result is shown. Run again to apply the current settings.','前回の結果を表示しています。新しい設定を適用するには再実行してください。')}</Text>}
   {d.activeTab==='split'?<>
    <Space wrap><Button type="primary" loading={busy==='split'} disabled={!d.source||!!busy||preparing} onClick={()=>{void run('split')}}>{t('spriteSplit')}</Button>{d.split&&<Button icon={<DownloadOutlined/>} onClick={()=>download(d.split!.data,base+'_frames.zip')}>{t('gifDownloadFrames')}</Button>}</Space>
    {archive.view&&<div style={board}><Text>{t('imgPreview')} · {archive.view.sizes.length} {t('frame')}</Text><div style={{display:'flex',flexWrap:'wrap',gap:8,maxHeight:320,overflow:'auto'}}>{archive.view.thumbnails.map((url,i)=><StashableImage key={i} src={url} stashSrc={archive.view!.frames[i]} alt={`${t('frame')} ${i+1}`} style={{maxWidth:80,maxHeight:80,imageRendering:'pixelated'}}/>)}</div></div>}
   </>:<>
    <Button type="primary" loading={busy==='frames'} disabled={!d.source||!!busy||preparing} onClick={()=>{void run('frames')}}>{t('spriteToGifSplit')}</Button>
    {d.frames&&<>
     <Text strong>{t('spriteToGifFrames')} · {d.order.length}</Text>
     <Space><label>{t('spriteTogifFrameCols')}: <InputNumber aria-label={t('spriteTogifFrameCols')} min={1} max={128} value={d.framesPerRow} onChange={v=>model.set('framesPerRow',Math.max(1,Math.min(128,Math.floor(v??6))))}/></label></Space>
     <Text type="secondary">{t('spriteTogifFrameReorderHint')} · {text('方向键可移动帧，Home/End 移到首尾','Arrow keys move a frame; Home/End move to the ends','矢印キーで移動、Home/End で先頭・末尾へ')}</Text>
     <div ref={frameRoot} style={{...board,display:'grid',width:'100%',gridTemplateColumns:`repeat(${d.framesPerRow}, minmax(92px,1fr))`,gap:12,maxHeight:400,overflow:'auto'}}>
      {frameIndices.map((physical,local)=>{const i=frameStart+local;return <div key={physical} style={{position:'relative',borderRadius:4,opacity:dragIndex===physical ? .6 : 1,border:dragIndex===physical?'2px dashed #b55233':'1px solid transparent',minHeight:68}} onDragOver={e=>{if(drag.current!==null){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move'}}} onDrop={e=>{e.preventDefault();e.stopPropagation();const source=drag.current;if(source!==null)moveFrame(d.order.indexOf(source),i);endDrag()}}>
       {framePreviewUrls[local]?<StashableImage src={framePreviewUrls[local]} stashSrc={archive.view?.frames[physical]} alt={`${t('frame')} ${i+1}`} draggable={false} style={{width:'100%',maxHeight:120,objectFit:'contain',imageRendering:'pixelated',display:'block'}}/>:<Text>{t('frame')} {i+1}</Text>}
       <Button size="small" aria-label={text(`移动帧 ${i+1}`,`Move frame ${i+1}`,`フレーム ${i+1} を移動`)} title={text(`原始帧 ${physical+1}`,`Original frame ${physical+1}`,`元のフレーム ${physical+1}`)} data-source-frame={physical} icon={<DragOutlined/>} draggable onDragStart={e=>{e.stopPropagation();drag.current=physical;setDragIndex(physical);dispatch({type:'begin'});e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i))}} onDragEnd={endDrag} onKeyDown={e=>{if(e.altKey||e.metaKey||e.ctrlKey)return;let to=i;if(e.key==='ArrowLeft')to=i-1;else if(e.key==='ArrowRight')to=i+1;else if(e.key==='ArrowUp')to=i-d.framesPerRow;else if(e.key==='ArrowDown')to=i+d.framesPerRow;else if(e.key==='Home')to=0;else if(e.key==='End')to=d.order.length-1;else return;e.preventDefault();e.stopPropagation();moveFrame(i,to)}}>{i+1}</Button>
       <Button danger size="small" icon={<DeleteOutlined/>} aria-label={text(`删除帧 ${i+1}`,`Delete frame ${i+1}`,`フレーム ${i+1} を削除`)} onClick={()=>model.change(prev=>({...prev,order:prev.order.filter((_,index)=>index!==i)}))}/>
       {i%d.framesPerRow===0&&<Tooltip title={t('gifFrameDeleteRow')}><Button danger size="small" icon={<DeleteOutlined/>} aria-label={text(`删除第 ${Math.floor(i/d.framesPerRow)+1} 行`,`Delete row ${Math.floor(i/d.framesPerRow)+1}`,`${Math.floor(i/d.framesPerRow)+1} 行目を削除`)} onClick={()=>model.change(prev=>{const start=Math.floor(i/prev.framesPerRow)*prev.framesPerRow;return {...prev,order:prev.order.filter((_,index)=>index<start||index>=start+prev.framesPerRow)}})}>{text('整行','Row','行')}</Button></Tooltip>}
      </div>})}
     </div>
     <Pagination aria-label={text('帧列表分页','Frame pages','フレームのページ')} current={framePageValue} total={d.order.length} pageSize={pageSize} showSizeChanger={false} onChange={setFramePage} size="small"/>
     <Space wrap><Button type="primary" icon={<ExportOutlined/>} loading={busy==='gifs'} disabled={!d.order.length||!!busy||preparing} onClick={()=>{void run('gifs')}}>{t('spriteToGif')}</Button>{d.gifs&&<Button icon={<DownloadOutlined/>} onClick={()=>download(d.gifs!.data,base+'_rows.zip')}>{t('spriteDownloadAllGif')}</Button>}</Space>
    </>}
    {d.gifs&&<>
     <Text strong>{t('imgPreview')}</Text>
     {!animateGifs&&<Text type="secondary">{text('为限制内存显示静态缩略图；下载保留完整动画。','Static thumbnails limit memory use; downloads retain the full animations.','メモリを抑えるため静止サムネイルを表示します。ダウンロードには全アニメーションを保持します。')}</Text>}
     <Space direction="vertical">{rows.slice(gifStart,gifStart+12).map((row,local)=>{const index=gifStart+local,url=animateGifs?gifUrls[index]:gifPreviewUrls[local];return <div key={index} style={board}><Text>{t('spriteRowN',{n:index+1})} · {row.frames} {t('frame')} · {row.durationMs} ms</Text>{url&&<StashableImage src={url} stashSrc={gifUrls[index]} alt={t('spriteRowN',{n:index+1})} style={{display:'block',maxWidth:320,maxHeight:200}}/>}<Button size="small" icon={<DownloadOutlined/>} disabled={!gifsArchive.value.files[index]} onClick={()=>download(gifsArchive.value.files[index],base+`_row${index+1}.gif`)}>{t('gifDownloadGif')}</Button></div>})}</Space>
     <Pagination aria-label={text('GIF 行分页','GIF row pages','GIF 行のページ')} current={gifPageValue} total={rows.length} pageSize={12} showSizeChanger={false} onChange={setGifPage} size="small"/>
    </>}
   </>}
  </Space>
 </SpriteSheetDocumentSurface>
}

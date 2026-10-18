import {videoCapturePlan,type VideoCaptureLayout} from './videoCapture'

type VideoInfo={width:number;height:number;duration:number}
type Limits={budget:number;frontendBytes:number;physical?:{width:number;height:number}}
const abortError=()=>new DOMException('Video capture canceled','AbortError')
function mediaEvent(video:HTMLVideoElement,event:string,signal:AbortSignal,start:()=>void){
 return new Promise<void>((resolve,reject)=>{
  const done=(error?:unknown)=>{clearTimeout(timer);video.removeEventListener(event,loaded);video.removeEventListener('error',failed);signal.removeEventListener('abort',abort);if(error!==undefined)reject(error);else resolve()}
  const loaded=()=>done(),failed=()=>done(new Error(`VIDEO_DECODE_FAILED: ${video.error?.code??0}`)),abort=()=>done(abortError())
  const timer=setTimeout(()=>done(new Error('VIDEO_DECODE_TIMEOUT')),20000)
  video.addEventListener(event,loaded,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted){abort();return}
  try{start()}catch(error){done(error)}
 })
}
async function open(file:Blob,signal:AbortSignal){
 const video=document.createElement('video'),url=URL.createObjectURL(file)
 video.muted=true;video.playsInline=true;video.preload='auto';video.dataset.frameroninCapture='true'
 video.ariaHidden='true';video.tabIndex=-1
 Object.assign(video.style,{position:'fixed',left:'-10000px',top:'0',width:'1px',height:'1px',opacity:'0',pointerEvents:'none'})
 document.body.append(video)
 let closed=false
 const close=()=>{if(closed)return;closed=true;video.pause();video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url)}
 signal.addEventListener('abort',close,{once:true})
 try{
  await mediaEvent(video,'loadeddata',signal,()=>{video.src=url;video.load()})
  if(!Number.isSafeInteger(video.videoWidth)||!Number.isSafeInteger(video.videoHeight)||video.videoWidth<1||video.videoHeight<1||!Number.isFinite(video.duration)||video.duration<=0)throw new Error('VIDEO_METADATA_INVALID')
  return {video,info:{width:video.videoWidth,height:video.videoHeight,duration:video.duration},close:()=>{signal.removeEventListener('abort',close);close()}}
 }catch(error){signal.removeEventListener('abort',close);close();throw error}
}
export async function inspectSelectedVideo(file:Blob,limits:Limits,signal:AbortSignal):Promise<VideoInfo>{
 signal.throwIfAborted()
 if(!limits.physical)throw new Error('VIDEO_SOURCE_METADATA_REQUIRED')
 videoCapturePlan({sourceWidth:limits.physical.width,sourceHeight:limits.physical.height,start:0,end:.01,fps:1,maxFrames:1,crop:{left:0,top:0,right:0,bottom:0}},file.size,limits.budget,limits.frontendBytes,limits.physical)
 const selected=await open(file,signal)
 try{videoCapturePlan({sourceWidth:selected.info.width,sourceHeight:selected.info.height,start:0,end:.01,fps:1,maxFrames:1,crop:{left:0,top:0,right:0,bottom:0}},file.size,limits.budget,limits.frontendBytes,limits.physical);return selected.info}finally{selected.close()}
}
function snapshot(video:HTMLVideoElement,signal:AbortSignal){
 return new Promise<ImageBitmap>((resolve,reject)=>{
  let settled=false
  const abort=()=>{settled=true;reject(abortError())}
  signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted){signal.removeEventListener('abort',abort);abort();return}
  void createImageBitmap(video).then(bitmap=>{
   signal.removeEventListener('abort',abort)
   if(settled||signal.aborted){bitmap.close();if(!settled)reject(abortError());return}
   settled=true;resolve(bitmap)
  },error=>{signal.removeEventListener('abort',abort);if(!settled){settled=true;reject(error)}})
 })
}
/** Native media decoder + one transferable frame at a time. Pixel reads and
 * PNG/ZIP encoding remain in the owned Worker; no animation callback is used. */
export async function captureSelectedVideo(file:Blob,layout:VideoCaptureLayout,limits:Limits,signal:AbortSignal,identity:{id:string;generation:number},onProgress?:(progress:number)=>void){
 if(!limits.physical)throw new Error('VIDEO_SOURCE_METADATA_REQUIRED')
 const plan=videoCapturePlan(layout,file.size,limits.budget,limits.frontendBytes,limits.physical)
 signal.throwIfAborted()
 const selected=await open(file,signal)
 let worker:Worker
 try{worker=new Worker(new URL('./videoCapture.worker.ts',import.meta.url),{type:'module'})}catch(error){selected.close();throw error}
 let pending:((error:unknown)=>void)|null=null
 const stop=()=>{selected.close();worker.terminate();pending?.(abortError())}
 signal.addEventListener('abort',stop,{once:true})
 const exchange=(message:object,phase:string,transfer:Transferable[]=[])=>new Promise<MessageEvent['data']>((resolve,reject)=>{
  const timer=setTimeout(()=>{pending=null;reject(new Error('VIDEO_CAPTURE_WORKER_TIMEOUT'))},30000)
  const fail=(error:unknown)=>{clearTimeout(timer);pending=null;reject(error)};pending=fail
  worker.onerror=e=>fail(new Error(e.message||'VIDEO_CAPTURE_WORKER_FAILED'))
  worker.onmessage=e=>{
   if(e.data.id!==identity.id||e.data.generation!==identity.generation)return
   if(e.data.error){fail(new Error(e.data.error));return}
   if(e.data.phase!==phase&&!(phase==='result'&&e.data.blob instanceof Blob)){fail(new Error('VIDEO_CAPTURE_WORKER_REPLY'));return}
   clearTimeout(timer);pending=null;resolve(e.data)
  }
  const release=()=>transfer.forEach(value=>{if(value instanceof ImageBitmap)value.close()})
  if(signal.aborted){release();fail(abortError());return}
  try{worker.postMessage({...identity,...message},transfer)}catch(error){release();fail(error)}
 })
 try{
  if(selected.info.width!==layout.sourceWidth||selected.info.height!==layout.sourceHeight||layout.end>selected.info.duration+.000001)throw new Error('VIDEO_SOURCE_CHANGED')
  await exchange({action:'init',layout,fileBytes:file.size,budget:limits.budget,frontendBytes:limits.frontendBytes,physical:limits.physical},'ready')
  for(const [index,timestamp] of plan.timestamps.entries()){
   signal.throwIfAborted()
   await mediaEvent(selected.video,'seeked',signal,()=>{selected.video.currentTime=timestamp})
   const bitmap=await snapshot(selected.video,signal)
   let transferred=false
   try{
    signal.throwIfAborted()
    const reply=exchange({action:'frame',index,timestamp,bitmap},'frame',[bitmap]);transferred=true
    const result=await reply
    if(result.index!==index||!Number.isFinite(result.progress)||result.progress!==(index+1)/plan.timestamps.length)throw new Error('VIDEO_CAPTURE_FRAME_REPLY')
    onProgress?.(result.progress)
   }finally{if(!transferred)bitmap.close()}
  }
  const result=await exchange({action:'finish'},'result');signal.throwIfAborted();return result.blob as Blob
 }finally{signal.removeEventListener('abort',stop);stop()}
}

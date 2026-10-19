import type {VideoFrameSize} from './videoFrameTools'
export type VideoStroke={size:number;points:[number,number][]}
type Frames={file:Blob;size:VideoFrameSize;count:number}
export type VideoAssetRequest=
 |(Frames&{action:'frames';indices:number[];limit:number})
 |(Frames&{action:'sample';index:number;x:number;y:number})
 |(Frames&{action:'matte';index:number;background:string;tolerance:number;feather:number;mask:Blob|null;limit:number})
 |{action:'sheet';file:Blob;size:VideoFrameSize;limit:number}
 |{action:'brush';mask:Blob|null;size:VideoFrameSize;stroke:VideoStroke}
export type VideoAssetResult={files:Blob[];previews:Blob[];color:number[]|null}
const integer=(n:unknown,a:number,b:number)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=a&&n<=b
export function videoAssetPlan(p:VideoAssetRequest,budget:number,frontend:number,encoded=0){
 if(!integer(budget,1,2*1024**3)||!integer(frontend,0,2*1024**3)||!integer(p.size.w,1,30000)||!integer(p.size.h,1,30000)||!integer(encoded,0,128*1024**2))throw new Error('VIDEO_ASSET_BUDGET')
 if(!['frames','sample','matte','sheet','brush'].includes(p.action))throw new Error('VIDEO_ASSET_ACTION')
 if(p.action!=='brush'&&(!(p.file instanceof Blob)||!integer(p.file.size,1,128*1024**2)))throw new Error('VIDEO_ASSET_FILE')
 if('mask'in p&&p.mask!==null&&(!(p.mask instanceof Blob)||!integer(p.mask.size,1,20*1024**2)))throw new Error('VIDEO_ASSET_MASK')
 if(p.action==='frames'&&(!Array.isArray(p.indices)||!integer(p.indices.length,1,256)||new Set(p.indices).size!==p.indices.length||p.indices.some(i=>!integer(i,0,p.count-1))))throw new Error('VIDEO_ASSET_INDICES')
 if('count'in p&&!integer(p.count,1,2000)||'index'in p&&!integer(p.index,0,p.count-1))throw new Error('VIDEO_ASSET_COUNT')
 if(p.action==='sample'&&(!integer(p.x,0,p.size.w-1)||!integer(p.y,0,p.size.h-1)))throw new Error('VIDEO_ASSET_SAMPLE')
 if('limit'in p&&!integer(p.limit,1,1024))throw new Error('VIDEO_ASSET_LIMIT')
 if(p.action==='matte'&&(!/^#[a-f\d]{6}$/i.test(p.background)||!Number.isFinite(p.tolerance)||p.tolerance<1||p.tolerance>100||!Number.isFinite(p.feather)||p.feather<0||p.feather>30))throw new Error('VIDEO_ASSET_MATTE')
 if(p.action==='brush'&&(!integer(p.stroke.size,4,80)||!Array.isArray(p.stroke.points)||!integer(p.stroke.points.length,1,32768)||p.stroke.points.some(point=>!Array.isArray(point)||point.length!==2||point.some(n=>!integer(n,-30000,60000)))))throw new Error('VIDEO_ASSET_STROKE')
 const count=p.action==='frames'?p.indices.length:1,limit='limit'in p?p.limit:0,scale=limit?Math.min(1,limit/Math.max(p.size.w,p.size.h)):0
 const previewWidth=Math.max(1,Math.round(p.size.w*scale)),previewHeight=Math.max(1,Math.round(p.size.h*scale))
 const fileBytes=p.action==='brush'?(p.mask?.size??0):p.file.size+('mask'in p?(p.mask?.size??0):0)
 const estimatedBytes=96*1024**2+frontend+fileBytes*8+encoded*2+p.size.w*p.size.h*64+count*previewWidth*previewHeight*16
 if(!Number.isSafeInteger(estimatedBytes)||estimatedBytes>budget)throw new Error('VIDEO_ASSET_RESOURCE_LIMIT')
 return {estimatedBytes,previewWidth,previewHeight}
}
/** One owned, abortable Worker per request. Callers pause previews while a
 * formal job runs; no ZIP inflation or full-image pixel work occurs in React. */
let preceding:Promise<void>=Promise.resolve()
/** Serialize ephemeral decoders as well as formal processing. Queued aborts
 * finish immediately and never construct their Worker. A failed request does
 * not poison the queue or overlap another full-resolution frame. */
export function videoAssets(request:VideoAssetRequest,budgetBytes:number,frontendBytes:number,signal:AbortSignal):Promise<VideoAssetResult>{
 signal.throwIfAborted();videoAssetPlan(request,budgetBytes,frontendBytes)
 const previous=preceding;let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve});preceding=previous.then(()=>gate)
 return new Promise((resolve,reject)=>{
  const queuedAbort=()=>reject(new DOMException('Video preview canceled','AbortError'))
  signal.addEventListener('abort',queuedAbort,{once:true})
  void previous.then(()=>{
   signal.removeEventListener('abort',queuedAbort)
   if(signal.aborted){release();return}
   try{void runVideoAsset(request,budgetBytes,frontendBytes,signal).then(resolve,reject).finally(release)}catch(error){release();reject(error)}
  })
 })
}
function runVideoAsset(request:VideoAssetRequest,budgetBytes:number,frontendBytes:number,signal:AbortSignal):Promise<VideoAssetResult>{
 signal.throwIfAborted();videoAssetPlan(request,budgetBytes,frontendBytes)
 const id=crypto.randomUUID(),generation=0,worker=new Worker(new URL('./videoAssets.worker.ts',import.meta.url),{type:'module'})
 return new Promise((resolve,reject)=>{
  let settled=false
  const timer=setTimeout(()=>finish(new Error('VIDEO_ASSET_TIMEOUT')),30000)
  const finish=(error:unknown,result?:VideoAssetResult)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!)}
  const abort=()=>finish(new DOMException('Video preview canceled','AbortError'));signal.addEventListener('abort',abort,{once:true})
  worker.onerror=e=>finish(new Error(e.message||'VIDEO_ASSET_WORKER'))
  worker.onmessage=e=>{const v=e.data;if(v?.id!==id||v?.generation!==generation)return
   if(v.error){finish(new Error(v.error));return}
   const count=request.action==='frames'?request.indices.length:['matte','sheet'].includes(request.action)?1:0,files=request.action==='sheet'?2:request.action==='brush'?1:0
   if(!Array.isArray(v.files)||v.files.length!==files||v.files.some((f:unknown)=>!(f instanceof Blob)||f.size>128*1024**2)||!Array.isArray(v.previews)||v.previews.length!==count||v.previews.some((b:unknown)=>!(b instanceof Blob)||b.type!=='image/png'||b.size>8*1024**2)||v.previews.reduce((n:number,b:Blob)=>n+b.size,0)>32*1024**2){finish(new Error('VIDEO_ASSET_RESPONSE'));return}
   if(request.action==='brush'&&(v.files[0].type!=='image/png'||v.files[0].size>20*1024**2)||request.action==='sheet'&&(v.files[0].type!=='image/png'||v.files[1].size>2*1024**2)||request.action==='sample'&&(!Array.isArray(v.color)||v.color.length!==4||v.color.some((n:unknown)=>!integer(n,0,255)))){finish(new Error('VIDEO_ASSET_RESPONSE'));return}
   finish(null,{files:v.files,previews:v.previews,color:request.action==='sample'?v.color:null})
  }
  if(signal.aborted){abort();return}
  try{worker.postMessage({id,generation,request,budgetBytes,frontendBytes})}catch(error){finish(error)}
 })
}

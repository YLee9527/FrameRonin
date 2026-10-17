import type {FrameSize} from './customSlice'
export type CustomAsset={kind:'source';width:number;height:number;preview:Blob}|{kind:'archive';files:Blob[];previews:Blob[];sizes:FrameSize[]}
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max
export function customSliceAssetWorker(file:File,kind:'source'|'archive',budgetBytes:number,frontendBytes:number,signal:AbortSignal):Promise<CustomAsset>{
 signal.throwIfAborted();const id=crypto.randomUUID(),generation=0,worker=new Worker(new URL('./customSlice.worker.ts',import.meta.url),{type:'module'})
 return new Promise((resolve,reject)=>{
  let settled=false
  const finish=(error:unknown,result?:CustomAsset)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!)}
  const abort=()=>finish(new DOMException('Preview canceled','AbortError'));signal.addEventListener('abort',abort,{once:true})
  worker.onerror=e=>finish(new Error(e.message||'CUSTOM_PREVIEW_WORKER'))
  worker.onmessage=e=>{const v=e.data;if(v.id!==id||v.generation!==generation)return
   if(v.error){finish(new Error(v.error));return}
   if(kind==='source'&&v.preview instanceof Blob&&v.preview.type==='image/png'&&v.preview.size<=8*1024**2&&integer(v.width,1,30000)&&integer(v.height,1,30000)){finish(null,{kind,width:v.width,height:v.height,preview:v.preview});return}
   if(kind==='archive'&&Array.isArray(v.files)&&v.files.length>=1&&v.files.length<=4096&&v.files.every((f:unknown)=>f instanceof Blob)&&v.files.reduce((s:number,f:Blob)=>s+f.size,0)<=128*1024**2&&Array.isArray(v.previews)&&v.previews.length===Math.min(24,v.files.length)&&v.previews.every((f:unknown)=>f instanceof Blob&&f.type==='image/png'&&f.size<=256*1024)&&Array.isArray(v.sizes)&&v.sizes.length===v.files.length&&v.sizes.every((s:FrameSize)=>s&&integer(s.w,1,30000)&&integer(s.h,1,30000))){finish(null,{kind,files:v.files,previews:v.previews,sizes:v.sizes});return}
   finish(new Error('CUSTOM_PREVIEW_RESPONSE'))
  }
  worker.postMessage({id,generation,file,budgetBytes,operation:kind==='source'?'image.customSlicePlan':'image.customCompose',action:kind==='source'?'preview':'archive',parameters:{frontendBytes}})
 })
}

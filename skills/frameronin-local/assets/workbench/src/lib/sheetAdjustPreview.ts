import {sheetFrameCrop,type SheetPlacement,type SheetPixelFix} from './sheetAdjust'
import type {FrameSize} from './customSlice'
export type SheetPreviewRequest={action:'preview';files:Blob[];sizes:FrameSize[];placements:SheetPlacement[];cell:FrameSize|null;limit:number}|{action:'sample';file:Blob;size:FrameSize;dx:number;dy:number;x:number;y:number;range:number}
export type SheetPreviewResult={previews:Blob[];patch:SheetPixelFix|null}
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
export function sheetPreviewGeometry(size:FrameSize,p:SheetPlacement,cell:FrameSize|null,limit:number){
 if(!integer(size.w,1,30000)||!integer(size.h,1,30000)||!integer(limit,1,1024)||!integer(p.dx,-30000,30000)||!integer(p.dy,-30000,30000)||Object.keys(p.crop).sort().join(',')!=='bottom,left,right,top'||Object.values(p.crop).some(v=>!Number.isFinite(v)||Math.abs(v)>30000))throw new Error('SHEET_PREVIEW_GEOMETRY')
 const width=cell?.w??size.w,height=cell?.h??size.h
 if(!integer(width,1,30000)||!integer(height,1,30000))throw new Error('SHEET_PREVIEW_DIMENSIONS')
 const scale=Math.min(1,limit/Math.max(width,height))
 return {width,height,previewWidth:Math.max(1,Math.round(width*scale)),previewHeight:Math.max(1,Math.round(height*scale)),crop:sheetFrameCrop(size.w,size.h,p.crop)}
}
export function sheetSampleCoordinates(size:FrameSize,dx:number,dy:number,x:number,y:number,range:number){
 if(!integer(size.w,1,30000)||!integer(size.h,1,30000)||!integer(dx,-30000,30000)||!integer(dy,-30000,30000)||!integer(x,0,size.w)||!integer(y,0,size.h)||!integer(range,1,8)||range>size.w||range>size.h)throw new Error('SHEET_SAMPLE_COORDINATES')
 const imgX=Math.max(0,Math.min(size.w-range,x-dx-Math.floor(range/2))),imgY=Math.max(0,Math.min(size.h-range,y-dy-Math.floor(range/2)))
 if(dx+imgX<0||dy+imgY<0||dx+imgX+range>size.w||dy+imgY+range>size.h)throw new Error('SHEET_SAMPLE_OUTSIDE_SHIFTED_FRAME')
 return {imgX,imgY}
}
export function sheetAdjustPreview(request:SheetPreviewRequest,budgetBytes:number,frontendBytes:number,signal:AbortSignal):Promise<SheetPreviewResult>{
 signal.throwIfAborted();const id=crypto.randomUUID(),generation=0,worker=new Worker(new URL('./sheetAdjustPreview.worker.ts',import.meta.url),{type:'module'})
 return new Promise((resolve,reject)=>{
  let settled=false
  const finish=(error:unknown,result?:SheetPreviewResult)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!)}
  const abort=()=>finish(new DOMException('Preview canceled','AbortError'));signal.addEventListener('abort',abort,{once:true})
  worker.onerror=e=>finish(new Error(e.message||'SHEET_PREVIEW_WORKER'))
  worker.onmessage=e=>{const v=e.data;if(v?.id!==id||v?.generation!==generation)return
   if(v.error){finish(new Error(v.error));return}
   if(request.action==='preview'&&Array.isArray(v.previews)&&v.previews.length===request.files.length&&v.previews.length<=128&&v.previews.every((b:unknown)=>b instanceof Blob&&b.type==='image/png'&&b.size<=8*1024**2)&&v.previews.reduce((sum:number,b:Blob)=>sum+b.size,0)<=Math.min(32*1024**2,budgetBytes/8)){finish(null,{previews:v.previews,patch:null});return}
   if(request.action==='sample'&&v.patch){try{const pos=sheetSampleCoordinates(request.size,request.dx,request.dy,request.x,request.y,request.range),p=v.patch;if(p.imgX!==pos.imgX||p.imgY!==pos.imgY||p.range!==request.range||!Array.isArray(p.data)||p.data.length!==request.range**2*4||p.data.some((n:unknown)=>!integer(n,0,255)))throw new Error('SHEET_SAMPLE_RESPONSE');finish(null,{previews:[],patch:p})}catch(error){finish(error)}return}
   finish(new Error('SHEET_PREVIEW_RESPONSE'))
  }
  worker.postMessage({id,generation,...request,budgetBytes,frontendBytes})
 })
}

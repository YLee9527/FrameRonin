/// <reference lib="webworker" />
import {sheetPreviewGeometry,sheetSampleCoordinates,type SheetPreviewRequest} from './sheetAdjustPreview'
import {fineEditorImageSize} from './fineEditorPixels'
type Request=SheetPreviewRequest&{id:string;generation:number;budgetBytes:number;frontendBytes:number}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const p=event.data,{id,generation,budgetBytes,frontendBytes}=p
 try{
  if(!Number.isSafeInteger(budgetBytes)||budgetBytes<1||budgetBytes>2*1024**3||!Number.isSafeInteger(frontendBytes)||frontendBytes<0||frontendBytes>2*1024**3)throw new Error('SHEET_PREVIEW_BUDGET')
  if(p.action!=='preview'&&p.action!=='sample')throw new Error('SHEET_PREVIEW_ACTION')
  const files=p.action==='sample'?[p.file]:p.files,sizes=p.action==='sample'?[p.size]:p.sizes
  if(!Array.isArray(files)||!Array.isArray(sizes)||!files.length||files.length>128||files.length!==sizes.length||files.some(f=>!(f instanceof Blob)||f.size>128*1024**2)||p.action==='preview'&&p.placements.length!==files.length)throw new Error('SHEET_PREVIEW_INPUTS')
  const geometry=p.action==='preview'?sizes.map((s,i)=>sheetPreviewGeometry(s,p.placements[i],p.cell,p.limit)):[]
  if(p.action==='sample')sheetSampleCoordinates(p.size,p.dx,p.dy,p.x,p.y,p.range)
  const estimate=96*1024**2+frontendBytes+files.reduce((n,f)=>n+f.size*8,0)+Math.max(...sizes.map(s=>s.w*s.h))*40+geometry.reduce((n,g)=>n+g.previewWidth*g.previewHeight*16,0)
  if(!Number.isSafeInteger(estimate)||estimate>budgetBytes)throw new Error('SHEET_PREVIEW_RESOURCE_LIMIT')
  const previews:Blob[]=[];let encoded=0
  for(let i=0;i<files.length;i++){
   const header=await fineEditorImageSize(files[i]),s=sizes[i]
   if(header.width!==s.w||header.height!==s.h)throw new Error('SHEET_PREVIEW_SOURCE_CHANGED')
   const image=await createImageBitmap(files[i]);let canvas:OffscreenCanvas|undefined
   try{
    if(image.width!==s.w||image.height!==s.h)throw new Error('SHEET_PREVIEW_SOURCE_CHANGED')
    if(p.action==='sample'){
     const pos=sheetSampleCoordinates(s,p.dx,p.dy,p.x,p.y,p.range);canvas=new OffscreenCanvas(p.range,p.range)
     const ctx=canvas.getContext('2d')!;ctx.drawImage(image,-pos.imgX,-pos.imgY)
     self.postMessage({id,generation,patch:{...pos,range:p.range,data:Array.from(ctx.getImageData(0,0,p.range,p.range).data)}});return
    }
    const g=geometry[i],frame=p.placements[i],cr=g.crop
    canvas=new OffscreenCanvas(g.previewWidth,g.previewHeight);const ctx=canvas.getContext('2d')!
    // Display-only thumbnails: logical crop/offset coordinates stay unscaled in
    // document and export. Never feed the thumbnail back into a processing task.
    ctx.scale(g.previewWidth/g.width,g.previewHeight/g.height)
    ctx.drawImage(image,cr.sx,cr.sy,cr.srcW,cr.srcH,frame.dx+cr.padX,frame.dy+cr.padY,cr.srcW,cr.srcH)
    const blob=await canvas.convertToBlob({type:'image/png'});encoded+=blob.size
    if(encoded>Math.min(32*1024**2,budgetBytes/8))throw new Error('SHEET_PREVIEW_ENCODED_LIMIT')
    previews.push(blob)
   }finally{image.close();if(canvas)canvas.width=canvas.height=1}
  }
  self.postMessage({id,generation,previews})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
}

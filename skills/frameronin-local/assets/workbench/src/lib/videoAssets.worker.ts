/// <reference lib="webworker" />
import JSZip from 'jszip'
import {videoAssetPlan,type VideoAssetRequest} from './videoAssets'
import {boundedZipBlob,inspectOrderedZip} from './orderedZip'
import {fineEditorImageSize} from './fineEditorPixels'
import {normalChromaPixels} from './normalMattePixels'
self.onmessage=async(event:MessageEvent<{id:string;generation:number;request:VideoAssetRequest;budgetBytes:number;frontendBytes:number}>)=>{
 const {id,generation,request:p,budgetBytes,frontendBytes}=event.data
 const canvases:OffscreenCanvas[]=[],bitmaps=new Set<ImageBitmap>(),make=(w:number,h:number)=>{const c=new OffscreenCanvas(w,h);canvases.push(c);return c}
 const bitmap=async(blob:Blob)=>{const header=await fineEditorImageSize(blob);if(header.width!==p.size.w||header.height!==p.size.h)throw new Error('VIDEO_ASSET_SIZE');const image=await createImageBitmap(blob);bitmaps.add(image);if(image.width!==p.size.w||image.height!==p.size.h)throw new Error('VIDEO_ASSET_SIZE');return image}
 const release=(image:ImageBitmap)=>{image.close();bitmaps.delete(image)}
 try{
  let plan=videoAssetPlan(p,budgetBytes,frontendBytes),files:Blob[]=[],color:number[]|null=null,previews:Blob[]=[]
  const preview=async(image:CanvasImageSource)=>{const c=make(plan.previewWidth,plan.previewHeight);c.getContext('2d')!.drawImage(image,0,0,c.width,c.height);const blob=await c.convertToBlob({type:'image/png'});c.width=c.height=1;if(blob.size>8*1024**2)throw new Error('VIDEO_ASSET_ENCODED_LIMIT');return blob}
  if(p.action==='brush'){
   const c=make(p.size.w,p.size.h),ctx=c.getContext('2d')!
   if(p.mask){const image=await bitmap(p.mask);ctx.drawImage(image,0,0);release(image)}
   const [first,...rest]=p.stroke.points
   ctx.fillStyle='rgba(255,255,255,0.9)';ctx.beginPath();ctx.arc(first[0],first[1],p.stroke.size/2,0,Math.PI*2);ctx.fill()
   ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=p.stroke.size;ctx.lineCap='round'
   let previous=first
   // Each segment is a separate original Canvas stroke; combining the path
   // would change Alpha at overlap and revisited pixels.
   for(const point of rest){ctx.beginPath();ctx.moveTo(...previous);ctx.lineTo(...point);ctx.stroke();previous=point}
   const result=await c.convertToBlob({type:'image/png'});if(result.size>20*1024**2)throw new Error('VIDEO_ASSET_MASK_LIMIT');files=[result]
  }else{
   const bytes=await p.file.arrayBuffer(),index=inspectOrderedZip(bytes,budgetBytes,i=>p.action==='sheet'?['sprite.png','index.json'][i]:`frame_${String(i).padStart(3,'0')}.png`)
   if(index.names.length!==(p.action==='sheet'?2:p.count))throw new Error('VIDEO_ASSET_ARCHIVE_COUNT')
   plan=videoAssetPlan(p,budgetBytes,frontendBytes,index.encodedBytes)
   const zip=await JSZip.loadAsync(bytes),read=(i:number)=>boundedZipBlob(zip.file(index.names[i])!,index.encodedBytes)
   if(p.action==='sheet'){
    const file=await read(0),json=await read(1);if(json.size>2*1024**2)throw new Error('VIDEO_ASSET_INDEX_LIMIT')
    const image=await bitmap(file);previews=[await preview(image)];release(image);files=[new Blob([file],{type:'image/png'}),new Blob([json],{type:'application/json'})]
   }else if(p.action==='frames'){
    let encoded=0
    for(const i of p.indices){const image=await bitmap(await read(i));const blob=await preview(image);release(image);encoded+=blob.size;if(encoded>32*1024**2)throw new Error('VIDEO_ASSET_ENCODED_LIMIT');previews.push(blob)}
   }else{
    const image=await bitmap(await read(p.index)),c=make(p.size.w,p.size.h),ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);release(image)
    if(p.action==='sample')color=Array.from(ctx.getImageData(p.x,p.y,1,1).data)
    else{
     const data=ctx.getImageData(0,0,c.width,c.height),rgb=[1,3,5].map(i=>parseInt(p.background.slice(i,i+2),16));normalChromaPixels(data.data,...rgb as [number,number,number],p.tolerance,p.feather);ctx.putImageData(data,0,0)
     if(p.mask){const original=await c.convertToBlob({type:'image/png'}),m=await bitmap(p.mask),base=await bitmap(original);ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(base,0,0);ctx.globalCompositeOperation='destination-out';ctx.drawImage(m,0,0);release(m);release(base)}
     previews=[await preview(c)]
    }
   }
  }
  self.postMessage({id,generation,files,previews,color})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{bitmaps.forEach(image=>image.close());canvases.forEach(c=>{c.width=c.height=1})}
}

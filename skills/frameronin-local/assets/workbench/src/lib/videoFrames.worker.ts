/// <reference lib="webworker" />
import JSZip from 'jszip'
import {boundedZipBlob,inspectOrderedZip} from './orderedZip'
import {fineEditorImageSize} from './fineEditorPixels'
import {normalChromaPixels} from './normalMattePixels'
import {videoDuplicateMarkers,videoFingerprint,videoFramePlan,videoInnerStroke,type VideoFrameLayout} from './videoFrameTools'

type Request={id:string;generation:number;file:Blob;files?:Blob[];operation:string;budgetBytes:number;parameters:{layout:VideoFrameLayout;frontendBytes:number}}
const canvas=(w:number,h:number)=>new OffscreenCanvas(Math.floor(w),Math.floor(h))
const png=(c:OffscreenCanvas)=>c.convertToBlob({type:'image/png'})
function resize(image:ImageBitmap,w:number,h:number,padding:number){
 const c=canvas(w,h),ctx=c.getContext('2d')!,innerW=w-padding*2,innerH=h-padding*2,scale=Math.min(innerW/image.width,innerH/image.height,1)
 const cw=Math.round(image.width*scale),ch=Math.round(image.height*scale)
 ctx.drawImage(image,padding+(innerW-cw)/2,padding+(innerH-ch)/2,cw,ch)
 return c
}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const {id,generation,file,files,budgetBytes,parameters:p,operation}=event.data
 let current:ImageBitmap|null=null,mask:ImageBitmap|null=null,sheet:OffscreenCanvas|null=null
 const progress=(completed:number,total:number)=>self.postMessage({id,generation,phase:'progress',progress:completed/total})
 try{
  if(operation!=='video.frameTools'||!(file instanceof Blob)||!Number.isSafeInteger(p.frontendBytes)||p.frontendBytes<0||!Number.isSafeInteger(budgetBytes)||budgetBytes<1||budgetBytes>2*1024**3||256*1024**2+file.size*12+p.frontendBytes>budgetBytes)throw new Error('VIDEO_FRAME_INPUT')
  const bytes=await file.arrayBuffer(),{names,encodedBytes}=inspectOrderedZip(bytes,budgetBytes,i=>`frame_${String(i).padStart(3,'0')}.png`)
  if(names.length>2000||256*1024**2+(file.size+encodedBytes)*12+p.frontendBytes>budgetBytes)throw new Error('VIDEO_FRAME_ARCHIVE_LIMIT')
  const zip=await JSZip.loadAsync(bytes),sources:Blob[]=[],sizes:{w:number;h:number}[]=[];let inflated=0
  for(const name of names){
   const blob=await boundedZipBlob(zip.file(name)!,encodedBytes-inflated);inflated+=blob.size
   if(new Uint8Array(await blob.slice(0,8).arrayBuffer()).join(',')!=='137,80,78,71,13,10,26,10')throw new Error('VIDEO_FRAME_PNG')
   const size=await fineEditorImageSize(blob);sources.push(blob);sizes.push({w:size.width,h:size.height})
  }
  const hasMask=p.layout.mode==='matte'&&p.layout.mask,maskFile=files?.[1]
  if((files?.length??1)!==(hasMask?2:1)||hasMask&&!(maskFile instanceof Blob)||maskFile&&maskFile.size>20*1024**2)throw new Error('VIDEO_FRAME_MASK')
  const maskSize=hasMask?await fineEditorImageSize(maskFile!):undefined
  const plan=videoFramePlan(sizes,p.layout,file.size+inflated+(maskFile?.size??0),p.frontendBytes,budgetBytes,maskSize?{w:maskSize.width,h:maskSize.height}:undefined)
  if(hasMask)mask=await createImageBitmap(maskFile!)
  self.postMessage({id,generation,phase:'processing'})
  const output=new JSZip(),hashes:string[]=[],layout=p.layout
  if(layout.mode==='compose')sheet=canvas(plan.width,plan.height)
  for(let position=0;position<plan.selected.length;position++){
   const index=plan.selected[position]
   if(layout.mode==='archive')output.file(`${layout.kind==='extracted'?'frames/frame_':'matted_frames/matte_'}${String(position+1).padStart(5,'0')}.png`,await sources[index].arrayBuffer())
   else{
    current=await createImageBitmap(sources[index]);if(current.width!==sizes[index].w||current.height!==sizes[index].h)throw new Error('VIDEO_FRAME_SIZE_CHANGED')
    if(layout.mode==='analyze'){
     const c=canvas(current.width,current.height),ctx=c.getContext('2d')!;ctx.drawImage(current,0,0);hashes.push(videoFingerprint(ctx.getImageData(0,0,c.width,c.height).data));c.width=1;c.height=1
    }else if(layout.mode==='matte'){
     let c=canvas(current.width,current.height),ctx=c.getContext('2d')!;ctx.drawImage(current,0,0)
     const data=ctx.getImageData(0,0,c.width,c.height),rgb=[1,3,5].map(at=>parseInt(layout.background.slice(at,at+2),16))
     normalChromaPixels(data.data,rgb[0],rgb[1],rgb[2],layout.tolerance,layout.feather);ctx.putImageData(data,0,0)
     let blob=await png(c);c.width=1;c.height=1
     if(mask){
      current.close();current=await createImageBitmap(blob);c=canvas(current.width,current.height);ctx=c.getContext('2d')!;ctx.drawImage(current,0,0);ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);blob=await png(c);c.width=1;c.height=1
     }
     output.file(`frame_${String(position).padStart(3,'0')}.png`,await blob.arrayBuffer())
    }else{
     if(layout.strokeWidth>0){
      let c=resize(current,layout.width,layout.height,layout.padding),blob=await png(c);c.width=1;c.height=1;current.close();current=await createImageBitmap(blob)
      c=canvas(current.width,current.height);const ctx=c.getContext('2d')!;ctx.drawImage(current,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height)
      videoInnerStroke(pixels.data,c.width,c.height,layout.strokeWidth,layout.strokeColor);ctx.putImageData(pixels,0,0);blob=await png(c);c.width=1;c.height=1;current.close();current=await createImageBitmap(blob)
     }
     const c=resize(current,layout.width,layout.height,layout.padding)
     sheet!.getContext('2d')!.drawImage(c,position%layout.columns*(layout.width+layout.spacing),Math.floor(position/layout.columns)*(layout.height+layout.spacing),layout.width,layout.height);c.width=1;c.height=1
    }
    current.close();current=null
   }
   progress(position+1,plan.selected.length)
  }
  if(layout.mode==='analyze')output.file('analysis.json',JSON.stringify({hashes,duplicates:videoDuplicateMarkers(hashes),frameCount:sizes.length}))
  if(layout.mode==='compose'){
   output.file('sprite.png',await (await png(sheet!)).arrayBuffer())
   output.file('index.json',JSON.stringify({version:'1.0',frame_size:{w:layout.width,h:layout.height},sheet_size:{w:layout.columns*(layout.width+layout.spacing)-layout.spacing,h:Math.ceil(sizes.length/layout.columns)*(layout.height+layout.spacing)-layout.spacing},frames:sizes.map((_,i)=>({i,x:i%layout.columns*(layout.width+layout.spacing),y:Math.floor(i/layout.columns)*(layout.height+layout.spacing),w:layout.width,h:layout.height,t:Math.round(layout.timestamps[i]*1000)/1000}))},null,2))
  }
  const blob=await output.generateAsync({type:'blob',compression:'DEFLATE'})
  if(blob.size>128*1024**2)throw new Error('VIDEO_FRAME_OUTPUT_LIMIT')
  self.postMessage({id,generation,blob})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{current?.close();mask?.close();if(sheet){sheet.width=1;sheet.height=1}}
}

/// <reference lib="webworker" />
import JSZip from 'jszip'
import {checkCustomComposeBudget,checkCustomSliceBudget,composeCustomSlices,computeCustomPlan,exportCustomSlices,inspectCustomZip,type CustomCompose,type CustomLayout,type CustomPlanParameters,type FrameSize} from './customSlice'
import {fineEditorImageSize} from './fineEditorPixels'

const canvases:OffscreenCanvas[]=[]
Object.defineProperty(self,'document',{value:{createElement(name:string){
 if(name!=='canvas')throw new Error('CUSTOM_ELEMENT_UNSUPPORTED')
 const canvas=new OffscreenCanvas(1,1);canvases.push(canvas)
 return Object.assign(canvas,{toBlob(callback:(blob:Blob|null)=>void,type='image/png',quality?:number){void canvas.convertToBlob({type,quality}).then(callback).catch(()=>callback(null))}})
}}})
type Request={id:string;generation:number;operation:'image.customSlicePlan'|'image.customSlice'|'image.customCompose';file:Blob;budgetBytes:number;parameters:CustomPlanParameters&{layout:CustomLayout;composition:CustomCompose;frontendBytes:number};action?:'preview'}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const {id,generation,file,operation,budgetBytes,parameters:p,action}=event.data
 let bitmap:ImageBitmap|undefined,frame:VideoFrame|undefined,decoder:ImageDecoder|undefined
 try{
  if(!(file instanceof Blob)||!['image.customSlicePlan','image.customSlice','image.customCompose'].includes(operation))throw new Error('CUSTOM_REQUEST')
  let blob:Blob
  if(operation==='image.customCompose'){
   if(file.size>128*1024**2)throw new Error('CUSTOM_ARCHIVE_LIMIT')
   if(!Number.isSafeInteger(budgetBytes)||budgetBytes<=0||budgetBytes>2*1024**3||!Number.isSafeInteger(p.frontendBytes)||p.frontendBytes<0||256*1024**2+file.size*4+p.frontendBytes>budgetBytes)throw new Error('CUSTOM_RESOURCE_LIMIT')
   const bytes=await file.arrayBuffer(),{names,encodedBytes}=inspectCustomZip(bytes,budgetBytes)
   if(256*1024**2+file.size*4+encodedBytes*4+p.frontendBytes>budgetBytes)throw new Error('CUSTOM_RESOURCE_LIMIT')
   const archive=await JSZip.loadAsync(bytes),files:Blob[]=[],sizes:FrameSize[]=[]
   for(const name of names){
    const file=await archive.file(name)!.async('blob'),size=await fineEditorImageSize(file),signature=new Uint8Array(await file.slice(0,8).arrayBuffer())
    if(signature.join(',')!=='137,80,78,71,13,10,26,10')throw new Error('CUSTOM_ARCHIVE_PNG')
    files.push(file);sizes.push({w:size.width,h:size.height})
   }
   checkCustomComposeBudget(sizes,p.composition,file.size,encodedBytes,budgetBytes,p.frontendBytes)
   self.postMessage({id,generation,phase:'processing'})
   blob=await composeCustomSlices(sizes,p.composition,async index=>{
    const image=await createImageBitmap(files[index]);if(image.width!==sizes[index].w||image.height!==sizes[index].h){image.close();throw new Error('CUSTOM_FRAME_SIZE_CHANGED')}
    return {image,close:()=>image.close()}
   })
  }else{
   const size=await fineEditorImageSize(file)
   checkCustomSliceBudget(size.width,size.height,file.size,budgetBytes,p.frontendBytes)
   const signature=new Uint8Array(await file.slice(0,2).arrayBuffer());let native:ImageBitmap|VideoFrame
   if(signature[0]===255&&signature[1]===216){
    if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('CUSTOM_JPEG_DECODER_UNAVAILABLE')
    decoder=new ImageDecoder({data:await file.arrayBuffer(),type:'image/jpeg'});frame=(await decoder.decode({frameIndex:0})).image;native=frame
   }else{bitmap=await createImageBitmap(file);native=bitmap}
   const width=frame?.displayWidth??bitmap!.width,height=frame?.displayHeight??bitmap!.height
   if(!(width===size.width&&height===size.height||width===size.height&&height===size.width))throw new Error('CUSTOM_SOURCE_SIZE_CHANGED')
   checkCustomSliceBudget(width,height,file.size,budgetBytes,p.frontendBytes,operation==='image.customSlice'?p.layout:undefined)
   if(action==='preview'){
    const scale=Math.min(1,1024/Math.max(width,height)),canvas=new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));canvases.push(canvas)
    const ctx=canvas.getContext('2d')!;ctx.drawImage(native,0,0,canvas.width,canvas.height)
    const preview=canvas.transferToImageBitmap();self.postMessage({id,generation,bitmap:preview,width,height},[preview]);return
   }
   self.postMessage({id,generation,phase:'processing'})
   if(operation==='image.customSlicePlan'){
    const canvas=new OffscreenCanvas(width,height);canvases.push(canvas);const ctx=canvas.getContext('2d')!;ctx.drawImage(native,0,0)
    const plan=computeCustomPlan(ctx.getImageData(0,0,width,height),{mode:p.mode,columns:p.columns,rows:p.rows,refine:p.refine,bandPercent:p.bandPercent})
    blob=new Blob([JSON.stringify(plan)],{type:'application/json'})
   }else blob=await exportCustomSlices({source:native,naturalWidth:width,naturalHeight:height},p.layout)
  }
  self.postMessage({id,generation,blob})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{bitmap?.close();frame?.close();decoder?.close();for(const canvas of canvases){canvas.width=1;canvas.height=1}canvases.length=0}
}

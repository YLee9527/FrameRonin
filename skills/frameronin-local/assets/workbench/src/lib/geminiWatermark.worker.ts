/// <reference lib="webworker" />
import {checkWatermarkBudget,removeVisibleWatermark,type WatermarkParameters} from './geminiWatermarkOperation'
import {fineEditorImageSize} from './fineEditorPixels'

self.onmessage=async(event:MessageEvent<{id:string;generation:number;file:Blob;parameters:WatermarkParameters&{frontendBytes:number};budgetBytes:number}>)=>{
 const {id,generation,file,parameters:p,budgetBytes}=event.data
 let image:ImageBitmap|VideoFrame|undefined,decoder:ImageDecoder|undefined,canvas:OffscreenCanvas|undefined
 try{
  if(!(file instanceof Blob))throw new Error('WATERMARK_SOURCE_INVALID')
  const header=await fineEditorImageSize(file)
  checkWatermarkBudget(header.width,header.height,file.size,budgetBytes,p.frontendBytes)
  const signature=new Uint8Array(await file.slice(0,2).arrayBuffer())
  if(signature[0]===255&&signature[1]===216){
   if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('WATERMARK_JPEG_DECODER_UNAVAILABLE')
   decoder=new ImageDecoder({data:await file.arrayBuffer(),type:'image/jpeg'});image=(await decoder.decode({frameIndex:0})).image
  }else image=await createImageBitmap(file)
  const width='displayWidth'in image?image.displayWidth:image.width,height='displayHeight'in image?image.displayHeight:image.height
  if(!(width===header.width&&height===header.height||width===header.height&&height===header.width))throw new Error('WATERMARK_SOURCE_SIZE_CHANGED')
  checkWatermarkBudget(width,height,file.size,budgetBytes,p.frontendBytes)
  canvas=new OffscreenCanvas(width,height)
  const context=canvas.getContext('2d');if(!context)throw new Error('WATERMARK_CANVAS_UNAVAILABLE')
  context.drawImage(image,0,0)
  self.postMessage({id,generation,phase:'processing'})
  const pixels=context.getImageData(0,0,canvas.width,canvas.height)
  await removeVisibleWatermark(pixels,p,async url=>{
   if(!url.startsWith('data:image/png;base64,'))throw new Error('WATERMARK_MASK_URL_UNSUPPORTED')
   const mask=await createImageBitmap(await(await fetch(url)).blob())
   try{
    if(mask.width!==48||mask.height!==48)throw new Error('WATERMARK_MASK_SIZE')
    const source=new OffscreenCanvas(48,48),ctx=source.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(mask,0,0)
    const data=ctx.getImageData(0,0,48,48).data,alpha=new Float32Array(48*48)
    for(let i=0;i<alpha.length;i++)alpha[i]=Math.max(data[i*4],data[i*4+1],data[i*4+2])/255
    source.width=source.height=1
    return {alpha,width:48,height:48}
   }finally{mask.close()}
  })
  context.putImageData(pixels,0,0)
  self.postMessage({id,generation,blob:await canvas.convertToBlob({type:'image/png'})})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{image?.close();decoder?.close();if(canvas)canvas.width=canvas.height=1}
}

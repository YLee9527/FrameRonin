/// <reference lib="webworker" />
import {checkSpriteGifBudget,encodeSpriteGifRows,type SpriteGifLayout} from './spriteGifRows'
import {customSliceSizes} from './customSlice'
import {fineEditorImageSize} from './fineEditorPixels'

self.onmessage=async(event:MessageEvent<{id:string;generation:number;file:Blob;parameters:{layout:SpriteGifLayout;frontendBytes:number};budgetBytes:number}>)=>{
 const {id,generation,file,parameters:p,budgetBytes}=event.data
 let image:ImageBitmap|VideoFrame|undefined,decoder:ImageDecoder|undefined,cut:OffscreenCanvas|undefined,read:OffscreenCanvas|undefined
 try{
  if(!(file instanceof Blob))throw new Error('SPRITE_GIF_SOURCE')
  const header=await fineEditorImageSize(file);checkSpriteGifBudget(header.width,header.height,file.size,p.layout,budgetBytes,p.frontendBytes)
  const bytes=new Uint8Array(await file.slice(0,2).arrayBuffer())
  if(bytes[0]===255&&bytes[1]===216){
   if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('SPRITE_GIF_JPEG_DECODER_UNAVAILABLE')
   decoder=new ImageDecoder({data:await file.arrayBuffer(),type:'image/jpeg'});image=(await decoder.decode({frameIndex:0})).image
  }else image=await createImageBitmap(file)
  const width='displayWidth'in image?image.displayWidth:image.width,height='displayHeight'in image?image.displayHeight:image.height
  if(!(width===header.width&&height===header.height||width===header.height&&height===header.width))throw new Error('SPRITE_GIF_SOURCE_SIZE_CHANGED')
  checkSpriteGifBudget(width,height,file.size,p.layout,budgetBytes,p.frontendBytes)
  const sizes=customSliceSizes(width,height,{mode:'grid',columns:p.layout.columns,rows:p.layout.rows})
  cut=new OffscreenCanvas(1,1);read=new OffscreenCanvas(1,1)
  const cutContext=cut.getContext('2d')!,readContext=read.getContext('2d')!
  self.postMessage({id,generation,phase:'processing'})
  const blob=await encodeSpriteGifRows(sizes,p.layout,async index=>{
   const row=Math.floor(index/p.layout.columns),col=index%p.layout.columns,size=sizes[index]
   const x=Math.floor(col*width/p.layout.columns),y=Math.floor(row*height/p.layout.rows)
   cut!.width=read!.width=size.w;cut!.height=read!.height=size.h
   cutContext.drawImage(image!,x,y,size.w,size.h,0,0,size.w,size.h)
   readContext.drawImage(cut!,0,0)
   return readContext.getImageData(0,0,size.w,size.h)
  })
  self.postMessage({id,generation,blob})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{image?.close();decoder?.close();if(cut)cut.width=cut.height=1;if(read)read.width=read.height=1}
}

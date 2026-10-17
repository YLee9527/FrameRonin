/// <reference lib="webworker" />
import JSZip from 'jszip'
import {boundedZipBlob,inspectOrderedZip} from './orderedZip'
import {spriteGifName} from './spriteGifRows'
import {fineEditorImageSize} from './fineEditorPixels'
type Size={w:number;h:number;frames:number}
type Request={id:string;generation:number;budgetBytes:number;frontendBytes:number}&({action:'gifArchive';file:Blob;rowCount:number}|{action:'preview';files:Blob[];sizes:Size[]})
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
self.onmessage=async(event:MessageEvent<Request>)=>{
 const p=event.data,{id,generation,budgetBytes,frontendBytes}=p
 try{
  if(!integer(budgetBytes,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3))throw new Error('SPRITE_ASSET_BUDGET')
  if(p.action==='gifArchive'){
   if(!(p.file instanceof Blob)||!integer(p.rowCount,1,4096)||p.file.size>128*1024**2||96*1024**2+p.file.size*4+frontendBytes>budgetBytes)throw new Error('SPRITE_ASSET_ARCHIVE_LIMIT')
   const bytes=await p.file.arrayBuffer(),{names,encodedBytes}=inspectOrderedZip(bytes,budgetBytes,spriteGifName)
   if(names.length!==p.rowCount||96*1024**2+p.file.size*4+encodedBytes*4+frontendBytes>budgetBytes)throw new Error('SPRITE_ASSET_ARCHIVE_LIMIT')
   const archive=await JSZip.loadAsync(bytes),files:Blob[]=[];let actualBytes=0
   for(const name of names){
    const blob=await boundedZipBlob(archive.file(name)!,encodedBytes-actualBytes),header=new TextDecoder().decode(await blob.slice(0,6).arrayBuffer());actualBytes+=blob.size
    if(!['GIF87a','GIF89a'].includes(header)||actualBytes>encodedBytes||actualBytes>128*1024**2)throw new Error('SPRITE_ASSET_GIF')
    files.push(new Blob([blob],{type:'image/gif'}))
   }
   self.postMessage({id,generation,files});return
  }
  if(p.action!=='preview'||!Array.isArray(p.files)||p.files.length>128||p.files.length!==p.sizes.length||p.files.some(f=>!(f instanceof Blob))||p.sizes.some(s=>!integer(s.w,1,30000)||!integer(s.h,1,30000)||!integer(s.frames,1,128)))throw new Error('SPRITE_ASSET_PREVIEW')
  const estimate=96*1024**2+frontendBytes+p.files.reduce((s,f)=>s+f.size*8,0)+Math.max(0,...p.sizes.map(s=>s.w*s.h))*40+p.files.length*128*128*16
  if(estimate>budgetBytes)throw new Error('SPRITE_ASSET_RESOURCE_LIMIT')
  const previews:Blob[]=[]
  for(let i=0;i<p.files.length;i++){
   const file=p.files[i],size=p.sizes[i],header=new TextDecoder().decode(await file.slice(0,6).arrayBuffer())
   let image:ImageBitmap|VideoFrame|undefined,decoder:ImageDecoder|undefined,canvas:OffscreenCanvas|undefined
   try{
    if(['GIF87a','GIF89a'].includes(header)){
     const bytes=new DataView(await file.slice(0,10).arrayBuffer())
     if(bytes.getUint16(6,true)!==size.w||bytes.getUint16(8,true)!==size.h)throw new Error('SPRITE_ASSET_SIZE_CHANGED')
     if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/gif'))throw new Error('SPRITE_ASSET_GIF_DECODER_UNAVAILABLE')
     decoder=new ImageDecoder({data:await file.arrayBuffer(),type:'image/gif'});image=(await decoder.decode({frameIndex:0})).image
    }else{
     const actual=await fineEditorImageSize(file);if(actual.width!==size.w||actual.height!==size.h)throw new Error('SPRITE_ASSET_SIZE_CHANGED')
     image=await createImageBitmap(file)
    }
    const width='displayWidth'in image?image.displayWidth:image.width,height='displayHeight'in image?image.displayHeight:image.height
    if(width!==size.w||height!==size.h)throw new Error('SPRITE_ASSET_SIZE_CHANGED')
    const scale=Math.min(1,128/Math.max(width,height));canvas=new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)))
    const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=false;context.drawImage(image,0,0,canvas.width,canvas.height)
    previews.push(await canvas.convertToBlob({type:'image/png'}))
   }finally{image?.close();decoder?.close();if(canvas)canvas.width=canvas.height=1}
  }
  self.postMessage({id,generation,previews})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
}

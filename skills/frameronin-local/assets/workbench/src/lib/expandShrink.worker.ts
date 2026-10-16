/// <reference lib="webworker" />
import {expandShrinkImage,checkExpandShrinkBudget,type ExpandShrinkParameters} from './expandShrinkImage'
import {fineEditorImageSize} from './fineEditorPixels'

const canvases:OffscreenCanvas[]=[]
Object.defineProperty(self,'document',{value:{createElement(name:string){
  if(name!=='canvas')throw new Error('EXPAND_SHRINK_ELEMENT_UNSUPPORTED')
  const canvas=new OffscreenCanvas(1,1);canvases.push(canvas)
  return Object.assign(canvas,{toBlob(callback:(blob:Blob|null)=>void,type='image/png'){
    void canvas.convertToBlob({type}).then(callback).catch(()=>callback(null))
  }})
}}})
self.onmessage=async(event:MessageEvent<{id:string;generation:number;file:Blob;parameters:ExpandShrinkParameters&{frontendBytes:number};budgetBytes:number}>)=>{
  const {id,generation,file,parameters:p,budgetBytes}=event.data
  let image:ImageBitmap|VideoFrame|undefined,decoder:ImageDecoder|undefined
  try{
    if(!(file instanceof Blob))throw new Error('EXPAND_SHRINK_SOURCE_INVALID')
    const header=await fineEditorImageSize(file)
    checkExpandShrinkBudget(header.width,header.height,file.size,p,budgetBytes,p.frontendBytes)
    const signature=new Uint8Array(await file.slice(0,2).arrayBuffer())
    if(signature[0]===255&&signature[1]===216){
      if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('EXPAND_SHRINK_JPEG_DECODER_UNAVAILABLE')
      decoder=new ImageDecoder({data:await file.arrayBuffer(),type:'image/jpeg'});image=(await decoder.decode({frameIndex:0})).image
    }else image=await createImageBitmap(file)
    const width='displayWidth'in image?image.displayWidth:image.width,height='displayHeight'in image?image.displayHeight:image.height
    if(!(width===header.width&&height===header.height||width===header.height&&height===header.width))throw new Error('EXPAND_SHRINK_SOURCE_SIZE_CHANGED')
    checkExpandShrinkBudget(width,height,file.size,p,budgetBytes,p.frontendBytes)
    self.postMessage({id,generation,phase:'processing'})
    const blob=await expandShrinkImage({native:image,naturalWidth:width,naturalHeight:height},p)
    self.postMessage({id,generation,blob})
  }catch(error){self.postMessage({id,generation,error:String(error)})}
  finally{image?.close();decoder?.close();for(const canvas of canvases){canvas.width=1;canvas.height=1}canvases.length=0}
}

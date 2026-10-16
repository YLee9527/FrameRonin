/// <reference lib="webworker" />
import {checkScatterBudget,detectScatterPixels,exportReviewedScatterZip,type ScatterDetect,type ReviewedScatterExport,type ScatterOrder} from './scatterSlice'
import {fineEditorImageSize} from './fineEditorPixels'

const canvases:OffscreenCanvas[]=[]
Object.defineProperty(self,'document',{value:{createElement(name:string){
  if(name!=='canvas')throw new Error('SCATTER_ELEMENT_UNSUPPORTED')
  const canvas=new OffscreenCanvas(1,1);canvases.push(canvas)
  return Object.assign(canvas,{toBlob(callback:(blob:Blob|null)=>void,type='image/png',quality?:number){
    void canvas.convertToBlob({type,quality}).then(callback).catch(()=>callback(null))
  }})
}}})
type Parameters={detect?:ScatterDetect;order?:ScatterOrder;layout?:ReviewedScatterExport;frontendBytes:number}
self.onmessage=async(event:MessageEvent<{id:string;generation:number;file:Blob;budgetBytes:number;parameters:Parameters;operation:'image.scatterDetect'|'image.scatterExport';action?:'preview'}>)=>{
  const {id,generation,file,budgetBytes,parameters:p,operation,action}=event.data
  let image:ImageBitmap|undefined
  try{
    if(!(file instanceof Blob)||!['image.scatterDetect','image.scatterExport'].includes(operation))throw new Error('SCATTER_INPUT_INVALID')
    const header=await fineEditorImageSize(file)
    checkScatterBudget(header.width,header.height,file.size,budgetBytes,p.frontendBytes,operation==='image.scatterExport'?p.layout:undefined)
    // The original scatter tool first paints into a CPU-readable source
    // canvas. Bitmap decoding preserves its JPEG chroma interpolation; the
    // VideoFrame path differs at strong subsampled edges.
    image=await createImageBitmap(file)
    const width=image.width,height=image.height
    if(!(width===header.width&&height===header.height||width===header.height&&height===header.width))throw new Error('SCATTER_SOURCE_SIZE_CHANGED')
    checkScatterBudget(width,height,file.size,budgetBytes,p.frontendBytes,operation==='image.scatterExport'?p.layout:undefined)
    const canvas=new OffscreenCanvas(width,height);canvases.push(canvas)
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('SCATTER_CANVAS_UNAVAILABLE')
    context.drawImage(image,0,0)
    if(action==='preview'){
      const scale=Math.min(1,1024/Math.max(width,height)),preview=new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));canvases.push(preview)
      preview.getContext('2d')!.drawImage(canvas,0,0,preview.width,preview.height)
      const bitmap=preview.transferToImageBitmap(),color=[...context.getImageData(0,0,1,1).data]
      self.postMessage({id,generation,bitmap,width,height,color},[bitmap]);return
    }
    self.postMessage({id,generation,phase:'processing'})
    let blob:Blob
    if(operation==='image.scatterDetect'){
      const boxes=detectScatterPixels(context.getImageData(0,0,width,height).data,width,height,p.detect!,p.order!)
      blob=new Blob([JSON.stringify({formatVersion:1,width,height,boxes})],{type:'application/json'})
    }else blob=await exportReviewedScatterZip(canvas,width,height,p.layout!)
    self.postMessage({id,generation,blob})
  }catch(error){self.postMessage({id,generation,error:String(error)})}
  finally{image?.close();for(const canvas of canvases){canvas.width=1;canvas.height=1}canvases.length=0}
}

import { applyMapFeather } from './mapFeather'
import type { MapFeather } from '../localProject/mapDocument'
self.onmessage=async(event:MessageEvent<{file:Blob;width:number;height:number;feather:MapFeather;budgetBytes:number}>)=>{
  const {file,width,height,feather,budgetBytes}=event.data
  let bitmap:ImageBitmap|undefined
  try{
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!Number.isFinite(budgetBytes)||width*height*32+file.size*2>budgetBytes/4)throw new Error('MAP_PREVIEW_RESOURCE_LIMIT')
    bitmap=await createImageBitmap(file)
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d')
    if(!ctx)throw new Error('MAP_PREVIEW_CANVAS_UNAVAILABLE')
    ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,0,0,width,height)
    const pixels=ctx.getImageData(0,0,width,height)
    applyMapFeather(pixels.data,width,height,feather);ctx.putImageData(pixels,0,0)
    self.postMessage({ok:true,blob:await canvas.convertToBlob({type:'image/png'})})
  }catch(error){self.postMessage({ok:false,error:String(error)})}
  finally{bitmap?.close()}
}

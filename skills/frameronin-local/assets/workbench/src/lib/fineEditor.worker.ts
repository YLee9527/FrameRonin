/// <reference lib="webworker" />
import {checkFineEditorBudget,eraseConnected,fineEditorImageSize,movePixelSelection,type PixelRect} from './fineEditorPixels'

export type FineEditorRequest={action:'decode';file:Blob;budget:number;retained:number}|{action:'encode'|'erase'|'move';width:number;height:number;pixels:Uint8ClampedArray;budget:number;retained:number;x?:number;y?:number;tolerance?:number;rect?:PixelRect;dx?:number;dy?:number}
export type FineEditorResult={width:number;height:number;pixels?:Uint8ClampedArray;blob?:Blob;rect?:PixelRect}

self.onmessage=async(event:MessageEvent<FineEditorRequest&{id:string;generation:number}>)=>{
  const request=event.data,{id,generation}=request
  let bitmap:ImageBitmap|undefined
  try{
    let pixels:Uint8ClampedArray,width:number,height:number
    if(request.action==='decode'){
      const size=await fineEditorImageSize(request.file);width=size.width;height=size.height
      checkFineEditorBudget(width,height,request.file.size,request.budget,request.retained)
      bitmap=await createImageBitmap(request.file)
      if(bitmap.width!==width||bitmap.height!==height)throw new Error('FINE_EDITOR_DECODE_SIZE_CHANGED')
      const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d')
      if(!context)throw new Error('FINE_EDITOR_CANVAS_UNAVAILABLE')
      context.drawImage(bitmap,0,0);pixels=context.getImageData(0,0,width,height).data
      self.postMessage({id,generation,result:{width,height,pixels}},[pixels.buffer]);return
    }
    width=request.width;height=request.height;pixels=request.pixels
    checkFineEditorBudget(width,height,0,request.budget,request.retained)
    if(!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)throw new Error('FINE_EDITOR_PIXELS_INVALID')
    let rect:PixelRect|undefined
    if(request.action==='erase'){
      const {x,y,tolerance}=request
      if(typeof x!=='number'||typeof y!=='number'||typeof tolerance!=='number'||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=width||y>=height||!Number.isFinite(tolerance)||tolerance<1||tolerance>100)throw new Error('FINE_EDITOR_ERASE_INVALID')
      eraseConnected(pixels,width,height,x,y,tolerance)
    }else if(request.action==='move'){
      const r=request.rect
      if(!r||![r.x,r.y,r.w,r.h,request.dx,request.dy].every(Number.isSafeInteger)||r.x<0||r.y<0||r.w<1||r.h<1||r.x+r.w>width||r.y+r.h>height)throw new Error('FINE_EDITOR_SELECTION_INVALID')
      rect=movePixelSelection(pixels,width,height,r,request.dx!,request.dy!)
    }else if(request.action!=='encode')throw new Error('FINE_EDITOR_ACTION_INVALID')
    const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d')
    if(!context)throw new Error('FINE_EDITOR_CANVAS_UNAVAILABLE')
    context.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>,width,height),0,0)
    const blob=await canvas.convertToBlob({type:'image/png'})
    self.postMessage({id,generation,result:{width,height,blob,pixels:request.action==='encode'?undefined:pixels,rect}},request.action==='encode'?[]:[pixels.buffer])
  }catch(error){self.postMessage({id,generation,error:String(error)})}
  finally{bitmap?.close()}
}

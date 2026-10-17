/// <reference lib="webworker" />
import JSZip from 'jszip'
import {applySheetProPreprocess,type SheetProPreprocessOptions,type SheetPreprocessAdapters} from './sheetProPreprocess'
import {checkSheetPreprocessBudget,sheetPreprocessSize,checkSheetPrepareBudget,prepareSheetGrid,type SheetPreparation} from './sheetPrepare'
import {fineEditorImageSize} from './fineEditorPixels'
import {normalChromaPixels,normalContiguousPixels} from './normalMattePixels'
import {getEmbeddedAlphaMask,getWatermarkParams,getWatermarkSize,removeWatermarkReverseAlpha} from './geminiWatermark'
import {superSplitByTransparent} from './superSplitTransparent'

const owned=new Set<{close():void}>(),canvases:OffscreenCanvas[]=[],bitmapFactory=self.createImageBitmap.bind(self)
Object.defineProperty(self,'createImageBitmap',{value:async(blob:Blob)=>{const image=await bitmapFactory(blob);owned.add(image);return image}})
type Decoded={image:ImageBitmap|VideoFrame;width:number;height:number}
async function htmlImage(blob:Blob):Promise<Decoded>{
 const head=new Uint8Array(await blob.slice(0,2).arrayBuffer())
 if(head[0]===255&&head[1]===216){
  if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('SHEET_JPEG_DECODER_UNAVAILABLE')
  const decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:'image/jpeg'});owned.add(decoder);const {image}=await decoder.decode({frameIndex:0});owned.add(image)
  return {image,width:image.displayWidth,height:image.displayHeight}
 }
 const image=await createImageBitmap(blob);return {image,width:image.width,height:image.height}
}
class WorkerImage{
 decoded?:Decoded;onload:(()=>void)|null=null;onerror:((error:unknown)=>void)|null=null;crossOrigin=''
 get width(){return this.decoded?.width??0}get height(){return this.decoded?.height??0}get naturalWidth(){return this.width}get naturalHeight(){return this.height}
 set src(value:string){void(async()=>{if(!value.startsWith('blob:')&&!value.startsWith('data:'))throw new Error('SHEET_IMAGE_URL_UNSUPPORTED');const response=await fetch(value);if(!response.ok)throw new Error('SHEET_IMAGE_LOAD');this.decoded=await htmlImage(await response.blob());this.onload?.()})().catch(e=>this.onerror?.(e))}
}
Object.defineProperty(self,'Image',{value:WorkerImage})
Object.defineProperty(self,'document',{value:{createElement(name:string){
 if(name!=='canvas')throw new Error('SHEET_PREPARATION_ELEMENT')
 const canvas=new OffscreenCanvas(1,1),get=canvas.getContext.bind(canvas);canvases.push(canvas);const context=get('2d')!
 const proxy=new Proxy(context,{get(target,key){const value=Reflect.get(target,key,target);if(key==='drawImage')return(source:CanvasImageSource|WorkerImage,...args:number[])=>Reflect.apply(value,target,[source instanceof WorkerImage?source.decoded?.image:source,...args]);return typeof value==='function'?value.bind(target):value},set(target,key,value){return Reflect.set(target,key,value,target)}})
 return Object.assign(canvas,{getContext(type:string){if(type!=='2d')throw new Error('SHEET_PREPARATION_CONTEXT');return proxy},toBlob(callback:(blob:Blob|null)=>void,type='image/png'){void canvas.convertToBlob({type}).then(callback).catch(()=>callback(null))}})
}}})
async function matte(blob:Blob,r:number,g:number,b:number,tolerance:number,feather:number,contiguous:boolean){
 const decoded=await htmlImage(blob),c=new OffscreenCanvas(decoded.width,decoded.height);canvases.push(c);const ctx=c.getContext('2d')!;ctx.drawImage(decoded.image,0,0)
 const data=ctx.getImageData(0,0,c.width,c.height)
 if(contiguous)normalContiguousPixels(data.data,c.width,c.height,r,g,b,tolerance);else normalChromaPixels(data.data,r,g,b,tolerance,feather)
 ctx.putImageData(data,0,0);return c.convertToBlob({type:'image/png'})
}
const adapters:SheetPreprocessAdapters={
 global:(...args)=>matte(...args,false),contiguous:(...args)=>matte(...args,true),
 watermark:async blob=>{
  const decoded=await htmlImage(blob),size=getWatermarkSize(decoded.width,decoded.height),mask=await getEmbeddedAlphaMask(size),position=getWatermarkParams(decoded.width,decoded.height,size)
  const c=new OffscreenCanvas(decoded.width,decoded.height);canvases.push(c);const ctx=c.getContext('2d')!;ctx.drawImage(decoded.image,0,0);const data=ctx.getImageData(0,0,c.width,c.height)
  removeWatermarkReverseAlpha(data,mask.alpha,mask.width,mask.height,position.x,position.y,255,1);ctx.putImageData(data,0,0);return c.convertToBlob({type:'image/png'})
 },
}
type Request={id:string;generation:number;file:Blob;operation:string;budgetBytes:number;parameters:{layout:SheetPreparation|SheetProPreprocessOptions;frontendBytes:number}}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const {id,generation,file,operation,budgetBytes,parameters:p}=event.data
 try{
  if(!(file instanceof Blob))throw new Error('SHEET_PREPARATION_INPUT')
  const header=await fineEditorImageSize(file),preprocess=operation==='image.sheetPreprocess'
  if(!preprocess&&operation!=='image.sheetPrepare')throw new Error('SHEET_PREPARATION_OPERATION')
  if(preprocess)checkSheetPreprocessBudget(header.width,header.height,file.size,p.layout as SheetProPreprocessOptions,budgetBytes,p.frontendBytes)
  else checkSheetPrepareBudget(header.width,header.height,file.size,p.layout as SheetPreparation,budgetBytes,p.frontendBytes)
  self.postMessage({id,generation,phase:'processing'})
  let blob:Blob
  if(preprocess){
   const options=p.layout as SheetProPreprocessOptions,source=await htmlImage(file)
   checkSheetPreprocessBudget(source.width,source.height,file.size,options,budgetBytes,p.frontendBytes)
   blob=await applySheetProPreprocess(file,options,adapters)
   const actual=await fineEditorImageSize(blob),expected=sheetPreprocessSize(source.width,source.height,options).output,signature=new Uint8Array(await blob.slice(0,8).arrayBuffer())
   if(actual.width!==expected.width||actual.height!==expected.height||signature.join(',')!=='137,80,78,71,13,10,26,10')throw new Error('SHEET_PREPROCESS_SIZE_CHANGED')
  }else{
   const decoded=await htmlImage(file),layout=p.layout as SheetPreparation
   if(!(decoded.width===header.width&&decoded.height===header.height||decoded.width===header.height&&decoded.height===header.width))throw new Error('SHEET_PREPARATION_SIZE_CHANGED')
   checkSheetPrepareBudget(decoded.width,decoded.height,file.size,layout,budgetBytes,p.frontendBytes)
   if(layout.mode==='transparent'){
    const source=new WorkerImage(),zip=new JSZip();source.decoded=decoded
    // The mature helper expects an HTML image; its controlled adapter unwraps
    // only this native frame at draw time, without enabling a URL input surface.
    const files=await superSplitByTransparent(source as unknown as HTMLImageElement,'sheet',{maxFrames:4096,budgetBytes,retainedBytes:p.frontendBytes+decoded.width*decoded.height*16+file.size*8})
    let encoded=0;const sizes=[]
    for(let i=0;i<files.length;i++){encoded+=files[i].size;if(encoded>128*1024**2)throw new Error('SHEET_PREPARATION_ENCODED_LIMIT');const s=await fineEditorImageSize(files[i]);sizes.push({w:s.width,h:s.height});zip.file(`frame_${String(i).padStart(3,'0')}.png`,files[i])}
    checkSheetPrepareBudget(decoded.width,decoded.height,file.size,layout,budgetBytes,p.frontendBytes,sizes);blob=await zip.generateAsync({type:'blob'})
   }else blob=await prepareSheetGrid(decoded.image,decoded.width,decoded.height,layout)
  }
  if(blob.size>128*1024**2)throw new Error('SHEET_PREPARATION_ENCODED_LIMIT')
  self.postMessage({id,generation,blob})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{for(const resource of owned)resource.close();owned.clear();for(const c of canvases)c.width=c.height=1;canvases.length=0}
}

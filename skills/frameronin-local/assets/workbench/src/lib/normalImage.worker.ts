/// <reference lib="webworker" />
import {normalImageOutputSize,processNormalImage,type NormalImageParameters,type NormalMatteAdapter} from './normalImageTools'
import {normalChromaPixels,normalContiguousPixels} from './normalMattePixels'
import {checkFineEditorBudget,fineEditorImageSize} from './fineEditorPixels'

const owned=new Set<{close():void}>(),canvases:OffscreenCanvas[]=[]
const bitmapFactory=self.createImageBitmap.bind(self)
Object.defineProperty(self,'createImageBitmap',{value:async(blob:Blob)=>{
  const image=await bitmapFactory(blob);owned.add(image);return image
}})
type Decoded={native:ImageBitmap|VideoFrame;width:number;height:number}
async function htmlImage(blob:Blob):Promise<Decoded>{
  const header=new Uint8Array(await blob.slice(0,2).arrayBuffer())
  if(header[0]===255&&header[1]===216){
    if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('NORMAL_JPEG_DECODER_UNAVAILABLE')
    const decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:'image/jpeg'});owned.add(decoder)
    const {image}=await decoder.decode({frameIndex:0});owned.add(image)
    return {native:image,width:image.displayWidth,height:image.displayHeight}
  }
  const image=await createImageBitmap(blob);return {native:image,width:image.width,height:image.height}
}
// The mature watermark helper uses Image for its embedded mask. Only controlled
// blobs and inline data are accepted; no local path or network URL is resolved.
class WorkerImage{
  decoded?:Decoded;onload:(()=>void)|null=null;onerror:((error:unknown)=>void)|null=null;crossOrigin=''
  get width(){return this.decoded?.width??0}get height(){return this.decoded?.height??0}
  get naturalWidth(){return this.width}get naturalHeight(){return this.height}
  set src(value:string){
    void(async()=>{
      if(!value.startsWith('blob:')&&!value.startsWith('data:'))throw new Error('NORMAL_IMAGE_URL_UNSUPPORTED')
      const response=await fetch(value);if(!response.ok)throw new Error('ERR_IMAGE_LOAD')
      this.decoded=await htmlImage(await response.blob());this.onload?.()
    })().catch(error=>this.onerror?.(error))
  }
}
Object.defineProperty(self,'Image',{value:WorkerImage})
Object.defineProperty(self,'document',{value:{createElement(name:string){
  if(name!=='canvas')throw new Error('NORMAL_WORKER_ELEMENT_UNSUPPORTED')
  const canvas=new OffscreenCanvas(1,1),nativeGet=canvas.getContext.bind(canvas)
  canvases.push(canvas)
  const context=nativeGet('2d')!
  const wrapped=new Proxy(context,{
    get(target,key){
      const value=Reflect.get(target,key,target)
      if(key==='drawImage')return(source:CanvasImageSource|WorkerImage,...args:number[])=>Reflect.apply(value,target,[source instanceof WorkerImage?source.decoded?.native:source,...args])
      return typeof value==='function'?value.bind(target):value
    },set(target,key,value){return Reflect.set(target,key,value,target)},
  })
  return Object.assign(canvas,{getContext(type:string){if(type!=='2d')throw new Error('NORMAL_WORKER_CONTEXT_UNSUPPORTED');return wrapped},
    toBlob(callback:(blob:Blob|null)=>void,type='image/png'){void canvas.convertToBlob({type}).then(callback).catch(()=>callback(null))}})
}}})

function matte(contiguous:boolean):NormalMatteAdapter{
  return async(blob,r,g,b,tolerance,feather)=>{
    const image=await htmlImage(blob),canvas=new OffscreenCanvas(image.width,image.height);canvases.push(canvas)
    const context=canvas.getContext('2d')!;context.drawImage(image.native,0,0)
    const data=context.getImageData(0,0,canvas.width,canvas.height)
    if(contiguous)normalContiguousPixels(data.data,canvas.width,canvas.height,r,g,b,tolerance)
    else normalChromaPixels(data.data,r,g,b,tolerance,feather)
    context.putImageData(data,0,0);return canvas.convertToBlob({type:'image/png'})
  }
}
function check(width:number,height:number,fileBytes:number,p:NormalImageParameters&{frontendBytes:number},budget:number){
  const output=normalImageOutputSize(width,height,p)
  if(![width,height,output.width,output.height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=30000)
    ||['apply','mattePreview'].includes(p.mode)&&(width-p.cropLeft-p.cropRight<1||height-p.cropTop-p.cropBottom<1)
    ||256*1024**2+width*height*16+Math.max(width*height,output.width*output.height)*64+fileBytes*8+p.frontendBytes>budget)throw new Error('NORMAL_WORKER_RESOURCE_LIMIT')
}
type TaskRequest={id:string;generation:number;file:Blob;parameters:NormalImageParameters&{frontendBytes:number};budgetBytes:number;action?:undefined}
type SourceRequest={id:string;generation:number;file:Blob;budgetBytes:number;action:'preview'|'sample';retainedBytes:number;x?:number;y?:number}
self.onmessage=async(event:MessageEvent<TaskRequest|SourceRequest>)=>{
  const request=event.data,{id,generation,file,budgetBytes}=request
  try{
    if(request.action){
      if(!(file instanceof Blob)||!['preview','sample'].includes(request.action)||!Number.isSafeInteger(budgetBytes)||budgetBytes<=0||budgetBytes>2*1024**3)throw new Error('NORMAL_SOURCE_INVALID')
      const size=await fineEditorImageSize(file)
      checkFineEditorBudget(size.width,size.height,file.size,budgetBytes,request.retainedBytes)
      const image=await htmlImage(file)
      if(!(image.width===size.width&&image.height===size.height||image.width===size.height&&image.height===size.width))throw new Error('NORMAL_SOURCE_SIZE_CHANGED')
      if(request.action==='preview'){
        const scale=Math.min(1,1024/Math.max(image.width,image.height)),canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));canvases.push(canvas)
        const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=false;context.drawImage(image.native,0,0,canvas.width,canvas.height)
        const bitmap=canvas.transferToImageBitmap();self.postMessage({id,generation,bitmap,width:image.width,height:image.height},[bitmap]);return
      }
      const {x,y}=request
      if(!Number.isInteger(x)||!Number.isInteger(y)||x!<0||y!<0||x!>=image.width||y!>=image.height)throw new Error('NORMAL_SAMPLE_OUTSIDE_IMAGE')
      const canvas=new OffscreenCanvas(1,1);canvases.push(canvas);const context=canvas.getContext('2d')!
      context.drawImage(image.native,x!,y!,1,1,0,0,1,1)
      self.postMessage({id,generation,color:[...context.getImageData(0,0,1,1).data]});return
    }
    const p=request.parameters
    if(!(file instanceof Blob)||!Number.isSafeInteger(budgetBytes)||budgetBytes<=0||budgetBytes>2*1024**3||!Number.isSafeInteger(p.frontendBytes)||p.frontendBytes<0
      ||!['keepAspect','pixelated','enableMatte'].every(key=>typeof p[key as 'keepAspect']==='boolean')
      ||![p.cropLeft,p.cropTop,p.cropRight,p.cropBottom].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=30000)
      ||![p.width,p.height].every(value=>Number.isSafeInteger(value)&&value>=1&&value<=30000)
      ||!Number.isFinite(p.tolerance)||p.tolerance<1||p.tolerance>100||!Number.isFinite(p.feather)||p.feather<0||p.feather>30
      ||!Number.isInteger(p.strokeWidth)||p.strokeWidth<0||p.strokeWidth>20||![p.background,p.strokeColor].every(value=>/^#[a-f\d]{6}$/i.test(value)))throw new Error('NORMAL_WORKER_INPUT_INVALID')
    const size=await fineEditorImageSize(file);check(size.width,size.height,file.size,p,budgetBytes)
    const bitmap=await createImageBitmap(file)
    if(!(bitmap.width===size.width&&bitmap.height===size.height||bitmap.width===size.height&&bitmap.height===size.width))throw new Error('NORMAL_WORKER_SOURCE_SIZE_CHANGED')
    check(bitmap.width,bitmap.height,file.size,p,budgetBytes);bitmap.close();owned.delete(bitmap)
    self.postMessage({id,generation,phase:'processing'})
    const blob=await processNormalImage(file,p,{global:matte(false),contiguous:matte(true)})
    self.postMessage({id,generation,blob})
  }catch(error){self.postMessage({id,generation,error:String(error)})}
  finally{for(const resource of owned)resource.close();owned.clear();for(const canvas of canvases){canvas.width=1;canvas.height=1}canvases.length=0}
}

/// <reference lib="webworker" />
import {checkMatteToolBudget,processMatteTool,type MatteToolLayout} from './matteTool'
import {fineEditorImageSize} from './fineEditorPixels'
import {getEmbeddedAlphaMask,getWatermarkParams,getWatermarkSize,removeWatermarkReverseAlpha} from './geminiWatermark'

const owned=new Set<{close():void}>(),canvases:OffscreenCanvas[]=[],contexts:WebGLRenderingContext[]=[]
let textureDecode=false
type Decoded={image:ImageBitmap|VideoFrame;width:number;height:number;texture?:ImageBitmap|OffscreenCanvas}
async function decode(blob:Blob):Promise<Decoded>{
 const head=new Uint8Array(await blob.slice(0,2).arrayBuffer());let image:ImageBitmap|VideoFrame
 if(head[0]===255&&head[1]===216){
  if(typeof ImageDecoder==='undefined'||!await ImageDecoder.isTypeSupported('image/jpeg'))throw new Error('MATTE_TOOL_JPEG_DECODER_UNAVAILABLE')
  const decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:'image/jpeg'});owned.add(decoder)
  image=(await decoder.decode({frameIndex:0})).image
 }else image=await createImageBitmap(blob)
 owned.add(image)
 const width='displayWidth'in image?image.displayWidth:image.width,height='displayHeight'in image?image.displayHeight:image.height
 // WebGL ignores UNPACK_FLIP_Y/PREMULTIPLY for ImageBitmap inputs. Decode the
 // GPU texture explicitly so the unchanged original shader sees the same texels.
 let texture:ImageBitmap|OffscreenCanvas|undefined
 if(textureDecode){
  if('displayWidth'in image){
   // Flatten JPEG orientation before WebGL's flip. A combined ImageBitmap
   // EXIF-90 + flipY path reverses only its first column on this browser.
   const upright=await createImageBitmap(blob,{premultiplyAlpha:'none'});owned.add(upright)
   texture=new OffscreenCanvas(upright.width,upright.height);canvases.push(texture);texture.getContext('2d')!.drawImage(upright,0,0)
  }else{texture=await createImageBitmap(blob,{imageOrientation:'flipY',premultiplyAlpha:'none'});owned.add(texture)}
 }
 return {image,width,height,texture}
}
class WorkerImage{
 decoded?:Decoded;onload:(()=>void)|null=null;onerror:((error:unknown)=>void)|null=null;crossOrigin=''
 get width(){return this.decoded?.width??0}get height(){return this.decoded?.height??0}get naturalWidth(){return this.width}get naturalHeight(){return this.height}
 set src(value:string){void(async()=>{if(!value.startsWith('blob:')&&!value.startsWith('data:image/png;base64,'))throw new Error('MATTE_TOOL_IMAGE_URL');const response=await fetch(value);if(!response.ok)throw new Error('MATTE_TOOL_IMAGE_LOAD');this.decoded=await decode(await response.blob());this.onload?.()})().catch(error=>this.onerror?.(error))}
}
Object.defineProperty(self,'Image',{value:WorkerImage})
Object.defineProperty(self,'document',{value:{createElement(name:string){
 if(name!=='canvas')throw new Error('MATTE_TOOL_ELEMENT')
 const canvas=new OffscreenCanvas(1,1),nativeGet=canvas.getContext.bind(canvas);canvases.push(canvas)
 const cache=new Map<string,unknown>()
 return Object.assign(canvas,{getContext(type:string,options?:object){
  if(cache.has(type))return cache.get(type)
  if(type==='2d'){
   const context=nativeGet('2d',options);if(!context)throw new Error('MATTE_TOOL_CANVAS')
   const proxy=new Proxy(context,{get(target,key){const value=Reflect.get(target,key,target);if(key==='drawImage')return(source:CanvasImageSource|WorkerImage,...args:number[])=>Reflect.apply(value,target,[source instanceof WorkerImage?source.decoded?.image:source,...args]);return typeof value==='function'?value.bind(target):value},set(target,key,value){return Reflect.set(target,key,value,target)}})
   cache.set(type,proxy);return proxy
  }
  if(type!=='webgl')throw new Error('MATTE_TOOL_CONTEXT')
  const gl=nativeGet('webgl',options);if(!gl)throw new Error('MATTE_TOOL_WEBGL_UNAVAILABLE');contexts.push(gl)
  const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array,max=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  if(canvas.width>max||canvas.height>max||canvas.width>viewport[0]||canvas.height>viewport[1]||gl.drawingBufferWidth!==canvas.width||gl.drawingBufferHeight!==canvas.height)throw new Error('MATTE_TOOL_WEBGL_DIMENSIONS')
  const proxy=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target)
   if(key==='texImage2D')return(...args:unknown[])=>{const source=args.at(-1);if(source instanceof WorkerImage){if(!source.decoded?.texture)throw new Error('MATTE_TOOL_WEBGL_TEXTURE');args[args.length-1]=source.decoded.texture}return Reflect.apply(value,target,args)}
   if(key==='framebufferTexture2D')return(...args:unknown[])=>{Reflect.apply(value,target,args);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('MATTE_TOOL_WEBGL_FRAMEBUFFER')}
   return typeof value==='function'?value.bind(target):value
  }})
  cache.set(type,proxy);return proxy
 },toBlob(callback:(blob:Blob|null)=>void,type='image/png'){void canvas.convertToBlob({type}).then(callback).catch(()=>callback(null))}})
}}})
async function watermark(blob:Blob){
 const decoded=await decode(blob),size=getWatermarkSize(decoded.width,decoded.height),mask=await getEmbeddedAlphaMask(size),position=getWatermarkParams(decoded.width,decoded.height,size)
 const canvas=new OffscreenCanvas(decoded.width,decoded.height);canvases.push(canvas);const context=canvas.getContext('2d')!;context.drawImage(decoded.image,0,0)
 const data=context.getImageData(0,0,canvas.width,canvas.height);removeWatermarkReverseAlpha(data,mask.alpha,mask.width,mask.height,position.x,position.y,255,1);context.putImageData(data,0,0)
 return canvas.convertToBlob({type:'image/png'})
}
type Request={id:string;generation:number;files:Blob[];budgetBytes:number;parameters:{layout:MatteToolLayout;frontendBytes:number}}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const {id,generation,files,budgetBytes,parameters:p}=event.data
 try{
  if(!Array.isArray(files)||files.length<1||files.length>2||files.some(f=>!(f instanceof Blob)))throw new Error('MATTE_TOOL_SOURCE')
  const headers=await Promise.all(files.map(f=>fineEditorImageSize(f)))
  // Encoded headers may carry an orientation marker; validate raw dimensions
  // here and recheck displayed dimensions inside the controlled Image loader.
  checkMatteToolBudget(headers.map((s,i)=>({...s,...(s.width===headers[0].height&&s.height===headers[0].width?{width:headers[0].width,height:headers[0].height}:{}),bytes:files[i].size})),p.layout,budgetBytes,p.frontendBytes)
  textureDecode=p.layout.mode==='whiteErode'
  self.postMessage({id,generation,phase:'processing'})
  let displayed:{width:number;height:number}|undefined
  const blob=await processMatteTool(files,p.layout,watermark,sizes=>{
   sizes.forEach((s,i)=>{const h=headers[i];if(!(s.width===h.width&&s.height===h.height||s.width===h.height&&s.height===h.width))throw new Error('MATTE_TOOL_SOURCE_SIZE_CHANGED')})
   checkMatteToolBudget(sizes,p.layout,budgetBytes,p.frontendBytes);displayed=sizes[0]
  })
  for(const gl of contexts)if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw new Error('MATTE_TOOL_WEBGL_FAILED')
  const header=await fineEditorImageSize(blob)
  if(header.width!==displayed?.width||header.height!==displayed?.height)throw new Error('MATTE_TOOL_OUTPUT_DIMENSIONS')
  // A malicious or failed decoder cannot bypass the complete output estimate.
  checkMatteToolBudget(files.map(f=>({width:header.width,height:header.height,bytes:f.size})),p.layout,budgetBytes,p.frontendBytes)
  self.postMessage({id,generation,blob})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
 finally{for(const resource of owned)resource.close();owned.clear();for(const gl of contexts)gl.getExtension('WEBGL_lose_context')?.loseContext();contexts.length=0;for(const c of canvases)c.width=c.height=1;canvases.length=0}
}

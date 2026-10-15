/// <reference lib="webworker" />
import { resizeImageToBlobCanvasLegacy } from '../components/ParamsStep/utilsResizeCanvasLegacy'

// Use the host's original Canvas filter in a disposable Worker. Native canvas
// libraries choose different filters for large downscales and fractional alpha.
Object.defineProperty(self,'document',{value:{createElement(name:string){
  if(name!=='canvas')throw new Error('WORKER_ELEMENT_UNSUPPORTED')
  const canvas=new OffscreenCanvas(1,1)
  return Object.assign(canvas,{toBlob(callback:(blob:Blob|null)=>void,type='image/png'){
    void canvas.convertToBlob({type}).then(callback).catch(()=>callback(null))
  }})
}}})
self.onmessage=async(event:MessageEvent)=>{
  const {id,generation,file,parameters}=event.data
  try{
    if(!(file instanceof Blob)||!Number.isInteger(parameters.width)||!Number.isInteger(parameters.height)
      ||parameters.width<1||parameters.width>4096||parameters.height<1||parameters.height>4096||typeof parameters.keepAspect!=='boolean')throw new Error('WORKER_INPUT_INVALID')
    self.postMessage({id,generation,phase:'processing'})
    const blob=await resizeImageToBlobCanvasLegacy(file,parameters.width,parameters.height,parameters.keepAspect,false)
    self.postMessage({id,generation,blob})
  }catch(error){self.postMessage({id,generation,error:String(error)})}
}

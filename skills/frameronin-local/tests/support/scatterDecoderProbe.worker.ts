/// <reference lib="webworker" />
import {exportReviewedScatterZip} from '../../assets/workbench/src/lib/scatterSlice'

// Diagnostic fixture Worker, excluded from the product. It compares the host's
// bitmap decoder with the original HTMLImage source-canvas path.
const owned:OffscreenCanvas[]=[]
Object.defineProperty(self,'document',{value:{createElement(){
  const canvas=new OffscreenCanvas(1,1);owned.push(canvas)
  return Object.assign(canvas,{toBlob(callback:(blob:Blob|null)=>void,type:string,quality?:number){
    void canvas.convertToBlob({type,quality}).then(callback).catch(()=>callback(null))
  }})
}}})
self.onmessage=async event=>{
  let bitmap:ImageBitmap|undefined
  try{
    bitmap=await createImageBitmap(event.data.file)
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);owned.push(canvas)
    canvas.getContext('2d',{willReadFrequently:true})!.drawImage(bitmap,0,0)
    self.postMessage({blob:await exportReviewedScatterZip(canvas,bitmap.width,bitmap.height,event.data.layout)})
  }catch(error){self.postMessage({error:String(error)})}
  finally{bitmap?.close();for(const canvas of owned){canvas.width=1;canvas.height=1}}
}

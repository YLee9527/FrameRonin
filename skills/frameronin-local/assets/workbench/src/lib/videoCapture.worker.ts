/// <reference lib="webworker" />
import JSZip from 'jszip'
import {videoCapturePlan,type VideoCaptureLayout} from './videoCapture'
type Init={action:'init';id:string;generation:number;layout:VideoCaptureLayout;fileBytes:number;budget:number;frontendBytes:number;physical?:{width:number;height:number}}
type Frame={action:'frame';id:string;generation:number;index:number;timestamp:number;bitmap:ImageBitmap}
type Finish={action:'finish';id:string;generation:number}
let request:Init|null=null,plan:ReturnType<typeof videoCapturePlan>|null=null,output:JSZip|null=null,canvas:OffscreenCanvas|null=null,next=0,encoded=0,busy=false
self.onmessage=async(event:MessageEvent<Init|Frame|Finish>)=>{
 const data=event.data
 try{
  if(data.action==='init'){
   if(request)throw new Error('VIDEO_CAPTURE_ALREADY_STARTED')
   plan=videoCapturePlan(data.layout,data.fileBytes,data.budget,data.frontendBytes,data.physical);request=data;output=new JSZip();canvas=new OffscreenCanvas(plan.width,plan.height)
   self.postMessage({id:data.id,generation:data.generation,phase:'ready'});return
  }
  if(!request||!plan||!canvas||data.id!==request.id||data.generation!==request.generation){if(data.action==='frame')data.bitmap.close();return}
  if(busy){if(data.action==='frame')data.bitmap.close();throw new Error('VIDEO_CAPTURE_FRAME_OVERLAP')}
  busy=true
  if(data.action==='finish'){
   if(next!==plan.timestamps.length)throw new Error('VIDEO_CAPTURE_FRAME_COUNT')
   const blob=await output!.generateAsync({type:'blob',compression:'DEFLATE'});if(blob.size>128*1024**2)throw new Error('VIDEO_CAPTURE_ENCODED_LIMIT')
   self.postMessage({id:data.id,generation:data.generation,blob});canvas.width=1;canvas.height=1;return
  }
  const bitmap=data.bitmap
  try{
   if(data.index!==next||data.timestamp!==plan.timestamps[next]||bitmap.width!==request.layout.sourceWidth||bitmap.height!==request.layout.sourceHeight)throw new Error('VIDEO_CAPTURE_FRAME_CHANGED')
   const ctx=canvas.getContext('2d')!,c=request.layout.crop
   ctx.clearRect(0,0,canvas.width,canvas.height)
   ctx.drawImage(bitmap,c.left,c.top,plan.cropWidth,plan.cropHeight,0,0,plan.cropWidth,plan.cropHeight)
   const blob=await canvas.convertToBlob({type:'image/png'});encoded+=blob.size
   if(encoded>plan.encodedCacheBytes)throw new Error('VIDEO_CAPTURE_ENCODED_LIMIT')
   output!.file(`frame_${String(next).padStart(3,'0')}.png`,await blob.arrayBuffer());next++
   self.postMessage({id:data.id,generation:data.generation,phase:'frame',index:data.index,progress:next/plan.timestamps.length})
  }finally{bitmap.close()}
 }catch(error){self.postMessage({id:data.id,generation:data.generation,error:String(error)})}
 finally{busy=false}
}

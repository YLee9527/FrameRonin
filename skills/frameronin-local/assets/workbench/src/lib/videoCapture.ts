import {videoTimestamps} from './videoFrameTools'

export type VideoCaptureLayout={sourceWidth:number;sourceHeight:number;start:number;end:number;fps:number;maxFrames:number;crop:{left:number;top:number;right:number;bottom:number}}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const integer=(v:unknown,a:number,b:number)=>finite(v,a,b)&&Number.isSafeInteger(v)
export function videoCapturePlan(value:unknown,fileBytes:number,budget:number,frontendBytes:number,physical?:{width:number;height:number}){
 if(!object(value)||!fields(value,['sourceWidth','sourceHeight','start','end','fps','maxFrames','crop'])||!integer(value.sourceWidth,1,30000)||!integer(value.sourceHeight,1,30000)
  ||!object(value.crop)||!fields(value.crop,['left','top','right','bottom']))throw new Error('VIDEO_CAPTURE_LAYOUT')
 const p=value as VideoCaptureLayout,c=p.crop
 if(!finite(c.left,0,p.sourceWidth-1)||!finite(c.right,0,p.sourceWidth-1)||!finite(c.top,0,p.sourceHeight-1)||!finite(c.bottom,0,p.sourceHeight-1))throw new Error('VIDEO_CAPTURE_CROP')
 const timestamps=videoTimestamps(p.start,p.end,p.fps,p.maxFrames)
 if(!integer(fileBytes,1,200*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3)
  ||physical&&(!integer(physical.width,1,30000)||!integer(physical.height,1,30000)))throw new Error('VIDEO_CAPTURE_RESOURCE_LIMIT')
 const cropWidth=Math.max(1,p.sourceWidth-c.left-c.right),cropHeight=Math.max(1,p.sourceHeight-c.top-c.bottom),width=Math.floor(cropWidth),height=Math.floor(cropHeight)
 const encodedCacheBytes=Math.min(128*1024**2,timestamps.length*(width*height*5+height+1024))
 const pixels=Math.max(p.sourceWidth*p.sourceHeight,physical?physical.width*physical.height:0)
 const estimatedBytes=256*1024**2+fileBytes*2+pixels*96+encodedCacheBytes*8+frontendBytes
 if(!Number.isSafeInteger(estimatedBytes)||estimatedBytes>budget)throw new Error('VIDEO_CAPTURE_RESOURCE_LIMIT')
 return {timestamps,width,height,cropWidth,cropHeight,encodedCacheBytes,estimatedBytes}
}

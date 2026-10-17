import {getEmbeddedAlphaMask,getWatermarkParams,getWatermarkSize,removeWatermarkReverseAlpha,type WatermarkSize} from './geminiWatermark'

export type WatermarkParameters={sizeMode:'auto'|'48'|'96'}
export type AlphaLoader=(url:string)=>Promise<{alpha:Float32Array;width:number;height:number}>
export function validateWatermarkParameters(p:WatermarkParameters){
 if(!p||!['auto','48','96'].includes(p.sizeMode))throw new Error('WATERMARK_PARAMETERS_INVALID')
}
export function checkWatermarkBudget(width:number,height:number,fileBytes:number,budget:number,retained=0){
 if(![width,height].every(v=>Number.isSafeInteger(v)&&v>=1&&v<=30000)||!Number.isSafeInteger(fileBytes)||fileBytes<1||fileBytes>20*1024**2||!Number.isSafeInteger(budget)||budget<1||budget>2*1024**3||!Number.isSafeInteger(retained)||retained<0
  ||256*1024**2+width*height*40+fileBytes*8+retained>budget)throw new Error('WATERMARK_RESOURCE_LIMIT')
}
/** Preserve the standalone tool's 96px alpha scale (the workflow uses 1). */
export async function removeVisibleWatermark(image:ImageData,p:WatermarkParameters,load?:AlphaLoader){
 validateWatermarkParameters(p)
 const size:WatermarkSize=p.sizeMode==='auto'?getWatermarkSize(image.width,image.height):p.sizeMode==='48'?48:96
 const mask=await getEmbeddedAlphaMask(size,load),position=getWatermarkParams(image.width,image.height,size)
 removeWatermarkReverseAlpha(image,mask.alpha,mask.width,mask.height,position.x,position.y,255,size===96?.85:1)
 return {size,x:position.x,y:position.y,alphaScale:size===96?.85:1}
}

import {applyChromaKey,applyChromaKeyContiguousFromTopLeft,applyInnerStroke,cropImageBlob,
  extendImageBottom,getTopLeftPixelColor,processAncientCostumeAllActions,resizeImageToBlob} from '../components/ParamsStep/utils'
import {removeGeminiWatermarkFromBlob} from './geminiWatermark'

export type NormalImageMode='apply'|'mattePreview'|'extendBottom'|'rpgMaker'|'allActions'|'ancientCostume'
export type NormalImageParameters={mode:NormalImageMode;cropLeft:number;cropTop:number;cropRight:number;cropBottom:number;
  width:number;height:number;keepAspect:boolean;pixelated:boolean;enableMatte:boolean;background:string;
  tolerance:number;feather:number;strokeWidth:number;strokeColor:string}
export type NormalMatteAdapter=(blob:Blob,r:number,g:number,b:number,tolerance:number,feather:number)=>Promise<Blob>
export function normalImageOutputSize(width:number,height:number,p:NormalImageParameters){
  if(p.mode==='apply')return {width:p.width,height:p.height}
  if(p.mode==='mattePreview')return {width:width-p.cropLeft-p.cropRight,height:height-p.cropTop-p.cropBottom}
  if(p.mode==='extendBottom')return {width,height:height+Math.floor(height/3)}
  if(p.mode==='rpgMaker')return {width:144,height:192}
  if(p.mode==='allActions')return {width:252,height:252}
  if(p.mode==='ancientCostume')return {width:1024,height:896}
  throw new Error('NORMAL_MODE_INVALID')
}

const dataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('ERR_READ'));reader.readAsDataURL(blob)
})
/** Preserve the original normal-image recipes and the order of their stages. */
export async function processNormalImage(input:Blob,p:NormalImageParameters,adapters?:{global:NormalMatteAdapter;contiguous:NormalMatteAdapter}):Promise<Blob>{
  if(p.mode==='extendBottom'){
    const result=await extendImageBottom(input,48)
    const bytes=new Uint8Array(await result.slice(0,8).arrayBuffer())
    if([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return result
    // The original UI extends an already encoded PNG. A direct engine caller
    // can supply a one/two-pixel JPEG, for which the old helper is a no-op.
    const url=URL.createObjectURL(result)
    try{
      const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('ERR_IMAGE_LOAD'));image.src=url})
      return await resizeImageToBlob(result,image.naturalWidth,image.naturalHeight,false,true)
    }finally{URL.revokeObjectURL(url)}
  }
  if(p.mode==='apply'||p.mode==='mattePreview'){
    let result=await cropImageBlob(input,{left:p.cropLeft,top:p.cropTop,right:p.cropRight,bottom:p.cropBottom})
    if(p.mode==='mattePreview'||p.enableMatte){
      const rgb=p.background.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
      if(!rgb)throw new Error('NORMAL_COLOR_INVALID')
      const r=parseInt(rgb[1],16),g=parseInt(rgb[2],16),b=parseInt(rgb[3],16)
      if(adapters)result=await adapters.global(result,r,g,b,p.tolerance,p.feather)
      else{const matte=await applyChromaKey(await dataUrl(result),r,g,b,p.tolerance,p.feather);result=await(await fetch(matte.dataUrl)).blob()}
    }
    if(p.mode==='mattePreview')return result
    result=await resizeImageToBlob(result,p.width,p.height,p.keepAspect,p.pixelated)
    return p.strokeWidth>0?applyInnerStroke(result,p.strokeWidth,p.strokeColor):result
  }
  if(!['rpgMaker','allActions','ancientCostume'].includes(p.mode))throw new Error('NORMAL_MODE_INVALID')
  let result=await removeGeminiWatermarkFromBlob(input)
  if(p.mode!=='rpgMaker')result=await resizeImageToBlob(result,256,256,false,true)
  const {r,g,b}=await getTopLeftPixelColor(result)
  if(adapters)result=await adapters.contiguous(result,r,g,b,80,5)
  else{const matte=await applyChromaKeyContiguousFromTopLeft(await dataUrl(result),r,g,b,80,5);result=await(await fetch(matte.dataUrl)).blob()}
  if(p.mode==='rpgMaker')return extendImageBottom(await resizeImageToBlob(result,144,144,false,true),48)
  if(p.mode==='allActions')return cropImageBlob(result,{left:0,top:0,right:4,bottom:4})
  return processAncientCostumeAllActions(result)
}

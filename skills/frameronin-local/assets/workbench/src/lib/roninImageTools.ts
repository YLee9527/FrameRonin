import { applyChromaKeyAdaptiveRegion, applyChromaKeyContiguousFromTopLeft, applyChromaKeyHybridTolerance,
  cropImageBlob, getTopLeftPixelColor, resizeImageToBlob } from '../components/ParamsStep/utils'

export type ScalePreset='resize'|'ffff'|'fffb'|'fbfb'|'fbff'|'c0c0'|'c0be'|'bebe'|'bec0'
export type CustomScaleParameters={width:number;height:number;keepAspect:boolean;pixelated:boolean;mode:ScalePreset;
  matteAlgorithm:'contiguous'|'chromaKey'|'chromaKeyAdaptive';nonContiguousTolerance:number}
const presets={ffff:[256,0,0],fffb:[256,0,4],fbfb:[256,4,4],fbff:[256,4,0],c0c0:[192,0,0],c0be:[192,0,2],bebe:[190,0,0],bec0:[192,2,0]} as const
export async function customScaleImage(input:Blob,parameters:CustomScaleParameters):Promise<Blob>{
  if(parameters.mode==='resize'&&!parameters.pixelated)throw new Error('BROWSER_RENDERER_REQUIRED')
  if(parameters.mode==='resize')return resizeImageToBlob(input,parameters.width,parameters.height,parameters.keepAspect,parameters.pixelated)
  const [side,right,bottom]=presets[parameters.mode]
  const scaled=await resizeImageToBlob(input,side,side,false,true)
  const {r,g,b}=await getTopLeftPixelColor(scaled)
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('ERR_READ'));reader.readAsDataURL(scaled)})
  let result:{dataUrl:string}
  if(parameters.matteAlgorithm==='chromaKey')result=await applyChromaKeyHybridTolerance(dataUrl,r,g,b,80,parameters.nonContiguousTolerance,0)
  else if(parameters.matteAlgorithm==='chromaKeyAdaptive')result=await applyChromaKeyAdaptiveRegion(dataUrl,r,g,b,80,parameters.nonContiguousTolerance,20,40,0)
  else result=await applyChromaKeyContiguousFromTopLeft(dataUrl,r,g,b,80,5)
  return cropImageBlob(await(await fetch(result.dataUrl)).blob(),{left:0,top:0,right,bottom})
}

export async function unifyImageSizes(images:HTMLImageElement[],columns:number,horizontal:'left'|'center'|'right',vertical:'top'|'center'|'bottom'):Promise<Blob>{
  const maxW=Math.max(...images.map(i=>i.naturalWidth)),maxH=Math.max(...images.map(i=>i.naturalHeight))
  const cols=Math.max(1,Math.min(64,columns)),rows=Math.ceil(images.length/cols)
  const canvas=document.createElement('canvas');canvas.width=cols*maxW;canvas.height=rows*maxH
  const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=false;context.clearRect(0,0,canvas.width,canvas.height)
  const offset=(max:number,size:number,alignment:'start'|'center'|'end')=>alignment==='start'?0:alignment==='center'?Math.floor((max-size)/2):max-size
  const h=horizontal==='left'?'start':horizontal==='right'?'end':'center',v=vertical==='top'?'start':vertical==='bottom'?'end':'center'
  for(const [index,image]of images.entries()){
    const x=index%cols*maxW+offset(maxW,image.naturalWidth,h),y=Math.floor(index/cols)*maxH+offset(maxH,image.naturalHeight,v)
    context.drawImage(image,0,0,image.naturalWidth,image.naturalHeight,x,y,image.naturalWidth,image.naturalHeight)
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG_ENCODE_FAILED')),'image/png',.95))
}

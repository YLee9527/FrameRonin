import {chromaKeyCanvas,erodeAlphaOnCanvas,whiteKeyErodeGLSL} from './imageMatteAlgorithms'
import {processDoubleBackground,postProcessDoubleBackgroundMatte,applyAlphaErosionToCanvas} from './doubleBackgroundMatte'

export type MatteToolLayout={mode:'chroma';keyColor:string;tolerance:number;smoothness:number;spill:number;erosion:number}
 |{mode:'whiteErode';tolerance:number;smoothness:number;erosion:number}
 |{mode:'doubleBg';tolerance:number;edgeContrast:number}|{mode:'repair'}|{mode:'frontier';erosion:number}
type Source={width:number;height:number;bytes:number}
const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
export function validateMatteToolLayout(value:unknown):asserts value is MatteToolLayout{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('MATTE_TOOL_LAYOUT')
 const p=value as Record<string,unknown>,keys=p.mode==='chroma'?['mode','keyColor','tolerance','smoothness','spill','erosion']:p.mode==='whiteErode'?['mode','tolerance','smoothness','erosion']:p.mode==='doubleBg'?['mode','tolerance','edgeContrast']:p.mode==='repair'?['mode']:p.mode==='frontier'?['mode','erosion']:[]
 if(!keys.length||Object.keys(p).sort().join(',')!==keys.sort().join(','))throw new Error('MATTE_TOOL_LAYOUT')
 if(p.mode==='chroma'&&(!/^#[a-f\d]{6}$/i.test(String(p.keyColor))||!finite(p.spill,5,100))
  ||['chroma','whiteErode'].includes(String(p.mode))&&(!finite(p.tolerance,5,100)||!finite(p.smoothness,5,100))
  ||['chroma','whiteErode','frontier'].includes(String(p.mode))&&!finite(p.erosion,0,100)
  ||p.mode==='doubleBg'&&(!finite(p.tolerance,50,100)||!finite(p.edgeContrast,50,100)))throw new Error('MATTE_TOOL_PARAMETERS')
}
export function checkMatteToolBudget(sources:Source[],layout:MatteToolLayout,budgetBytes:number,frontendBytes:number){
 validateMatteToolLayout(layout)
 if(!Number.isSafeInteger(budgetBytes)||budgetBytes<1||budgetBytes>2*1024**3||!Number.isSafeInteger(frontendBytes)||frontendBytes<0||frontendBytes>2*1024**3)throw new Error('MATTE_TOOL_BUDGET')
 if(sources.length!==(layout.mode==='doubleBg'?2:1)||sources.some(s=>![s.width,s.height,s.bytes].every(Number.isSafeInteger)||s.width<1||s.height<1||s.width>30000||s.height>30000||s.bytes<1||s.bytes>(['repair','frontier'].includes(layout.mode)?128:20)*1024**2))throw new Error('MATTE_TOOL_SOURCE')
 if(sources.some(s=>s.width!==sources[0].width||s.height!==sources[0].height))throw new Error('MATTE_TOOL_SIZE_MISMATCH')
 // Includes source/cleaned decodes, Canvas/WebGL textures and buffers, repair
 // union-find/island maps, PNG encoding, retained frontend copies and runtime.
 const estimate=256*1024**2+sources.reduce((n,s)=>n+s.width*s.height*192+s.bytes*12,0)+frontendBytes
 if(!Number.isSafeInteger(estimate)||estimate>budgetBytes)throw new Error('MATTE_TOOL_RESOURCE_LIMIT')
 return estimate
}
const load=(blob:Blob)=>new Promise<HTMLImageElement>((resolve,reject)=>{
 const url=URL.createObjectURL(blob),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('MATTE_TOOL_IMAGE_LOAD'))};image.src=url
})
const encode=(canvas:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('MATTE_TOOL_ENCODE')),'image/png'))
function draw(image:HTMLImageElement){const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');if(!ctx)throw new Error('MATTE_TOOL_CANVAS');ctx.drawImage(image,0,0);return c}
export async function processMatteTool(files:Blob[],p:MatteToolLayout,watermark:(blob:Blob)=>Promise<Blob>,onDecoded?:(sizes:Source[])=>void):Promise<Blob>{
 validateMatteToolLayout(p)
 if(files.length!==(p.mode==='doubleBg'?2:1))throw new Error('MATTE_TOOL_SOURCE')
 const images=await Promise.all(files.map(load))
 onDecoded?.(images.map((image,i)=>({width:image.naturalWidth,height:image.naturalHeight,bytes:files[i].size})))
 if(images.some(i=>i.naturalWidth!==images[0].naturalWidth||i.naturalHeight!==images[0].naturalHeight))throw new Error('MATTE_TOOL_SIZE_MISMATCH')
 let canvas:HTMLCanvasElement
 if(p.mode==='doubleBg'){
  // Preserve the original image -> PNG -> watermark -> image sequence. Mask
  // or decode failure is explicit; the old silent fallback is not retained.
  const clean=await Promise.all(images.map(async image=>load(await watermark(await encode(draw(image))))))
  canvas=processDoubleBackground(clean[0],clean[1],p.tolerance,p.edgeContrast)
 }else if(p.mode==='chroma'){
  const color=p.keyColor.slice(1).match(/../g)!.map(c=>parseInt(c,16)) as [number,number,number]
  canvas=erodeAlphaOnCanvas(chromaKeyCanvas(images[0],color,p.tolerance,p.smoothness,p.spill),Math.min(5,Math.round((p.erosion/100)*10)))
 }else if(p.mode==='whiteErode')canvas=whiteKeyErodeGLSL(images[0],p.tolerance,p.smoothness,p.erosion)
 else if(p.mode==='repair')canvas=postProcessDoubleBackgroundMatte(draw(images[0]))
 else canvas=applyAlphaErosionToCanvas(draw(images[0]),p.erosion)
 const blob=await encode(canvas)
 if(blob.size>128*1024**2)throw new Error('MATTE_TOOL_ENCODED_LIMIT')
 return blob
}

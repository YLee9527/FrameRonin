import JSZip from 'jszip'
import {encodeBrowserGif} from './gifSequence'
import type {FrameSize} from './customSlice'

export type SheetCrop={top:number;bottom:number;left:number;right:number}
export type SheetPlacement={sourceIndex:number;dx:number;dy:number;crop:SheetCrop}
export type SheetCompose={columns:number;rows:number;frames:SheetPlacement[]}
export type SheetGif=SheetCompose&{selected:number[];speedScale:number}
export type SheetPixelFix={imgX:number;imgY:number;range:number;data:number[]}
export type SheetFix={selected:number[];referenceWidth:number;referenceHeight:number;fixes:SheetPixelFix[]}
export type SheetImage={image:CanvasImageSource;width:number;height:number;close:()=>void}
export type SheetLoad=(index:number)=>Promise<SheetImage>
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const MIB=1024**2
function sizesChecked(sizes:FrameSize[]){
 if(!Array.isArray(sizes)||!sizes.length||sizes.length>4096||sizes.some(s=>!object(s)||!fields(s,['w','h'])||!integer(s.w,1,30000)||!integer(s.h,1,30000)))throw new Error('SHEET_FRAME_SIZES')
}
function selection(value:unknown,count:number){
 if(!Array.isArray(value)||!value.length||value.length>count||new Set(value).size!==value.length||value.some(v=>!integer(v,0,count-1)))throw new Error('SHEET_SELECTION')
}
export function validateSheetCompose(value:unknown,sizes:FrameSize[],gif=false):asserts value is SheetCompose|SheetGif{
 sizesChecked(sizes)
 if(!object(value)||!fields(value,['columns','rows','frames',...(gif?['selected','speedScale']:[])])||!integer(value.columns,1,64)||!integer(value.rows,1,4096)||!Array.isArray(value.frames)||!value.frames.length||value.frames.length>4096)throw new Error('SHEET_LAYOUT')
 for(const frame of value.frames){
  if(!object(frame)||!fields(frame,['sourceIndex','dx','dy','crop'])||!integer(frame.sourceIndex,0,sizes.length-1)||!integer(frame.dx,-30000,30000)||!integer(frame.dy,-30000,30000)||!object(frame.crop)||!fields(frame.crop,['top','bottom','left','right'])||Object.values(frame.crop).some(v=>!finite(v,-30000,30000)))throw new Error('SHEET_PLACEMENT')
 }
 if(gif){selection(value.selected,value.frames.length);if(!finite(value.speedScale,.25,4))throw new Error('SHEET_SPEED')}
}
export function validateSheetFix(value:unknown,sizes:FrameSize[]):asserts value is SheetFix{
 sizesChecked(sizes)
 if(!object(value)||!fields(value,['selected','referenceWidth','referenceHeight','fixes'])||!integer(value.referenceWidth,1,30000)||!integer(value.referenceHeight,1,30000)||!Array.isArray(value.fixes)||!value.fixes.length||value.fixes.length>4096)throw new Error('SHEET_PIXEL_FIX')
 selection(value.selected,sizes.length)
 for(const fix of value.fixes){
  if(!object(fix)||!fields(fix,['imgX','imgY','range','data'])||!integer(fix.range,1,8)||!integer(fix.imgX,0,Number(value.referenceWidth)-Number(fix.range))||!integer(fix.imgY,0,Number(value.referenceHeight)-Number(fix.range))||!Array.isArray(fix.data)||fix.data.length!==Number(fix.range)**2*4||fix.data.some(v=>!integer(v,0,255)))throw new Error('SHEET_PIXEL_PATCH')
 }
}
/** Preserve the original fractional crop and padding coordinates. */
export function sheetFrameCrop(iw:number,ih:number,cr:SheetCrop){
 const {top:t,bottom:b,left:l,right:r}=cr
 return {sw:Math.max(1,iw-l-r),sh:Math.max(1,ih-t-b),sx:Math.max(0,l),sy:Math.max(0,t),srcW:Math.max(1,iw-Math.max(0,l)-Math.max(0,r)),srcH:Math.max(1,ih-Math.max(0,t)-Math.max(0,b)),padX:Math.max(0,-l),padY:Math.max(0,-t)}
}
export function sheetLayout(sizes:FrameSize[],p:SheetCompose,output:'compose'|'gif'='compose'){
 validateSheetCompose(p,sizes,'selected'in p)
 let cellW=1,cellH=1
 for(const frame of p.frames){const size=sizes[frame.sourceIndex],cr=frame.crop;cellW=Math.max(cellW,size.w-cr.left-cr.right);cellH=Math.max(cellH,size.h-cr.top-cr.bottom)}
 const width=Math.floor(cellW*p.columns),height=Math.floor(cellH*p.rows)
 if(![cellW,cellH,...(output==='compose'?[width,height]:[])].every(v=>Number.isFinite(v)&&v>=1&&v<=30000))throw new Error('SHEET_OUTPUT_DIMENSIONS')
 return {cellW,cellH,width,height,gifWidth:Math.floor(cellW),gifHeight:Math.floor(cellH)}
}
export function checkSheetBudget(sizes:FrameSize[],p:SheetCompose|SheetGif|SheetFix,action:'compose'|'gif'|'fix',encodedBytes:number,budget:number,frontendBytes:number){
 sizesChecked(sizes)
 if(!integer(encodedBytes,1,256*MIB)||!integer(budget,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3))throw new Error('SHEET_RESOURCE_PARAMETERS')
 const maxPixels=Math.max(...sizes.map(s=>s.w*s.h)),sourcePixels=sizes.reduce((sum,s)=>sum+s.w*s.h,0)
 let outputPixels=0,totalOutputPixels=sourcePixels,patchBytes=0
 if(action==='fix'){
  validateSheetFix(p,sizes);const fix=p as SheetFix
  outputPixels=fix.referenceWidth*fix.referenceHeight;patchBytes=fix.fixes.reduce((sum,f)=>sum+f.data.length*16,0)
 }else{
  validateSheetCompose(p,sizes,action==='gif');const layout=sheetLayout(sizes,p as SheetCompose,action)
  outputPixels=action==='gif'?layout.gifWidth*layout.gifHeight:layout.width*layout.height
  totalOutputPixels=action==='gif'?outputPixels*(p as SheetGif).selected.length:outputPixels
 }
 const estimate=256*MIB+encodedBytes*10+frontendBytes+maxPixels*64+outputPixels*48+totalOutputPixels*8+patchBytes
 if(estimate>budget)throw new Error('SHEET_RESOURCE_LIMIT')
 return estimate
}
const canvas=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c}
const png=(c:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('SHEET_PNG_ENCODING')),'image/png'))
function paint(c:HTMLCanvasElement,loaded:SheetImage,p:SheetPlacement){
 const cr=sheetFrameCrop(loaded.width,loaded.height,p.crop),ctx=c.getContext('2d')!
 ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(loaded.image,cr.sx,cr.sy,cr.srcW,cr.srcH,p.dx+cr.padX,p.dy+cr.padY,cr.srcW,cr.srcH)
}
async function loadChecked(load:SheetLoad,index:number,sizes:FrameSize[]){
 const frame=await load(index),s=sizes[index]
 if(frame.width!==s.w||frame.height!==s.h){frame.close();throw new Error('SHEET_SOURCE_SIZE_CHANGED')}
 return frame
}
export async function composeSheet(sizes:FrameSize[],p:SheetCompose,load:SheetLoad){
 const layout=sheetLayout(sizes,p),out=canvas(layout.width,layout.height),cell=canvas(layout.cellW,layout.cellH)
 try{
  const ctx=out.getContext('2d')!
  for(let i=0;i<p.frames.length;i++){
   const frame=await loadChecked(load,p.frames[i].sourceIndex,sizes)
   try{paint(cell,frame,p.frames[i]);ctx.drawImage(cell,0,0,layout.cellW,layout.cellH,(i%p.columns)*layout.cellW,Math.floor(i/p.columns)*layout.cellH,layout.cellW,layout.cellH)}finally{frame.close()}
  }
  return await png(out)
 }finally{out.width=out.height=cell.width=cell.height=1}
}
export async function gifSheet(sizes:FrameSize[],p:SheetGif,load:SheetLoad){
 validateSheetCompose(p,sizes,true);const layout=sheetLayout(sizes,p,'gif'),cell=canvas(layout.gifWidth,layout.gifHeight)
 async function* frames(){
  for(const index of [...p.selected].sort((a,b)=>a-b)){
   const position=p.frames[index],frame=await loadChecked(load,position.sourceIndex,sizes)
   try{paint(cell,frame,position);yield cell.getContext('2d')!.getImageData(0,0,cell.width,cell.height)}finally{frame.close()}
  }
 }
 try{return await encodeBrowserGif(frames(),Math.round(Math.max(50,100/p.speedScale)))}finally{cell.width=cell.height=1}
}
/** Latest overlapping patch wins; pixels outside the reference or frame remain unchanged. */
export function fixSheetPixels(image:ImageData,p:SheetFix){
 for(const fix of p.fixes)for(let y=0;y<fix.range;y++)for(let x=0;x<fix.range;x++){
  const px=fix.imgX+x,py=fix.imgY+y
  if(px>=image.width||py>=image.height||px>=p.referenceWidth||py>=p.referenceHeight)continue
  image.data.set(fix.data.slice((y*fix.range+x)*4,(y*fix.range+x+1)*4),(py*image.width+px)*4)
 }
 return image
}
export async function fixSheet(sizes:FrameSize[],p:SheetFix,load:SheetLoad,original:(index:number)=>Blob){
 validateSheetFix(p,sizes);const zip=new JSZip(),selected=new Set(p.selected),cell=canvas(1,1);let encoded=0
 try{
  for(let i=0;i<sizes.length;i++){
   let blob=original(i)
   if(selected.has(i)){
    const frame=await loadChecked(load,i,sizes)
    try{
     cell.width=frame.width;cell.height=frame.height;const ctx=cell.getContext('2d')!;ctx.drawImage(frame.image,0,0)
     const image=ctx.getImageData(0,0,cell.width,cell.height);fixSheetPixels(image,p);ctx.putImageData(image,0,0);blob=await png(cell)
    }finally{frame.close()}
   }
   encoded+=blob.size;if(encoded>128*MIB)throw new Error('SHEET_ENCODED_LIMIT')
   zip.file(`frame_${String(i).padStart(3,'0')}.png`,blob)
  }
  const blob=await zip.generateAsync({type:'blob'});if(blob.size>128*MIB)throw new Error('SHEET_ENCODED_LIMIT');return blob
 }finally{cell.width=cell.height=1}
}

import JSZip from 'jszip'
import {adjustColBoundariesL7,adjustRowBoundariesL7,bandColOffsetBounds,detectAutoSplit,maxPolyDeltaX,splitByRegions,splitSpriteSheet,splitSpriteSheetSingleRowPolyline,splitSpriteSheetWithBandOffsets,uniformColStarts,uniformRowStarts,type Region,type SliceImage} from './customSliceAlgorithms'

export const MAX_CUSTOM_CELLS=4096
export type CustomPlanParameters={mode:'grid'|'auto';columns:number;rows:number;refine:'l7'|'uniform';bandPercent:number}
export type CustomPlan={formatVersion:1;width:number;height:number;columns:number;rows:number;colStarts:number[];rowStarts:number[];bandColOffset:number[];bendY:number;deltaX:number}
export type CustomLayout={mode:'grid';columns:number;rows:number}|{mode:'regions';regions:Region[]}|{mode:'bands';colStarts:number[];rowStarts:number[];bandColOffset:number[]}|{mode:'polyline';colStarts:number[];bendY:number;deltaX:number}
export type CustomCompose={rows:number;columns:number;grid:number[][];expandUp:number;expandDown:number;expandLeft:number;expandRight:number}
export type FrameSize={w:number;h:number}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const fields=(value:object,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi
const finite=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi
function dimensions(width:number,height:number){if(!integer(width,1,30000)||!integer(height,1,30000))throw new Error('CUSTOM_SOURCE_DIMENSIONS')}
export function validateCustomPlanParameters(value:unknown):asserts value is CustomPlanParameters{
 if(!object(value)||!fields(value,['mode','columns','rows','refine','bandPercent'])||!['grid','auto'].includes(String(value.mode))||!['l7','uniform'].includes(String(value.refine))||!integer(value.columns,1,64)||!integer(value.rows,1,64)||!integer(value.bandPercent,10,50))throw new Error('CUSTOM_PLAN_PARAMETERS')
}
function boundaries(value:unknown,total:number):asserts value is number[]{
 if(!Array.isArray(value)||value.length<2||value.length>MAX_CUSTOM_CELLS+1||value[0]!==0||value.at(-1)!==total||value.some((v,i)=>!integer(v,0,total)||i>0&&v<value[i-1]))throw new Error('CUSTOM_BOUNDARIES')
}
export function validateCustomLayout(value:unknown,width:number,height:number):asserts value is CustomLayout{
 dimensions(width,height)
 if(!object(value))throw new Error('CUSTOM_LAYOUT')
 if(value.mode==='grid'){
  if(!fields(value,['mode','columns','rows'])||!integer(value.columns,1,64)||!integer(value.rows,1,64))throw new Error('CUSTOM_GRID')
 }else if(value.mode==='regions'){
  if(!fields(value,['mode','regions'])||!Array.isArray(value.regions)||!value.regions.length||value.regions.length>MAX_CUSTOM_CELLS)throw new Error('CUSTOM_REGIONS')
  const ids=new Set<string>()
  for(const region of value.regions){
   if(!object(region)||!fields(region,['id','x','y','w','h'])||typeof region.id!=='string'||!/^[a-z\d-]{1,80}$/i.test(region.id)||ids.has(region.id)||!finite(region.x,0,width-Number.EPSILON)||!finite(region.y,0,height-Number.EPSILON)||Number(region.x)>=width||Number(region.y)>=height||!finite(region.w,1,30000)||!finite(region.h,1,30000))throw new Error('CUSTOM_REGION')
   ids.add(region.id)
  }
 }else if(value.mode==='bands'||value.mode==='polyline'){
  if(!fields(value,value.mode==='bands'?['mode','colStarts','rowStarts','bandColOffset']:['mode','colStarts','bendY','deltaX']))throw new Error('CUSTOM_SEAMS')
  boundaries(value.colStarts,width)
  if(value.mode==='bands'){
   boundaries(value.rowStarts,height)
   const count=value.rowStarts.length-1,{min,max}=bandColOffsetBounds(value.colStarts)
   if((value.colStarts.length-1)*count>MAX_CUSTOM_CELLS||!Array.isArray(value.bandColOffset)||value.bandColOffset.length!==count||value.bandColOffset.some(v=>!integer(v,min,max)))throw new Error('CUSTOM_BAND_OFFSET')
  }else if(!integer(value.bendY,0,height)||!integer(value.deltaX,-maxPolyDeltaX(value.colStarts,width),maxPolyDeltaX(value.colStarts,width)))throw new Error('CUSTOM_POLYLINE')
 }else throw new Error('CUSTOM_LAYOUT')
}
export function validateCustomPlan(value:unknown,width:number,height:number):asserts value is CustomPlan{
 if(!object(value)||!fields(value,['formatVersion','width','height','columns','rows','colStarts','rowStarts','bandColOffset','bendY','deltaX'])||value.formatVersion!==1||value.width!==width||value.height!==height||!integer(value.columns,1,MAX_CUSTOM_CELLS)||!integer(value.rows,1,MAX_CUSTOM_CELLS)||Number(value.rows)*Number(value.columns)>MAX_CUSTOM_CELLS||!Array.isArray(value.colStarts)||value.colStarts.length!==Number(value.columns)+1||!Array.isArray(value.rowStarts)||value.rowStarts.length!==Number(value.rows)+1||!Array.isArray(value.bandColOffset))throw new Error('CUSTOM_PLAN_RESULT')
 validateCustomLayout({mode:'bands',colStarts:value.colStarts,rowStarts:value.rowStarts,bandColOffset:value.bandColOffset},width,height)
 if(value.bendY!==Math.floor(height/2)||value.deltaX!==0||value.bandColOffset.some(v=>v!==0))throw new Error('CUSTOM_PLAN_RESULT')
}
export function computeCustomPlan(image:ImageData,p:CustomPlanParameters):CustomPlan{
 validateCustomPlanParameters(p);dimensions(image.width,image.height)
 let {columns,rows}=p
 if(p.mode==='auto'){const detected=detectAutoSplit(image);columns=detected.cols;rows=detected.rows}
 if(columns*rows>MAX_CUSTOM_CELLS)throw new Error('CUSTOM_CELL_LIMIT')
 const {width,height,data}=image,refine=p.refine==='l7'&&rows>1
 const plan:CustomPlan={formatVersion:1,width,height,columns,rows,colStarts:refine?adjustColBoundariesL7(data,width,height,columns,p.bandPercent/100):uniformColStarts(width,columns),rowStarts:refine?adjustRowBoundariesL7(data,width,height,rows,p.bandPercent/100):uniformRowStarts(height,rows),bandColOffset:Array.from({length:rows},()=>0),bendY:Math.floor(height/2),deltaX:0}
 validateCustomPlan(plan,width,height);return plan
}
export function customSliceSizes(width:number,height:number,layout:CustomLayout):FrameSize[]{
 validateCustomLayout(layout,width,height)
 if(layout.mode==='regions')return layout.regions.map(r=>({w:Math.max(1,Math.min(Math.floor(r.w),width-Math.floor(r.x))),h:Math.max(1,Math.min(Math.floor(r.h),height-Math.floor(r.y)))}))
 const cols=layout.mode==='grid'?uniformColStarts(width,layout.columns):layout.colStarts
 const rows=layout.mode==='grid'?uniformRowStarts(height,layout.rows):layout.mode==='bands'?layout.rowStarts:[0,height],sizes:FrameSize[]=[]
 for(let row=0;row<rows.length-1;row++)for(let col=0;col<cols.length-1;col++){
  const off=layout.mode==='bands'?layout.bandColOffset[row]:0
  const left=col===0?0:cols[col]+off,right=col===cols.length-2?width:cols[col+1]+off
  let w=Math.max(1,right-left),h=Math.max(1,rows[row+1]-rows[row])
  if(layout.mode==='polyline'){
   const xL=cols[col],xR=cols[col+1],d=layout.deltaX,L=layout.bendY
   w=xR-xL<1?1:L>=height?Math.max(1,Math.min(width,xR)-Math.max(0,xL)):Math.max(1,Math.min(width,Math.max(xL,xL+d,xR,xR+d))-Math.max(0,Math.min(xL,xL+d,xR,xR+d)));h=height
  }
  sizes.push({w,h})
 }
 return sizes
}
export function checkCustomSliceBudget(width:number,height:number,fileBytes:number,budget:number,frontendBytes:number,layout?:CustomLayout){
 dimensions(width,height)
 if(!integer(fileBytes,0,20*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3))throw new Error('CUSTOM_RESOURCE_PARAMETERS')
 const sizes=layout?customSliceSizes(width,height,layout):[],pixels=sizes.map(s=>s.w*s.h)
 const bytes=256*1024**2+width*height*40+fileBytes*8+frontendBytes+pixels.reduce((a,b)=>a+b,0)*16+Math.max(0,...pixels)*16
 if(bytes>budget)throw new Error('CUSTOM_RESOURCE_LIMIT')
 return bytes
}
export async function exportCustomSlices(image:SliceImage,layout:CustomLayout):Promise<Blob>{
 validateCustomLayout(layout,image.naturalWidth,image.naturalHeight)
 const frames=layout.mode==='grid'?splitSpriteSheet(image,layout.columns,layout.rows):layout.mode==='regions'?splitByRegions(image,layout.regions):layout.mode==='bands'?splitSpriteSheetWithBandOffsets(image,layout.colStarts,layout.rowStarts,layout.bandColOffset):splitSpriteSheetSingleRowPolyline(image,layout.colStarts,image.naturalHeight,layout.bendY,layout.deltaX)
 const zip=new JSZip()
 try{
  for(let i=0;i<frames.length;i++){
   const frame=frames[i],blob=await new Promise<Blob>((resolve,reject)=>frame.toBlob(b=>b?resolve(b):reject(new Error('CUSTOM_PNG_ENCODING')),'image/png'))
   zip.file(`frame_${String(i).padStart(3,'0')}.png`,blob);frame.width=1;frame.height=1
  }
  return await zip.generateAsync({type:'blob'})
 }finally{for(const frame of frames){frame.width=1;frame.height=1}}
}
export function validateCustomCompose(value:unknown,count:number):asserts value is CustomCompose{
 // The original 150px upward-only preset can require 149px padding even
 // though its manual number inputs stop at 128.
 if(!object(value)||!fields(value,['rows','columns','grid','expandUp','expandDown','expandLeft','expandRight'])||!integer(count,1,MAX_CUSTOM_CELLS)||!integer(value.rows,1,MAX_CUSTOM_CELLS)||!integer(value.columns,1,MAX_CUSTOM_CELLS)||Number(value.rows)*Number(value.columns)>MAX_CUSTOM_CELLS||!['expandUp','expandDown','expandLeft','expandRight'].every(key=>integer(value[key],0,149))||!Array.isArray(value.grid)||value.grid.length!==value.rows||value.grid.some(row=>!Array.isArray(row)||row.length!==value.columns||row.some(v=>!integer(v,-count,count))))throw new Error('CUSTOM_COMPOSE_LAYOUT')
}
export function customComposeSize(sizes:FrameSize[],p:CustomCompose){
 validateCustomCompose(p,sizes.length)
 if(sizes.some(s=>!integer(s.w,1,30000)||!integer(s.h,1,30000)))throw new Error('CUSTOM_FRAME_DIMENSIONS')
 const cellW=Math.max(...sizes.map(s=>s.w)),cellH=Math.max(...sizes.map(s=>s.h)),width=p.columns*(cellW+p.expandLeft+p.expandRight),height=p.rows*(cellH+p.expandUp+p.expandDown)
 dimensions(width,height);return {width,height,cellW,cellH}
}
export function checkCustomComposeBudget(sizes:FrameSize[],p:CustomCompose,archiveBytes:number,encodedBytes:number,budget:number,frontendBytes:number){
 const {width,height}=customComposeSize(sizes,p)
 if(!integer(archiveBytes,1,128*1024**2)||!integer(encodedBytes,1,128*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3))throw new Error('CUSTOM_RESOURCE_PARAMETERS')
 const bytes=256*1024**2+archiveBytes*4+encodedBytes*4+Math.max(...sizes.map(s=>s.w*s.h))*40+width*height*32+frontendBytes
 if(bytes>budget)throw new Error('CUSTOM_RESOURCE_LIMIT')
 return bytes
}
/** Inspect central-directory sizes before any ZIP member is inflated. */
export function inspectCustomZip(bytes:ArrayBuffer,budget:number){
 if(!integer(budget,1,2*1024**3)||bytes.byteLength<22||bytes.byteLength>128*1024**2)throw new Error('CUSTOM_ARCHIVE_LIMIT')
 const view=new DataView(bytes);let end=-1
 for(let at=bytes.byteLength-22;at>=Math.max(0,bytes.byteLength-65557);at--)if(view.getUint32(at,true)===0x06054b50&&at+22+view.getUint16(at+20,true)===bytes.byteLength){end=at;break}
 if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new Error('CUSTOM_ARCHIVE_UNSUPPORTED')
 const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),size=view.getUint32(end+12,true)
 if(count<1||count>MAX_CUSTOM_CELLS||view.getUint16(end+8,true)!==count||start+size!==end)throw new Error('CUSTOM_ARCHIVE_LIMIT')
 const names:string[]=[];let at=start,encodedBytes=0
 for(let index=0;index<count;index++){
  if(at+46>end||view.getUint32(at,true)!==0x02014b50)throw new Error('CUSTOM_ARCHIVE_INVALID')
  const len=view.getUint16(at+28,true),next=at+46+len+view.getUint16(at+30,true)+view.getUint16(at+32,true)
  if(next>end||view.getUint16(at+8,true)&1||![0,8].includes(view.getUint16(at+10,true))||![0,0x8000].includes((view.getUint32(at+38,true)>>>16)&0xf000)||view.getUint32(at+42,true)>=start)throw new Error('CUSTOM_ARCHIVE_ENTRY')
  const name=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,at+46,len))
  if(name!==`frame_${String(index).padStart(3,'0')}.png`)throw new Error('CUSTOM_ARCHIVE_NAMES')
  encodedBytes+=view.getUint32(at+24,true)
  if(encodedBytes>Math.min(128*1024**2,budget/8)||view.getUint32(at+20,true)===0xffffffff)throw new Error('CUSTOM_ARCHIVE_LIMIT')
  names.push(name);at=next
 }
 if(at!==end)throw new Error('CUSTOM_ARCHIVE_INVALID')
 return {names,encodedBytes}
}

/** Original right-aligned, vertically centered cell buffer; negative indices flip it. */
export async function composeCustomSlices(sizes:FrameSize[],p:CustomCompose,load:(index:number)=>Promise<{image:CanvasImageSource;close:()=>void}>):Promise<Blob>{
 const {width,height,cellW,cellH}=customComposeSize(sizes,p),canvas=document.createElement('canvas'),cell=document.createElement('canvas')
 canvas.width=width;canvas.height=height;cell.width=cellW;cell.height=cellH
 const ctx=canvas.getContext('2d')!,cctx=cell.getContext('2d')!;ctx.imageSmoothingEnabled=false;cctx.imageSmoothingEnabled=false
 try{
  for(let row=0;row<p.rows;row++)for(let col=0;col<p.columns;col++){
   const value=p.grid[row][col],index=Math.abs(value)-1;if(index<0)continue
   const loaded=await load(index),{w,h}=sizes[index],dx=col*(cellW+p.expandLeft+p.expandRight)+p.expandLeft,dy=row*(cellH+p.expandUp+p.expandDown)+p.expandUp
   try{cctx.clearRect(0,0,cellW,cellH);cctx.drawImage(loaded.image,0,0,w,h,Math.max(0,cellW-w),Math.max(0,Math.floor((cellH-h)/2)),w,h)
    if(value<0){ctx.save();ctx.translate(dx+cellW,dy);ctx.scale(-1,1);ctx.drawImage(cell,0,0,cellW,cellH,0,0,cellW,cellH);ctx.restore()}else ctx.drawImage(cell,dx,dy)
   }finally{loaded.close()}
  }
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('CUSTOM_PNG_ENCODING')),'image/png',.95))
 }finally{canvas.width=1;canvas.height=1;cell.width=1;cell.height=1}
}

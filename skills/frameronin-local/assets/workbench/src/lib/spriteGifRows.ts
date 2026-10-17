import JSZip from 'jszip'
import {customSliceSizes,type FrameSize} from './customSlice'
import {encodeBrowserGif} from './gifSequence'
export type SpriteGifLayout={columns:number;rows:number;order:number[];framesPerRow:number;duration:number}
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
export function validateSpriteGifLayout(value:unknown):asserts value is SpriteGifLayout{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('SPRITE_GIF_LAYOUT')
 const p=value as SpriteGifLayout
 if(Object.keys(p).sort().join(',')!=='columns,duration,framesPerRow,order,rows'||!integer(p.columns,1,64)||!integer(p.rows,1,64)||!integer(p.framesPerRow,1,128)||!integer(p.duration,20,500)
  ||!Array.isArray(p.order)||!p.order.length||p.order.length>4096||new Set(p.order).size!==p.order.length||p.order.some(v=>!integer(v,0,p.columns*p.rows-1)))throw new Error('SPRITE_GIF_LAYOUT')
}
export const spriteGifName=(row:number)=>`row_${String(row+1).padStart(2,'0')}.gif`
export function spriteGifRows(width:number,height:number,p:SpriteGifLayout){
 validateSpriteGifLayout(p)
 const sizes=customSliceSizes(width,height,{mode:'grid',columns:p.columns,rows:p.rows})
 return Array.from({length:Math.ceil(p.order.length/p.framesPerRow)},(_,row)=>{
  const indices=p.order.slice(row*p.framesPerRow,(row+1)*p.framesPerRow)
  return {indices,width:Math.max(...indices.map(i=>sizes[i].w)),height:Math.max(...indices.map(i=>sizes[i].h)),frames:indices.length,durationMs:Math.round(p.duration/10)*10}
 })
}
export function checkSpriteGifBudget(width:number,height:number,fileBytes:number,p:SpriteGifLayout,budget:number,frontendBytes:number){
 const rows=spriteGifRows(width,height,p)
 if(![width,height].every(v=>integer(v,1,30000))||!integer(fileBytes,1,20*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3))throw new Error('SPRITE_GIF_RESOURCE_PARAMETERS')
 const total=rows.reduce((n,r)=>n+r.width*r.height*r.frames,0),maximum=Math.max(...rows.map(r=>r.width*r.height))
 const bytes=256*1024**2+width*height*40+fileBytes*8+frontendBytes+maximum*64+total*8+rows.length*8192
 if(bytes>budget)throw new Error('SPRITE_GIF_RESOURCE_LIMIT')
 return bytes
}
/** The original encoder normalizes each row at top-left to its largest frame. */
export async function encodeSpriteGifRows(sizes:FrameSize[],p:SpriteGifLayout,load:(index:number)=>Promise<ImageData>){
 validateSpriteGifLayout(p)
 if(sizes.length!==p.columns*p.rows)throw new Error('SPRITE_GIF_SOURCE_FRAMES')
 const zip=new JSZip();let encodedBytes=0
 for(let start=0,row=0;start<p.order.length;start+=p.framesPerRow,row++){
  const indices=p.order.slice(start,start+p.framesPerRow),width=Math.max(...indices.map(i=>sizes[i].w)),height=Math.max(...indices.map(i=>sizes[i].h))
  async function* frames(){
   for(const index of indices){
    const frame=await load(index),size=sizes[index]
    if(frame.width!==size.w||frame.height!==size.h)throw new Error('SPRITE_GIF_FRAME_SIZE_CHANGED')
    if(frame.width===width&&frame.height===height){yield frame;continue}
    const normalized=new ImageData(width,height)
    for(let y=0;y<frame.height;y++)normalized.data.set(frame.data.subarray(y*frame.width*4,(y+1)*frame.width*4),y*width*4)
    yield normalized
   }
  }
  const blob=await encodeBrowserGif(frames(),p.duration);encodedBytes+=blob.size
  if(encodedBytes>128*1024**2)throw new Error('SPRITE_GIF_ENCODED_LIMIT')
  zip.file(spriteGifName(row),blob)
 }
 const blob=await zip.generateAsync({type:'blob'})
 if(blob.size>128*1024**2)throw new Error('SPRITE_GIF_ENCODED_LIMIT')
 return blob
}

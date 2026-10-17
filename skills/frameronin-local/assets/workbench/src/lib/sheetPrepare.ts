import JSZip from 'jszip'
import type {SheetProPreprocessOptions} from './sheetProPreprocess'
import type {FrameSize} from './customSlice'

export type SheetPreparation={mode:'whole'|'uniform';columns:number;rows:number}|{mode:'transparent'}
export const sheetPreprocessDefaults:SheetProPreprocessOptions={watermark:false,cropTop:0,cropBottom:0,cropLeft:0,cropRight:0,padTop:0,padRight:0,padBottom:0,padLeft:0,resizeEnabled:false,resizeW:256,resizeH:256,resizeKeepAspect:false,matteMode:'none',matteTolerance:80,matteFeather:5}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const cropFields=['cropTop','cropBottom','cropLeft','cropRight','padTop','padRight','padBottom','padLeft'] as const
export function validateSheetPreprocess(value:unknown):asserts value is SheetProPreprocessOptions{
 if(!object(value)||!fields(value,Object.keys(sheetPreprocessDefaults))||!['watermark','resizeEnabled','resizeKeepAspect'].every(k=>typeof value[k]==='boolean')||!cropFields.every(k=>finite(value[k],0,4096))||!finite(value.resizeW,1,8192)||!finite(value.resizeH,1,8192)||!['none','global','contiguous'].includes(String(value.matteMode))||!finite(value.matteTolerance,0,441)||!finite(value.matteFeather,0,64))throw new Error('SHEET_PREPROCESS_PARAMETERS')
}
/** The old UI may store fractional values that round to zero during processing. */
export function sheetPreprocessHasEffect(p:SheetProPreprocessOptions){return p.watermark||p.resizeEnabled||p.matteMode!=='none'||cropFields.some(k=>Math.round(p[k])>0)}
export function sheetPreprocessSize(width:number,height:number,p:SheetProPreprocessOptions){
 validateSheetPreprocess(p)
 const cropped={width:Math.max(1,width-Math.round(p.cropLeft)-Math.round(p.cropRight)),height:Math.max(1,height-Math.round(p.cropTop)-Math.round(p.cropBottom))}
 const padded={width:cropped.width+Math.round(p.padLeft)+Math.round(p.padRight),height:cropped.height+Math.round(p.padTop)+Math.round(p.padBottom)}
 const output=p.resizeEnabled?{width:Math.round(p.resizeW),height:Math.round(p.resizeH)}:padded
 return {cropped,padded,output}
}
export function checkSheetPreprocessBudget(width:number,height:number,fileBytes:number,p:SheetProPreprocessOptions,budget:number,frontend:number){
 const sizes=sheetPreprocessSize(width,height,p)
 if(!sheetPreprocessHasEffect(p))throw new Error('SHEET_PREPROCESS_NO_EFFECT')
 if(![width,height,...Object.values(sizes).flatMap(s=>[s.width,s.height])].every(v=>integer(v,1,30000))||!integer(fileBytes,1,20*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontend,0,2*1024**3))throw new Error('SHEET_PREPROCESS_RESOURCE_PARAMETERS')
 const maxPixels=Math.max(width*height,...Object.values(sizes).map(s=>s.width*s.height)),estimate=256*1024**2+width*height*16+maxPixels*192+fileBytes*12+frontend
 if(estimate>budget)throw new Error('SHEET_PREPROCESS_RESOURCE_LIMIT')
 return estimate
}
export function validateSheetPreparation(value:unknown):asserts value is SheetPreparation{
 if(!object(value)||!(value.mode==='transparent'?fields(value,['mode']):['whole','uniform'].includes(String(value.mode))&&fields(value,['mode','columns','rows'])&&integer(value.columns,1,value.mode==='whole'?64:32)&&integer(value.rows,1,value.mode==='whole'?4096:32)&&Number(value.columns)*Number(value.rows)<=4096))throw new Error('SHEET_PREPARATION_LAYOUT')
}
export function sheetPreparationSizes(width:number,height:number,p:SheetPreparation):FrameSize[]|null{
 validateSheetPreparation(p)
 if(!integer(width,1,30000)||!integer(height,1,30000))throw new Error('SHEET_PREPARATION_DIMENSIONS')
 if(p.mode==='transparent')return null
 const cw=Math.floor(width/p.columns),ch=Math.floor(height/p.rows)
 if(p.mode==='uniform'&&(!cw||!ch))throw new Error('SHEET_PREPARATION_DENSE_UNIFORM')
 return Array.from({length:p.columns*p.rows},(_,i)=>{const c=i%p.columns,r=Math.floor(i/p.columns);return p.mode==='uniform'?{w:cw,h:ch}:{w:Math.max(1,Math.floor((c+1)*width/p.columns)-Math.floor(c*width/p.columns)),h:Math.max(1,Math.floor((r+1)*height/p.rows)-Math.floor(r*height/p.rows))}})
}
export function checkSheetPrepareBudget(width:number,height:number,fileBytes:number,p:SheetPreparation,budget:number,frontend:number,resolved?:FrameSize[]){
 const declared=sheetPreparationSizes(width,height,p),sizes=resolved??declared
 // The service verifies provenance before dispatch: uploads are <=20 MiB;
 // controlled preprocessing PNGs may use the existing 128 MiB output limit.
 if(!integer(fileBytes,1,128*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontend,0,2*1024**3)||sizes&&(!sizes.length||sizes.length>4096||sizes.some(s=>!integer(s.w,1,30000)||!integer(s.h,1,30000))))throw new Error('SHEET_PREPARATION_RESOURCES')
 const estimate=256*1024**2+width*height*48+fileBytes*8+frontend+(sizes?.reduce((sum,s)=>sum+s.w*s.h*16,0)??0)
 if(estimate>budget)throw new Error('SHEET_PREPARATION_RESOURCE_LIMIT')
 return estimate
}
export async function prepareSheetGrid(image:CanvasImageSource,width:number,height:number,p:SheetPreparation){
 const sizes=sheetPreparationSizes(width,height,p);if(!sizes||p.mode==='transparent')throw new Error('SHEET_PREPARATION_GRID_REQUIRED')
 const zip=new JSZip(),c=document.createElement('canvas');let encoded=0
 try{
  for(let i=0;i<sizes.length;i++){
   const size=sizes[i],col=i%p.columns,row=Math.floor(i/p.columns),x=p.mode==='whole'?Math.floor(col*width/p.columns):col*size.w,y=p.mode==='whole'?Math.floor(row*height/p.rows):row*size.h
   c.width=size.w;c.height=size.h;c.getContext('2d')!.drawImage(image,x,y,size.w,size.h,0,0,size.w,size.h)
   const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('SHEET_PREPARATION_PNG')),'image/png'));encoded+=blob.size
   if(encoded>128*1024**2)throw new Error('SHEET_PREPARATION_ENCODED_LIMIT')
   zip.file(`frame_${String(i).padStart(3,'0')}.png`,blob)
  }
  const blob=await zip.generateAsync({type:'blob'});if(blob.size>128*1024**2)throw new Error('SHEET_PREPARATION_ENCODED_LIMIT');return blob
 }finally{c.width=c.height=1}
}

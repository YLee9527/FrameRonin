/// <reference lib="webworker" />
import JSZip from 'jszip'
import {inspectOrderedZip,boundedZipBlob} from './orderedZip'
import {fineEditorImageSize} from './fineEditorPixels'
import {checkSheetBudget,composeSheet,gifSheet,fixSheet,type SheetCompose,type SheetGif,type SheetFix,type SheetLoad} from './sheetAdjust'

Object.defineProperty(self,'document',{value:{createElement(name:string){
 if(name!=='canvas')throw new Error('SHEET_WORKER_ELEMENT')
 const c=new OffscreenCanvas(1,1)
 return Object.assign(c,{toBlob(callback:(b:Blob|null)=>void,type='image/png'){void c.convertToBlob({type}).then(callback).catch(()=>callback(null))}})
}}})
type Request={id:string;generation:number;file:Blob;operation:string;budgetBytes:number;parameters:{layout:SheetCompose|SheetGif|SheetFix;frontendBytes:number}}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const {id,generation,file,parameters:p,budgetBytes,operation}=event.data
 try{
  const action=operation==='image.sheetCompose'?'compose':operation==='image.sheetGif'?'gif':operation==='image.sheetFix'?'fix':null
  if(!action||!(file instanceof Blob)||!Number.isSafeInteger(budgetBytes)||budgetBytes<1||budgetBytes>2*1024**3||!Number.isSafeInteger(p.frontendBytes)||p.frontendBytes<0||256*1024**2+file.size*10+p.frontendBytes>budgetBytes)throw new Error('SHEET_ARCHIVE_RESOURCE_LIMIT')
  const bytes=await file.arrayBuffer(),{names,encodedBytes}=inspectOrderedZip(bytes,budgetBytes,i=>`frame_${String(i).padStart(3,'0')}.png`)
  if(256*1024**2+(file.size+encodedBytes)*10+p.frontendBytes>budgetBytes)throw new Error('SHEET_ARCHIVE_RESOURCE_LIMIT')
  const zip=await JSZip.loadAsync(bytes),files:Blob[]=[],sizes:{w:number;h:number}[]=[];let inflated=0
  for(const name of names){
   const blob=await boundedZipBlob(zip.file(name)!,encodedBytes-inflated);inflated+=blob.size
   const signature=new Uint8Array(await blob.slice(0,8).arrayBuffer())
   if(signature.join(',')!=='137,80,78,71,13,10,26,10')throw new Error('SHEET_ARCHIVE_PNG')
   const size=await fineEditorImageSize(blob);files.push(blob);sizes.push({w:size.width,h:size.height})
  }
  checkSheetBudget(sizes,p.layout,action,file.size+inflated,budgetBytes,p.frontendBytes)
  const load:SheetLoad=async index=>{const image=await createImageBitmap(files[index]);return {image,width:image.width,height:image.height,close:()=>image.close()}}
  self.postMessage({id,generation,phase:'processing'})
  const blob=action==='compose'?await composeSheet(sizes,p.layout as SheetCompose,load):action==='gif'?await gifSheet(sizes,p.layout as SheetGif,load):await fixSheet(sizes,p.layout as SheetFix,load,i=>files[i])
  if(blob.size>128*1024**2)throw new Error('SHEET_ENCODED_LIMIT')
  self.postMessage({id,generation,blob})
 }catch(error){self.postMessage({id,generation,error:String(error)})}
}

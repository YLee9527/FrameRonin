import JSZip, { type JSZipObject } from 'jszip'
import { validateMapZipBudget } from './mapArchiveFormat'
type SavedImage = {path?:string;dataUrl?:string;fileName?:string;type?:string}
// JSZip 3.10.1 exposes this browser stream API in zipObject.js, but omits it
// from JSZipObject's declarations. Bound actual emitted bytes before retaining.
type EntryStream = { on(event:'data',callback:(data:Uint8Array<ArrayBuffer>)=>void):EntryStream;
  on(event:'error',callback:(error:Error)=>void):EntryStream;on(event:'end',callback:()=>void):EntryStream;
  pause():EntryStream;resume():EntryStream }
function boundedEntry(entry:JSZipObject,limit:number):Promise<Blob>{
  return new Promise((resolve,reject)=>{
    const chunks:Uint8Array<ArrayBuffer>[]=[];let bytes=0;let rejected=false
    const stream=(entry as JSZipObject&{internalStream(type:'uint8array'):EntryStream}).internalStream('uint8array')
    stream.on('data',(chunk:Uint8Array<ArrayBuffer>)=>{
      bytes+=chunk.byteLength
      if(bytes>limit){rejected=true;stream.pause();reject(new Error('MAP_ARCHIVE_IMAGE_LIMIT'));return}
      chunks.push(chunk)
    }).on('error',reject).on('end',()=>{if(!rejected)resolve(new Blob(chunks))}).resume()
  })
}
self.onmessage=async(event:MessageEvent<{action:'read'|'write';file?:File;files?:Record<string,Blob>;state?:object;budgetBytes:number}>)=>{
  try{
    const {action,file,files,state,budgetBytes}=event.data
    if(!Number.isFinite(budgetBytes)||budgetBytes<=0)throw new Error('MAP_ARCHIVE_BUDGET_INVALID')
    if(action==='write'){
      const manifest=JSON.stringify(state,null,2)
      if(manifest.length>1024**2||Object.keys(files!).length>1001||manifest.length*4+Object.values(files!).reduce((bytes,file)=>bytes+file.size*6,0)>budgetBytes/4)throw new Error('MAP_ARCHIVE_RESOURCE_LIMIT')
      const zip=new JSZip()
      for(const [name,blob]of Object.entries(files!))zip.file(name,await blob.arrayBuffer())
      zip.file('map_stitch_state.json',manifest)
      self.postMessage({ok:true,result:await zip.generateAsync({type:'blob',compression:'STORE'})})
    }else{
      if(!file||file.size*4>budgetBytes/4)throw new Error('MAP_ARCHIVE_RESOURCE_LIMIT')
      const zipped=file.name.toLowerCase().endsWith('.zip')||file.type.includes('zip')
      let zip:JSZip|undefined
      if(zipped){const bytes=await file.arrayBuffer();validateMapZipBudget(bytes,budgetBytes);zip=await JSZip.loadAsync(bytes)}
      const entry=zip?.file('map_stitch_state.json')
      const manifest=zip?(entry?await(await boundedEntry(entry,1024**2)).text():undefined):await file.text()
      if(!manifest||manifest.length*4>budgetBytes/4)throw new Error('MAP_ARCHIVE_MANIFEST_MISSING_OR_LIMIT')
      const state=JSON.parse(manifest)
      if(!state||![1,2].includes(state.version)||!state.source||(state.tileUploads!==undefined&&(typeof state.tileUploads!=='object'||state.tileUploads===null||Array.isArray(state.tileUploads))))throw new Error('MAP_ARCHIVE_MANIFEST_INVALID')
      const selected:SavedImage[]=[state.source,...Object.values(state.tileUploads??{}) as SavedImage[]]
      if(selected.length>1001)throw new Error('MAP_ARCHIVE_RESOURCE_LIMIT')
      const images:Record<string,File>={};let retained=file.size*4+manifest.length*4
      for(const [index,image]of selected.entries()){
        if(!image||typeof image!=='object')throw new Error('MAP_ARCHIVE_IMAGE_INVALID')
        let blob:Blob
        if(image.dataUrl){
          const match=/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\s]+)$/.exec(image.dataUrl)
          if(!match||match[2].length*2+retained>budgetBytes/4)throw new Error('MAP_ARCHIVE_IMAGE_LIMIT')
          const decoded=atob(match[2]),bytes=new Uint8Array(decoded.length)
          for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i)
          blob=new Blob([bytes],{type:match[1]})
        }else{
          if(!image.path||!zip||!image.path.startsWith('images/')||image.path.split('/').includes('..'))throw new Error('MAP_ARCHIVE_PATH_INVALID')
          const entry=zip.file(image.path);if(!entry)throw new Error('MAP_ARCHIVE_IMAGE_MISSING')
          blob=await boundedEntry(entry,Math.min(30*1024**2,Math.floor((budgetBytes/4-retained)/4)))
        }
        retained+=blob.size*4;if(retained>budgetBytes/4||blob.size>30*1024**2)throw new Error('MAP_ARCHIVE_IMAGE_LIMIT')
        const key=`selected-${index}`
        images[key]=new File([blob],image.fileName||`tile-${index}.png`,{type:image.type||blob.type||'image/png'})
        delete image.dataUrl;image.path=key
      }
      self.postMessage({ok:true,result:{state,images}})
    }
  }catch(error){self.postMessage({ok:false,error:String(error)})}
}

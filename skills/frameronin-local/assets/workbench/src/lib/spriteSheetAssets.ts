export type SpritePreviewSize={w:number;h:number;frames:number}
export type SpriteAssetRequest={action:'gifArchive';file:Blob;rowCount:number}|{action:'preview';files:Blob[];sizes:SpritePreviewSize[]}
export type SpriteAssetResult={files:Blob[];previews:Blob[]}
export function spriteSheetAssets(request:SpriteAssetRequest,budgetBytes:number,frontendBytes:number,signal:AbortSignal):Promise<SpriteAssetResult>{
 signal.throwIfAborted();const id=crypto.randomUUID(),generation=0,worker=new Worker(new URL('./spriteSheetAssets.worker.ts',import.meta.url),{type:'module'})
 return new Promise((resolve,reject)=>{
  let settled=false
  const finish=(error:unknown,result?:SpriteAssetResult)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!)}
  const abort=()=>finish(new DOMException('Preview canceled','AbortError'));signal.addEventListener('abort',abort,{once:true})
  worker.onerror=e=>finish(new Error(e.message||'SPRITE_ASSET_WORKER'))
  worker.onmessage=e=>{const v=e.data;if(v?.id!==id||v?.generation!==generation)return
   if(v.error){finish(new Error(v.error));return}
   if(request.action==='gifArchive'&&Array.isArray(v.files)&&v.files.length>=1&&v.files.length<=4096&&v.files.length===request.rowCount&&v.files.every((f:unknown)=>f instanceof Blob&&f.type==='image/gif')&&v.files.reduce((sum:number,f:Blob)=>sum+f.size,0)<=128*1024**2){finish(null,{files:v.files,previews:[]});return}
   if(request.action==='preview'&&Array.isArray(v.previews)&&v.previews.length<=128&&v.previews.length===request.files.length&&v.previews.every((f:unknown)=>f instanceof Blob&&f.type==='image/png'&&f.size<=256*1024)){finish(null,{files:[],previews:v.previews});return}
   finish(new Error('SPRITE_ASSET_RESPONSE'))
  }
  worker.postMessage({id,generation,...request,budgetBytes,frontendBytes})
 })
}

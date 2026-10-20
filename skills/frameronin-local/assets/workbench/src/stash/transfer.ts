/** Copy a caller-owned preview before it can be unmounted. Only explicitly
 * transferred temporary URLs belong to the stash and may be revoked here. */
export async function materializeStashUrl(url:string,releaseSource=false):Promise<string>{
 if(!url.startsWith('blob:'))return url
 try{
  const response=await fetch(url);if(!response.ok)throw new Error('STASH_SOURCE_UNAVAILABLE')
  const blob=await response.blob()
  return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('STASH_READ_FAILED'));reader.readAsDataURL(blob)})
 }finally{if(releaseSource)URL.revokeObjectURL(url)}
}
export function stashTransferName(proposed:string,type:string){
 const extension=type==='image/jpeg'?'jpg':type==='image/webp'?'webp':type==='image/gif'?'gif':'png'
 return proposed.length>0&&proposed.length<=255&&!/[\\/]/.test(proposed)&&![...proposed].some(c=>c.charCodeAt(0)<32)&&new RegExp('\\.'+(extension==='jpg'?'jpe?g':extension)+'$','i').test(proposed)?proposed:'stash_'+Date.now()+'.'+extension
}

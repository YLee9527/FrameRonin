/** Compatibility import for the original rearrange_params.txt, not AI execution. */
export function parseRearrangeText(text:string,frameCount:number){
 if(text.length>256*1024||!Number.isSafeInteger(frameCount)||frameCount<0||frameCount>4096)throw new Error('CUSTOM_REARRANGE_TEXT_LIMIT')
 const parsed:unknown=JSON.parse(text)
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('CUSTOM_REARRANGE_TEXT')
 const p=parsed as Record<string,unknown>,corrections:string[]=[],axis=(v:unknown,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(1,Math.min(64,Math.floor(v))):fallback
 const rows=axis(p.rows,2),cols=axis(p.cols,4),raw=Array.isArray(p.grid)?p.grid:[]
 let corrected=0
 const grid=Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>{
  const value=Array.isArray(raw[r])?raw[r][c]:undefined,n=typeof value==='number'&&Number.isFinite(value)?Math.floor(value):0,next=Math.abs(n)<=frameCount?n:0
  if(value!==undefined&&value!==next)corrected++;return next
 }))
 if(p.rows!==undefined&&p.rows!==rows||p.cols!==undefined&&p.cols!==cols)corrections.push('CUSTOM_REARRANGE_AXES_NORMALIZED')
 if(corrected)corrections.push(`CUSTOM_REARRANGE_CELLS_NORMALIZED: ${corrected}`)
 if(raw.length>rows||raw.some(row=>Array.isArray(row)&&row.length>cols))corrections.push('CUSTOM_REARRANGE_EXTRA_CELLS_REMOVED')
 const unknown=Object.keys(p).filter(key=>!['rows','cols','grid'].includes(key));if(unknown.length)corrections.push('CUSTOM_REARRANGE_UNKNOWN_FIELDS_REMOVED: '+unknown.join(', '))
 return {rows,cols,grid,corrections}
}

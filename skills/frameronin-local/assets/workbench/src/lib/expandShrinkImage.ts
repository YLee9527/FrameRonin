export type ExpandShrinkParameters={columns:number;rows:number;cellWidth:number;cellHeight:number}
export function validateExpandShrinkParameters(p:ExpandShrinkParameters){
  if(![p.columns,p.rows].every(value=>Number.isSafeInteger(value)&&value>=1&&value<=64)
    ||![p.cellWidth,p.cellHeight].every(value=>Number.isSafeInteger(value)&&value>=1&&value<=512))throw new Error('EXPAND_SHRINK_PARAMETERS_INVALID')
}
export function checkExpandShrinkBudget(width:number,height:number,fileBytes:number,p:ExpandShrinkParameters,budget:number,frontendBytes:number){
  validateExpandShrinkParameters(p)
  const outWidth=p.columns*p.cellWidth,outHeight=p.rows*p.cellHeight
  if(![width,height,outWidth,outHeight].every(value=>Number.isSafeInteger(value)&&value>=1&&value<=30000)
    ||!Number.isSafeInteger(fileBytes)||fileBytes<0||!Number.isSafeInteger(frontendBytes)||frontendBytes<0
    ||!Number.isSafeInteger(budget)||budget<=0||budget>2*1024**3
    ||256*1024**2+width*height*40+outWidth*outHeight*40+fileBytes*8+frontendBytes>budget)throw new Error('EXPAND_SHRINK_RESOURCE_LIMIT')
}

/** Original fractional Canvas coordinates and default smoothing are intentional.
 * Each source cell is center-cropped or padded; it is never scaled to fit. */
export async function expandShrinkImage(img:{native:CanvasImageSource;naturalWidth:number;naturalHeight:number},p:ExpandShrinkParameters):Promise<Blob>{
  validateExpandShrinkParameters(p)
  const fullW=img.naturalWidth,fullH=img.naturalHeight,colsNum=p.columns,rowsNum=p.rows,cellW=p.cellWidth,cellH=p.cellHeight
  const cellSrcW=fullW/colsNum,cellSrcH=fullH/rowsNum
  const out=document.createElement('canvas');out.width=colsNum*cellW;out.height=rowsNum*cellH
  const ctx=out.getContext('2d')!
  for(let row=0;row<rowsNum;row++)for(let col=0;col<colsNum;col++){
    const sx=col*fullW/colsNum,sy=row*fullH/rowsNum
    const cropW=Math.min(cellW,Math.floor(cellSrcW)),cropH=Math.min(cellH,Math.floor(cellSrcH))
    const srcX=sx+Math.max(0,(cellSrcW-cropW)/2),srcY=sy+Math.max(0,(cellSrcH-cropH)/2)
    const dx=col*cellW+Math.max(0,(cellW-cropW)/2),dy=row*cellH+Math.max(0,(cellH-cropH)/2)
    ctx.drawImage(img.native,srcX,srcY,cropW,cropH,dx,dy,cropW,cropH)
  }
  return new Promise((resolve,reject)=>out.toBlob(blob=>blob?resolve(blob):reject(new Error('EXPAND_SHRINK_PNG_FAILED')),'image/png',.95))
}

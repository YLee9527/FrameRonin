/** Original GIF workbench crop/expand/center composition. Keep half-pixel
 * placement; integer rounding would change alignment of differently sized frames. */
export type SequenceCombineParameters = { columns: number; cropTop: number; cropBottom: number; cropLeft: number; cropRight: number }
export async function combineSequenceImages(selected: HTMLImageElement[], parameters: SequenceCombineParameters): Promise<Blob> {
  const imgs: HTMLImageElement[] = []
  const top = parameters.cropTop
  const bottom = parameters.cropBottom
  const left = parameters.cropLeft
  const right = parameters.cropRight
  let maxW = 0
  let maxH = 0
  for (const img of selected) {
    // 正数=裁切，负数=扩边（增加透明像素）
    const sw = Math.max(1, img.naturalWidth - left - right)
    const sh = Math.max(1, img.naturalHeight - top - bottom)
    maxW = Math.max(maxW, sw)
    maxH = Math.max(maxH, sh)
    imgs.push(img)
  }
  const cols = Math.max(1, Math.floor(parameters.columns))
  const rows = Math.ceil(imgs.length / cols)
  const outW = cols * maxW
  const outH = rows * maxH
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  // 不填充背景，保持透明
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i]!
    const sw = Math.max(1, img.naturalWidth - left - right)
    const sh = Math.max(1, img.naturalHeight - top - bottom)
    const r = Math.floor(i / cols)
    const c = i % cols
    const dx = c * maxW + (maxW - sw) / 2
    const dy = r * maxH + (maxH - sh) / 2
    // 正数=从边缘裁切，负数=扩边时源区从 (0,0) 开始，目标偏移
    const sx = Math.max(0, left)
    const sy = Math.max(0, top)
    const srcW = Math.max(1, img.naturalWidth - Math.max(0, left) - Math.max(0, right))
    const srcH = Math.max(1, img.naturalHeight - Math.max(0, top) - Math.max(0, bottom))
    const offsetX = Math.max(0, -left)
    const offsetY = Math.max(0, -top)
    // 始终按 1:1 绘制，避免拉伸变形。sw/sh 为格子尺寸（含扩边），实际绘制用 srcW/srcH
    ctx.drawImage(img, sx, sy, srcW, srcH, dx + offsetX, dy + offsetY, srcW, srcH)
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png')
  })
  return blob
}

export async function sliceSequenceImage(image: HTMLImageElement, rows: number, columns: number): Promise<Blob[]> {
  const cellWidth = Math.floor(image.naturalWidth / columns), cellHeight = Math.floor(image.naturalHeight / rows)
  if (!cellWidth || !cellHeight || rows * columns > 1000) throw new Error('SEQUENCE_SLICE_LIMIT')
  const canvas = document.createElement('canvas'); canvas.width = cellWidth; canvas.height = cellHeight
  const context = canvas.getContext('2d')!, outputs: Blob[] = []
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    context.clearRect(0, 0, cellWidth, cellHeight)
    context.drawImage(image, column * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight)
    outputs.push(await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG_ENCODE_FAILED')), 'image/png')))
  }
  return outputs
}

export async function stitchSequenceImages(imgs: HTMLImageElement[], direction: 'vertical' | 'horizontal' | 'overlay'): Promise<Blob> {
  const isVertical = direction === 'vertical'
  const isOverlay = direction === 'overlay'
  let outW: number
  let outH: number
  if (isOverlay) {
    outW = Math.max(...imgs.map((i) => i.naturalWidth))
    outH = Math.max(...imgs.map((i) => i.naturalHeight))
  } else if (isVertical) {
    outW = Math.max(...imgs.map((i) => i.naturalWidth))
    outH = imgs.reduce((s, i) => s + i.naturalHeight, 0)
  } else {
    outW = imgs.reduce((s, i) => s + i.naturalWidth, 0)
    outH = Math.max(...imgs.map((i) => i.naturalHeight))
  }
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  let dx = 0
  let dy = 0
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i]!
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (isOverlay) {
      dx = (outW - w) / 2
      dy = (outH - h) / 2
      ctx.drawImage(img, 0, 0, w, h, dx, dy, w, h)
    } else if (isVertical) {
      dx = (outW - w) / 2
      drawCenteredTranslation(ctx,img,w,h,dx,dy)
      dy += h
    } else {
      dy = (outH - h) / 2
      drawCenteredTranslation(ctx,img,w,h,dx,dy)
      dx += w
    }
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png')
  })
  return blob
}

function drawCenteredTranslation(context:CanvasRenderingContext2D,image:HTMLImageElement,width:number,height:number,x:number,y:number){
  if(Number.isInteger(x)&&Number.isInteger(y)){context.drawImage(image,0,0,width,height,x,y,width,height);return}
  // Each horizontal/vertical strip occupies disjoint pixels. Browser Canvas
  // translates half-pixel centers in associated RGBA8; the pinned native Skia
  // round-half-up path differs by two unassociated RGB levels at alpha 192.
  // Explicit RGBA8 clamping keeps ties-to-even without rounding placement.
  const source=document.createElement('canvas');source.width=width;source.height=height
  const sourceContext=source.getContext('2d')!;sourceContext.drawImage(image,0,0)
  const pixels=sourceContext.getImageData(0,0,width,height).data
  const left=Math.floor(x),top=Math.floor(y),fractionX=x-left,fractionY=y-top
  const outWidth=width+(fractionX?1:0),outHeight=height+(fractionY?1:0)
  const result=context.createImageData(outWidth,outHeight),clamp=new Uint8ClampedArray(1)
  const byte=(value:number)=>{clamp[0]=value;return clamp[0]}
  for(let row=0;row<outHeight;row++)for(let column=0;column<outWidth;column++){
    const rgba=[0,0,0,0]
    for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){
      const ix=column-sx,iy=row-sy
      if(ix<0||iy<0||ix>=width||iy>=height)continue
      const weight=(sx?fractionX:1-fractionX)*(sy?fractionY:1-fractionY)
      const index=(iy*width+ix)*4,alpha=pixels[index+3]
      rgba[3]+=alpha*weight
      for(let channel=0;channel<3;channel++)rgba[channel]+=byte(pixels[index+channel]*alpha/255)*weight
    }
    const index=(row*outWidth+column)*4,alpha=byte(rgba[3]);result.data[index+3]=alpha
    for(let channel=0;channel<3;channel++)result.data[index+channel]=alpha?byte(byte(rgba[channel])*255/alpha):0
  }
  context.putImageData(result,left,top)
}

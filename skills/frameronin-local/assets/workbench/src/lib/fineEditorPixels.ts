export type PixelRect={x:number;y:number;w:number;h:number}

/** Same integer circle as the original stamp, with only a bounded pixel read. */
export function stampFineCircle(context:Pick<CanvasRenderingContext2D,'getImageData'|'putImageData'>,width:number,height:number,px:number,py:number,size:number,rgb:number[]|null){
  const radius=size/2,rad=Math.ceil(radius)
  const left=Math.max(0,px-rad),top=Math.max(0,py-rad),right=Math.min(width-1,px+rad),bottom=Math.min(height-1,py+rad)
  const region=context.getImageData(left,top,right-left+1,bottom-top+1)
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    if((x-px)**2+(y-py)**2>radius*radius)continue
    const index=((y-top)*region.width+x-left)*4
    if(rgb){region.data[index]=rgb[0];region.data[index+1]=rgb[1];region.data[index+2]=rgb[2];region.data[index+3]=255}
    else region.data[index+3]=0
  }
  context.putImageData(region,left,top)
}

/** Original four-connected RGB-distance eraser; transparent pixels are barriers. */
export function eraseConnected(pixels:Uint8ClampedArray,width:number,height:number,x:number,y:number,tolerance:number){
  const start=y*width+x,offset=start*4
  if(pixels[offset+3]===0)return
  const r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2],limit=tolerance*tolerance
  const visited=new Uint8Array(width*height),stack=new Uint32Array(width*height)
  let length=1;stack[0]=start;visited[start]=1
  while(length){
    const index=stack[--length],px=index%width,py=Math.floor(index/width)
    pixels[index*4+3]=0
    // Keep the original neighbor order. Each accepted pixel is pushed once.
    for(const neighbor of [py>0?index-width:-1,px+1<width?index+1:-1,py+1<height?index+width:-1,px>0?index-1:-1]){
      if(neighbor<0||visited[neighbor]||pixels[neighbor*4+3]===0)continue
      const at=neighbor*4
      if((pixels[at]-r)**2+(pixels[at+1]-g)**2+(pixels[at+2]-b)**2<=limit){visited[neighbor]=1;stack[length++]=neighbor}
    }
  }
}

/** Move the original RGBA selection, clearing its old rectangle before blitting. */
export function movePixelSelection(pixels:Uint8ClampedArray,width:number,height:number,rect:PixelRect,dx:number,dy:number){
  const x=Math.max(0,Math.min(rect.x+dx,width-rect.w)),y=Math.max(0,Math.min(rect.y+dy,height-rect.h))
  if(x===rect.x&&y===rect.y)return {...rect}
  const chunk=new Uint8ClampedArray(rect.w*rect.h*4),stride=rect.w*4
  for(let row=0;row<rect.h;row++){
    const start=((rect.y+row)*width+rect.x)*4
    chunk.set(pixels.subarray(start,start+stride),row*stride);pixels.fill(0,start,start+stride)
  }
  for(let row=0;row<rect.h;row++)pixels.set(chunk.subarray(row*stride,(row+1)*stride),((y+row)*width+x)*4)
  return {...rect,x,y}
}

/** Read bounded headers before decoding; these are the workbench's accepted formats. */
export async function fineEditorImageSize(file:Blob){
  const bytes=new Uint8Array(await file.slice(0,1024*1024).arrayBuffer()),view=new DataView(bytes.buffer)
  let width=0,height=0
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)){
    width=view.getUint32(16);height=view.getUint32(20)
  }else if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216){
    let at=2
    while(at+4<=bytes.length){
      if(bytes[at++]!==255)break
      while(bytes[at]===255)at++
      const marker=bytes[at++]
      if(marker===217||marker===218)break
      if(marker===1||marker>=208&&marker<=215)continue
      if(at+2>bytes.length)break
      const length=view.getUint16(at)
      if(length<2||at+length>bytes.length)break
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=view.getUint16(at+3);width=view.getUint16(at+5);break}
      at+=length
    }
  }else if(bytes.length>=30&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP'){
    const format=String.fromCharCode(...bytes.subarray(12,16))
    if(format==='VP8X'){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)}
    else if(format==='VP8L'&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1}
    else if(format==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383}
  }
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30000||height>30000)throw new Error('FINE_EDITOR_IMAGE_HEADER_INVALID')
  return {width,height}
}

export function checkFineEditorBudget(width:number,height:number,fileBytes:number,budget:number,retained=0){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30000||height>30000||!Number.isFinite(budget)||budget<=0
    ||!Number.isSafeInteger(fileBytes)||fileBytes<0||!Number.isSafeInteger(retained)||retained<0||width*height*40+fileBytes*2+retained+96*1024**2>budget)throw new Error('FINE_EDITOR_RESOURCE_LIMIT')
}

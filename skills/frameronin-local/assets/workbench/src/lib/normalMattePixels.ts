/** Original RGB-distance rule; feather replaces alpha only within its band. */
export function normalChromaPixels(data:Uint8ClampedArray,r:number,g:number,b:number,tolerance:number,feather:number){
  for(let i=0;i<data.length;i+=4){
    const distance=Math.sqrt((data[i]-r)**2+(data[i+1]-g)**2+(data[i+2]-b)**2)
    if(distance<=tolerance)data[i+3]=0
    else if(feather>0&&distance<tolerance+feather)data[i+3]=Math.round(255*Math.min(1,(distance-tolerance)/feather))
  }
}

/** Four-connected flood from (0,0), with the original RGB-only match rule.
 * Fixed arrays replace sets/coordinate tuples; each pixel is considered once. */
export function normalContiguousPixels(data:Uint8ClampedArray,width:number,height:number,r:number,g:number,b:number,tolerance:number){
  const match=(index:number)=>{const i=index*4;return Math.sqrt((data[i]-r)**2+(data[i+1]-g)**2+(data[i+2]-b)**2)<=tolerance}
  if(!match(0))return
  const visited=new Uint8Array(width*height),stack=new Uint32Array(width*height)
  let size=1;stack[0]=0;visited[0]=1
  while(size){
    const index=stack[--size],x=index%width,y=Math.floor(index/width);data[index*4+3]=0
    for(const next of [y>0?index-width:-1,x+1<width?index+1:-1,y+1<height?index+width:-1,x>0?index-1:-1]){
      if(next<0||visited[next])continue
      visited[next]=1;if(match(next))stack[size++]=next
    }
  }
}

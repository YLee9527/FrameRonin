export type VideoCrop={left:number;top:number;right:number;bottom:number}
export type VideoCropHandle='n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'|'move'
export function videoCropHit(w:number,h:number,c:VideoCrop,x:number,y:number):VideoCropHandle|null{
 const r=w-c.left-c.right,b=h-c.top-c.bottom,hs=12,{left,top}=c
 if(x>=left-hs&&x<=left+hs&&y>=top-hs&&y<=top+hs)return 'nw'
 if(x>=left+r-hs&&x<=left+r+hs&&y>=top-hs&&y<=top+hs)return 'ne'
 if(x>=left-hs&&x<=left+hs&&y>=top+b-hs&&y<=top+b+hs)return 'sw'
 if(x>=left+r-hs&&x<=left+r+hs&&y>=top+b-hs&&y<=top+b+hs)return 'se'
 if(x>=left-hs&&x<=left+hs&&y>=top&&y<=top+b)return 'w'
 if(x>=left+r-hs&&x<=left+r+hs&&y>=top&&y<=top+b)return 'e'
 if(x>=left&&x<=left+r&&y>=top-hs&&y<=top+hs)return 'n'
 if(x>=left&&x<=left+r&&y>=top+b-hs&&y<=top+b+hs)return 's'
 return x>=left&&x<=left+r&&y>=top&&y<=top+b?'move':null
}
/** Original eight-handle crop geometry, including its one-pixel move margin. */
export function videoCropDrag(w:number,h:number,c:VideoCrop,handle:VideoCropHandle,dx:number,dy:number):VideoCrop{
 let {left,top,right,bottom}=c
 if(handle==='move'){
  const cw=w-left-right,ch=h-top-bottom
  left=Math.max(0,Math.min(w-cw-1,left+dx));top=Math.max(0,Math.min(h-ch-1,top+dy));right=w-left-cw;bottom=h-top-ch
 }else{
  if(handle.includes('w'))left=Math.max(0,Math.min(w-c.right-1,c.left+dx))
  if(handle.includes('e'))right=Math.max(0,Math.min(w-c.left-1,c.right-dx))
  if(handle.includes('n'))top=Math.max(0,Math.min(h-c.bottom-1,c.top+dy))
  if(handle.includes('s'))bottom=Math.max(0,Math.min(h-c.top-1,c.bottom-dy))
 }
 return {left,top,right,bottom}
}

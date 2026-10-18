/** ParamsStep frame semantics. Decode, pixel loops and encoding run in a Worker. */
export type VideoFrameSize={w:number;h:number}
export type VideoFrameLayout=
 |{mode:'analyze'}
 |{mode:'select';selected:number[]}
 |{mode:'matte';selected:number[];background:string;tolerance:number;feather:number;mask:boolean}
 |{mode:'compose';width:number;height:number;padding:number;spacing:number;columns:number;timestamps:number[];strokeWidth:number;strokeColor:string}
 |{mode:'archive';selected:number[];kind:'extracted'|'matted'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const finite=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi
const integer=(v:unknown,lo:number,hi:number)=>finite(v,lo,hi)&&Number.isSafeInteger(v)
const color=(v:unknown)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)
function selection(v:unknown,count:number):asserts v is number[]{
 if(!Array.isArray(v)||!v.length||v.length>count||v.some((n,i)=>!integer(n,0,count-1)||i>0&&n<=v[i-1]))throw new Error('VIDEO_FRAME_SELECTION')
}
export function validateVideoFrameLayout(sizes:VideoFrameSize[],value:unknown):asserts value is VideoFrameLayout{
 if(!sizes.length||sizes.length>2000||sizes.some(s=>!integer(s.w,1,30000)||!integer(s.h,1,30000))||!object(value))throw new Error('VIDEO_FRAME_LAYOUT')
 if(value.mode==='analyze'&&fields(value,['mode']))return
 if(value.mode==='select'&&fields(value,['mode','selected'])){selection(value.selected,sizes.length);return}
 if(value.mode==='archive'&&fields(value,['mode','selected','kind'])&&['extracted','matted'].includes(String(value.kind))){selection(value.selected,sizes.length);return}
 if(value.mode==='matte'&&fields(value,['mode','selected','background','tolerance','feather','mask'])&&color(value.background)&&finite(value.tolerance,1,100)&&finite(value.feather,0,30)&&typeof value.mask==='boolean'){selection(value.selected,sizes.length);return}
 if(value.mode==='compose'&&fields(value,['mode','width','height','padding','spacing','columns','timestamps','strokeWidth','strokeColor'])
  &&finite(value.width,1,30000)&&finite(value.height,1,30000)&&finite(value.padding,0,64)&&finite(value.spacing,0,64)&&integer(value.columns,1,64)
  &&Array.isArray(value.timestamps)&&value.timestamps.length===sizes.length&&value.timestamps.every(t=>finite(t,0,86400))&&finite(value.strokeWidth,0,16)&&color(value.strokeColor)){
  const p=value as VideoFrameLayout&{mode:'compose'},w=Math.floor(p.columns*(p.width+p.spacing)-p.spacing),h=Math.floor(Math.ceil(sizes.length/p.columns)*(p.height+p.spacing)-p.spacing)
  if(!integer(w,1,30000)||!integer(h,1,30000))throw new Error('VIDEO_FRAME_SHEET_SIZE')
  return
 }
 throw new Error('VIDEO_FRAME_LAYOUT')
}
export function videoFramePlan(sizes:VideoFrameSize[],layout:VideoFrameLayout,encodedBytes:number,frontendBytes:number,budget:number,mask?:VideoFrameSize){
 validateVideoFrameLayout(sizes,layout)
 if(!integer(budget,1,2*1024**3)||!integer(encodedBytes,1,256*1024**2)||!integer(frontendBytes,0,2*1024**3))throw new Error('VIDEO_FRAME_BUDGET')
 if(!!mask!==(layout.mode==='matte'&&layout.mask)||mask&&(!integer(mask.w,1,30000)||!integer(mask.h,1,30000)))throw new Error('VIDEO_FRAME_MASK')
 const selected=layout.mode==='matte'||layout.mode==='archive'||layout.mode==='select'?layout.selected:sizes.map((_,i)=>i)
 const width=layout.mode==='compose'?Math.floor(layout.columns*(layout.width+layout.spacing)-layout.spacing):0
 const height=layout.mode==='compose'?Math.floor(Math.ceil(sizes.length/layout.columns)*(layout.height+layout.spacing)-layout.spacing):0
 const maxPixels=Math.max(...sizes.map(s=>s.w*s.h),mask?mask.w*mask.h:0,layout.mode==='compose'?Math.ceil(layout.width)*Math.ceil(layout.height):0)
 const outputPixels=layout.mode==='compose'?width*height:layout.mode==='matte'?selected.reduce((n,i)=>n+sizes[i].w*sizes[i].h,0):0
 const estimatedBytes=256*1024**2+encodedBytes*12+maxPixels*96+outputPixels*32+frontendBytes
 if(!Number.isSafeInteger(estimatedBytes)||estimatedBytes>budget)throw new Error('VIDEO_FRAME_RESOURCE_LIMIT')
 return {estimatedBytes,width,height,outputFrames:layout.mode==='compose'?1:layout.mode==='analyze'?0:selected.length,selected}
}
/** Repeated addition matches the original capture loop at floating boundaries. */
export function videoTimestamps(start:number,end:number,fps:number,maxFrames:number){
 if(!finite(start,0,86400)||!finite(end,0,86400)||end<=start||!finite(fps,1,60)||!integer(maxFrames,1,2000))throw new Error('VIDEO_CAPTURE_RANGE')
 const result:number[]=[];for(let t=start;t<end&&result.length<maxFrames;t+=1/fps)result.push(t)
 return result
}
export function sampleVideoSelection(selected:number[],start:number,end:number,step:number){
 if(!selected.length||![start,end,step].every(Number.isSafeInteger))throw new Error('VIDEO_SAMPLE_RANGE')
 const a=Math.max(1,Math.min(start,selected.length)),b=Math.max(1,Math.min(end,selected.length)),slice=selected.slice(Math.min(a,b)-1,Math.max(a,b))
 return slice.filter((_,i)=>i%Math.max(1,step)===0)
}
export function videoFingerprint(data:Uint8ClampedArray){
 let h1=0,h2=0
 // Preserve the original sparse hash, including its final short-group coercion.
 for(let i=0;i<data.length;i+=16){h1=((h1<<5)-h1+data[i]+data[i+1]+data[i+2]+data[i+3])|0;h2=((h2<<3)+h2+data[i+4]+data[i+5]+data[i+6]+data[i+7])|0}
 return `${h1}_${h2}`
}
export function videoDuplicateMarkers(hashes:string[]){
 const groups=new Map<string,number[]>();hashes.forEach((h,i)=>{const row=groups.get(h)??[];row.push(i);groups.set(h,row)})
 const result:{index:number;groupId:number;totalInGroup:number}[]=[];let groupId=0
 for(const indices of groups.values())if(indices.length>1){indices.forEach(index=>result.push({index,groupId,totalInGroup:indices.length}));groupId++}
 return result
}
/** Same eight-neighbour distance/alpha rule; a bounded queue avoids shift(). */
export function videoInnerStroke(data:Uint8ClampedArray,w:number,h:number,width:number,color:string){
 if(width<=0)return
 const dist=new Uint16Array(w*h),queue=new Uint32Array(w*h),stroked=new Uint8Array(w*h),rgb=[1,3,5].map(at=>parseInt(color.slice(at,at+2),16))
 let head=0,tail=0
 for(let i=0;i<dist.length;i++){dist[i]=data[i*4+3]<=5?0:65535;if(dist[i]===0)queue[tail++]=i}
 const dx=[-1,-1,-1,0,0,1,1,1],dy=[-1,0,1,-1,1,-1,0,1]
 while(head<tail){const index=queue[head++],x=index%w,y=Math.floor(index/w);for(let k=0;k<8;k++){
  const nx=x+dx[k],ny=y+dy[k];if(nx<0||nx>=w||ny<0||ny>=h)continue
  const next=ny*w+nx;if(dist[next]!==65535)continue;dist[next]=dist[index]+1;queue[tail++]=next
 }}
 for(let i=0;i<dist.length;i++)if(dist[i]>=1&&dist[i]<=width){data.set([...rgb,255],i*4);stroked[i]=1}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,a=data[i*4+3];if(a>0&&a<=5)for(let k=0;k<8;k++)if(stroked[(y+dy[k])*w+x+dx[k]]){data.set([...rgb,255],i*4);break}}
}

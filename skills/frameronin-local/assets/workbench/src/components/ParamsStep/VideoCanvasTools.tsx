import {useEffect,useId,useRef,useState,type PointerEvent} from 'react'
import {message} from 'antd'
import {useLanguage} from '../../i18n/context'
import {videoCropDrag,videoCropHit,type VideoCrop,type VideoCropHandle} from '../../lib/videoInteraction'
import type {VideoFrameSize} from '../../lib/videoFrameTools'
import type {VideoStroke} from '../../lib/videoAssets'
const coordinates=(svg:SVGSVGElement,size:VideoFrameSize,x:number,y:number):[number,number]=>{const r=svg.getBoundingClientRect();return[Math.round((x-r.left)*size.w/r.width),Math.round((y-r.top)*size.h/r.height)]}
export function VideoCropEditor({url,size,crop,onChange,label}:{url:string;size:VideoFrameSize;crop:VideoCrop;onChange:(v:VideoCrop)=>void;label:string}){
 const svg=useRef<SVGSVGElement>(null),drag=useRef<{handle:VideoCropHandle;x:number;y:number;crop:VideoCrop}|null>(null)
 const width=Math.max(1,size.w-crop.left-crop.right),height=Math.max(1,size.h-crop.top-crop.bottom)
 const handles:[VideoCropHandle,number,number][]=[['nw',crop.left,crop.top],['n',crop.left+width/2,crop.top],['ne',crop.left+width,crop.top],['w',crop.left,crop.top+height/2],['e',crop.left+width,crop.top+height/2],['sw',crop.left,crop.top+height],['s',crop.left+width/2,crop.top+height],['se',crop.left+width,crop.top+height]]
 const keyboard=(handle:VideoCropHandle,event:React.KeyboardEvent)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();onChange(videoCropDrag(size.w,size.h,crop,handle,event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0))}
 return <svg ref={svg} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-label={label} role="group" tabIndex={0} style={{width:'100%',maxWidth:640,height:'auto',display:'block',touchAction:'none',cursor:'crosshair'}}
  onPointerDown={e=>{if(e.button!==0)return;const [x,y]=coordinates(e.currentTarget,size,e.clientX,e.clientY),handle=videoCropHit(size.w,size.h,crop,x,y);if(handle){drag.current={handle,x,y,crop};e.currentTarget.setPointerCapture(e.pointerId)}}}
  onPointerMove={e=>{const d=drag.current;if(!d)return;const[x,y]=coordinates(e.currentTarget,size,e.clientX,e.clientY);onChange(videoCropDrag(size.w,size.h,d.crop,d.handle,x-d.x,y-d.y))}}
  onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{drag.current=null}}>
  <image href={url} width={size.w} height={size.h} preserveAspectRatio="none"/>
  <path d={`M0 0H${size.w}V${size.h}H0Z M${crop.left} ${crop.top}v${height}h${width}v${-height}Z`} fill="black" fillOpacity={.45} fillRule="evenodd" pointerEvents="none"/>
  <rect x={crop.left} y={crop.top} width={width} height={height} stroke="#ff9f0a" fill="transparent" strokeWidth={1} role="button" aria-label={`${label} move`} tabIndex={0} onKeyDown={e=>keyboard('move',e)}/>
  {handles.map(([handle,x,y])=><rect key={handle} x={x-4} y={y-4} width={8} height={8} fill="white" stroke="#ff9f0a" strokeWidth={1} role="button" aria-label={`${label} ${handle}`} tabIndex={0} onKeyDown={e=>keyboard(handle,e)}/>)}
 </svg>
}
export function VideoBrushEditor({url,size,brushSize,disabled,onCommit,label}:{url:string;size:VideoFrameSize;brushSize:number;disabled:boolean;onCommit:(s:VideoStroke)=>Promise<void>;label:string}){
 const {lang}=useLanguage(),svg=useRef<SVGSVGElement>(null),stroke=useRef<VideoStroke|null>(null),alive=useRef(true),[preview,setPreview]=useState<[number,number][]>([]),[finishing,setFinishing]=useState(false)
 const maskId=useId()
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stroke.current=null}},[])
 const finish=(e:PointerEvent<SVGSVGElement>)=>{
  const value=stroke.current;if(!value)return;stroke.current=null
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
  setFinishing(true);void onCommit(value).catch(error=>message.error(String(error))).finally(()=>{if(alive.current){setFinishing(false);setPreview([])}})
 }
 return <svg ref={svg} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={label} aria-disabled={disabled||finishing} style={{width:'100%',maxWidth:640,height:'auto',display:'block',cursor:disabled||finishing?'wait':'crosshair',touchAction:'none'}}
  onPointerDown={e=>{if(disabled||finishing||e.button!==0)return;const p=coordinates(e.currentTarget,size,e.clientX,e.clientY);stroke.current={size:brushSize,points:[p]};setPreview([p]);e.currentTarget.setPointerCapture(e.pointerId)}}
  onPointerMove={e=>{const value=stroke.current;if(!value)return
   if(value.points.length===32768){stroke.current=null;setPreview([]);message.error(lang==='zh'?'单次笔画过长，请分段绘制':lang==='ja'?'ストロークが長すぎます。分割してください':'Stroke too long. Draw it in smaller segments.');return}
   value.points.push(coordinates(e.currentTarget,size,e.clientX,e.clientY))
   // Bound display geometry independently of the exact full stroke sent to
   // the Worker. Formal output retains every original pointer sample.
   const step=Math.max(1,Math.ceil(value.points.length/2048));setPreview(value.points.filter((_,i)=>i%step===0||i===value.points.length-1))
  }} onPointerUp={finish} onPointerLeave={finish} onPointerCancel={()=>{stroke.current=null;setPreview([])}}>
  <defs><mask id={maskId}><rect width={size.w} height={size.h} fill="white"/>{preview.length>0&&<><circle cx={preview[0][0]} cy={preview[0][1]} r={brushSize/2} fill="black" opacity={.9}/><polyline points={preview.map(p=>p.join(',')).join(' ')} fill="none" stroke="black" opacity={.9} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round"/></>}</mask></defs>
  <image href={url} width={size.w} height={size.h} preserveAspectRatio="none" mask={`url(#${maskId})`}/>
 </svg>
}

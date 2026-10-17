import {useCallback,useLayoutEffect,useReducer,useRef,type SetStateAction} from 'react'
import {customSliceFiles,initialCustomSliceDraft,restoreCustomSlice,type CustomSliceDraft} from './customSliceDocument'
import {limitFileHistory} from './fileHistory'
type History={present:CustomSliceDraft;past:CustomSliceDraft[];future:CustomSliceDraft[];checkpoint?:CustomSliceDraft}
type Action={type:'change';update:(d:CustomSliceDraft)=>CustomSliceDraft}|{type:'restore';draft:CustomSliceDraft}|{type:'begin'|'end'|'undo'|'redo'}
export const sameCustomSliceDraft=(a:CustomSliceDraft,b:CustomSliceDraft)=>(Object.keys(a) as (keyof CustomSliceDraft)[]).every(k=>a[k]===b[k])
export const createCustomSliceHistory=(present=initialCustomSliceDraft()):History=>({present,past:[],future:[]})
function reduce(s:History,a:Action):History{
 if(a.type==='restore')return createCustomSliceHistory(a.draft)
 if(a.type==='begin')return s.checkpoint?s:{...s,checkpoint:s.present}
 if(a.type==='end')return !s.checkpoint?s:{present:s.present,past:sameCustomSliceDraft(s.present,s.checkpoint)?s.past:[...s.past,s.checkpoint].slice(-50),future:s.future}
 if(a.type==='undo'||a.type==='redo'){
  const c=reduce(s,{type:'end'})
  return a.type==='undo'?(c.past.length?{present:c.past.at(-1)!,past:c.past.slice(0,-1),future:[...c.future,c.present].slice(-50)}:c):(c.future.length?{present:c.future.at(-1)!,past:[...c.past,c.present].slice(-50),future:c.future.slice(0,-1)}:c)
 }
 if(a.type!=='change')return s
 const present=a.update(s.present)
 return sameCustomSliceDraft(present,s.present)?s:{present,past:s.checkpoint?s.past:[...s.past,s.present].slice(-50),future:[],checkpoint:s.checkpoint}
}
const sizes=new WeakMap<CustomSliceDraft,number>()
const bytes=(d:CustomSliceDraft)=>{let b=sizes.get(d);if(b===undefined){b=JSON.stringify(d).length*2;sizes.set(d,b)}return b}
export function customSliceHistoryReducer(s:History,a:Action):History{
 const next=limitFileHistory(reduce(s,a),customSliceFiles);let {past,future}=next
 while([...past,...future,next.present,...(next.checkpoint?[next.checkpoint]:[])].reduce((sum,d)=>sum+bytes(d),0)>64*1024**2&&(past.length||future.length)){if(past.length)past=past.slice(1);else future=future.slice(1)}
 return past===next.past&&future===next.future?next:{...next,past,future}
}
export function useCustomSliceDocument(){
 const [history,dispatch]=useReducer(customSliceHistoryReducer,undefined,createCustomSliceHistory),latest=useRef(history)
 useLayoutEffect(()=>{latest.current=history},[history])
 const change=useCallback((update:(d:CustomSliceDraft)=>CustomSliceDraft)=>dispatch({type:'change',update}),[])
 const set=useCallback(<K extends keyof CustomSliceDraft>(key:K,value:SetStateAction<CustomSliceDraft[K]>)=>change(d=>{const next=typeof value==='function'?(value as (v:CustomSliceDraft[K])=>CustomSliceDraft[K])(d[key]):value;return Object.is(next,d[key])?d:{...d,[key]:next}}),[change])
 const current=useCallback(()=>latest.current.present,[])
 const retained=useCallback(()=>customSliceFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
 const restore=useCallback((value:unknown)=>restoreCustomSlice(value,[...retained()]),[retained])
 const apply=useCallback((draft:CustomSliceDraft)=>dispatch({type:'restore',draft}),[])
 return {history,draft:history.present,dispatch,change,set,current,retained,restore,apply}
}

import {useCallback,useLayoutEffect,useReducer,useRef,type SetStateAction} from 'react'
import {spriteSheetFiles,initialSpriteSheetDraft,restoreSpriteSheet,type SpriteSheetDraft} from './spriteSheetDocument'
import {limitFileHistory} from './fileHistory'
type History={present:SpriteSheetDraft;past:SpriteSheetDraft[];future:SpriteSheetDraft[];checkpoint?:SpriteSheetDraft}
type Action={type:'change';update:(d:SpriteSheetDraft)=>SpriteSheetDraft}|{type:'restore';draft:SpriteSheetDraft}|{type:'begin'|'end'|'undo'|'redo'}
export const sameSpriteSheetDraft=(a:SpriteSheetDraft,b:SpriteSheetDraft)=>(Object.keys(a) as (keyof SpriteSheetDraft)[]).every(k=>a[k]===b[k])
export const createSpriteSheetHistory=(present=initialSpriteSheetDraft()):History=>({present,past:[],future:[]})
function reduce(s:History,a:Action):History{
 if(a.type==='restore')return createSpriteSheetHistory(a.draft)
 if(a.type==='begin')return s.checkpoint?s:{...s,checkpoint:s.present}
 if(a.type==='end')return !s.checkpoint?s:{present:s.present,past:sameSpriteSheetDraft(s.present,s.checkpoint)?s.past:[...s.past,s.checkpoint].slice(-50),future:s.future}
 if(a.type==='undo'||a.type==='redo'){
  const c=reduce(s,{type:'end'})
  return a.type==='undo'?(c.past.length?{present:c.past.at(-1)!,past:c.past.slice(0,-1),future:[...c.future,c.present].slice(-50)}:c):(c.future.length?{present:c.future.at(-1)!,past:[...c.past,c.present].slice(-50),future:c.future.slice(0,-1)}:c)
 }
 if(a.type!=='change')return s
 const present=a.update(s.present)
 return sameSpriteSheetDraft(present,s.present)?s:{present,past:s.checkpoint?s.past:[...s.past,s.present].slice(-50),future:[],checkpoint:s.checkpoint}
}
const sizes=new WeakMap<SpriteSheetDraft,number>()
const bytes=(d:SpriteSheetDraft)=>{let b=sizes.get(d);if(b===undefined){b=JSON.stringify(d).length*2;sizes.set(d,b)}return b}
export function spriteSheetHistoryReducer(s:History,a:Action):History{
 const next=limitFileHistory(reduce(s,a),spriteSheetFiles);let {past,future}=next
 while([...past,...future,next.present,...(next.checkpoint?[next.checkpoint]:[])].reduce((sum,d)=>sum+bytes(d),0)>64*1024**2&&(past.length||future.length)){if(past.length)past=past.slice(1);else future=future.slice(1)}
 return past===next.past&&future===next.future?next:{...next,past,future}
}
export function useSpriteSheetDocument(){
 const [history,dispatch]=useReducer(spriteSheetHistoryReducer,undefined,createSpriteSheetHistory),latest=useRef(history)
 useLayoutEffect(()=>{latest.current=history},[history])
 const change=useCallback((update:(d:SpriteSheetDraft)=>SpriteSheetDraft)=>dispatch({type:'change',update}),[])
 const set=useCallback(<K extends keyof SpriteSheetDraft>(key:K,value:SetStateAction<SpriteSheetDraft[K]>)=>change(d=>{const next=typeof value==='function'?(value as (v:SpriteSheetDraft[K])=>SpriteSheetDraft[K])(d[key]):value;return Object.is(next,d[key])?d:{...d,[key]:next}}),[change])
 const current=useCallback(()=>latest.current.present,[])
 const retained=useCallback(()=>spriteSheetFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
 const restore=useCallback((value:unknown)=>restoreSpriteSheet(value,[...retained()]),[retained])
 const apply=useCallback((draft:SpriteSheetDraft)=>dispatch({type:'restore',draft}),[])
 return {history,draft:history.present,dispatch,change,set,current,retained,restore,apply}
}

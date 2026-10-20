import {useCallback,useLayoutEffect,useReducer,useRef,type SetStateAction} from 'react'
import {initialControlDraft,restoreControl,controlFiles,type ControlDraft,type ControlVariant} from './controlDocument'
import {limitFileHistory} from './fileHistory'

type History={present:ControlDraft;past:ControlDraft[];future:ControlDraft[];checkpoint?:ControlDraft}
type Action={type:'change';update:(draft:ControlDraft)=>ControlDraft}|{type:'restore';draft:ControlDraft}|{type:'begin'|'end'|'undo'|'redo'}
export const sameControlDraft=(a:ControlDraft,b:ControlDraft)=>(Object.keys(a) as (keyof ControlDraft)[]).every(k=>a[k]===b[k])
export const createControlHistory=(present:ControlDraft=initialControlDraft('topdown')):History=>({present,past:[],future:[]})
function reduce(state:History,action:Action):History{
 if(action.type==='restore')return createControlHistory(action.draft)
 if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
 if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:sameControlDraft(state.checkpoint,state.present)?state.past:[...state.past,state.checkpoint].slice(-50),future:state.future}
 if(action.type==='undo'||action.type==='redo'){
  const current=reduce(state,{type:'end'})
  if(action.type==='undo')return current.past.length?{present:current.past.at(-1)!,past:current.past.slice(0,-1),future:[...current.future,current.present].slice(-50)}:current
  return current.future.length?{present:current.future.at(-1)!,past:[...current.past,current.present].slice(-50),future:current.future.slice(0,-1)}:current
 }
 if(action.type!=='change')return state
 const present=action.update(state.present)
 return sameControlDraft(present,state.present)?state:{present,past:state.checkpoint?state.past:[...state.past,state.present].slice(-50),future:[],checkpoint:state.checkpoint}
}
export const controlHistoryReducer=(state:History,action:Action)=>limitFileHistory(reduce(state,action),controlFiles)
export function useControlDocument(variant:ControlVariant){
 const [history,dispatch]=useReducer(controlHistoryReducer,variant,value=>createControlHistory(initialControlDraft(value))),latest=useRef(history)
 useLayoutEffect(()=>{latest.current=history},[history])
 const change=useCallback((update:(d:ControlDraft)=>ControlDraft)=>dispatch({type:'change',update}),[])
 const set=useCallback(<K extends keyof ControlDraft>(key:K,value:SetStateAction<ControlDraft[K]>)=>change(d=>{const next=typeof value==='function'?(value as (v:ControlDraft[K])=>ControlDraft[K])(d[key]):value;return Object.is(next,d[key])?d:{...d,[key]:next}}),[change])
 const current=useCallback(()=>latest.current.present,[])
 const retained=useCallback(()=>controlFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
 const restore=useCallback((value:unknown)=>restoreControl(value,variant,[...retained()],current()),[retained,variant,current])
 const apply=useCallback((draft:ControlDraft)=>dispatch({type:'restore',draft}),[])
 return {history,draft:history.present,dispatch,change,set,current,retained,restore,apply}
}

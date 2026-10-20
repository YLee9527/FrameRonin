import {useCallback,useLayoutEffect,useReducer,useRef,type SetStateAction} from 'react'
import {initialFlowDraft,restoreFlow,flowFiles,type FlowDraft} from './flowDocument'
import {limitFileHistory} from './fileHistory'

type History={present:FlowDraft;past:FlowDraft[];future:FlowDraft[];checkpoint?:FlowDraft}
type Action={type:'change';update:(draft:FlowDraft)=>FlowDraft}|{type:'restore';draft:FlowDraft}|{type:'begin'|'end'|'undo'|'redo'}
export const sameFlowDraft=(a:FlowDraft,b:FlowDraft)=>(Object.keys(a) as (keyof FlowDraft)[]).every(k=>a[k]===b[k])
export const createFlowHistory=(present:FlowDraft=initialFlowDraft()):History=>({present,past:[],future:[]})
function reduce(state:History,action:Action):History{
 if(action.type==='restore')return createFlowHistory(action.draft)
 if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
 if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:sameFlowDraft(state.checkpoint,state.present)?state.past:[...state.past,state.checkpoint].slice(-50),future:state.future}
 if(action.type==='undo'||action.type==='redo'){
  const current=reduce(state,{type:'end'})
  if(action.type==='undo')return current.past.length?{present:current.past.at(-1)!,past:current.past.slice(0,-1),future:[...current.future,current.present].slice(-50)}:current
  return current.future.length?{present:current.future.at(-1)!,past:[...current.past,current.present].slice(-50),future:current.future.slice(0,-1)}:current
 }
 if(action.type!=='change')return state
 const present=action.update(state.present)
 return sameFlowDraft(present,state.present)?state:{present,past:state.checkpoint?state.past:[...state.past,state.present].slice(-50),future:[],checkpoint:state.checkpoint}
}
export const flowHistoryReducer=(state:History,action:Action)=>limitFileHistory(reduce(state,action),flowFiles)
export function useFlowDocument(initial?:FlowDraft){
 const [history,dispatch]=useReducer(flowHistoryReducer,initial,value=>createFlowHistory(value??initialFlowDraft())),latest=useRef(history)
 useLayoutEffect(()=>{latest.current=history},[history])
 const change=useCallback((update:(d:FlowDraft)=>FlowDraft)=>dispatch({type:'change',update}),[])
 const set=useCallback(<K extends keyof FlowDraft>(key:K,value:SetStateAction<FlowDraft[K]>)=>change(d=>{const next=typeof value==='function'?(value as (v:FlowDraft[K])=>FlowDraft[K])(d[key]):value;return Object.is(next,d[key])?d:{...d,[key]:next}}),[change])
 const current=useCallback(()=>latest.current.present,[])
 const retained=useCallback(()=>flowFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
 const restore=useCallback((value:unknown)=>restoreFlow(value,[...retained()]),[retained])
 const apply=useCallback((draft:FlowDraft)=>dispatch({type:'restore',draft}),[])
 return {history,draft:history.present,dispatch,change,set,current,retained,restore,apply}
}

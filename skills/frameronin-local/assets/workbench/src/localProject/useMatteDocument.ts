import {useCallback,useLayoutEffect,useReducer,useRef} from 'react'
import {initialMatteDraft,matteFiles,restoreMatte,type MatteDraft} from './matteDocument'
import {limitFileHistory} from './fileHistory'

type History={present:MatteDraft;past:MatteDraft[];future:MatteDraft[];checkpoint?:MatteDraft}
type Action={type:'change';update:(draft:MatteDraft)=>MatteDraft}|{type:'restore';draft:MatteDraft}|{type:'begin'|'end'|'undo'|'redo'}
export const sameMatteDraft=(a:MatteDraft,b:MatteDraft)=>(Object.keys(a) as (keyof MatteDraft)[]).every(key=>a[key]===b[key])
export const createMatteHistory=(present:MatteDraft=initialMatteDraft()):History=>({present,past:[],future:[]})
function reduce(state:History,action:Action):History{
  if(action.type==='restore')return createMatteHistory(action.draft)
  if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
  if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:sameMatteDraft(state.checkpoint,state.present)?state.past:[...state.past,state.checkpoint].slice(-50),future:state.future}
  if(action.type==='undo'||action.type==='redo'){
    const current=reduce(state,{type:'end'})
    if(action.type==='undo')return current.past.length?{present:current.past.at(-1)!,past:current.past.slice(0,-1),future:[...current.future,current.present].slice(-50)}:current
    return current.future.length?{present:current.future.at(-1)!,past:[...current.past,current.present].slice(-50),future:current.future.slice(0,-1)}:current
  }
  if(action.type!=='change')return state
  const present=action.update(state.present)
  return sameMatteDraft(present,state.present)?state:{present,past:state.checkpoint?state.past:[...state.past,state.present].slice(-50),future:[],checkpoint:state.checkpoint}
}
export const matteHistoryReducer=(state:History,action:Action)=>limitFileHistory(reduce(state,action),matteFiles)
export function useMatteDocument(){
  const [history,dispatch]=useReducer(matteHistoryReducer,undefined,createMatteHistory)
  const latest=useRef(history);useLayoutEffect(()=>{latest.current=history},[history])
  const change=useCallback((update:(draft:MatteDraft)=>MatteDraft)=>dispatch({type:'change',update}),[])
  const current=useCallback(()=>latest.current.present,[])
  const retained=useCallback(()=>matteFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
  const restore=useCallback((value:unknown)=>restoreMatte(value,[...retained()]),[retained])
  const apply=useCallback((draft:MatteDraft)=>dispatch({type:'restore',draft}),[])
  return {draft:history.present,history,dispatch,current,change,retained,restore,apply}
}

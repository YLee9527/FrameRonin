import {useCallback,useLayoutEffect,useReducer,useRef,type SetStateAction} from 'react'
import {initialScatterDraft,restoreScatter,scatterFiles,scatterSettings,type ScatterDraft,type ScatterSettings} from './scatterDocument'
import {limitFileHistory} from './fileHistory'
type History={present:ScatterDraft;past:ScatterDraft[];future:ScatterDraft[];checkpoint?:ScatterDraft}
type Action={type:'change';update:(draft:ScatterDraft)=>ScatterDraft}|{type:'restore';draft:ScatterDraft}|{type:'begin'|'end'|'undo'|'redo'}
export const sameScatterDraft=(a:ScatterDraft,b:ScatterDraft)=>a.source===b.source&&a.info===b.info&&a.boxes===b.boxes&&a.selectedId===b.selectedId&&a.detection===b.detection&&a.archive===b.archive&&(Object.keys(scatterSettings) as (keyof ScatterSettings)[]).every(key=>key==='detect'?JSON.stringify(a.settings.detect)===JSON.stringify(b.settings.detect):a.settings[key]===b.settings[key])
export const createScatterHistory=(present=initialScatterDraft()):History=>({present,past:[],future:[]})
function reduce(state:History,action:Action):History{
 if(action.type==='restore')return createScatterHistory(action.draft)
 if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
 if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:sameScatterDraft(state.present,state.checkpoint)?state.past:[...state.past,state.checkpoint].slice(-50),future:state.future}
 if(action.type==='undo'||action.type==='redo'){
  const current=reduce(state,{type:'end'})
  if(action.type==='undo')return current.past.length?{present:current.past.at(-1)!,past:current.past.slice(0,-1),future:[...current.future,current.present].slice(-50)}:current
  return current.future.length?{present:current.future.at(-1)!,past:[...current.past,current.present].slice(-50),future:current.future.slice(0,-1)}:current
 }
 if(action.type!=='change')return state
 const present=action.update(state.present)
 return sameScatterDraft(present,state.present)?state:{present,past:state.checkpoint?state.past:[...state.past,state.present].slice(-50),future:[],checkpoint:state.checkpoint}
}
const boxBytes=new WeakMap<ScatterDraft['boxes'],number>()
const bytes=(draft:ScatterDraft)=>{
 let boxes=boxBytes.get(draft.boxes)
 if(boxes===undefined){boxes=draft.boxes.reduce((sum,box)=>sum+256+(box.name?.length??0)*2,0);boxBytes.set(draft.boxes,boxes)}
 return boxes+draft.settings.namesText.length*2+2048
}
export function scatterHistoryReducer(state:History,action:Action):History{
 const next=limitFileHistory(reduce(state,action),scatterFiles)
 let {past,future}=next
 while([...past,...future,next.present,...(next.checkpoint?[next.checkpoint]:[])].reduce((sum,draft)=>sum+bytes(draft),0)>64*1024**2&&(past.length||future.length)){
  if(past.length)past=past.slice(1);else future=future.slice(1)
 }
 return past===next.past&&future===next.future?next:{...next,past,future}
}
export function useScatterDocument(){
 const [history,dispatch]=useReducer(scatterHistoryReducer,undefined,createScatterHistory),latest=useRef(history)
 useLayoutEffect(()=>{latest.current=history},[history])
 const change=useCallback((update:(draft:ScatterDraft)=>ScatterDraft)=>dispatch({type:'change',update}),[])
 const setting=useCallback(<K extends keyof ScatterSettings,>(key:K,value:SetStateAction<ScatterSettings[K]>)=>change(draft=>({...draft,settings:{...draft.settings,[key]:typeof value==='function'?(value as (v:ScatterSettings[K])=>ScatterSettings[K])(draft.settings[key]):value}})),[change])
 const boxes=useCallback((value:SetStateAction<ScatterDraft['boxes']>)=>change(draft=>({...draft,boxes:typeof value==='function'?value(draft.boxes):value})),[change])
 const select=useCallback((selectedId:string|null)=>change(draft=>({...draft,selectedId})),[change])
 const current=useCallback(()=>latest.current.present,[])
 const retained=useCallback(()=>scatterFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
 const restore=useCallback((value:unknown)=>restoreScatter(value,[...retained()]),[retained])
 const apply=useCallback((draft:ScatterDraft)=>dispatch({type:'restore',draft}),[])
 return {draft:history.present,history,dispatch,change,setting,boxes,select,current,retained,restore,apply}
}

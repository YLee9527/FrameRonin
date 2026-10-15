import { limitFileHistory } from './fileHistory'
import { pixelFiles, type PixelDraft } from './pixelDocument'
export type PixelHistory={present:PixelDraft;past:PixelDraft[];future:PixelDraft[];checkpoint?:PixelDraft}
export type PixelAction={type:'change';update:(value:PixelDraft)=>PixelDraft}|{type:'view';activeTab:PixelDraft['activeTab']}|{type:'restore';draft:PixelDraft}|{type:'undo'}|{type:'redo'}|{type:'begin'}|{type:'end'}|{type:'normalize';update:(value:PixelDraft)=>PixelDraft}
const same=(a:PixelDraft,b:PixelDraft)=>(Object.keys(a) as (keyof PixelDraft)[]).every(key=>key==='activeTab'||a[key]===b[key])
function bounded(values:PixelDraft[]){
  const retained=values.slice(-50)
  const bytes=()=>[...pixelFiles(retained)].reduce((sum,file)=>sum+file.size*2,0)
  while(retained.length&&bytes()>256*1024**2)retained.shift()
  return retained
}
export const createPixelHistory=(present:PixelDraft):PixelHistory=>({present,past:[],future:[]})
export function pixelHistoryReducer(state:PixelHistory,action:PixelAction):PixelHistory{
  return limitFileHistory(reduceHistory(state,action),pixelFiles)
}
function reduceHistory(state:PixelHistory,action:PixelAction):PixelHistory{
  if(action.type==='normalize'){const present=action.update(state.present);return same(present,state.present)?state:{...state,present}}
  if(action.type==='restore')return createPixelHistory(action.draft)
  if(action.type==='view')return state.present.activeTab===action.activeTab?state:{...state,present:{...state.present,activeTab:action.activeTab}}
  if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
  if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:same(state.checkpoint,state.present)?state.past:bounded([...state.past,state.checkpoint]),future:state.future}
  if(action.type==='undo'||action.type==='redo'){
    const current=pixelHistoryReducer(state,{type:'end'})
    if(action.type==='undo')return current.past.length?{present:{...current.past.at(-1)!,activeTab:current.present.activeTab},past:current.past.slice(0,-1),future:bounded([...current.future,current.present])}:current
    return current.future.length?{present:{...current.future.at(-1)!,activeTab:current.present.activeTab},past:bounded([...current.past,current.present]),future:current.future.slice(0,-1)}:current
  }
  const present=action.update(state.present)
  return same(present,state.present)?state:{present,past:state.checkpoint?state.past:bounded([...state.past,state.present]),future:[],checkpoint:state.checkpoint}
}

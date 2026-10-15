import { sequenceFiles, type SequenceDraft } from './sequenceDocument'
export type SequenceHistory={present:SequenceDraft;past:SequenceDraft[];future:SequenceDraft[];checkpoint?:SequenceDraft}
export type SequenceAction={type:'change';update:(value:SequenceDraft)=>SequenceDraft}|{type:'view';activeTab:SequenceDraft['activeTab']}|{type:'restore';draft:SequenceDraft}|{type:'undo'}|{type:'redo'}|{type:'begin'}|{type:'end'}
const same=(a:SequenceDraft,b:SequenceDraft)=>(Object.keys(a) as (keyof SequenceDraft)[]).every(key=>a[key]===b[key])
function bounded(values:SequenceDraft[]){
  const retained=values.slice(-50)
  const bytes=()=>[...sequenceFiles(retained)].reduce((sum,file)=>sum+file.size*2,0)
  while(retained.length&&bytes()>256*1024**2)retained.shift()
  return retained
}
export const createSequenceHistory=(present:SequenceDraft):SequenceHistory=>({present,past:[],future:[]})
export function sequenceHistoryReducer(state:SequenceHistory,action:SequenceAction):SequenceHistory{
  if(action.type==='restore')return createSequenceHistory(action.draft)
  if(action.type==='view')return state.present.activeTab===action.activeTab?state:{...state,present:{...state.present,activeTab:action.activeTab}}
  if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
  if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:same(state.checkpoint,state.present)?state.past:bounded([...state.past,state.checkpoint]),future:state.future}
  if(action.type==='undo'||action.type==='redo'){
    const current=sequenceHistoryReducer(state,{type:'end'})
    if(action.type==='undo')return current.past.length?{present:{...current.past.at(-1)!,activeTab:current.present.activeTab},past:current.past.slice(0,-1),future:bounded([...current.future,current.present])}:current
    return current.future.length?{present:{...current.future.at(-1)!,activeTab:current.present.activeTab},past:bounded([...current.past,current.present]),future:current.future.slice(0,-1)}:current
  }
  const present=action.update(state.present)
  return same(present,state.present)?state:{present,past:state.checkpoint?state.past:bounded([...state.past,state.present]),future:[],checkpoint:state.checkpoint}
}

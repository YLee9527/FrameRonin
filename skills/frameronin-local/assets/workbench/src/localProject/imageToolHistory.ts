import { limitFileHistory } from './fileHistory'
import { imageToolFiles, type ImageToolDraft, type ImageToolKind } from './imageToolDocument'

export type ImageToolHistory<K extends ImageToolKind=ImageToolKind>={present:ImageToolDraft<K>;past:ImageToolDraft<K>[];future:ImageToolDraft<K>[];checkpoint?:ImageToolDraft<K>}
export type ImageToolAction<K extends ImageToolKind=ImageToolKind>={type:'change'|'normalize';update:(draft:ImageToolDraft<K>)=>ImageToolDraft<K>}|{type:'restore';draft:ImageToolDraft<K>}|{type:'undo'|'redo'|'begin'|'end'}
const sameFiles=(a:File[],b:File[])=>a.length===b.length&&a.every((file,index)=>file===b[index])
export const sameImageToolDraft=(a:ImageToolDraft,b:ImageToolDraft)=>a.tool===b.tool&&a.taskId===b.taskId&&a.reportFile===b.reportFile&&a.editedFile===b.editedFile
  &&sameFiles(a.files,b.files)&&sameFiles(a.results,b.results)&&JSON.stringify(a.parameters)===JSON.stringify(b.parameters)
export const createImageToolHistory=<K extends ImageToolKind>(present:ImageToolDraft<K>):ImageToolHistory<K>=>({present,past:[],future:[]})
export function imageToolHistoryReducer<K extends ImageToolKind>(state:ImageToolHistory<K>,action:ImageToolAction<K>):ImageToolHistory<K>{
  return limitFileHistory(reduce(state,action),imageToolFiles)
}
function reduce<K extends ImageToolKind>(state:ImageToolHistory<K>,action:ImageToolAction<K>):ImageToolHistory<K>{
  if(action.type==='restore')return createImageToolHistory(action.draft)
  if(action.type==='begin')return state.checkpoint?state:{...state,checkpoint:state.present}
  if(action.type==='end')return !state.checkpoint?state:{present:state.present,past:sameImageToolDraft(state.checkpoint,state.present)?state.past:[...state.past,state.checkpoint].slice(-50),future:state.future}
  if(action.type==='undo'||action.type==='redo'){
    const current=imageToolHistoryReducer(state,{type:'end'})
    if(action.type==='undo')return current.past.length?{present:current.past.at(-1)!,past:current.past.slice(0,-1),future:[...current.future,current.present].slice(-50)}:current
    return current.future.length?{present:current.future.at(-1)!,past:[...current.past,current.present].slice(-50),future:current.future.slice(0,-1)}:current
  }
  if(action.type!=='change'&&action.type!=='normalize')return state
  const present=action.update(state.present)
  if(sameImageToolDraft(present,state.present))return state
  return action.type==='normalize'?{...state,present}:{present,past:state.checkpoint?state.past:[...state.past,state.present].slice(-50),future:[],checkpoint:state.checkpoint}
}

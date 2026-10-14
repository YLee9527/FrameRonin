import type { MapDraft, MapImage } from './mapDocument'

export type MapHistory = { present: MapDraft; past: MapDraft[]; future: MapDraft[]; checkpoint?: MapDraft }
export type MapAction = { type: 'change'; update: (draft: MapDraft) => MapDraft } | { type: 'restore'; draft: MapDraft } | { type: 'undo' } | { type: 'redo' } | { type: 'begin' } | { type: 'end' }
export function mapImages(drafts: MapDraft[]): Set<MapImage> {
  return new Set(drafts.flatMap(draft => [draft.source,...Object.values(draft.tileUploads)].filter((image):image is MapImage=>!!image)))
}
function bounded(values: MapDraft[]) {
  const history=values.slice(-50)
  const bytes=()=>[...mapImages(history)].reduce((total,image)=>total+image.width*image.height*16+image.file.size*2,0)
  while(history.length&&bytes()>256*1024**2)history.shift()
  return history
}
export function createMapHistory(present: MapDraft): MapHistory { return {present,past:[],future:[]} }
const same = (a: MapDraft, b: MapDraft) => (Object.keys(a) as (keyof MapDraft)[]).every(key => a[key] === b[key])
export function mapHistoryReducer(state: MapHistory,action: MapAction): MapHistory {
  if(action.type==='restore')return createMapHistory(action.draft)
  if(action.type==='begin')return state.checkpoint ? state : {...state,checkpoint:state.present}
  if(action.type==='end')return !state.checkpoint ? state : {present:state.present,
    past:same(state.checkpoint,state.present)?state.past:bounded([...state.past,state.checkpoint]),future:state.future}
  if(action.type==='undo'||action.type==='redo'){
    const current=mapHistoryReducer(state,{type:'end'})
    if(action.type==='undo')return current.past.length?{present:current.past.at(-1)!,past:current.past.slice(0,-1),future:bounded([...current.future,current.present])}:current
    return current.future.length?{present:current.future.at(-1)!,past:bounded([...current.past,current.present]),future:current.future.slice(0,-1)}:current
  }
  const present=action.update(state.present)
  if(same(present,state.present))return state
  return {present,past:state.checkpoint?state.past:bounded([...state.past,state.present]),future:[],checkpoint:state.checkpoint}
}

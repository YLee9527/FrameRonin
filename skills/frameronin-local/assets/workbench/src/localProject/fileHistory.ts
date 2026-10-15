/** Bound all retained file references, including redo and an active gesture. */
export function limitFileHistory<T>(state:{present:T;past:T[];future:T[];checkpoint?:T},files:(drafts:T[])=>Set<File>){
  let past=state.past,future=state.future
  const retainedBytes=()=>[...files([state.present,...past,...future,...(state.checkpoint?[state.checkpoint]:[])])].reduce((sum,file)=>sum+file.size*2,0)
  while(retainedBytes()>256*1024**2&&(past.length||future.length)){
    if(past.length)past=past.slice(1)
    else future=future.slice(1)
  }
  // The active document is never discarded to make the history budget pass.
  return past===state.past&&future===state.future?state:{...state,past,future}
}

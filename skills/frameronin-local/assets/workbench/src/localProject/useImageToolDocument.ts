import {useCallback,useLayoutEffect,useReducer,useRef} from 'react'
import {initialImageToolDraft,imageToolFiles,restoreImageToolDocument,validateStoredImageTool,type ImageToolDraft,type ImageToolKind,type ImageToolParameters} from './imageToolDocument'
import {createImageToolHistory,imageToolHistoryReducer,type ImageToolHistory,type ImageToolAction} from './imageToolHistory'

export function useImageToolDocument<K extends ImageToolKind>(tool:K){
  const [history,dispatch]=useReducer((state:ImageToolHistory<K>,action:ImageToolAction<K>)=>imageToolHistoryReducer(state,action),undefined,()=>createImageToolHistory(initialImageToolDraft(tool)))
  const latest=useRef(history);useLayoutEffect(()=>{latest.current=history},[history])
  const change=useCallback((update:(draft:ImageToolDraft<K>)=>ImageToolDraft<K>)=>dispatch({type:'change',update}),[])
  const normalize=useCallback((update:(draft:ImageToolDraft<K>)=>ImageToolDraft<K>)=>dispatch({type:'normalize',update}),[])
  const setFiles=useCallback((update:File[]|((files:File[])=>File[]))=>change(draft=>({...draft,files:typeof update==='function'?update(draft.files):update,results:[],reportFile:null,editedFile:null,taskId:null})),[change])
  const setParameter=useCallback(<P extends keyof ImageToolParameters[K],>(key:P,value:ImageToolParameters[K][P])=>change(draft=>({...draft,parameters:{...draft.parameters,[key]:value}})),[change])
  const retained=useCallback(()=>imageToolFiles([latest.current.present,...latest.current.past,...latest.current.future,...(latest.current.checkpoint?[latest.current.checkpoint]:[])]),[])
  const accept=useCallback((result:{results:File[];reportFile:File;taskId:string})=>change(draft=>({...draft,...result,editedFile:null})),[change])
  const restore=useCallback(async(value:unknown)=>{
    if(validateStoredImageTool(value).tool!==tool)throw new Error('IMAGE_TOOL_DOCUMENT_KIND')
    return await restoreImageToolDocument(value,[...retained()]) as ImageToolDraft<K>
  },[tool,retained])
  const apply=useCallback((draft:ImageToolDraft<K>)=>dispatch({type:'restore',draft}),[])
  return {draft:history.present,history,dispatch,change,normalize,setFiles,setParameter,retained,accept,restore,apply}
}


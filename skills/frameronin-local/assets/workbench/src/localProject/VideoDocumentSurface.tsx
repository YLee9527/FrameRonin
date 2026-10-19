import {useEffect,useRef,type PropsWithChildren} from 'react'
import {Button,Space,message} from 'antd'
import {RedoOutlined,UndoOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import DocumentSaveBar from './DocumentSaveBar'
import {serializeVideo,type VideoDraft} from './videoDocument'
import {sameVideoDraft,type useVideoDocument} from './useVideoDocument'
export function VideoDocumentSurface({model,beforeAction,hasPendingEdits,onInteraction,onRestore,onHistory,children}:PropsWithChildren<{model:ReturnType<typeof useVideoDocument>;beforeAction:()=>Promise<void>;hasPendingEdits:()=>boolean;onInteraction:(active:boolean)=>void;onRestore:(draft:VideoDraft)=>void;onHistory:()=>void}>){
 const {lang}=useLanguage(),root=useRef<HTMLDivElement>(null),changing=useRef(false)
 useEffect(()=>{const end=()=>onInteraction(false);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end)}},[onInteraction])
 const history=async(type:'undo'|'redo')=>{if(changing.current)return;changing.current=true;try{await beforeAction();onHistory();model.dispatch({type});root.current?.focus({preventScroll:true})}catch(error){message.error(String(error))}finally{changing.current=false}}
 return <div ref={root} tabIndex={-1} style={{outline:'none'}}
  onPointerDownCapture={e=>{onInteraction(true);model.dispatch({type:'begin'});if(!(e.target as HTMLElement).closest('input,textarea,select,button,[role="combobox"]'))root.current?.focus({preventScroll:true})}}
  onPointerUp={()=>{if(!document.activeElement?.closest('input,textarea'))model.dispatch({type:'end'})}} onPointerCancel={()=>model.dispatch({type:'end'})}
  onFocusCapture={e=>{if((e.target as HTMLElement).closest('input,textarea'))model.dispatch({type:'begin'})}} onBlurCapture={e=>{if((e.target as HTMLElement).closest('input,textarea'))model.dispatch({type:'end'})}}
  onKeyDownCapture={e=>{if(e.nativeEvent.isComposing||e.altKey||!(e.ctrlKey||e.metaKey)||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;if(e.code==='KeyZ'||e.code==='KeyY'){e.preventDefault();e.stopPropagation();void history(e.shiftKey||e.code==='KeyY'?'redo':'undo')}}}>
  <Space wrap><DocumentSaveBar stableLayout kind="video" snapshot={model.draft} serialize={serializeVideo} restore={model.restore} applySnapshot={onRestore} prepareSnapshot={beforeAction} hasPendingEdits={hasPendingEdits}/>
   <Button icon={<UndoOutlined/>} disabled={!model.history.past.length&&(!model.history.checkpoint||sameVideoDraft(model.history.checkpoint,model.draft))} onClick={()=>{void history('undo')}}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
   <Button icon={<RedoOutlined/>} disabled={!model.history.future.length} onClick={()=>{void history('redo')}}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
  </Space>{children}
 </div>
}

import {useCallback,useEffect,useRef,type PropsWithChildren} from 'react'
import {Button,Space,message} from 'antd'
import {UndoOutlined,RedoOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import DocumentSaveBar from './DocumentSaveBar'
import {serializeSpriteSheet} from './spriteSheetDocument'
import {sameSpriteSheetDraft,type useSpriteSheetDocument} from './useSpriteSheetDocument'

export function SpriteSheetDocumentSurface({model,beforeAction,hasPendingEdits,onInteractionChange,children}:PropsWithChildren<{model:ReturnType<typeof useSpriteSheetDocument>;beforeAction:()=>Promise<void>;hasPendingEdits:()=>boolean;onInteractionChange:(active:boolean)=>void}>){
 const {lang}=useLanguage(),root=useRef<HTMLDivElement>(null),changing=useRef(false),pointer=useRef(false)
 const prepare=useCallback(async()=>{pointer.current=false;onInteractionChange(false);await beforeAction()},[beforeAction,onInteractionChange])
 const pending=useCallback(()=>pointer.current||hasPendingEdits(),[hasPendingEdits])
 useEffect(()=>{const end=()=>{pointer.current=false;onInteractionChange(false)};window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end)}},[onInteractionChange])
 const history=async(type:'undo'|'redo')=>{if(changing.current)return;changing.current=true;try{await prepare();model.dispatch({type})}catch(error){message.error(String(error))}finally{changing.current=false}}
 return <div ref={root} tabIndex={-1} style={{outline:'none'}}
  onPointerDownCapture={event=>{pointer.current=true;onInteractionChange(true);model.dispatch({type:'begin'});if(!(event.target as HTMLElement).closest('input,textarea,select,button,[role="combobox"]'))root.current?.focus({preventScroll:true})}}
  onPointerUp={()=>{if(!document.activeElement?.closest('input,textarea'))model.dispatch({type:'end'})}} onPointerCancel={()=>model.dispatch({type:'end'})}
  onFocusCapture={event=>{if((event.target as HTMLElement).closest('input,textarea'))model.dispatch({type:'begin'})}}
  onBlurCapture={event=>{if((event.target as HTMLElement).closest('input,textarea'))model.dispatch({type:'end'})}}
  onKeyDownCapture={event=>{
   if(event.nativeEvent.isComposing||event.altKey||!(event.ctrlKey||event.metaKey)||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return
   if(event.code==='KeyZ'||event.code==='KeyY'){event.preventDefault();event.stopPropagation();void history(event.shiftKey||event.code==='KeyY'?'redo':'undo')}
  }}>
  <Space wrap style={{marginBottom:16}}>
   <DocumentSaveBar kind="sprite-sheet" snapshot={model.draft} serialize={serializeSpriteSheet} restore={model.restore} applySnapshot={model.apply} prepareSnapshot={prepare} hasPendingEdits={pending}/>
   <Button icon={<UndoOutlined/>} disabled={!model.history.past.length&&(!model.history.checkpoint||sameSpriteSheetDraft(model.history.checkpoint,model.draft))} onClick={()=>{void history('undo')}}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
   <Button icon={<RedoOutlined/>} disabled={!model.history.future.length} onClick={()=>{void history('redo')}}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
  </Space>{children}
 </div>
}

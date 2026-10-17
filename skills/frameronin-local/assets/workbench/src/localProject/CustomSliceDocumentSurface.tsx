import {useRef,type PropsWithChildren} from 'react'
import {Button,Space,message} from 'antd'
import {UndoOutlined,RedoOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import DocumentSaveBar from './DocumentSaveBar'
import {serializeCustomSlice} from './customSliceDocument'
import {sameCustomSliceDraft,type useCustomSliceDocument} from './useCustomSliceDocument'

export function CustomSliceDocumentSurface({model,beforeAction,hasPendingEdits,children}:PropsWithChildren<{model:ReturnType<typeof useCustomSliceDocument>;beforeAction:()=>Promise<void>;hasPendingEdits:()=>boolean}>){
 const {lang}=useLanguage(),root=useRef<HTMLDivElement>(null),changing=useRef(false)
 const history=async(type:'undo'|'redo')=>{if(changing.current)return;changing.current=true;try{await beforeAction();model.dispatch({type})}catch(error){message.error(String(error))}finally{changing.current=false}}
 return <div ref={root} tabIndex={-1} style={{outline:'none'}}
  onPointerDownCapture={event=>{model.dispatch({type:'begin'});if(!(event.target as HTMLElement).closest('input,textarea,select,button,[role="combobox"]'))root.current?.focus({preventScroll:true})}}
  onPointerUp={()=>{if(!document.activeElement?.closest('input,textarea'))model.dispatch({type:'end'})}} onPointerCancel={()=>model.dispatch({type:'end'})}
  onFocusCapture={event=>{if((event.target as HTMLElement).closest('input,textarea'))model.dispatch({type:'begin'})}}
  onBlurCapture={event=>{if((event.target as HTMLElement).closest('input,textarea'))model.dispatch({type:'end'})}}
  onKeyDownCapture={event=>{
   if(event.nativeEvent.isComposing||event.altKey||!(event.ctrlKey||event.metaKey)||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return
   if(event.code==='KeyZ'||event.code==='KeyY'){event.preventDefault();event.stopPropagation();void history(event.shiftKey||event.code==='KeyY'?'redo':'undo')}
  }}>
  <Space wrap style={{marginBottom:16}}>
   <DocumentSaveBar kind="custom-slice" snapshot={model.draft} serialize={serializeCustomSlice} restore={model.restore} applySnapshot={model.apply} prepareSnapshot={beforeAction} hasPendingEdits={hasPendingEdits}/>
   <Button icon={<UndoOutlined/>} disabled={!model.history.past.length&&(!model.history.checkpoint||sameCustomSliceDraft(model.history.checkpoint,model.draft))} onClick={()=>{void history('undo')}}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
   <Button icon={<RedoOutlined/>} disabled={!model.history.future.length} onClick={()=>{void history('redo')}}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
  </Space>{children}
 </div>
}

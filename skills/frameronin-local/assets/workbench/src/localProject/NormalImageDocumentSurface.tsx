import {useEffect,useRef,type PropsWithChildren} from 'react'
import {Button,Space,message} from 'antd'
import {UndoOutlined,RedoOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import DocumentSaveBar from './DocumentSaveBar'
import {serializeNormalImage} from './normalImageDocument'
import type {useNormalImageDocument} from './useNormalImageDocument'
import {sameNormalImageDraft} from './useNormalImageDocument'

export default function NormalImageDocumentSurface({model,children,beforeAction,hasPendingEdits}:PropsWithChildren<{model:ReturnType<typeof useNormalImageDocument>;beforeAction?:()=>Promise<void>;hasPendingEdits?:()=>boolean}>){
  const {lang}=useLanguage(),root=useRef<HTMLDivElement>(null),pending=useRef(false),dispatch=model.dispatch
  const changeHistory=async(type:'undo'|'redo')=>{
    if(pending.current)return
    pending.current=true
    try{await beforeAction?.();dispatch({type})}catch(error){message.error(String(error))}finally{pending.current=false}
  }
  useEffect(()=>{
    const end=()=>{if(document.activeElement?.getAttribute('role')!=='spinbutton')dispatch({type:'end'})}
    window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end)
    return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end)}
  },[dispatch])
  return <div ref={root} tabIndex={-1} style={{outline:'none'}}
    onPointerDownCapture={event=>{dispatch({type:'begin'});if(!(event.target as HTMLElement).closest('input,textarea,select,button,[role="combobox"]'))root.current?.focus({preventScroll:true})}}
    onBlurCapture={event=>{if((event.target as HTMLElement).getAttribute('role')==='spinbutton')dispatch({type:'end'})}}
    onFocusCapture={event=>{if((event.target as HTMLElement).getAttribute('role')==='spinbutton')dispatch({type:'begin'})}}
    onKeyDownCapture={event=>{
      if(event.nativeEvent.isComposing||event.altKey||!(event.metaKey||event.ctrlKey)||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return
      if(event.code==='KeyZ'||event.code==='KeyY'){event.preventDefault();event.stopPropagation();void changeHistory(event.shiftKey||event.code==='KeyY'?'redo':'undo')}
    }}>
    <Space wrap style={{marginBottom:12}}>
      <DocumentSaveBar kind="image-normal" snapshot={model.draft} serialize={serializeNormalImage} restore={model.restore} applySnapshot={model.apply} prepareSnapshot={beforeAction} hasPendingEdits={hasPendingEdits}/>
      <Button icon={<UndoOutlined/>} disabled={!model.history.past.length&&(!model.history.checkpoint||sameNormalImageDraft(model.history.checkpoint,model.draft))} onClick={()=>{void changeHistory('undo')}}>{lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo'}</Button>
      <Button icon={<RedoOutlined/>} disabled={!model.history.future.length} onClick={()=>{void changeHistory('redo')}}>{lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'}</Button>
    </Space>
    {children}
  </div>
}

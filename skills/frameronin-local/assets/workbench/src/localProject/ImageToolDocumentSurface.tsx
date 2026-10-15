import {useEffect,useRef,type PropsWithChildren} from 'react'
import {Button,Space,Typography,message} from 'antd'
import {UndoOutlined,RedoOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import DocumentSaveBar from './DocumentSaveBar'
import {imageToolDocumentKinds,imageToolReports,serializeImageToolDocument,type ImageToolKind} from './imageToolDocument'
import {sameImageToolDraft} from './imageToolHistory'
import type {useImageToolDocument} from './useImageToolDocument'

export function ImageToolDocumentSurface<K extends ImageToolKind>({model,children,beforeAction,pendingEdits=false,hasPendingEdits}:PropsWithChildren<{model:ReturnType<typeof useImageToolDocument<K>>;beforeAction?:()=>Promise<void>;pendingEdits?:boolean;hasPendingEdits?:()=>boolean}>){
  const {lang}=useLanguage(),root=useRef<HTMLDivElement>(null)
  const undo=lang==='zh'?'撤销':lang==='ja'?'元に戻す':'Undo',redo=lang==='zh'?'重做':lang==='ja'?'やり直す':'Redo'
  const report=model.draft.reportFile?imageToolReports.get(model.draft.reportFile):undefined
  const parameters=report?.parameters as Record<string,unknown>|undefined
  const compared=model.draft.tool==='customScale'&&parameters?.mode!=='resize'?['matteAlgorithm','nonContiguousTolerance']:Object.keys(model.draft.parameters)
  const outdated=model.draft.results.length>0&&parameters&&Object.entries(model.draft.parameters).some(([key,value])=>compared.includes(key)&&parameters[key]!==value)
  const dispatch=model.dispatch
  const pendingHistory=useRef(false)
  const changeHistory=async(type:'undo'|'redo')=>{
    if(pendingHistory.current)return
    pendingHistory.current=true
    try{await beforeAction?.();dispatch({type})}catch(error){message.error(String(error))}finally{pendingHistory.current=false}
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
      if(event.code==='KeyZ'||event.code==='KeyY'){
        event.preventDefault();event.stopPropagation();void changeHistory(event.shiftKey||event.code==='KeyY'?'redo':'undo')
      }
    }}>
    <Space wrap>
      <DocumentSaveBar kind={imageToolDocumentKinds[model.draft.tool]} snapshot={model.draft} serialize={serializeImageToolDocument} restore={model.restore} applySnapshot={model.apply} prepareSnapshot={beforeAction} externalDirty={pendingEdits} hasPendingEdits={hasPendingEdits}/>
      <Button icon={<UndoOutlined/>} disabled={!model.history.past.length&&(!model.history.checkpoint||sameImageToolDraft(model.history.checkpoint,model.draft))} onClick={()=>{void changeHistory('undo')}}>{undo}</Button>
      <Button icon={<RedoOutlined/>} disabled={!model.history.future.length} onClick={()=>{void changeHistory('redo')}}>{redo}</Button>
    </Space>
    {outdated&&<Typography.Paragraph type="secondary">{lang==='zh'?'当前显示的是上次加工结果；应用新参数请重新执行。':lang==='ja'?'前回の処理結果を表示しています。新しい設定を適用するには再実行してください。':'The previous result is shown. Run again to apply the current settings.'}</Typography.Paragraph>}
    {children}
  </div>
}

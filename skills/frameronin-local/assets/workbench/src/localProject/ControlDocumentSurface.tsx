import {useEffect, useRef, type PropsWithChildren} from 'react'
import {Button, Space, message} from 'antd'
import {RedoOutlined, UndoOutlined} from '@ant-design/icons'
import {useLanguage} from '../i18n/context'
import DocumentSaveBar from './DocumentSaveBar'
import {serializeControl} from './controlDocument'
import {sameControlDraft, type useControlDocument} from './useControlDocument'

export function ControlDocumentSurface({model, beforeAction, pending, onInteraction, children}: PropsWithChildren<{
  model: ReturnType<typeof useControlDocument>; beforeAction: () => Promise<void>; pending: () => boolean; onInteraction: (active: boolean) => void
}>) {
  const {lang} = useLanguage(), changing = useRef(false), root = useRef<HTMLDivElement>(null), dispatch = model.dispatch
  useEffect(() => {
    const end = () => { onInteraction(false); if (!document.activeElement?.closest('input,textarea')) dispatch({type: 'end'}) }
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end)
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end) }
  }, [dispatch, onInteraction])
  const history = async (type: 'undo' | 'redo') => {
    if (changing.current) return
    changing.current = true
    try { await beforeAction(); dispatch({type}); root.current?.focus({preventScroll: true}) }
    catch (error) { message.error(String(error)) }
    finally { changing.current = false }
  }
  return <div ref={root} tabIndex={-1} style={{outline: 'none'}}
    onPointerDownCapture={() => { onInteraction(true); dispatch({type: 'begin'}) }}
    onFocusCapture={e => { if ((e.target as HTMLElement).closest('input,textarea')) dispatch({type: 'begin'}) }}
    onBlurCapture={e => { if ((e.target as HTMLElement).closest('input,textarea')) dispatch({type: 'end'}) }}
    onKeyDownCapture={e => {
      if (e.nativeEvent.isComposing || e.altKey || !(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return
      if (e.code === 'KeyZ' || e.code === 'KeyY') { e.preventDefault(); e.stopPropagation(); void history(e.shiftKey || e.code === 'KeyY' ? 'redo' : 'undo') }
    }}>
    <Space wrap style={{position: 'fixed', top: 16, left: 16, zIndex: 31, maxWidth: 'calc(100vw - 260px)', padding: 8, background: '#eee6d9', borderRadius: 8}}>
      <DocumentSaveBar stableLayout kind={'control-' + model.draft.variant} snapshot={model.draft} serialize={serializeControl} restore={model.restore} applySnapshot={model.apply} prepareSnapshot={beforeAction} hasPendingEdits={pending}/>
      <Button icon={<UndoOutlined/>} disabled={!model.history.past.length && (!model.history.checkpoint || sameControlDraft(model.history.checkpoint, model.draft))} onClick={() => { void history('undo') }}>{lang === 'zh' ? '撤销' : lang === 'ja' ? '元に戻す' : 'Undo'}</Button>
      <Button icon={<RedoOutlined/>} disabled={!model.history.future.length} onClick={() => { void history('redo') }}>{lang === 'zh' ? '重做' : lang === 'ja' ? 'やり直す' : 'Redo'}</Button>
    </Space>
    {children}
  </div>
}

import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {runFineEditorWorker} from '../lib/fineEditorWorker'
import {prepareControlAssets, type ControlDraft} from './controlDocument'
import {localFetch} from './api'

export type ControlImages = Record<'sprite' | 'background' | 'foreground' | 'zombie' | 'zombie2' | 'zombie3' | 'zombie4', ImageBitmap | null>
const bundled = {
  sprite: 'decha.png', background: 'debg.png', foreground: 'qian384.png',
  zombie: 'zombie_walk.png', zombie2: 'zombie_walk2.png', zombie3: 'zombie_walk3.png', zombie4: 'zombie_walk4.png',
}
const close = (images: ControlImages) => Object.values(images).forEach(bitmap => bitmap?.close())
export function useControlImages(draft: ControlDraft, retained: () => Set<File>) {
  const latest = useRef(draft)
  useLayoutEffect(() => { latest.current = draft }, [draft])
  const selected = useMemo(() => [draft.sprite, draft.background, draft.foreground, draft.music], [draft.sprite, draft.background, draft.foreground, draft.music])
  const active = useRef<AbortController | null>(null)
  const [retry, setRetry] = useState(0), [images, setImages] = useState<ControlImages | null>(null)
  const [accepted, setAccepted] = useState<typeof selected | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [budget, setBudget] = useState(0)
  useEffect(() => {
    const abort = new AbortController(), owned: ControlImages = {sprite: null, background: null, foreground: null, zombie: null, zombie2: null, zombie3: null, zombie4: null}
    active.current = abort
    void (async () => {
      await Promise.resolve(); abort.signal.throwIfAborted(); setLoading(true); setError(''); setImages(null)
      const current = latest.current, context = await prepareControlAssets(current, abort.signal, [...retained()])
      const encoded = [...retained()].reduce((n, f) => n + f.size * 2, 0)
      let decoded = 0
      for (const name of Object.keys(owned) as (keyof ControlImages)[]) {
        if (current.variant === 'topdown' && !['sprite', 'background'].includes(name)) continue
        const file = name === 'sprite' ? current.sprite : name === 'background' ? current.background : name === 'foreground' ? current.foreground : null
        let source: Blob
        if (file) source = file
        else {
          const filename = name === 'background' && current.variant === 'arcade' ? 'hou384.png' : bundled[name]
          // This URL is selected only from the fixed bundled catalog, never a
          // document or model-provided path. User assets are imported Files.
          const response = await localFetch(import.meta.env.BASE_URL + filename, {signal: abort.signal})
          if (!response.ok) throw new Error('CONTROL_BUNDLED_ASSET_MISSING: ' + filename)
          source = await response.blob()
        }
        const result = await runFineEditorWorker({action: 'decodeBitmap', file: source, budget: context.memoryBudgetBytes, retained: encoded + decoded}, abort.signal, retry)
        if (abort.signal.aborted) { result.bitmap?.close(); abort.signal.throwIfAborted() }
        if (!result.bitmap) throw new Error('CONTROL_IMAGE_DECODE')
        owned[name] = result.bitmap; decoded += result.width * result.height * 8
      }
      abort.signal.throwIfAborted(); setBudget(context.memoryBudgetBytes); setImages({...owned}); setAccepted(selected)
    })().catch(reason => {
      close(owned)
      if (!abort.signal.aborted) { setError(String(reason)); abort.abort() }
    }).finally(() => { if (active.current === abort) setLoading(false) })
    return () => { abort.abort(); close(owned); if (active.current === abort) active.current = null }
  }, [selected, draft.variant, retained, retry])
  return {images: accepted === selected ? images : null, loading: loading || accepted !== selected && !error, error, budget, retry: () => setRetry(v => v + 1), cancel: () => {
    active.current?.abort(); setLoading(false); setError('CONTROL_IMAGE_LOAD_CANCELED')
  }}
}

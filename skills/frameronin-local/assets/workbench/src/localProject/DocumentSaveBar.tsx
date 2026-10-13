import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Select, Space, Typography } from 'antd'
import { useLanguage } from '../i18n/context'
import { jsonPost, localJson } from './api'
import { registerSaveGuard } from './navigationGuard'

type SavedDocument<T> = { id: string; kind: string; revision: number; payload: T }
type Props<S extends object, T> = {
  kind: string; snapshot: S; serialize: (snapshot: S) => Promise<T>; restore: (value: T) => Promise<S>
}

export default function DocumentSaveBar<S extends object, T>({ kind, snapshot, serialize, restore }: Props<S, T>) {
  const { lang } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState<S>(snapshot)
  const [available, setAvailable] = useState<{ id: string; revision: number }[]>([])
  const [selected, setSelected] = useState<string>()
  const record = useRef<{ id: string; revision: number; saved: S }>({ id: crypto.randomUUID(), revision: 0, saved: snapshot })
  const latest = useRef({ snapshot, serialize, restore }); latest.current = { snapshot, serialize, restore }
  const pending = useRef<Promise<void> | null>(null)
  const alive = useRef(true)
  const dirty = savedSnapshot !== snapshot
  const text = lang === 'zh' ? { save: '保存到项目', saveAs: '另存文档副本', load: '打开文档', select: '选择已保存文档', unsaved: '有未保存更改', saved: '已保存', fresh: '新文档', retry: '保存失败，请重试或另存文档副本；当前内容仍保留', loading: '读取文档失败；当前内容仍保留' }
    : lang === 'ja' ? { save: 'プロジェクトに保存', saveAs: 'コピーを保存', load: '文書を開く', select: '保存済み文書を選択', unsaved: '未保存の変更', saved: '保存済み', fresh: '新規文書', retry: '保存に失敗しました。再試行またはコピーを保存してください。編集内容は保持されています', loading: '読み込みに失敗しました。編集内容は保持されています' }
      : { save: 'Save to project', saveAs: 'Save document copy', load: 'Open document', select: 'Choose saved document', unsaved: 'Unsaved changes', saved: 'Saved', fresh: 'New document', retry: 'Save failed. Retry or save a copy; your current edits are preserved', loading: 'Load failed; your current edits are preserved' }
  const messages = useRef(text); messages.current = text

  const save = useCallback(async (force = false) => {
    if (pending.current) await pending.current
    const current = latest.current.snapshot
    if (!force && record.current.saved === current) return
    const operation = async () => {
      if (alive.current) { setSaving(true); setError('') }
      try {
        const payload = await latest.current.serialize(current)
        const { id, revision } = record.current
        const result = await localJson<{ revision: number }>(`/api/documents/${id}`, jsonPost({ kind, revision, payload }))
        record.current = { id, revision: result.revision, saved: current }
        if (alive.current) {
          setSavedSnapshot(current)
          setAvailable(items => [{ id, revision: result.revision }, ...items.filter(item => item.id !== id)])
          setSelected(value => value ?? id)
        }
      } catch (error) {
        if (alive.current) setError(`${messages.current.retry}: ${String(error)}`)
        throw error
      } finally { if (alive.current) setSaving(false) }
    }
    const request = operation(); pending.current = request
    try { await request } finally { if (pending.current === request) pending.current = null }
  }, [kind])

  useEffect(() => {
    alive.current = true
    localJson<{ id: string; kind: string; revision: number }[]>('/api/documents')
      .then(items => { if (alive.current) { const documents = items.filter(item => item.kind === kind); setAvailable(documents); setSelected(documents[0]?.id) } })
      .catch(error => { if (alive.current) setError(String(error)) })
    const unregister = registerSaveGuard(async () => {
      await save()
      if (record.current.saved !== latest.current.snapshot) await save()
      if (record.current.saved !== latest.current.snapshot) throw new Error('Document changed while saving')
    })
    return () => { alive.current = false; unregister() }
  }, [kind, save])
  useEffect(() => {
    if (!dirty || saving || error) return
    const timer = window.setTimeout(() => { void save().catch(() => {}) }, 1200)
    return () => window.clearTimeout(timer)
  }, [dirty, snapshot, saving, error, save])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (record.current.saved !== latest.current.snapshot || pending.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  return <Space wrap style={{ marginBottom: 16 }}>
    <Button loading={saving} onClick={() => { void save(true).catch(() => {}) }}>{text.save}</Button>
    <Button disabled={saving} onClick={() => {
      record.current = { ...record.current, id: crypto.randomUUID(), revision: 0 }
      setSelected(undefined)
      void save(true).catch(() => {})
    }}>{text.saveAs}</Button>
    <Select aria-label={text.select} placeholder={text.select} style={{ minWidth: 230 }} value={selected}
      disabled={saving} onChange={setSelected} options={available.map(item => ({ value: item.id, label: `${item.id.slice(0, 8)} · v${item.revision}` }))} />
    <Button disabled={saving || !selected} onClick={async () => {
      const documentId = selected
      try {
        await save()
        setSaving(true); setError('')
        const document = await localJson<SavedDocument<T>>(`/api/documents/${documentId}`)
        if (document.kind !== kind) throw new Error('Document kind mismatch')
        const restored = await latest.current.restore(document.payload)
        record.current = { id: document.id, revision: document.revision, saved: restored }
        setSavedSnapshot(restored)
      } catch (error) { setError(`${text.loading}: ${String(error)}`) } finally { setSaving(false) }
    }}>{text.load}</Button>
    <Typography.Text type={dirty ? 'warning' : 'secondary'}>{dirty ? text.unsaved : record.current.revision ? text.saved : text.fresh}</Typography.Text>
    {error && <Alert type="error" title={error} />}
  </Space>
}

import { jsonPost, localFetch, localJson } from './api'

type Version = { id: string; metadata: { kind: string; width?: number; height?: number; extension?: string } }
type Task = { id: string; state: string; progress: number; results: string[]; error?: { code: string; message: string } }
type Options = { signal?: AbortSignal; onProgress?: (progress: number) => void; onTask?: (taskId: string) => void }
const imported = new WeakMap<Blob, { project: string; version: string }>()

export async function runManagedTask(operation: string, files: Blob[], parameters: object, options: Options = {}) {
  const { signal } = options
  signal?.throwIfAborted()
  const { project } = await localJson<{ project: { id: string } }>('/api/project')
  const inputs: string[] = []
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted()
    const existing = imported.get(file)
    if (existing?.project === project.id) {
      await localJson(`/api/versions/${existing.version}`)
      inputs.push(existing.version)
    } else {
      const name = file instanceof File ? file.name : `selected-${String(index).padStart(4, '0')}.png`
      const form = new FormData(); form.append('file', new File([file], name, { type: file.type || 'image/png' }))
      const version = await localJson<Version>('/api/assets', { method: 'POST', body: form, signal })
      imported.set(file, { project: project.id, version: version.id }); inputs.push(version.id)
    }
  }
  signal?.throwIfAborted()
  let record = await localJson<Task>('/api/tasks', jsonPost({ operation, inputs, parameters }))
  options.onTask?.(record.id)
  const cancellation: { request: Promise<Task | null> | null; error?: unknown } = { request: null }
  const abort = () => {
    cancellation.request ??= localJson<Task>(`/api/tasks/${record.id}/cancel`, jsonPost({})).catch(error => {
      cancellation.error = error
      return null
    })
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) abort()
    while (['queued', 'running'].includes(record.state)) {
      signal?.throwIfAborted()
      options.onProgress?.(record.progress)
      await new Promise(resolve => window.setTimeout(resolve, 200))
      record = await localJson<Task>(`/api/tasks/${record.id}`, { signal })
    }
    signal?.throwIfAborted()
    if (record.state === 'canceled') throw new DOMException('Task canceled', 'AbortError')
    if (record.state !== 'succeeded') throw new Error(`${record.error?.code ?? 'TASK_FAILED'}: ${record.error?.message ?? 'Processing did not complete'}`)
    const outputs: { version: Version; blob: Blob }[] = []
    for (const id of record.results) {
      signal?.throwIfAborted()
      const version = await localJson<Version>(`/api/versions/${id}`, { signal })
      const response = await localFetch(`/api/versions/${id}/content`, { signal })
      if (!response.ok) throw new Error('The registered result could not be read')
      outputs.push({ version, blob: await response.blob() })
    }
    options.onProgress?.(1)
    return { taskId: record.id, outputs }
  } catch (error) {
    if (signal?.aborted && cancellation.request) {
      const confirmed = await cancellation.request
      if (cancellation.error) throw new Error(`Cancellation could not be confirmed for task ${record.id}: ${String(cancellation.error)}`)
      if (confirmed?.state !== 'canceled') throw new Error(`Task ${record.id} completed before cancellation. Inspect its recorded result.`)
    }
    throw error
  } finally { signal?.removeEventListener('abort', abort) }
}

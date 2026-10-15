import { jsonPost, localFetch, localJson } from './api'

export type ManagedVersion = { id: string; name?: string; metadata: { kind: string; bytes: number; width?: number; height?: number; frames?: number; extension?: string; durationSeconds?: number; sampleRate?: number; channels?: number; thumbnailDataUrl?: string } }
type Version = ManagedVersion
type Task = { id: string; state: string; progress: number; results: string[]; error?: { code: string; message: string } }
type Options = { signal?: AbortSignal; onProgress?: (progress: number) => void; onTask?: (taskId: string) => void; outputFilter?: (version: Version) => boolean }
const imported = new WeakMap<Blob, { project: string; version: string }>()
const importing = new WeakMap<Blob, { project: string; promise: Promise<Version> }>()

export async function importManagedInputs(files: Blob[], signal?: AbortSignal, onImported?: (file: Blob, version: ManagedVersion) => void) {
  signal?.throwIfAborted()
  const { project, memoryBudgetBytes } = await localJson<{ project: { id: string }; memoryBudgetBytes: number }>('/api/project/context')
  if (!Number.isFinite(memoryBudgetBytes) || memoryBudgetBytes <= 0) {
    throw new Error('The local project service does not provide a valid preview budget. Restart the matching skill runtime.')
  }
  const inputs: string[] = []
  const versions: ManagedVersion[] = []
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted()
    const existing = imported.get(file)
    if (existing?.project === project.id) {
      const version = await localJson<Version>(`/api/versions/${existing.version}`, { signal })
      inputs.push(existing.version)
      versions.push(version); onImported?.(file, version)
    } else {
      let pending = importing.get(file)
      if (pending?.project !== project.id) {
        const name = file instanceof File ? file.name : `selected-${String(index).padStart(4, '0')}.png`
        const form = new FormData(); form.append('file', new File([file], name, { type: file.type || 'image/png' }))
        const promise = localJson<Version>('/api/assets', { method: 'POST', body: form, signal })
          .then(version => { imported.set(file, { project: project.id, version: version.id }); return version })
        pending = { project: project.id, promise }; importing.set(file, pending)
      }
      try {
        const version = await pending.promise
        inputs.push(version.id); versions.push(version); onImported?.(file, version)
      }
      finally { if (importing.get(file) === pending) importing.delete(file) }
    }
  }
  signal?.throwIfAborted()
  return { project, memoryBudgetBytes, inputs, versions }
}

export function cacheManagedInput(file: Blob, project: string, version: string) {
  // Call only after loading and verifying this version in the current project.
  // Every subsequent use still revalidates it through the scoped version API.
  imported.set(file, { project, version })
}

export async function runManagedTask(operation: string, files: Blob[], parameters: object, options: Options = {}) {
  const { signal } = options
  const { project, inputs, memoryBudgetBytes } = await importManagedInputs(files, signal)
  signal?.throwIfAborted()
  const created = await localJson<{ id: string; state: string }>('/api/tasks', jsonPost({ operation, inputs, parameters }))
  let record: Task = { id: created.id, state: created.state, progress: 0, results: [] }
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
    let retainedBytes = 0
    for (const id of record.results) {
      signal?.throwIfAborted()
      const version = await localJson<Version>(`/api/versions/${id}`, { signal })
      if (options.outputFilter && !options.outputFilter(version)) continue
      const decodedBytes = version.metadata.kind === 'image'
        ? (version.metadata.width ?? 0) * (version.metadata.height ?? 0) * 4 : 0
      retainedBytes += version.metadata.bytes * 2 + decodedBytes * 4
      // Leave room for decoding and frontend copies. Larger results remain in
      // the project and can be downloaded through its result links.
      if (!Number.isFinite(memoryBudgetBytes) || retainedBytes > memoryBudgetBytes / 4) {
        throw new Error(`Task ${record.id} succeeded, but its results exceed the preview budget. Download them from Project assets and tasks.`)
      }
      const response = await localFetch(`/api/versions/${id}/content`, { signal })
      if (!response.ok) throw new Error('The registered result could not be read')
      outputs.push({ version, blob: await response.blob() })
    }
    options.onProgress?.(1)
    return { project, taskId: record.id, outputs }
  } catch (error) {
    if (signal?.aborted && cancellation.request) {
      const confirmed = await cancellation.request
      if (cancellation.error) throw new Error(`Cancellation could not be confirmed for task ${record.id}: ${String(cancellation.error)}`)
      if (confirmed?.state !== 'canceled') throw new Error(`Task ${record.id} completed before cancellation. Inspect its recorded result.`)
    }
    throw error
  } finally { signal?.removeEventListener('abort', abort) }
}

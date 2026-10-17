import { jsonPost, localFetch, localJson } from './api'
import { browserCanvasTask } from './browserCanvasTask'

export type ManagedVersion = { id: string; name?: string; metadata: { kind: string; bytes: number; width?: number; height?: number; displayWidth?:number;displayHeight?:number;orientation?:number;containerFormat?:string;frames?: number; extension?: string; durationSeconds?: number; sampleRate?: number; channels?: number; thumbnailDataUrl?: string } }
type Version = ManagedVersion
type Task = { id: string; state: string; progress: number; results: string[]; error?: { code: string; message: string } }
type Options = { signal?: AbortSignal; onProgress?: (progress: number) => void; onTask?: (taskId: string) => void; outputFilter?: (version: Version) => boolean }
const imported = new WeakMap<Blob, { project: string; version: string }>()
const importing = new WeakMap<Blob, { project: string; promise: Promise<Version> }>()

export async function loadManagedVersions(ids:string[],signal?:AbortSignal):Promise<ManagedVersion[]>{
  if(ids.length>24){
    const versions=await localJson<ManagedVersion[]>('/api/versions/manifest',{...jsonPost({versions:ids}),signal})
    if(!Array.isArray(versions)||versions.length!==ids.length||versions.some((version,index)=>version.id!==ids[index]))throw new Error('VERSION_MANIFEST_CHANGED')
    return versions
  }
  const values:ManagedVersion[]=new Array(ids.length);let next=0
  await Promise.all(Array.from({length:Math.min(8,ids.length)},async()=>{
    while(next<ids.length){
      const index=next++,version=await localJson<ManagedVersion>(`/api/versions/${ids[index]}`,{signal})
      if(version.id!==ids[index])throw new Error('VERSION_MANIFEST_CHANGED')
      values[index]=version
    }
  }))
  return values
}

export async function importManagedInputs(files: Blob[], signal?: AbortSignal, onImported?: (file: Blob, version: ManagedVersion) => void) {
  signal?.throwIfAborted()
  const { project, memoryBudgetBytes } = await localJson<{ project: { id: string }; memoryBudgetBytes: number }>('/api/project/context')
  if (!Number.isFinite(memoryBudgetBytes) || memoryBudgetBytes <= 0) {
    throw new Error('The local project service does not provide a valid preview budget. Restart the matching skill runtime.')
  }
  const inputs: string[] = []
  const versions: ManagedVersion[] = []
  const knownIds=[...new Set(files.map(file=>imported.get(file)).filter(value=>value?.project===project.id).map(value=>value!.version))]
  const knownVersions=knownIds.length>24?new Map((await loadManagedVersions(knownIds,signal)).map(version=>[version.id,version])):new Map<string,ManagedVersion>()
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted()
    const existing = imported.get(file)
    if (existing?.project === project.id) {
      const version = knownVersions.get(existing.version)??await localJson<Version>(`/api/versions/${existing.version}`, { signal })
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

/** Preserve a verified reference only when wrapping the same bytes in a renamed File. */
export function managedFile(source:Blob,name:string,type=source.type){
  const file=new File([source],name,{type})
  const reference=imported.get(source)
  if(reference)imported.set(file,reference)
  return file
}

export async function runManagedTask(operation: string, files: Blob[], parameters: object, options: Options = {}) {
  const { signal } = options
  const { project, inputs, memoryBudgetBytes } = await importManagedInputs(files, signal)
  signal?.throwIfAborted()
  const created = await localJson<{ id: string; state: string }>('/api/tasks', jsonPost({ operation, inputs, parameters }))
  let record: Task = { id: created.id, state: created.state, progress: 0, results: [] }
  options.onTask?.(record.id)
  const browserController=new AbortController()
  let browserRun:Promise<void>|null=null,browserError:unknown
  const cancellation: { request: Promise<Task | null> | null; error?: unknown } = { request: null }
  const abort = () => {
    browserController.abort()
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
      if(['image.spriteGifs','image.visibleWatermark','image.customScale','image.normal','image.expandShrink','image.scatterDetect','image.scatterExport','image.customSlicePlan','image.customSlice','image.customCompose'].includes(operation)&&(parameters as {renderer?:string}).renderer==='browser-worker'&&record.state==='running'&&!browserRun){
        browserRun=browserCanvasTask(record.id,files[0],parameters,browserController.signal,()=>options.onProgress?.(.2),{operation,budgetBytes:memoryBudgetBytes}).catch(error=>{browserError=error})
      }
      if(browserError)throw browserError
      options.onProgress?.(record.progress)
      await new Promise(resolve => window.setTimeout(resolve, 200))
      record = await localJson<Task>(`/api/tasks/${record.id}`, { signal })
    }
    signal?.throwIfAborted()
    if (record.state === 'canceled') throw new DOMException('Task canceled', 'AbortError')
    if (record.state !== 'succeeded') throw new Error(`${record.error?.code ?? 'TASK_FAILED'}: ${record.error?.message ?? 'Processing did not complete'}`)
    const manifest=await localJson<Version[]>(`/api/tasks/${record.id}/results`,{signal})
    if(manifest.length!==record.results.length||manifest.some((version,index)=>version.id!==record.results[index]))throw new Error('TASK_RESULTS_CHANGED')
    const versions=manifest.filter(version=>!options.outputFilter||options.outputFilter(version))
    const outputs: { version: Version; blob: Blob }[] = new Array(versions.length)
    let retainedBytes = 0
    for (const version of versions) {
      if(!Number.isSafeInteger(version.metadata.bytes)||version.metadata.bytes<0
        ||version.metadata.kind==='image'&&(!Number.isSafeInteger(version.metadata.width)||!Number.isSafeInteger(version.metadata.height)||(version.metadata.width??0)<1||(version.metadata.height??0)<1))throw new Error('TASK_RESULT_METADATA_INVALID')
      const decodedBytes = version.metadata.kind === 'image'
        ? (version.metadata.width ?? 0) * (version.metadata.height ?? 0) * 4 : 0
      retainedBytes += version.metadata.bytes * 2 + decodedBytes * 4
      // Leave room for decoding and frontend copies. Larger results remain in
      // the project and can be downloaded through its result links.
      if (!Number.isSafeInteger(retainedBytes)||retainedBytes<0||!Number.isFinite(memoryBudgetBytes) || retainedBytes > memoryBudgetBytes / 4) {
        throw new Error(`Task ${record.id} succeeded, but its results exceed the preview budget. Download them from Project assets and tasks.`)
      }
    }
    // Preflight the entire result set before fetching any content. A bounded
    // pool avoids thousands of serialized loopback round trips for grid cells.
    let next=0,downloaded=0
    const downloads=new AbortController(),abortDownloads=()=>downloads.abort()
    signal?.addEventListener('abort',abortDownloads,{once:true})
    try{await Promise.all(Array.from({length:Math.min(8,versions.length)},async()=>{
      while(next<versions.length){
        signal?.throwIfAborted()
        downloads.signal.throwIfAborted()
        const index=next++,version=versions[index]
        const response=await localFetch(`/api/versions/${version.id}/content`,{signal:downloads.signal})
        if(!response.ok)throw new Error('The registered result could not be read')
        outputs[index]={version,blob:await response.blob()}
        downloaded++
        if(versions.length>24&&downloaded%8===0)options.onProgress?.(.9+downloaded/versions.length*.1)
        signal?.throwIfAborted()
      }
    }))}catch(error){downloads.abort();throw error}
    finally{signal?.removeEventListener('abort',abortDownloads)}
    options.onProgress?.(1)
    return { project, taskId: record.id, outputs }
  } catch (error) {
    if (signal?.aborted && cancellation.request) {
      const confirmed = await cancellation.request
      if (cancellation.error) throw new Error(`Cancellation could not be confirmed for task ${record.id}: ${String(cancellation.error)}`)
      if (confirmed?.state !== 'canceled') throw new Error(`Task ${record.id} completed before cancellation. Inspect its recorded result.`)
    }
    throw error
  } finally { browserController.abort();signal?.removeEventListener('abort', abort) }
}

/** Restore existing control scenes through production serializers; never mutate the project. */
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {restoreControl, serializeControl} from '../.runtime/js/algorithms.mjs'
const args = process.argv.slice(2), b = args.indexOf('--base'), o = args.indexOf('--output')
assert(b >= 0 && o >= 0, 'Pass --base <owned-loopback-url> --output <json>')
const base = new URL(args[b + 1])
assert(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname) && Number(base.port) >= 1024 && Number(base.port) <= 65535 && base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash)
const native = globalThis.fetch; let reads = 0, metadataPosts = 0
globalThis.fetch = (input, init = {}) => {
  assert(typeof input === 'string' && input.startsWith('/api/'))
  const method = (init.method ?? 'GET').toUpperCase()
  assert(method === 'GET' || method === 'POST' && input === '/api/versions/manifest', 'No imports, processing, saves or arbitrary reads allowed')
  const headers = new Headers(init.headers)
  if (method === 'POST') { metadataPosts++; headers.set('Origin', base.origin) } else reads++
  return native(new URL(input, base), {...init, headers})
}
const get = async path => { const response = await fetch(path); assert(response.ok); return response.json() }
try {
  const before = await get('/api/project'), tasks = await get('/api/tasks'), docs = (await get('/api/documents')).filter(d => ['control-topdown', 'control-arcade'].includes(d.kind)), rows = []
  assert(docs.length > 0)
  for (const info of docs) {
    const saved = await get('/api/documents/' + info.id), draft = await restoreControl(saved.payload, saved.payload.variant)
    assert.deepEqual(await serializeControl(draft), saved.payload)
    rows.push({id: info.id, revision: saved.revision, variant: draft.variant, selectedAssets: ['sprite', 'background', 'foreground', 'music'].filter(k => draft[k]), obstacles: draft.obstacles, spawn: draft.spawn, musicOn: draft.musicOn, unchanged: true})
  }
  const after = await get('/api/project'), afterTasks = await get('/api/tasks'), signature = p => p.assets.map(a => [a.id, a.current_version])
  assert.deepEqual(signature(after), signature(before)); assert.deepEqual(afterTasks, tasks)
  const record = {projectId: before.project.id, documents: rows, assets: before.assets.length, tasks: tasks.length, reads, metadataPosts, writes: 0, unchanged: true}
  await writeFile(args[o + 1], JSON.stringify(record, null, 2) + '\n')
  process.stdout.write(JSON.stringify({documents: rows.length, assets: before.assets.length, tasks: tasks.length, writes: 0, unchanged: true}) + '\n')
} finally { globalThis.fetch = native }

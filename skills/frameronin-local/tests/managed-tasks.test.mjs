import assert from 'node:assert/strict'
import test from 'node:test'
import { runManagedTask, importManagedInputs } from '../.runtime/js/managed-tasks.mjs'

globalThis.window = globalThis
const nativeFetch = globalThis.fetch
function response(value) { return Response.json(value) }
function fixture(overrides = {}) {
  const requests = []
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? 'GET' })
    if (overrides[url]) return overrides[url](init)
    if (url === '/api/project') return response({ project: { id: 'test-project' }, memoryBudgetBytes: 2 * 1024 ** 3 })
    if (url === '/api/assets') return response({ id: 'input' })
    if (url === '/api/tasks') return response({ id: 'task', state: 'queued' })
    if (url === '/api/tasks/task') return response({ id: 'task', state: 'succeeded', progress: 1, results: ['output'] })
    if (url === '/api/versions/output') return response({ id: 'output', metadata: { kind: 'audio', bytes: 3 } })
    if (url === '/api/versions/output/content') return new Response(new Uint8Array([1, 2, 3]))
    throw new Error(`Unexpected request: ${url}`)
  }
  return requests
}
test('queued creation without progress still reports finite progress and returns registered content', async () => {
  fixture()
  const progress = []
  try {
    const result = await runManagedTask('audio.compress', [new Blob(['input'])], {}, { onProgress: value => progress.push(value) })
    assert.deepEqual(progress, [0, 1])
    assert.equal(result.taskId, 'task'); assert.equal(result.outputs[0].blob.size, 3)
  } finally { globalThis.fetch = nativeFetch }
})
test('accepted cancellation prevents late result downloads', async () => {
  const controller = new AbortController()
  const requests = fixture({ '/api/tasks/task/cancel': () => response({ id: 'task', state: 'canceled' }) })
  try {
    await assert.rejects(runManagedTask('image.flip', [new Blob(['input'])], {}, {
      signal: controller.signal, onTask: () => controller.abort(),
    }), { name: 'AbortError' })
    assert(requests.some(value => value.url.endsWith('/cancel')))
    assert(!requests.some(value => value.url.endsWith('/content')))
  } finally { globalThis.fetch = nativeFetch }
})
test('large decoded previews remain registered without being downloaded into frontend memory', async () => {
  const requests = fixture({ '/api/versions/output': () => response({ id: 'output',
    metadata: { kind: 'image', bytes: 3, width: 8192, height: 8192 } }) })
  try {
    await assert.rejects(runManagedTask('image.flip', [new Blob(['input'])], {}), /succeeded.*preview budget/)
    assert(!requests.some(value => value.url.endsWith('/content')))
  } finally { globalThis.fetch = nativeFetch }
})
test('missing runtime budget rejects before imports or job creation', async () => {
  const requests = fixture({ '/api/project': () => response({ project: { id: 'old-project' } }) })
  try {
    await assert.rejects(runManagedTask('image.flip', [new Blob(['input'])], {}), /valid preview budget/)
    assert.equal(requests.length, 1)
  } finally { globalThis.fetch = nativeFetch }
})
test('concurrent document save and processing share one selected input import', async () => {
  let imports = 0
  fixture({ '/api/assets': async () => { imports++;await new Promise(resolve=>setTimeout(resolve,20));return response({id:'shared-input'}) } })
  const selected = new Blob(['same selected file'])
  try {
    const [a,b] = await Promise.all([importManagedInputs([selected]),importManagedInputs([selected])])
    assert.equal(imports,1);assert.deepEqual(a.inputs,['shared-input']);assert.deepEqual(a.inputs,b.inputs)
  } finally { globalThis.fetch = nativeFetch }
})

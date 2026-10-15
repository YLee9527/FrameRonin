import assert from 'node:assert/strict'
import test from 'node:test'
import { runManagedTask, importManagedInputs,cacheManagedInput } from '../.runtime/js/managed-tasks.mjs'

globalThis.window = globalThis
const nativeFetch = globalThis.fetch
function response(value) { return Response.json(value) }
function fixture(overrides = {}) {
  const requests = []
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? 'GET' })
    if (overrides[url]) return overrides[url](init)
    if (url === '/api/project/context') return response({ project: { id: 'test-project' }, memoryBudgetBytes: 2 * 1024 ** 3 })
    if (url === '/api/assets') return response({ id: 'input' })
    if (url === '/api/tasks') return response({ id: 'task', state: 'queued' })
    if (url === '/api/tasks/task') return response({ id: 'task', state: 'succeeded', progress: 1, results: ['output'] })
    if (url === '/api/tasks/task/results') return response([{id:'output',metadata:{kind:'audio',bytes:3}}])
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
    assert.equal(result.project.id,'test-project')
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
  const requests = fixture({ '/api/tasks/task/results': () => response([{ id: 'output',
    metadata: { kind: 'image', bytes: 3, width: 8192, height: 8192 } }]) })
  try {
    await assert.rejects(runManagedTask('image.flip', [new Blob(['input'])], {}), /succeeded.*preview budget/)
    assert(!requests.some(value => value.url.endsWith('/content')))
  } finally { globalThis.fetch = nativeFetch }
})
test('missing runtime budget rejects before imports or job creation', async () => {
  const requests = fixture({ '/api/project/context': () => response({ project: { id: 'old-project' } }) })
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
test('result manifests are all preflighted, fetched with a bounded pool, and retain output order',async()=>{
  const outputs=Array.from({length:31},(_,index)=>String(index));let active=0,peak=0
  fixture({
    '/api/tasks/task':()=>response({id:'task',state:'succeeded',progress:1,results:outputs}),
    '/api/tasks/task/results':()=>response(outputs.map(id=>({id,metadata:{kind:'image',bytes:2,width:1,height:1}}))),
    ...Object.fromEntries(outputs.map(id=>[`/api/versions/${id}/content`,async()=>{
      active++;peak=Math.max(active,peak);await new Promise(resolve=>setTimeout(resolve,Number(id)%3+2));active--;return new Response(id)
    }]))
  })
  try{
    const result=await runManagedTask('image.findDuplicates',[new Blob(['input'])],{})
    assert(peak>1&&peak<=8);assert.deepEqual(result.outputs.map(output=>output.version.id),outputs)
    assert.deepEqual(await Promise.all(result.outputs.map(output=>output.blob.text())),outputs)
  }finally{globalThis.fetch=nativeFetch}
  const requests=fixture({
    '/api/tasks/task':()=>response({id:'task',state:'succeeded',progress:1,results:['output','large']}),
    '/api/tasks/task/results':()=>response([{id:'output',metadata:{kind:'image',bytes:1,width:1,height:1}},
      {id:'large',metadata:{kind:'image',bytes:1,width:8192,height:8192}}])
  })
  try{
    await assert.rejects(runManagedTask('image.findDuplicates',[new Blob(['input'])],{}),/preview budget/)
    assert(!requests.some(request=>request.url.endsWith('/content')))
  }finally{globalThis.fetch=nativeFetch}
})
test('large verified selections reuse one ordered metadata batch without uploading saved resources again',async()=>{
  const files=Array.from({length:40},(_,index)=>new File([String(index)],`frame-${index}.png`)),ids=files.map((_,index)=>`00000000-0000-0000-0000-${String(index+1).padStart(12,'0')}`)
  files.forEach((file,index)=>cacheManagedInput(file,'test-project',ids[index]))
  const requests=fixture({'/api/versions/manifest':options=>response(JSON.parse(options.body).versions.map(id=>({id,metadata:{kind:'image',bytes:1,width:1,height:1}})))})
  try{
    const selected=await importManagedInputs([...files].reverse())
    assert.deepEqual(selected.inputs,[...ids].reverse());assert.equal(requests.length,2)
    assert.equal(requests[1].url,'/api/versions/manifest');assert(!requests.some(request=>request.url==='/api/assets'))
  }finally{globalThis.fetch=nativeFetch}
})

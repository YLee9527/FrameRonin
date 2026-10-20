import assert from 'node:assert/strict'
import test from 'node:test'
import { runManagedTask, importManagedInputs,cacheManagedInput,managedFile } from '../.runtime/js/managed-tasks.mjs'

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
test('encoded-only image results keep registered bytes without reserving main-thread raster copies',async()=>{
 const requests=fixture({'/api/tasks/task/results':()=>response([{id:'output',metadata:{kind:'image',bytes:3,width:8192,height:8192}}])})
 try{
  const result=await runManagedTask('sequence.opticalFlow',[new Blob(['source'])],{},{imageResults:'encoded-only'})
  assert.equal(result.outputs[0].blob.size,3);assert(requests.some(r=>r.url.endsWith('/content')))
 }finally{globalThis.fetch=nativeFetch}
 const rejected=fixture({'/api/tasks/task/results':()=>response([{id:'output',metadata:{kind:'image',bytes:300*1024**2,width:256,height:256}}])})
 try{
  await assert.rejects(runManagedTask('sequence.opticalFlow',[new Blob(['source'])],{},{imageResults:'encoded-only'}),/preview budget/)
  assert(!rejected.some(r=>r.url.endsWith('/content')))
 }finally{globalThis.fetch=nativeFetch}
})
test('flow browser decode transfers its raster straight into an encoder Worker and publishes only encoded content',async()=>{
 const nativeWorker=globalThis.Worker,calls=[],workers=[];let uploaded=false
 class Worker{
  constructor(){assert(workers.every(w=>w.stopped));workers.push(this)}
  terminate(){this.stopped=true}
  postMessage(p,transfer){
   calls.push({action:p.action,transferred:!!transfer?.length&&transfer[0]===p.pixels?.buffer})
   const result=p.action==='decode'?{width:16,height:12,pixels:new Uint8ClampedArray(16*12*4)}:{width:16,height:12,blob:new Blob(['png'],{type:'image/png'})}
   queueMicrotask(()=>this.onmessage({data:{id:p.id,generation:p.generation,result}}))
  }
 }
 globalThis.Worker=Worker
 const requests=fixture({
  '/api/tasks':()=>response({id:'task',state:'running'}),
  '/api/tasks/task':()=>response({id:'task',state:uploaded?'succeeded':'running',progress:uploaded?1:.1,results:uploaded?['output']:[]}),
  '/api/tasks/task/browser':()=>response({ready:true,generation:0,state:'running'}),
  '/api/tasks/task/browser/heartbeat':()=>response({accepted:true}),
  '/api/tasks/task/browser/result':init=>{assert.equal(init.body.get('file').type,'image/png');uploaded=true;return response({accepted:true})},
 })
 try{
  await runManagedTask('image.flowNormalize',[new File(['selected'],'source.jpg',{type:'image/jpeg'})],{width:16,height:12,frontendBytes:0,renderer:'browser-worker'})
  assert.deepEqual(calls,[{action:'decode',transferred:false},{action:'encode',transferred:true}]);assert(workers.every(w=>w.stopped));assert(requests.some(r=>r.url.endsWith('/browser/result')))
 }finally{globalThis.Worker=nativeWorker;globalThis.fetch=nativeFetch}
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
test('renamed handoff Files reuse a verified version only inside its project',async()=>{
  const original=new File(['unchanged bytes'],'result.png',{type:'image/png'})
  cacheManagedInput(original,'test-project','verified-result')
  const renamed=managedFile(original,'fine.png')
  assert.equal(renamed.name,'fine.png');assert.equal(renamed.type,'image/png');assert.equal(await renamed.text(),await original.text())
  let requests=fixture({'/api/versions/verified-result':()=>response({id:'verified-result',metadata:{kind:'image',bytes:15,width:1,height:1}})})
  try{
    assert.deepEqual((await importManagedInputs([renamed])).inputs,['verified-result'])
    assert(!requests.some(request=>request.url==='/api/assets'))
    requests=fixture({'/api/project/context':()=>response({project:{id:'other-project'},memoryBudgetBytes:2*1024**3})})
    assert.deepEqual((await importManagedInputs([renamed])).inputs,['input'])
    assert.equal(requests.filter(request=>request.url==='/api/assets').length,1)
  }finally{globalThis.fetch=nativeFetch}
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

test('double-background host task sends both selected inputs in order and publishes only its own execution generation',async()=>{
 const previous=globalThis.Worker,workers=[],selected=[new File(['black'],'black.png'),new File(['white'],'white.png')]
 let published=false,postedGeneration
 globalThis.Worker=class{
  constructor(url){this.url=String(url);this.stopped=0;workers.push(this)}
  postMessage(request){this.request=request;queueMicrotask(()=>{
   this.onmessage({data:{id:'foreign',generation:7,blob:new Blob(['ignored'])}})
   this.onmessage({data:{id:request.id,generation:6,blob:new Blob(['stale'])}})
   this.onmessage({data:{id:request.id,generation:7,phase:'processing'}})
   this.onmessage({data:{id:request.id,generation:7,blob:new Blob(['managed PNG'],{type:'image/png'})}})
  })}
  terminate(){this.stopped++}
 }
 const requests=fixture({
  '/api/tasks/task':()=>response({id:'task',state:published?'succeeded':'running',progress:published?1:.1,results:published?['output']:[]}),
  '/api/tasks/task/browser':()=>response({ready:true,generation:7,state:'running'}),
  '/api/tasks/task/browser/heartbeat':()=>response({accepted:true}),
  '/api/tasks/task/browser/result':async options=>{postedGeneration=options.body.get('generation');assert.equal(await options.body.get('file').text(),'managed PNG');published=true;return response({accepted:true})},
 })
 try{
  const result=await runManagedTask('image.matteTool',selected,{renderer:'browser-worker',layout:{mode:'doubleBg',tolerance:70,edgeContrast:53}})
  assert.equal(result.taskId,'task');assert.equal(workers.length,1);assert(workers[0].url.includes('matteTool.worker'))
  assert.deepEqual(await Promise.all(workers[0].request.files.map(file=>file.text())),['black','white'])
  assert.equal(workers[0].request.generation,7);assert.equal(postedGeneration,'7');assert.equal(workers[0].stopped,1)
  assert.equal(requests.filter(request=>request.url.endsWith('/browser/result')).length,1)
 }finally{globalThis.fetch=nativeFetch;globalThis.Worker=previous}
})

test('video host tasks preserve frame ZIP/mask order, accept bounded frame progress and reject invalid progress before upload',async()=>{
 const previous=globalThis.Worker,selected=[new File(['frames'],'frames.zip'),new File(['mask'],'mask.png')]
 let published=false,bad=false,worker,updates=[]
 globalThis.Worker=class{
  constructor(url){this.url=String(url);this.stopped=false;worker=this}
  postMessage(request){this.request=request;queueMicrotask(()=>{
   this.onmessage({data:{id:request.id,generation:7,phase:'processing'}})
   this.onmessage({data:{id:request.id,generation:6,phase:'progress',progress:NaN}})
   this.onmessage({data:{id:request.id,generation:7,phase:'progress',progress:bad?NaN:.5}})
   if(!bad)this.onmessage({data:{id:request.id,generation:7,blob:new Blob(['zip'])}})
  })}
  terminate(){this.stopped=true}
 }
 const configure=()=>fixture({
  '/api/versions/input':()=>response({id:'input',metadata:{kind:'archive',bytes:6}}),
  '/api/tasks/task':()=>response({id:'task',state:published?'succeeded':'running',progress:published?1:.1,results:published?['output']:[]}),
  '/api/tasks/task/browser':()=>response({ready:true,generation:7}),
  '/api/tasks/task/browser/heartbeat':()=>response({accepted:true}),
  '/api/tasks/task/browser/failure':()=>response({accepted:true}),
  '/api/tasks/task/browser/result':()=>{published=true;return response({accepted:true})},
 })
 try{
  configure();await runManagedTask('video.frameTools',selected,{renderer:'browser-worker',layout:{mode:'matte',mask:true}},{onProgress:p=>updates.push(p)})
  assert(worker.url.includes('videoFrames.worker'));assert.deepEqual(await Promise.all(worker.request.files.map(f=>f.text())),['frames','mask']);assert(updates.includes(.5));assert(worker.stopped)
  bad=true;published=false;updates=[];const requests=configure()
  await assert.rejects(runManagedTask('video.frameTools',selected,{renderer:'browser-worker',layout:{mode:'matte',mask:true}}),/BROWSER_PROGRESS_INVALID/)
  assert(!requests.some(r=>r.url.endsWith('/browser/result')));assert(worker.stopped)
 }finally{globalThis.fetch=nativeFetch;globalThis.Worker=previous}
})

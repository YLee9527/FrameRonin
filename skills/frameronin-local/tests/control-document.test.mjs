import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../.runtime/js/algorithms.mjs'
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')

test('control documents restore selected assets by identity without tasks or reimports and reject invalid metadata before reads', async () => {
  const native = globalThis.fetch, files = [new File(['sprite'], 'sprite.png', {type: 'image/png'}), new File(['foreground'], 'fg.webp', {type: 'image/webp'}), new File(['music'], 'music.m4a', {type: 'audio/mp4'})]
  let imports = 0, reads = 0, budget = 2 * 1024 ** 3, mutate = v => v
  const version = key => {
    const i = Number(key.slice(-12)) - 1, f = files[i]
    return mutate({id: key, metadata: {bytes: f.size, ...(i === 2 ? {kind: 'audio', extension: '.m4a', durationSeconds: 1, channels: 2, sampleRate: 44100}
      : {kind: 'image', containerFormat: i === 1 ? 'WEBP' : 'PNG', frames: 1, width: 252, height: 252})}})
  }
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/project/context') return Response.json({project: {id: 'control-roundtrip'}, memoryBudgetBytes: budget})
    if (url === '/api/assets') { imports++; return Response.json(version(id(files.findIndex(f => f.name === init.body.get('file').name) + 1))) }
    if (String(url).startsWith('/api/versions/')) {
      const key = String(url).split('/')[3]
      if (String(url).endsWith('/content')) { reads++; return new Response(files[Number(key.slice(-12)) - 1]) }
      return Response.json(version(key))
    }
    throw new Error('Verification must not start tasks or access arbitrary resources: ' + url)
  }
  try {
    const draft = {...api.initialControlDraft('arcade'), sprite: files[0], background: files[0], foreground: files[1], music: files[2],
      spawn: {x: 41.25, y: 255.75, facing: -1}, obstacles: [{x: 10.5, y: 20.25, w: 30.75, h: 40.5}]}
    const stored = await api.serializeControl(draft), restored = await api.restoreControl(stored, 'arcade')
    assert.equal(restored.sprite, restored.background); assert.equal(imports, 3); assert.equal(reads, 3)
    assert.deepEqual(restored.obstacles, draft.obstacles); assert.deepEqual(restored.spawn, draft.spawn)
    assert.deepEqual(await api.serializeControl(restored), stored); assert.equal(imports, 3)
    const before = reads
    budget = 103 * 1024 ** 2
    assert.doesNotThrow(() => api.checkControlAssets(stored, new Map([1, 2, 3].map(n => [id(n), version(id(n))])), budget))
    await assert.rejects(api.restoreControl(stored, 'arcade', [], restored), /RESOURCE_LIMIT/); assert.equal(reads, before)
    budget = 2 * 1024 ** 3
    for (const update of [v => v.variant = 'topdown', v => v.background.path = '../private', v => v.bundledResourceVersion = 2,
      v => v.music.command = 'run', v => v.sprite.name = '../secret.png', v => v.spawn.x = NaN, v => v.spawn.facing = 0,
      v => v.obstacles[0].w = 700, v => v.obstacles[0].secret = true, v => v.obstacles = Array(2049).fill(v.obstacles[0]),
      v => v.background.name = 'alias.png', v => v.obstacleEditMode = 'false']) {
      const bad = structuredClone(stored); update(bad)
      await assert.rejects(api.restoreControl(bad, 'arcade')); assert.equal(reads, before)
    }
    for (const change of [v => ({...v, metadata: {...v.metadata, bytes: 2 * 1024 ** 3}}),
      v => v.id === id(3) ? {...v, metadata: {...v.metadata, kind: 'script_pending_review'}} : v,
      v => v.id === id(1) ? {...v, metadata: {...v.metadata, width: 200}} : v,
      v => v.id === id(2) ? {...v, metadata: {...v.metadata, frames: 2}} : v,
      v => v.id === id(3) ? {...v, metadata: {...v.metadata, durationSeconds: Infinity}} : v]) {
      mutate = change; await assert.rejects(api.restoreControl(stored, 'arcade')); assert.equal(reads, before)
    }
  } finally { globalThis.fetch = native }
})

test('control history covers complete obstacle gestures, selected files, settings and spawn without regenerating assets', () => {
  const source = new File(['sprite'], 'sprite.png'), initial = {...api.initialControlDraft('topdown'), sprite: source}
  let h = api.createControlHistory(initial)
  h = api.controlHistoryReducer(h, {type: 'begin'})
  for (const x of [10, 20, 30]) h = api.controlHistoryReducer(h, {type: 'change', update: d => ({...d, obstacles: [{x, y: 20, w: 40, h: 50}]})})
  h = api.controlHistoryReducer(h, {type: 'end'}); assert.equal(h.past.length, 1)
  h = api.controlHistoryReducer(h, {type: 'change', update: d => ({...d, musicOn: false, spawn: {...d.spawn, x: 80}})})
  h = api.controlHistoryReducer(h, {type: 'undo'}); assert.equal(h.present.musicOn, true); assert.equal(h.present.obstacles[0].x, 30)
  h = api.controlHistoryReducer(h, {type: 'undo'}); assert.equal(h.present, initial)
  h = api.controlHistoryReducer(h, {type: 'redo'}); assert.equal(h.present.sprite, source)
  h = api.controlHistoryReducer(h, {type: 'redo'}); assert.equal(h.present.spawn.x, 80)
  for (let i = 0; i < 80; i++) h = api.controlHistoryReducer(h, {type: 'change', update: d => ({...d, spawn: {...d.spawn, x: i}})})
  assert.equal(h.past.length, 50)
})

test('control resources include audio PCM, image rasters and retained history in the budget; edge obstacles stay in bounds', () => {
  const d = {...api.initialControlDraft('arcade'), formatVersion: 1, music: {versionId: id(1), name: 'music.m4a', type: 'audio/mp4'}}
  const versions = new Map([[id(1), {id: id(1), metadata: {kind: 'audio', bytes: 1000, durationSeconds: 120, channels: 2, sampleRate: 48000}}]])
  const estimate = api.checkControlAssets(d, versions, 2 * 1024 ** 3, 10000)
  assert.equal(estimate, 96 * 1024 ** 2 + 10000 + 2000 + 120 * 2 * 48000 * 8)
  assert.throws(() => api.checkControlAssets(d, versions, estimate - 1, 10000), /RESOURCE_LIMIT/)
  for (const variant of ['topdown', 'arcade']) {
    const rect = api.controlObstacle({x: 999, y: 999}, {x: 999, y: 999}, variant)
    assert.equal(rect.w, 4); assert.equal(rect.h, 4)
    assert.doesNotThrow(() => api.validateStoredControl({...api.initialControlDraft(variant), formatVersion: 1, obstacles: [rect]}))
  }
})

test('bitmap Worker transfers rendering ownership, closes foreign/late bitmaps and handles post failures', async () => {
  const native = globalThis.Worker, workers = []
  globalThis.Worker = class {
    constructor() { this.stops = 0; workers.push(this) }
    postMessage(request, transfer) { this.request = request; this.transfer = transfer }
    terminate() { this.stops++ }
  }
  try {
    const abort = new AbortController(), promise = api.runFineEditorWorker({action: 'decodeBitmap', file: new Blob(['image']), budget: 2 * 1024 ** 3, retained: 0}, abort.signal, 9), worker = workers[0]
    assert.deepEqual(worker.transfer, [])
    let closed = 0; const bitmap = {close: () => closed++}
    worker.onmessage({data: {id: worker.request.id, generation: 8, result: {bitmap}}}); assert.equal(closed, 1)
    abort.abort(); await assert.rejects(promise, {name: 'AbortError'}); assert.equal(worker.stops, 1)
    worker.onmessage({data: {id: worker.request.id, generation: 9, result: {bitmap}}}); assert.equal(closed, 2)
    const accepted = api.runFineEditorWorker({action: 'decodeBitmap', file: new Blob(['image']), budget: 2 * 1024 ** 3, retained: 0}, new AbortController().signal, 10), second = workers[1]
    second.onmessage({data: {id: second.request.id, generation: 10, result: {bitmap, width: 1, height: 1}}})
    assert.equal((await accepted).bitmap, bitmap); assert.equal(closed, 2); assert.equal(second.stops, 1)
    globalThis.Worker = class {
      constructor() { this.stops = 0; workers.push(this) }
      terminate() { this.stops++ }
      postMessage() { throw new DOMException('Cannot transfer', 'DataCloneError') }
    }
    await assert.rejects(api.runFineEditorWorker({action: 'decodeBitmap', file: new Blob(['image']), budget: 2 * 1024 ** 3, retained: 0}, new AbortController().signal, 11), {name: 'DataCloneError'})
    assert.equal(workers[2].stops, 1)
  } finally { globalThis.Worker = native }
})

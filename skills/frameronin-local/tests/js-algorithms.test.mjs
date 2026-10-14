import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { installDom } from '../scripts/js-runtime/dom.mjs'

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dom = installDom(path.join(skill, 'assets/workbench/public'), 2 * 1024 ** 3)
const algorithms = await import(pathToFileURL(path.join(skill, '.runtime/js/algorithms.mjs')).href)

function graph() {
  return {version:7,nodes:[{id:'input',type:'workflowInputImage',params:{imageIndex:1}},
    {id:'resize',type:'resizeHard',params:{w:16,h:16}}],edges:[{id:'edge',source:'input',target:'resize'}]}
}
test('strict graph and legacy repairs have separate behavior', () => {
  assert.equal(algorithms.validateStrictWorkflow(graph(),1).nodes[1].params.keepAspect,0)
  for(const change of [value=>value.nodes[1].type='unknown',value=>value.nodes[1].params.shell=1,
    value=>value.nodes[1].id='input',value=>value.edges[0].source='missing',value=>value.edges[0].targetPort='inA']) {
    const value=graph();change(value);assert.throws(()=>algorithms.validateStrictWorkflow(value,1))
  }
  const historical=graph();historical.nodes.push({id:'unknown',type:'unknown',params:{},x:0,y:0})
  const imported=algorithms.importLegacyWorkflow(JSON.stringify(historical))
  assert(imported.warnings.includes('NODE_DISCARDED:unknown'))
})
test('native canvas adapter preserves exact nearest-neighbor and grid pixels', async () => {
  const canvas=dom.createCanvas(8,8),context=canvas.getContext('2d')
  context.fillStyle='#ff0000';context.fillRect(0,0,4,4)
  const blob=new Blob([await canvas.encode('png')])
  const result=await algorithms.runWorkflowOnBlob(blob,[{id:'r',type:'resizeHard',params:{w:16,h:16,keepAspect:0}}])
  const image=await dom.loadImage(Buffer.from(await result.arrayBuffer()))
  const output=dom.createCanvas(16,16);output.getContext('2d').drawImage(image,0,0)
  const rgba=output.getContext('2d').getImageData(0,0,16,16).data
  assert.deepEqual([...rgba.slice(0,4)],[255,0,0,255])
  assert.deepEqual([...rgba.slice((15*16+15)*4,(15*16+15)*4+4)],[0,0,0,0])
})
test('PerfectPixel manual grid retains palette and reports a reduced grid', () => {
  const canvas=dom.createCanvas(64,64),context=canvas.getContext('2d')
  context.fillStyle='#ff0000';context.fillRect(0,0,32,64)
  context.fillStyle='#00ff00';context.fillRect(32,0,32,64)
  const result=algorithms.getPerfectPixel(context.getImageData(0,0,64,64),{gridSize:{cols:8,rows:8},refineIntensity:0,fixSquare:false})
  assert.equal(result.width,8);assert.equal(result.height,8)
  assert.deepEqual([...result.data.slice(0,4)],[255,0,0,255])
})
test('Rseprite shares one undo history across paint, frames, durations and layer state', () => {
  let state = algorithms.createInitialState(16,16)
  const reducer = algorithms.rsepriteReducer
  const actions = [
    {type:'PAINT_PIXELS',frameIndex:0,celIndex:0,pixels:[{x:2,y:3}],rgba:[255,0,0,255]},
    {type:'ADD_FRAME'},
    {type:'SET_FRAME_DURATION',frameIndex:1,durationMs:240},
    {type:'SET_LAYER_VISIBLE',layerIndex:0,visible:false},
    {type:'DELETE_FRAME',frameIndex:0},
  ]
  const snapshots = [state]
  for (const action of actions) { state=reducer(state,action);snapshots.push(state) }
  assert.equal(state.undoStack.length,5)
  for(let index=actions.length-1;index>=0;index--) {
    state=reducer(state,{type:'UNDO'})
    assert.deepEqual(state.document,snapshots[index].document)
    assert.equal(state.activeFrameIndex,snapshots[index].activeFrameIndex)
  }
  for(let index=1;index<snapshots.length;index++) {
    state=reducer(state,{type:'REDO'})
    assert.deepEqual(state.document,snapshots[index].document)
  }
  assert.equal(state.document.frames[0].durationMs,240)
  assert.equal(state.document.layers[0].visible,false)
})
test('stored Rseprite documents reject extra fields, invalid references and resource overflow', () => {
  const document = {formatVersion:1,width:16,height:16,layers:[{id:'layer',name:'Layer',visible:true,locked:false}],
    frames:[{id:'frame',durationMs:100,cels:[{layerId:'layer',versionId:'00000000-0000-4000-8000-000000000001'}]}]}
  algorithms.validateStoredRseprite(document)
  for (const change of [value=>value.command='write',value=>value.layers[0].locked='false',
    value=>value.layers.push(value.layers[0]),value=>value.frames[0].durationMs=0,
    value=>value.frames[0].cels[0].layerId='missing',value=>value.frames[0].cels[0].versionId='../private.png',
    value=>value.width=8192,value=>value.frames[0].cels[0].path='/secret']) {
    const value=structuredClone(document);change(value);assert.throws(()=>algorithms.validateStoredRseprite(value))
  }
})
test('stitch accepts shared or named ports and rejects mixing their semantics', () => {
  const value={version:7,nodes:[{id:'a',type:'workflowInputImage',params:{imageIndex:1}},
    {id:'b',type:'workflowInputImage',params:{imageIndex:2}},{id:'stitch',type:'simpleStitchVertical',params:{stitchMode:2}}],
    edges:[{id:'a-s',source:'a',target:'stitch'},{id:'b-s',source:'b',target:'stitch'}]}
  algorithms.validateStrictWorkflow(value,2)
  value.edges[0].targetPort='in1';value.edges[1].targetPort='in2'
  algorithms.validateStrictWorkflow(value,2)
  delete value.edges[0].targetPort
  assert.throws(()=>algorithms.validateStrictWorkflow(value,2))
})
test('private OpenCV loader preserves original optical-flow behavior without a thenable initialization loop', {timeout:10000}, async () => {
  const first=dom.createCanvas(64,64),second=dom.createCanvas(64,64)
  for (const [canvas,x] of [[first,10],[second,14]]) {
    const context=canvas.getContext('2d');context.fillStyle='#dd6633';context.fillRect(x,20,20,20)
  }
  const output=await algorithms.interpolateMidFrameOpticalFlow(first,second,{quality:'fast'})
  assert.equal(output.width,64);assert.equal(output.height,64)
  assert.deepEqual([...output.getContext('2d').getImageData(20,25,1,1).data],[221,102,51,255])
  assert.deepEqual([...output.getContext('2d').getImageData(0,0,1,1).data],[0,0,0,0])
})

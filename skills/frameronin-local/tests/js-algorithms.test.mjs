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

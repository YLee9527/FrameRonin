import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('visible reverse alpha retains the standalone 96 scale and rejects working sets before decode',async()=>{
 const mask=async()=>({alpha:new Float32Array(48*48).fill(.5),width:48,height:48})
 const image=new ImageData(new Uint8ClampedArray(200*200*4).fill(200),200,200)
 const info=await api.removeVisibleWatermark(image,{sizeMode:'96'},mask)
 assert.equal(info.alphaScale,.85);assert.equal(info.size,96)
 const at=(info.y*200+info.x)*4
 assert.equal(image.data[at],Math.round((200-.425*255)/.575));assert.equal(image.data[at+3],200)
 assert.equal(image.data[0],200)
 await assert.rejects(api.removeVisibleWatermark(image,{sizeMode:'97'},mask),/PARAMETERS/)
 api.checkWatermarkBudget(1025,1025,1000,2*1024**3,0)
 for(const args of [[8192,8192,1000,2*1024**3,0],[20,20,1000,2*1024**3,-1],[20,20,21*1024**2,2*1024**3,0]])assert.throws(()=>api.checkWatermarkBudget(...args),/RESOURCE_LIMIT/)
 await assert.rejects(api.removeVisibleWatermark(image,{sizeMode:'48'},async()=>{throw new Error('mask unavailable')}),/mask unavailable/)
})

test('watermark document preserves prior-result parameters, reuses versions and rejects mismatches before content reads',async()=>{
  const native=globalThis.fetch,p={sizeMode:'auto'},parameters={...p,renderer:'browser-worker',frontendBytes:0}
  const source=new File(['source'],'source.png',{type:'image/png'}),result=new File(['result'],'grid.png',{type:'image/png'})
  const report=new File([JSON.stringify({operation:'image.visibleWatermark',outputFrames:1,parameters})],'report.json',{type:'application/json'})
  const files=[source,result,report];let imports=0,reads=0,badSize=false,badState=false,badFormat=false
  const version=key=>{const i=[id(1),id(2),id(3)].indexOf(key);return {id:key,metadata:{kind:i===2?'document':'image',bytes:files[i].size,extension:i===2?'.json':'.png',containerFormat:badFormat&&i===0?'GIF':i===2?undefined:'PNG',width:i===0?13:badSize?25:13,height:11}}}
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:'grid'},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){imports++;return Response.json(version(id(files.findIndex(file=>file.name===options.body.get('file').name)+1)))}
    if(String(url).startsWith('/api/tasks/'))return Response.json({state:badState?'canceled':'succeeded',results:[id(2),id(3)],payload:{operation:'image.visibleWatermark',inputs:[id(1)],parameters}})
    if(String(url).startsWith('/api/versions/')){
      const key=String(url).split('/')[3]
      if(String(url).endsWith('/content')){reads++;return new Response(files[[id(1),id(2),id(3)].indexOf(key)])}
      return Response.json(version(key))
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try{
    // Current parameters may differ from the saved result. Its original task,
    // rather than current controls, determines the required output dimensions.
    const draft={...api.initialImageToolDraft('visibleWatermark'),parameters:{sizeMode:'48'},files:[source],results:[result],reportFile:report,taskId:id(10)}
    const stored=await api.serializeImageToolDocument(draft),restored=await api.restoreImageToolDocument(stored)
    assert.equal(restored.parameters.sizeMode,'48');assert.equal(await restored.results[0].text(),'result');assert.equal(imports,3)
    await api.serializeImageToolDocument(restored);assert.equal(imports,3)
    const before=reads
    badSize=true;await assert.rejects(api.restoreImageToolDocument(stored),/RESULT_DIMENSIONS/);assert.equal(reads,before);badSize=false
    badState=true;await assert.rejects(api.restoreImageToolDocument(stored),/TASK_MISMATCH/);assert.equal(reads,before);badState=false
    badFormat=true;await assert.rejects(api.restoreImageToolDocument(stored),/SOURCE_LIMIT/);assert.equal(reads,before);badFormat=false
    for(const change of [v=>v.parameters.command='run',v=>v.parameters.sizeMode='12',v=>v.files[0].name='../outside.png',v=>v.editedFile=v.results[0]]){
      const invalid=structuredClone(stored);change(invalid);await assert.rejects(api.restoreImageToolDocument(invalid));assert.equal(reads,before)
    }
  }finally{globalThis.fetch=native}
})

test('input preparation forwards cancellation before import and does not accept a canceled reply',async()=>{
 const native=globalThis.fetch,abort=new AbortController(),file=new File(['source'],'canceled.png',{type:'image/png'});let requests=0
 globalThis.fetch=async(url,options={})=>{
  requests++
  if(url==='/api/project/context')return Response.json({project:{id:'cancel-source'},memoryBudgetBytes:2*1024**3})
  assert.equal(options.signal,abort.signal);abort.abort();throw new DOMException('Canceled','AbortError')
 }
 try{
  await assert.rejects(api.prepareFineInput(file,0,abort.signal),{name:'AbortError'})
  const before=requests;await assert.rejects(api.prepareFineInput(file,0,abort.signal),{name:'AbortError'});assert.equal(requests,before)
 }finally{globalThis.fetch=native}
})

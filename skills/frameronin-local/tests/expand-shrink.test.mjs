import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('expand/shrink rejects unsafe dimensions and full working-set estimates before decoding',()=>{
  const p={columns:3,rows:2,cellWidth:8,cellHeight:9}
  api.checkExpandShrinkBudget(13,11,1000,p,2*1024**3,0)
  for(const values of [{...p,columns:0},{...p,rows:65},{...p,cellWidth:513},{...p,cellHeight:1.5}])assert.throws(()=>api.validateExpandShrinkParameters(values))
  for(const [width,height,parameters,budget,retained]of [[8192,8192,p,2*1024**3,0],[13,11,p,2*1024**3,2*1024**3],[13,11,{...p,columns:64,cellWidth:512},2*1024**3,0],[13,11,p,2*1024**3,-1]]){
    assert.throws(()=>api.checkExpandShrinkBudget(width,height,1000,parameters,budget,retained),/RESOURCE_LIMIT/)
  }
})

test('expand/shrink document preserves prior-result parameters, reuses versions and rejects mismatches before content reads',async()=>{
  const native=globalThis.fetch,p={columns:3,rows:2,cellWidth:8,cellHeight:9},parameters={...p,renderer:'browser-worker',frontendBytes:0}
  const source=new File(['source'],'source.png',{type:'image/png'}),result=new File(['result'],'grid.png',{type:'image/png'})
  const report=new File([JSON.stringify({operation:'image.expandShrink',outputFrames:1,parameters})],'report.json',{type:'application/json'})
  const files=[source,result,report];let imports=0,reads=0,badSize=false,badState=false,badFormat=false
  const version=key=>{const i=[id(1),id(2),id(3)].indexOf(key);return {id:key,metadata:{kind:i===2?'document':'image',bytes:files[i].size,extension:i===2?'.json':'.png',containerFormat:badFormat&&i===0?'GIF':i===2?undefined:'PNG',width:i===0?13:badSize?25:24,height:i===0?11:18}}}
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:'grid'},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){imports++;return Response.json(version(id(files.findIndex(file=>file.name===options.body.get('file').name)+1)))}
    if(String(url).startsWith('/api/tasks/'))return Response.json({state:badState?'canceled':'succeeded',results:[id(2),id(3)],payload:{operation:'image.expandShrink',inputs:[id(1)],parameters}})
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
    const draft={...api.initialImageToolDraft('expandShrink'),parameters:{...p,cellWidth:10},files:[source],results:[result],reportFile:report,taskId:id(10)}
    const stored=await api.serializeImageToolDocument(draft),restored=await api.restoreImageToolDocument(stored)
    assert.equal(restored.parameters.cellWidth,10);assert.equal(await restored.results[0].text(),'result');assert.equal(imports,3)
    await api.serializeImageToolDocument(restored);assert.equal(imports,3)
    const before=reads
    badSize=true;await assert.rejects(api.restoreImageToolDocument(stored),/RESULT_DIMENSIONS/);assert.equal(reads,before);badSize=false
    badState=true;await assert.rejects(api.restoreImageToolDocument(stored),/TASK_MISMATCH/);assert.equal(reads,before);badState=false
    badFormat=true;await assert.rejects(api.restoreImageToolDocument(stored),/SOURCE_LIMIT/);assert.equal(reads,before);badFormat=false
    for(const change of [v=>v.parameters.command='run',v=>v.parameters.columns=65,v=>v.files[0].name='../outside.png',v=>v.editedFile=v.results[0]]){
      const invalid=structuredClone(stored);change(invalid);await assert.rejects(api.restoreImageToolDocument(invalid));assert.equal(reads,before)
    }
  }finally{globalThis.fetch=native}
})

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('custom documents bind source, plans, slices and composition to original tasks while retaining later seam edits',async()=>{
 const native=globalThis.fetch,source=new File(['source'],'source.png',{type:'image/png'}),planParameters={mode:'grid',columns:2,rows:2,refine:'uniform',bandPercent:25,renderer:'browser-worker',frontendBytes:0}
 const plan=api.computeCustomPlan(new ImageData(new Uint8ClampedArray(16*12*4),16,12),{mode:'grid',columns:2,rows:2,refine:'uniform',bandPercent:25}),layout={mode:'grid',columns:2,rows:2},sizes=api.customSliceSizes(16,12,layout)
 const composition={rows:2,columns:2,grid:[[1,-2],[3,0]],expandUp:0,expandDown:0,expandLeft:0,expandRight:0}
 const report=(name,operation,parameters,rest)=>new File([JSON.stringify({operation,parameters,...rest})],name,{type:'application/json'})
 const files=[source,new File([JSON.stringify(plan)],'plan.json',{type:'application/json'}),report('plan-report.json','image.customSlicePlan',planParameters,{plannedCells:4}),new File(['zip'],'slices.zip',{type:'application/zip'}),report('slice-report.json','image.customSlice',{layout,renderer:'browser-worker',frontendBytes:0},{outputFrames:4,frameSizes:sizes}),new File(['png'],'composed.png',{type:'image/png'}),report('compose-report.json','image.customCompose',{composition,renderer:'browser-worker',frontendBytes:0},{outputFrames:1,width:16,height:12,sourceFrames:4})]
 let imports=0,reads=0,badSource=false,badTask=false
 const version=key=>{const i=Array.from({length:7},(_,n)=>id(n+1)).indexOf(key);return {id:key,metadata:{kind:i===0||i===5?'image':i===3?'archive':'document',bytes:files[i].size,extension:i===0||i===5?'.png':i===3?'.zip':'.json',containerFormat:i===0||i===5?'PNG':undefined,width:i===0&&badSource?17:i===0||i===5?16:undefined,height:i===0||i===5?12:undefined}}}
 const params=[planParameters,{layout,renderer:'browser-worker',frontendBytes:0},{composition,renderer:'browser-worker',frontendBytes:0}]
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'customdoc'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets'){imports++;return Response.json(version(id(files.findIndex(f=>f.name===options.body.get('file').name)+1)))}
  if(String(url).startsWith('/api/tasks/')){const i=[id(10),id(11),id(12)].indexOf(String(url).split('/').at(-1));return Response.json({state:badTask?'canceled':'succeeded',results:[id(i*2+2),id(i*2+3)],payload:{operation:['image.customSlicePlan','image.customSlice','image.customCompose'][i],inputs:[i===2?id(4):id(1)],parameters:params[i]}})}
  if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){reads++;return new Response(files[Array.from({length:7},(_,n)=>id(n+1)).indexOf(key)])}return Response.json(version(key))}
  throw new Error('Unexpected request '+url)
 }
 try{
  const draft={...api.initialCustomSliceDraft(),...api.customPlanSettings(plan),activeTab:'grid',sliceL7:true,previewColStarts:[0,7,16],spriteFile:source,info:{w:16,h:12},planResult:{data:files[1],report:files[2],taskId:id(10)},splitResult:{data:files[3],report:files[4],taskId:id(11)},composedResult:{data:files[5],report:files[6],taskId:id(12),input:files[3]}}
  const stored=await api.serializeCustomSlice(draft),restored=await api.restoreCustomSlice(stored)
  assert.equal(imports,7);assert.equal(reads,7);assert.equal(restored.previewColStarts[1],7);assert.equal(restored.composedResult.input,restored.splitResult.data)
  await api.serializeCustomSlice(restored);assert.equal(imports,7)
  const before=reads;badSource=true;await assert.rejects(api.restoreCustomSlice(stored),/SOURCE_METADATA/);assert.equal(reads,before);badSource=false
  badTask=true;await assert.rejects(api.restoreCustomSlice(stored),/DOCUMENT_TASK/);assert.equal(reads,before);badTask=false
  for(const change of [v=>v.command='run',v=>v.previewColStarts=[0,20,16],v=>v.spriteFile.name='../outside.png',v=>v.composedResult.input.versionId=id(1),v=>v.rearrangeGrid[0][0]=1.5]){const invalid=structuredClone(stored);change(invalid);await assert.rejects(api.restoreCustomSlice(invalid));assert.equal(reads,before)}
 }finally{globalThis.fetch=native}
})

test('seam drags, layouts and existing results share complete history without new processing',()=>{
 let history=api.createCustomSliceHistory()
 history=api.customSliceHistoryReducer(history,{type:'begin'})
 for(const n of [20,21,22])history=api.customSliceHistoryReducer(history,{type:'change',update:d=>({...d,l7PolyBendY:n})})
 history=api.customSliceHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
 history=api.customSliceHistoryReducer(history,{type:'undo'});assert.equal(history.present.l7PolyBendY,32)
 history=api.customSliceHistoryReducer(history,{type:'redo'});assert.equal(history.present.l7PolyBendY,22)
 const result={data:new File(['zip'],'slices.zip'),report:new File(['report'],'report.json'),taskId:id(1)}
 history=api.customSliceHistoryReducer(history,{type:'change',update:d=>({...d,splitResult:result})})
 history=api.customSliceHistoryReducer(history,{type:'undo'});assert.equal(history.present.splitResult,null)
 history=api.customSliceHistoryReducer(history,{type:'redo'});assert.equal(history.present.splitResult.data,result.data)
})

test('asset preview protocol ignores foreign and canceled late replies and terminates its Worker',async()=>{
 const previous=globalThis.Worker,workers=[]
 globalThis.Worker=class{constructor(){workers.push(this);this.stopped=0}postMessage(v){this.request=v}terminate(){this.stopped++}}
 try{
  const file=new File(['source'],'source.png'),abort=new AbortController(),pending=api.customSliceAssetWorker(file,'source',2*1024**3,0,abort.signal),worker=workers[0]
  worker.onmessage({data:{id:'other',generation:0,error:'foreign'}});assert.equal(worker.stopped,0)
  abort.abort();await assert.rejects(pending,{name:'AbortError'});worker.onmessage({data:{...worker.request,preview:new Blob(['png'],{type:'image/png'}),width:16,height:12}});assert.equal(worker.stopped,1)
  const next=api.customSliceAssetWorker(file,'archive',2*1024**3,0,new AbortController().signal),w=workers[1]
  assert.equal(w.request.action,'archive');w.onmessage({data:{...w.request,files:[new Blob(['png'])],previews:[],sizes:[{w:1,h:1}]}});await assert.rejects(next,/RESPONSE/);assert.equal(w.stopped,1)
 }finally{globalThis.Worker=previous}
})

test('legacy TXT import retains valid signed grids and reports normalized or discarded fields',()=>{
 const valid={rows:2,cols:2,grid:[[1,-2],[0,3]]};assert.deepEqual(api.parseRearrangeText(JSON.stringify(valid),3),{...valid,corrections:[]})
 const parsed=api.parseRearrangeText(JSON.stringify({rows:1.5,cols:2,grid:[[1.8,9,5]],extra:'ignored'}),3)
 assert.deepEqual(parsed.grid,[[1,0]]);assert.ok(parsed.corrections.length>=3)
 assert.throws(()=>api.parseRearrangeText('[]',3),/REARRANGE_TEXT/)
})

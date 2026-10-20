import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../.runtime/js/algorithms.mjs'
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0')

test('flow documents preserve each frozen grid/flow/export recipe and reject invalid provenance before body reads',async()=>{
 const native=globalThis.fetch,files=new Map()
 for(const n of [1,2,3,4,5,9,11,12])files.set(n,new File(['png-'+n],'frame-'+n+'.png',{type:'image/png'}))
 files.set(7,new File(['zip'],'frames.zip',{type:'application/zip'}))
 const options=api.initialFlowDraft().options
 const tasks=new Map([
  [id(101),{state:'succeeded',results:[11,12,13].map(id),payload:{operation:'image.flowSplit',inputs:[id(1)],parameters:{columns:2,rows:1,frontendBytes:0}}}],
  [id(102),{state:'succeeded',results:[3,4,5,6].map(id),payload:{operation:'sequence.opticalFlow',inputs:[11,12].map(id),parameters:{...options,frontendBytes:0}}}],
  [id(103),{state:'succeeded',results:[7,8].map(id),payload:{operation:'sequence.flowExport',inputs:[3,4,5].map(id),parameters:{format:'zip',columns:2,frontendBytes:0}}}],
  [id(104),{state:'succeeded',results:[9,10].map(id),payload:{operation:'sequence.flowExport',inputs:[3,4,5].map(id),parameters:{format:'sheet',columns:2,frontendBytes:0}}}],
 ])
 const reports={13:{method:'original-advanced-pixel-grid-export',outputFrames:2,frameDimensions:[{width:64,height:48},{width:64,height:48}]},
  6:{method:'original-opencv-farneback',inputFrames:2,outputFrames:3,processingDimensions:{width:64,height:48}},
  8:{method:'original-advanced-pixel-grid-export',format:'zip',frameCount:3},
  10:{method:'original-advanced-pixel-grid-export',format:'sheet',frameCount:3,columns:2,width:128,height:96}}
 for(const [n,value] of Object.entries(reports)){
  const t=[...tasks.values()].find(v=>v.results.at(-1)===id(Number(n)))
  files.set(Number(n),new File([JSON.stringify({...value,operation:t.payload.operation,parameters:t.payload.parameters})],'report-'+n+'.json',{type:'application/json'}))
 }
 let imports=0,contents=0,taskChange=null,metadataChange=null
 const version=key=>{const n=Number(key.slice(-12)),file=files.get(n),report=[6,8,10,13,15].includes(n)
  const value={id:key,metadata:{kind:report?'document':n===7?'archive':'image',extension:report?'.json':n===7?'.zip':'.png',bytes:file.size,
   ...(!report&&n!==7?{width:[1,9,14].includes(n)?128:64,height:n===9?96:48,containerFormat:'PNG',frames:1}:{})}}
  return metadataChange?metadataChange(value):value
 }
 globalThis.fetch=async(url,init={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'flow-doc'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets'){imports++;const name=init.body.get('file').name,n=[...files].find(([,f])=>f.name===name)[0];return Response.json(version(id(n)))}
  if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){contents++;return new Response(files.get(Number(key.slice(-12))))}return Response.json(version(key))}
  if(String(url).startsWith('/api/tasks/')){const key=String(url).split('/').at(-1),t=structuredClone(tasks.get(key));return Response.json(taskChange?taskChange(t,key):t)}
  throw new Error('Unexpected processing or unscoped path '+url)
 }
 const result=(taskNo,out,report,inputs)=>({taskId:id(taskNo),outputs:out.map(n=>files.get(n)),report:files.get(report),inputs:inputs.map(n=>files.get(n))})
 try{
  const draft={...api.initialFlowDraft(),inputMode:'sheet',sheet:files.get(1),files:[files.get(2)],columns:3,options:{...options,alpha:.8},
   split:result(101,[11,12],13,[1]),flow:result(102,[3,4,5],6,[11,12]),zip:result(103,[7],8,[3,4,5]),sprite:result(104,[9],10,[3,4,5])}
  const stored=await api.serializeFlow(draft),restored=await api.restoreFlow(stored)
  const legacy=structuredClone(stored);delete legacy.normalizations;assert.deepEqual(api.validateStoredFlow(legacy),stored)
  assert.equal(restored.columns,3);assert.equal(restored.options.alpha,.8)
  assert.equal(restored.flow.inputs[0],restored.split.outputs[0]);assert.equal(restored.sprite.inputs[2],restored.flow.outputs[2])
  assert.deepEqual(await api.serializeFlow(restored),stored);assert.equal(imports,13)
  const before=contents
  for(const mutate of [v=>v.command='run',v=>v.options.alpha=NaN,v=>v.view.pageSize='24',v=>v.flow.outputs.pop(),v=>v.flow.inputs.reverse(),v=>v.split.inputs=[v.files[0]],v=>v.sprite.inputs.reverse(),v=>v.zip.outputs[0].versionId=v.flow.outputs[0].versionId,v=>v.files[0].name='../other.png',v=>v.flow.taskId=v.split.taskId,v=>v.normalizations=null,v=>v.split=false]){
   const bad=structuredClone(stored);mutate(bad);assert.throws(()=>api.validateStoredFlow(bad))
  }
  for(const [target,mutate] of [[102,t=>t.state='canceled'],[101,t=>t.payload.parameters.columns=3],[102,t=>t.payload.inputs.reverse()],[102,t=>t.results.reverse()],[104,t=>t.payload.parameters.columns=3],[103,t=>t.payload.parameters.path='../out.png']]){
   taskChange=(t,key)=>{if(key===id(target))mutate(t);return t};await assert.rejects(api.restoreFlow(stored));assert.equal(contents,before)
  }
  taskChange=null
  for(const change of [v=>v.id===id(11)?{...v,metadata:{...v.metadata,width:63}}:v,v=>v.id===id(7)?{...v,metadata:{...v.metadata,kind:'image'}}:v,v=>v.id===id(1)?{...v,metadata:{...v.metadata,bytes:600*1024**2}}:v]){
   metadataChange=change;await assert.rejects(api.restoreFlow(stored));assert.equal(contents,before)
  }
  metadataChange=null
  const old=files.get(6),bad=JSON.parse(await old.text());bad.parameters.alpha=.7;files.set(6,new File([JSON.stringify(bad)],old.name,{type:old.type}))
  await assert.rejects(api.restoreFlow(stored),/REPORT/);files.set(6,old)
  // The files path uses already-selected formal versions, without grid work.
  const multiple={...stored,inputMode:'files',files:stored.split.outputs,sheet:null,split:null}
  const filesRestored=await api.restoreFlow(multiple);assert.equal(filesRestored.flow.inputs[0],filesRestored.files[0]);assert.deepEqual(await api.serializeFlow(filesRestored),multiple);assert.equal(imports,13)
  // Browser decoding is a formal, immutable stage, not a hidden source copy.
  metadataChange=v=>v.id===id(1)?{...v,metadata:{...v.metadata,containerFormat:'JPEG',extension:'.jpg'}}:v
  const beforeDecode=contents;await assert.rejects(api.restoreFlow(stored),/BROWSER_DECODE_REQUIRED/);assert.equal(contents,beforeDecode)
  files.set(14,new File(['normalized'],'decoded.png',{type:'image/png'}))
  const decodeParams={width:128,height:48,renderer:'browser-worker',frontendBytes:0}
  files.set(15,new File([JSON.stringify({method:'original-host-canvas-worker',operation:'image.flowNormalize',parameters:decodeParams,outputFrames:1,generation:0})],'decode-report.json',{type:'application/json'}))
  tasks.set(id(105),{state:'succeeded',results:[14,15].map(id),payload:{operation:'image.flowNormalize',inputs:[id(1)],parameters:decodeParams}})
  const ref=n=>({versionId:id(n),name:files.get(n).name,type:files.get(n).type}),normalized=structuredClone(stored)
  normalized.normalizations=[{taskId:id(105),inputs:[normalized.sheet],outputs:[ref(14)],report:ref(15)}]
  normalized.split.inputs=[ref(14)];tasks.get(id(101)).payload.inputs=[id(14)]
  const decoded=await api.restoreFlow(normalized);assert.equal(decoded.normalizations[0].inputs[0],decoded.sheet);assert.equal(decoded.split.inputs[0],decoded.normalizations[0].outputs[0])
  assert.deepEqual(await api.serializeFlow(decoded),normalized);assert.equal(imports,13)
  const noMoreReads=contents;taskChange=(t,key)=>{if(key===id(105))t.payload.parameters.width=127;return t}
  await assert.rejects(api.restoreFlow(normalized));assert.equal(contents,noMoreReads)
 }finally{globalThis.fetch=native}
})
test('only canonical PNG sources can bypass the original browser decoder',()=>{
 assert.equal(api.flowNeedsBrowserDecode({containerFormat:'PNG',orientation:1}),false)
 for(const m of [{containerFormat:'PNG',orientation:2},{containerFormat:'JPEG'},{containerFormat:'WEBP'},{containerFormat:'GIF'}])assert.equal(api.flowNeedsBrowserDecode(m),true)
})

test('flow settings and immutable task outputs share gesture history without dispatching new jobs',()=>{
 const input=new File(['input'],'frame10.png'),second=new File(['second'],'frame2.png'),png=new File(['output'],'frame.png'),report=new File(['report'],'report.json')
 let h=api.createFlowHistory({...api.initialFlowDraft(),files:[input,second]})
 assert.deepEqual(api.sortFlowFiles(h.present.files),[second,input])
 h=api.flowHistoryReducer(h,{type:'begin'})
 for(const alpha of [.6,.7,.8])h=api.flowHistoryReducer(h,{type:'change',update:d=>({...d,options:{...d.options,alpha}})})
 h=api.flowHistoryReducer(h,{type:'end'});assert.equal(h.past.length,1)
 h=api.flowHistoryReducer(h,{type:'undo'});assert.equal(h.present.options.alpha,.5)
 h=api.flowHistoryReducer(h,{type:'redo'});assert.equal(h.present.options.alpha,.8)
 const flow={outputs:[png],report,inputs:[input],taskId:id(1)}
 h=api.flowHistoryReducer(h,{type:'change',update:d=>({...d,flow})})
 h=api.flowHistoryReducer(h,{type:'undo'});assert.equal(h.present.flow,null)
 h=api.flowHistoryReducer(h,{type:'redo'});assert.equal(h.present.flow,flow)
 for(let i=0;i<80;i++)h=api.flowHistoryReducer(h,{type:'change',update:d=>({...d,sheetColumns:i+1})})
 assert.equal(h.past.length,50);assert(api.flowFiles([h.present]).has(input));assert(api.flowFiles([h.present]).has(png))
})

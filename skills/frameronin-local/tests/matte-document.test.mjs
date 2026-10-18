import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../.runtime/js/algorithms.mjs'

const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
test('matte documents preserve all three result stages, verify their selected-input chain and reuse versions on reopening',async()=>{
 const native=globalThis.fetch,files=new Map([[1,new File(['black'],'black.png')],[2,new File(['white'],'white.png')]])
 const layouts=[{mode:'doubleBg',tolerance:70,edgeContrast:53},{mode:'repair'},{mode:'frontier',erosion:25}],inputs=[[1,2],[3],[5]]
 const tasks=new Map(layouts.map((layout,i)=>[id(101+i),{state:'succeeded',results:[id(3+i*2),id(4+i*2)],payload:{operation:'image.matteTool',inputs:inputs[i].map(id),parameters:{layout,renderer:'browser-worker',frontendBytes:0}}}]))
 for(let i=0;i<3;i++){
  files.set(3+i*2,new File([`stage-${i}`],`stage-${i}.png`,{type:'image/png'}))
  // JSON property order is not a semantic parameter difference.
  const p=tasks.get(id(101+i)).payload.parameters
  files.set(4+i*2,new File([JSON.stringify({operation:'image.matteTool',mode:layouts[i].mode,width:43,height:37,outputFrames:1,parameters:{frontendBytes:p.frontendBytes,renderer:p.renderer,layout:p.layout}})],`report-${i}.json`,{type:'application/json'}))
 }
 let imports=0,contents=0,taskChange=null,metadataChange=null
 const version=key=>{const n=Number(key.slice(-12)),file=files.get(n),report=n>=4&&n%2===0;let value={id:key,metadata:{kind:report?'document':'image',bytes:file.size,extension:report?'.json':'.png',containerFormat:report?undefined:'PNG',width:report?undefined:43,height:report?undefined:37,frames:1}};if(metadataChange)value=metadataChange(value);return value}
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'matte-project'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets'){imports++;const n=[...files].find(([,file])=>file.name===options.body.get('file').name)[0];return Response.json(version(id(n)))}
  if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){contents++;return new Response(files.get(Number(key.slice(-12))))}return Response.json(version(key))}
  if(String(url).startsWith('/api/tasks/')){const row=structuredClone(tasks.get(String(url).split('/').at(-1)));return Response.json(taskChange?taskChange(row):row)}
  throw new Error('Unexpected task execution or request: '+url)
 }
 const result=i=>({file:files.get(3+i*2),inputs:inputs[i].map(n=>files.get(n)),report:files.get(4+i*2),taskId:id(101+i)})
 try{
  const draft={...api.initialMatteDraft(),settings:{...api.initialMatteDraft().settings,postErosion:40},view:{backgroundActive:false,background:'#403020',zoom:2.5,panX:42,panY:-13},black:files.get(1),white:files.get(2),raw:result(0),repaired:result(1),eroded:result(2)}
  const stored=await api.serializeMatte(draft),restored=await api.restoreMatte(stored)
  assert.equal(imports,8);assert.equal(contents,8);assert.equal(restored.eroded.taskId,id(103));assert.equal(restored.settings.postErosion,40);assert.equal(restored.view.panY,-13)
  assert.equal(restored.repaired.inputs[0],restored.raw.file);assert.equal(restored.eroded.inputs[0],restored.repaired.file)
  await api.serializeMatte(restored);assert.equal(imports,8)
  const before=contents
  for(const mutate of [d=>d.command='run',d=>d.mode='unknown',d=>d.source=d.black,d=>d.view.panX=Infinity,d=>d.settings.postErosion=101,d=>d.black.name='../private.png',d=>d.raw.inputs.reverse(),d=>d.repaired.inputs=[d.raw.report],d=>d.eroded.inputs=[d.raw.file],d=>d.eroded.taskId=d.raw.taskId,d=>d.raw.file.versionId=d.black.versionId,d=>d.raw=null]){
   const invalid=structuredClone(stored);mutate(invalid);await assert.rejects(api.restoreMatte(invalid));assert.equal(contents,before)
  }
  for(const mutate of [t=>({...t,state:'canceled'}),t=>({...t,results:[id(1),id(2)]}),t=>{t.payload.inputs=[id(99)];return t},t=>{t.payload.parameters.renderer='native';return t},t=>{t.payload.parameters.layout.command='run';return t}]){
   taskChange=mutate;await assert.rejects(api.restoreMatte(stored));assert.equal(contents,before)
  }
  taskChange=null;metadataChange=v=>v.id===id(3)?{...v,metadata:{...v.metadata,width:42}}:v
  await assert.rejects(api.restoreMatte(stored),/OUTPUT/);assert.equal(contents,before);metadataChange=null
  const original=files.get(4),bad=JSON.parse(await original.text());bad.parameters.layout.tolerance=80;files.set(4,new File([JSON.stringify(bad)],original.name,{type:'application/json'}))
  await assert.rejects(api.restoreMatte(stored),/REPORT/);files.set(4,original)
  await assert.rejects(api.serializeMatte({...draft,settings:{...draft.settings,command:'run'}}));assert.equal(imports,8)
 }finally{globalThis.fetch=native}
})

test('matte gestures, mode changes and existing raw/repaired/eroded versions share one bounded undo history',()=>{
 const file=new File(['existing result'],'result.png'),report=new File(['report'],'report.json'),raw={file,report,inputs:[],taskId:id(1)}
 let history=api.createMatteHistory({...api.initialMatteDraft(),raw})
 history=api.matteHistoryReducer(history,{type:'begin'})
 for(const panX of [10,20,30])history=api.matteHistoryReducer(history,{type:'change',update:d=>({...d,view:{...d.view,panX}})})
 history=api.matteHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
 history=api.matteHistoryReducer(history,{type:'undo'});assert.equal(history.present.view.panX,0)
 history=api.matteHistoryReducer(history,{type:'redo'});assert.equal(history.present.view.panX,30);assert.equal(history.present.raw.file,file)
 history=api.matteHistoryReducer(history,{type:'change',update:d=>({...d,mode:'chroma',raw:null,repaired:null,eroded:null})})
 history=api.matteHistoryReducer(history,{type:'undo'});assert.equal(history.present.mode,'doubleBg');assert.equal(history.present.raw,raw)
 history=api.matteHistoryReducer(history,{type:'redo'});assert.equal(history.present.mode,'chroma');assert.equal(history.present.raw,null)
 assert.deepEqual(api.matteLayout(api.initialMatteDraft()),{mode:'doubleBg',tolerance:70,edgeContrast:53})
})

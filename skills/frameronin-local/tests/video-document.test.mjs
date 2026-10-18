import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../.runtime/js/algorithms.mjs'

const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
test('video document restores its immutable source/capture/selection/mask/compose lineage without reprocessing',async()=>{
 const native=globalThis.fetch,files=new Map([[1,new File(['video'],'original.mp4',{type:'video/mp4'})],[2,new File(['mask'],'brush.png',{type:'image/png'})]])
 const capture={sourceWidth:64,sourceHeight:48,start:0,end:1,fps:10,maxFrames:300,crop:{left:0,top:0,right:0,bottom:0}},timestamps=api.videoCapturePlan(capture,5,2*1024**3,0).timestamps
 const raw={mode:'compose',width:44,height:32,padding:2,spacing:1,columns:2,timestamps:[timestamps[0],timestamps[2],timestamps[8]],strokeWidth:0,strokeColor:'#000000'}
 const layouts=[capture,{mode:'analyze'},{mode:'matte',selected:[0,2,8],background:'#ffffff',tolerance:40,feather:10,mask:true},raw,{...raw,strokeWidth:1.5,strokeColor:'#995522'},{mode:'archive',selected:timestamps.map((_,i)=>i),kind:'extracted'},{mode:'archive',selected:[0,1,2],kind:'matted'}]
 const inputNumbers=[[1],[3],[3,2],[7],[7],[3],[7]],keys=['capture','analysis','processed','rawSheet','styledSheet','rawDownload','processedDownload']
 const tasks=new Map(layouts.map((layout,i)=>[id(101+i),{state:'succeeded',results:[id(3+i*2),id(4+i*2)],payload:{operation:i===0?'video.capture':'video.frameTools',inputs:inputNumbers[i].map(id),parameters:{layout,renderer:'browser-worker',frontendBytes:0}}}]))
 for(let i=0;i<layouts.length;i++){
  const t=tasks.get(id(101+i)),layout=layouts[i]
  files.set(3+i*2,new File([`archive-${i}`],`result-${i}.zip`,{type:'application/zip'}))
  const report={operation:t.payload.operation,parameters:t.payload.parameters,...(i===0?{timestamps,width:64,height:48,cropWidth:64,cropHeight:48,outputFrames:11}:{mode:layout.mode,inputFrames:[3,4,6].includes(i)?3:11,outputFrames:i===1?0:i===3||i===4?1:layout.selected.length,...(i===2?{frameSizes:[0,2,8].map(()=>({w:64,h:48}))}:{})})}
  files.set(4+i*2,new File([JSON.stringify(report)],`report-${i}.json`,{type:'application/json'}))
 }
 let imports=0,contents=0,taskChange=null,metadataChange=null
 const version=key=>{
  const n=Number(key.slice(-12)),report=n>=4&&n%2===0,file=files.get(n)
  const value={id:key,metadata:n===1?{kind:'video',bytes:file.size,width:64,height:48,durationSeconds:1.333333,extension:'.mp4'}:n===2?{kind:'image',bytes:file.size,width:64,height:48,frames:1,containerFormat:'PNG',extension:'.png'}:{kind:report?'document':'archive',bytes:file.size,extension:report?'.json':'.zip'}}
  return metadataChange?metadataChange(value):value
 }
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'video-document'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets'){imports++;const n=[...files].find(([,file])=>file.name===options.body.get('file').name)[0];return Response.json(version(id(n)))}
  if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){contents++;return new Response(files.get(Number(key.slice(-12))))}return Response.json(version(key))}
  if(String(url).startsWith('/api/tasks/')){const key=String(url).split('/').at(-1),row=structuredClone(tasks.get(key));return Response.json(taskChange?taskChange(row,key):row)}
  throw new Error('Unexpected execution/request: '+url)
 }
 const result=i=>({data:files.get(3+i*2),report:files.get(4+i*2),inputs:inputNumbers[i].map(n=>files.get(n)),taskId:id(101+i)})
 try{
  const draft={...api.initialVideoDraft(),source:files.get(1),info:{width:64,height:48,duration:1.333333},frameCount:11,frameSize:{w:64,h:48},selected:[1,3],mask:files.get(2),...Object.fromEntries(keys.map((k,i)=>[k,result(i)]))}
  // Current parameters and selection can differ from the already-made result.
  // Reopening must verify each frozen recipe rather than regenerate with them.
  draft.settings={...draft.settings,start:.3,end:.9,crop:{left:1.5,top:2.25,right:3.75,bottom:4.5},strokeWidth:2,exportName:'角色动作'}
  draft.view={page:1,pageSize:64,cursor:3,animationFps:7.5,matteSolid:true}
  const stored=await api.serializeVideo(draft),restored=await api.restoreVideo(stored)
  assert.equal(imports,16);assert.equal(contents,16);assert.deepEqual(restored.selected,[1,3]);assert.equal(restored.settings.start,.3);assert.equal(restored.view.animationFps,7.5)
  assert.equal(restored.capture.inputs[0],restored.source);assert.equal(restored.analysis.inputs[0],restored.capture.data);assert.equal(restored.processed.inputs[1],restored.mask);assert.equal(restored.styledSheet.inputs[0],restored.processed.data)
  await api.serializeVideo(restored);assert.equal(imports,16)
  const before=contents
  for(const mutate of [d=>d.command='execute',d=>d.view.pageSize='24',d=>d.view.cursor=11,d=>d.view.page=2,d=>d.settings.fps=NaN,d=>d.settings.crop.left=64,d=>d.selected=[3,1],d=>d.selected=[1,1],d=>d.selected=[11],d=>d.source.name='../source.mp4',d=>d.frameCount=0,d=>d.capture=null,d=>d.analysis.inputs=[d.source],d=>d.processed.inputs=[d.source],d=>d.rawSheet.inputs=[d.capture.data],d=>d.processed=null,d=>d.rawSheet=null,d=>d.styledSheet.taskId=d.rawSheet.taskId,d=>d.capture.data.versionId=d.source.versionId,d=>d.rawDownload.inputs[0].name='alias.zip']){
   const bad=structuredClone(stored);mutate(bad);await assert.rejects(api.restoreVideo(bad));assert.equal(contents,before)
  }
  for(const mutate of [t=>({...t,state:'canceled'}),t=>({...t,results:[id(1),id(2)]}),t=>{t.payload.inputs=[id(99)];return t},t=>{t.payload.parameters.command='execute';return t},t=>{t.payload.parameters.renderer='native';return t}]){
   taskChange=mutate;await assert.rejects(api.restoreVideo(stored));assert.equal(contents,before)
  }
  for(const [target,mutate] of [[101,t=>t.payload.parameters.layout.sourceWidth=63],[103,t=>t.payload.parameters.layout.mask=false],[104,t=>t.payload.parameters.layout.timestamps[0]=.1],[105,t=>t.payload.parameters.layout.padding=3],[106,t=>t.payload.parameters.layout.selected=[0,1]]]){
   taskChange=(t,key)=>{if(key===id(target))mutate(t);return t};await assert.rejects(api.restoreVideo(stored));assert.equal(contents,before)
  }
  taskChange=null
  for(const change of [v=>v.id===id(1)?{...v,metadata:{...v.metadata,kind:'image'}}:v,v=>v.id===id(2)?{...v,metadata:{...v.metadata,width:63}}:v,v=>v.id===id(3)?{...v,metadata:{...v.metadata,extension:'.png'}}:v]){
   metadataChange=change;await assert.rejects(api.restoreVideo(stored));assert.equal(contents,before)
  }
  metadataChange=null
  const old=files.get(4),bad=JSON.parse(await old.text());bad.timestamps[0]=.01;files.set(4,new File([JSON.stringify(bad)],old.name,{type:old.type}))
  await assert.rejects(api.restoreVideo(stored),/CAPTURE_REPORT/);files.set(4,old)
  const malformed={...draft,settings:{...draft.settings,command:'run'}};await assert.rejects(api.serializeVideo(malformed));assert.equal(imports,16)
  // Skip-matte persists a byte-preserving select task, with no mask input.
  const task=tasks.get(id(103)),oldInputs=task.payload.inputs,oldLayout=task.payload.parameters.layout,oldReport=files.get(8)
  task.payload.inputs=[id(3)];task.payload.parameters.layout={mode:'select',selected:[0,2,8]}
  const report=JSON.parse(await oldReport.text());report.mode='select';report.parameters=task.payload.parameters
  files.set(8,new File([JSON.stringify(report)],oldReport.name,{type:oldReport.type}))
  const skipped=structuredClone(stored);skipped.processed.inputs=[skipped.capture.data];assert.equal((await api.restoreVideo(skipped)).processed.inputs.length,1)
  task.payload.inputs=oldInputs;task.payload.parameters.layout=oldLayout;files.set(8,oldReport)
 }finally{globalThis.fetch=native}
})

test('video crop and brush gestures, selections and published results share bounded history without any jobs',()=>{
 const source=new File(['source'],'source.mp4'),data=new File(['result'],'result.zip'),report=new File(['report'],'report.json'),result={data,report,inputs:[source],taskId:id(1)},mask=new File(['mask'],'mask.png')
 let history=api.createVideoHistory({...api.initialVideoDraft(),source,capture:result})
 history=api.videoHistoryReducer(history,{type:'begin'})
 for(const left of [1,2,3])history=api.videoHistoryReducer(history,{type:'change',update:d=>({...d,settings:{...d.settings,crop:{...d.settings.crop,left}}})})
 history=api.videoHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
 history=api.videoHistoryReducer(history,{type:'change',update:d=>({...d,selected:[0,2],mask,processed:result})})
 history=api.videoHistoryReducer(history,{type:'undo'});assert.equal(history.present.mask,null);assert.equal(history.present.capture,result)
 history=api.videoHistoryReducer(history,{type:'redo'});assert.equal(history.present.processed,result);assert.equal(history.present.mask,mask)
 history=api.videoHistoryReducer(history,{type:'undo'});history=api.videoHistoryReducer(history,{type:'undo'});assert.equal(history.present.settings.crop.left,0)
 history=api.videoHistoryReducer(history,{type:'redo'});assert.equal(history.present.settings.crop.left,3)
 assert.deepEqual([...api.videoFiles([history.present,...history.future])],[source,data,report,mask])
 const large=new File(['bounded accounting'],'large.zip');Object.defineProperty(large,'size',{value:140*1024**2})
 history=api.videoHistoryReducer(history,{type:'change',update:d=>({...d,processed:{...result,data:large}})})
 assert.equal(history.past.length,0);assert.equal(history.future.length,0);assert.equal(history.present.processed.data,large)
})

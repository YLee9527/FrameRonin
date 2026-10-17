import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('sheet documents verify a preprocessing, preparation, fixed-pixel and blank chain without loading its old archives',async()=>{
 const native=globalThis.fetch,pre={...api.sheetPreprocessDefaults,resizeEnabled:true,resizeW:16,resizeH:12},prep={mode:'whole',columns:2,rows:1},sizes=Array.from({length:3},()=>({w:8,h:12}))
 const frames=[api.newSheetFrame(2),api.newSheetFrame(0)],layout={columns:2,rows:1,frames:[{sourceIndex:0,dx:0,dy:0,crop:{top:0,bottom:0,left:0,right:0}},{sourceIndex:1,dx:0,dy:0,crop:{top:0,bottom:0,left:0,right:0}}]}
 frames[0].dx=2;frames[1].selected=false
 const params=[pre,prep,{selected:[0],referenceWidth:8,referenceHeight:12,fixes:[{imgX:0,imgY:0,range:1,data:[0,0,0,0]}]},{order:[0,1],blank:{width:8,height:12}},layout,{...layout,selected:[1],speedScale:1},{order:[2,0],blank:null}].map(layout=>({layout,renderer:'browser-worker',frontendBytes:0}))
 const ops=['image.sheetPreprocess','image.sheetPrepare','image.sheetFix','image.sheetFrames','image.sheetCompose','image.sheetGif','image.sheetFrames']
 const inputs=[1,2,4,6,6,8,8],outputIndices=[2,4,6,8,10,12,14]
 const reports=[{width:16,height:12,outputFrames:1},{outputFrames:2,frameSizes:sizes.slice(0,2)},{outputFrames:2,frameSizes:sizes.slice(0,2)},{outputFrames:3,frameSizes:sizes},{width:16,height:12,outputFrames:1},{width:8,height:12,outputFrames:1,durationMs:100},{outputFrames:2,frameSizes:sizes.slice(0,2)}]
 const files=new Map([[1,new File(['source'],'source.png',{type:'image/png'})]])
 for(let i=0;i<7;i++){
  const n=outputIndices[i],ext=i===0||i===4?'png':i===5?'gif':'zip'
  files.set(n,new File([`result-${i}`],`result-${n}.${ext}`,{type:ext==='zip'?'application/zip':`image/${ext}`}))
  files.set(n+1,new File([JSON.stringify({operation:ops[i],parameters:params[i],...reports[i]})],`report-${n+1}.json`,{type:'application/json'}))
 }
 const tasks=new Map(ops.map((operation,i)=>[id(100+i),{state:'succeeded',results:[id(outputIndices[i]),id(outputIndices[i]+1)],payload:{operation,inputs:[id(inputs[i])],parameters:params[i]}}]))
 const version=key=>{const n=Number(key.slice(-12)),file=files.get(n),image=[1,2,10,12].includes(n),report=n!==1&&n%2===1;return {id:key,metadata:{kind:report?'document':image?'image':'archive',bytes:file.size,extension:report?'.json':n===12?'.gif':image?'.png':'.zip',containerFormat:image?n===12?'GIF':'PNG':undefined,width:image?n===12?8:16:undefined,height:image?12:undefined,frames:1}}}
 let imports=0,contentIds=[],badLink=false,badExport=false
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'sheet-document'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets'){imports++;const n=[...files].find(([,f])=>f.name===options.body.get('file').name)[0];return Response.json(version(id(n)))}
  if(url==='/api/tasks/manifest')return Response.json(JSON.parse(options.body).tasks.map(key=>{const r=tasks.get(key);return {id:key,state:badLink?'canceled':r.state,operation:r.payload.operation,inputs:r.payload.inputs,results:r.results}}))
  if(String(url).startsWith('/api/tasks/')){const key=String(url).split('/').at(-1),r=tasks.get(key);return Response.json(badExport&&key===id(104)?{...r,payload:{...r.payload,inputs:[id(1)]}}:r)}
  if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){contentIds.push(key);return new Response(files.get(Number(key.slice(-12))))}return Response.json(version(key))}
  throw new Error('Unexpected request '+url)
 }
 try{
  const result=i=>({data:files.get(outputIndices[i]),report:files.get(outputIndices[i]+1),taskId:id(100+i)})
  const draft={...api.initialSheetAdjustDraft(true),source:files.get(1),info:{w:16,h:12},preEnabled:true,preprocess:pre,processed:result(0),archive:result(3),recipe:{preprocess:pre,layout:prep},lineage:[100,101,102,103].map(id),sizes,frames,columns:2,rows:1,composed:{...result(4),input:files.get(6)},gif:{...result(5),input:files.get(8)},raw:{...result(6),input:files.get(8)}}
  const stored=await api.serializeSheetAdjust(draft),restored=await api.restoreSheetAdjust(stored)
  assert.equal(imports,12);assert.equal(contentIds.length,12);assert.deepEqual(restored.frames.map(f=>[f.sourceIndex,f.dx,f.selected]),[[2,2,true],[0,0,false]])
  assert(!contentIds.includes(id(4)));assert(!contentIds.includes(id(5)));assert(!contentIds.includes(id(7)))
  await api.serializeSheetAdjust(restored);assert.equal(imports,12)
  const before=contentIds.length
  badLink=true;await assert.rejects(api.restoreSheetAdjust(stored),/LINEAGE/);assert.equal(contentIds.length,before);badLink=false
  badExport=true;await assert.rejects(api.restoreSheetAdjust(stored),/DOCUMENT_TASK/);assert.equal(contentIds.length,before);badExport=false
  for(const edit of [d=>d.command='execute',d=>d.frames[1].id=d.frames[0].id,d=>d.frames[1].sourceIndex=2,d=>d.frames[0].sourceIndex=3,d=>d.frames[0].dx=.5,d=>d.preprocess.command='execute',d=>d.source.name='../other.png',d=>d.lineage=[id(102),id(103)],d=>d.recipe.preprocess=null,d=>d.composed.input.versionId=id(1),d=>d.archive.taskId=id(101)]){
   const invalid=structuredClone(stored);edit(invalid);await assert.rejects(api.restoreSheetAdjust(invalid));assert.equal(contentIds.length,before)
  }
  const wrongSizes=structuredClone(stored);wrongSizes.sizes[0].w=9;await assert.rejects(api.restoreSheetAdjust(wrongSizes),/FRAME_SIZES/)
  assert.equal(imports,12)
  const empty={...restored,frames:[]};await api.serializeSheetAdjust(empty)
 }finally{globalThis.fetch=native}
})

test('sheet history groups crop gestures, frame management and result versions without processing on undo',()=>{
 const file=new File(['archive'],'frames.zip'),result={data:file,report:new File(['report'],'report.json'),taskId:id(1)},frames=[api.newSheetFrame(0),api.newSheetFrame(1)]
 let history=api.createSheetAdjustHistory({...api.initialSheetAdjustDraft(true),frames,archive:result,sizes:[{w:8,h:12},{w:8,h:12}]})
 history=api.sheetAdjustHistoryReducer(history,{type:'begin'})
 for(const top of [1,2,3])history=api.sheetAdjustHistoryReducer(history,{type:'change',update:d=>({...d,crop:{...d.crop,top}})})
 history=api.sheetAdjustHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
 history=api.sheetAdjustHistoryReducer(history,{type:'undo'});assert.equal(history.present.crop.top,0)
 history=api.sheetAdjustHistoryReducer(history,{type:'redo'});assert.equal(history.present.crop.top,3)
 history=api.sheetAdjustHistoryReducer(history,{type:'change',update:d=>({...d,frames:[d.frames[1]],gif:{...result,input:file}})})
 history=api.sheetAdjustHistoryReducer(history,{type:'undo'});assert.equal(history.present.frames.length,2);assert.equal(history.present.gif,null)
 history=api.sheetAdjustHistoryReducer(history,{type:'redo'});assert.equal(history.present.frames.length,1);assert.equal(history.present.gif.data,file)
 const original=api.initialSheetAdjustDraft(true),recipe=api.currentSheetRecipe(original)
 assert.deepEqual(api.currentSheetRecipe({...original,columns:3,rows:7,frames}),recipe)
 assert.notDeepEqual(api.currentSheetRecipe({...original,splitColumns:3}),recipe)
 assert.equal(api.currentSheetRecipe({...original,preEnabled:true,preprocess:{...original.preprocess,cropTop:.1}}).preprocess,null)
 assert.equal(api.currentSheetRecipe({...original,preEnabled:true,preprocess:{...original.preprocess,cropTop:.5}}).preprocess.cropTop,.5)
 const prepared=api.preparedSheetFrames(Array.from({length:32},()=>({w:8,h:8})))
 assert.deepEqual(prepared.flatMap((f,i)=>f.selected?[i]:[]),[0,1,2,3,4,5])
 assert.equal(new Set(prepared.map(f=>f.id)).size,32)
 assert.equal(api.newSheetFrame(32).selected,true)
})

test('preview geometry retains logical crop coordinates and fixed-pixel sampling never reads scaled thumbnails',()=>{
 const p={sourceIndex:0,dx:3,dy:-2,crop:{top:1.5,bottom:-2,left:-1,right:3}}
 const g=api.sheetPreviewGeometry({w:8192,h:8192},p,{w:8190,h:8192},512)
 assert.deepEqual([g.width,g.height,g.previewWidth,g.previewHeight],[8190,8192,512,512]);assert.equal(g.crop.padX,1)
 assert.deepEqual(api.sheetSampleCoordinates({w:64,h:64},3,-2,13,18,2),{imgX:9,imgY:19})
 assert.throws(()=>api.sheetSampleCoordinates({w:8,h:8},-7,0,0,0,8),/OUTSIDE/)
 assert.throws(()=>api.sheetPreviewGeometry({w:8192,h:8192},p,{w:30001,h:10},512),/DIMENSIONS/)
})

test('sheet preview cancellation terminates Worker and late, foreign or malformed samples cannot publish',async()=>{
 const previous=globalThis.Worker,workers=[]
 globalThis.Worker=class{constructor(){workers.push(this);this.stopped=0}postMessage(v){this.request=v}terminate(){this.stopped++}}
 const request={action:'sample',file:new Blob(['frame']),size:{w:8,h:8},dx:0,dy:0,x:2,y:2,range:1}
 try{
  const abort=new AbortController(),pending=api.sheetAdjustPreview(request,2*1024**3,0,abort.signal),worker=workers[0]
  worker.onmessage({data:{id:'foreign',generation:0,patch:{}}});assert.equal(worker.stopped,0)
  abort.abort();await assert.rejects(pending,{name:'AbortError'});worker.onmessage({data:{...worker.request,patch:{imgX:2,imgY:2,range:1,data:[0,0,0,0]}}});assert.equal(worker.stopped,1)
  const malformed=api.sheetAdjustPreview(request,2*1024**3,0,new AbortController().signal),second=workers[1]
  second.onmessage({data:{...second.request,patch:{imgX:3,imgY:2,range:1,data:[0,0,0,0]}}});await assert.rejects(malformed,/SAMPLE_RESPONSE/);assert.equal(second.stopped,1)
  const png=new Blob(['png'],{type:'image/png'}),preview=count=>({action:'preview',files:Array(count).fill(png),sizes:Array(count).fill({w:1,h:1}),placements:Array(count).fill({sourceIndex:0,dx:0,dy:0,crop:{top:0,bottom:0,left:0,right:0}}),cell:null,limit:128})
  const fullRow=api.sheetAdjustPreview(preview(64),2*1024**3,0,new AbortController().signal),third=workers[2]
  third.onmessage({data:{...third.request,previews:Array(64).fill(png)}});assert.equal((await fullRow).previews.length,64);assert.equal(third.stopped,1)
  const tooMany=api.sheetAdjustPreview(preview(129),2*1024**3,0,new AbortController().signal),fourth=workers[3]
  fourth.onmessage({data:{...fourth.request,previews:Array(129).fill(png)}});await assert.rejects(tooMany,/RESPONSE/)
  const tooLarge=api.sheetAdjustPreview(preview(5),2*1024**3,0,new AbortController().signal),fifth=workers[4],large=new Blob([new Uint8Array(8*1024**2)],{type:'image/png'})
  fifth.onmessage({data:{...fifth.request,previews:Array(5).fill(large)}});await assert.rejects(tooLarge,/RESPONSE/)
 }finally{globalThis.Worker=previous}
})

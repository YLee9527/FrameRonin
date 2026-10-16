import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)

test('scatter review freezes names/order and rejects duplicate, escaping, oversized and unknown entries',()=>{
  const box={id:'one',x:1.5,y:2.25,w:8.5,h:4.75,kind:'sprite',name:''}
  const original={boxes:[box],format:'png',quality:.92,namesText:'../一号:* ',namePerRow:false,order:'row-major'}
  const reviewed=api.reviewScatterExport(original,16,12)
  assert.equal(reviewed.entries[0].name,'..-一号.png');api.validateReviewedScatterExport(reviewed,16,12)
  for(const change of [v=>v.entries[0].name='../outside.png',v=>v.entries[0].name='file.jpg',v=>v.entries[0].box.extra='run',v=>v.entries[0].box.x=10,v=>v.extra='read-file']){
    const invalid=structuredClone(reviewed);change(invalid);assert.throws(()=>api.validateReviewedScatterExport(invalid,16,12))
  }
  const duplicate={...original,boxes:[{...box,id:'a',name:'TILE'},{...box,id:'b',name:'tile'}]}
  assert.throws(()=>api.reviewScatterExport(duplicate,16,12),/COLLISION/)
  assert.throws(()=>api.reviewScatterExport({...duplicate,boxes:[{...box,id:'a',name:'é'},{...box,id:'b',name:'e\u0301'}]},16,12),/COLLISION/)
  api.checkScatterBudget(16,12,100,2*1024**3,0,reviewed)
  assert.throws(()=>api.checkScatterBudget(16,12,100,2*1024**3,2*1024**3,reviewed),/RESOURCE_LIMIT/)
})

test('scatter detection retains the original alpha boundary, four-connectivity and filtering-before-merge',()=>{
  const data=new Uint8ClampedArray(20*10*4),pixel=(x,y,alpha)=>{const i=(y*20+x)*4;data[i]=100;data[i+3]=alpha}
  pixel(1,1,24);pixel(2,2,25);pixel(10,1,255);pixel(11,1,255)
  const defaults={...api.scatterDetectDefaults,mode:'alpha',minPixels:1}
  const boxes=api.detectScatterPixels(data,20,10,defaults,'row-major')
  assert.deepEqual(boxes.map(({x,y,w,h})=>({x,y,w,h})),[{x:2,y:2,w:1,h:1},{x:10,y:1,w:2,h:1}])
  assert.equal(api.detectScatterPixels(data,20,10,{...defaults,minPixels:2},'row-major').length,1)
  assert.throws(()=>api.detectScatterPixels(data,20,10,{...defaults,unknown:true},'row-major'),/DETECT_INVALID/)
})

test('scatter documents bind both result kinds to successful source tasks and fail metadata checks before content reads',async()=>{
  const native=globalThis.fetch,id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  const source=new File(['source'],'source.png',{type:'image/png'}),box={id:'one',x:1,y:2,w:8,h:4,kind:'sprite',name:''}
  const detect={detect:api.scatterDetectDefaults,order:'row-major',renderer:'browser-worker',frontendBytes:0}
  const layout=api.reviewScatterExport({boxes:[box],format:'png',quality:.92,namesText:'',namePerRow:false,order:'row-major'},16,12),exp={layout,renderer:'browser-worker',frontendBytes:0}
  const detection=new File([JSON.stringify({formatVersion:1,width:16,height:12,boxes:[box]})],'detection.json',{type:'application/json'})
  const zip=new File(['zip'],'slices.zip',{type:'application/zip'})
  const report=(operation,parameters,extra)=>new File([JSON.stringify({operation,parameters,...extra})],operation+'.json',{type:'application/json'})
  const detectReport=report('image.scatterDetect',detect,{detectedBoxes:1}),exportReport=report('image.scatterExport',exp,{exportedSlices:1,format:'png'})
  const files=[source,detection,detectReport,zip,exportReport];let imports=0,reads=0,badMeta=false,badTask=false
  const version=key=>{const index=[id(1),id(2),id(3),id(4),id(5)].indexOf(key);return {id:key,metadata:{kind:index===0?'image':index===3?'archive':'document',bytes:files[index].size,extension:index===0?'.png':index===3?'.zip':'.json',containerFormat:index===0?'PNG':undefined,width:index===0?badMeta?17:16:undefined,height:index===0?12:undefined}}}
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:'scatter'},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){imports++;return Response.json(version(id(files.findIndex(file=>file.name===options.body.get('file').name)+1)))}
    if(String(url).startsWith('/api/tasks/')){const isDetect=String(url).endsWith(id(10));return Response.json({state:badTask?'canceled':'succeeded',results:isDetect?[id(2),id(3)]:[id(4),id(5)],payload:{operation:isDetect?'image.scatterDetect':'image.scatterExport',inputs:[id(1)],parameters:isDetect?detect:exp}})}
    if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){reads++;return new Response(files[[id(1),id(2),id(3),id(4),id(5)].indexOf(key)])}return Response.json(version(key))}
    throw new Error(`Unexpected request: ${url}`)
  }
  try{
    const draft={...api.initialScatterDraft(),source,info:{width:16,height:12,fileNameBase:'source'},boxes:[{...box,x:2}],selectedId:'one',detection:{data:detection,report:detectReport,taskId:id(10)},archive:{data:zip,report:exportReport,taskId:id(11)}}
    const stored=await api.serializeScatter(draft),restored=await api.restoreScatter(stored)
    assert.equal(restored.boxes[0].x,2);assert.equal(await restored.archive.data.text(),'zip');assert.equal(imports,5)
    await api.serializeScatter(restored);assert.equal(imports,5)
    const before=reads;badMeta=true;await assert.rejects(api.restoreScatter(stored),/SOURCE_METADATA/);assert.equal(reads,before);badMeta=false
    badTask=true;await assert.rejects(api.restoreScatter(stored),/TASK_MISMATCH/);assert.equal(reads,before);badTask=false
    for(const change of [v=>v.command='read',v=>v.boxes[0].x=20,v=>v.settings.detect.extra=true,v=>v.archive.taskId='not-an-id',v=>v.source.name='../outside.png']){
      const invalid=structuredClone(stored);change(invalid);await assert.rejects(api.restoreScatter(invalid));assert.equal(reads,before)
    }
  }finally{globalThis.fetch=native}
})

test('scatter geometry gestures and results share history while JSON retention stays bounded',()=>{
  const source=new File(['source'],'source.png'),box={id:'one',x:1,y:2,w:8,h:4,name:''}
  let history=api.createScatterHistory({...api.initialScatterDraft(),source,info:{width:16,height:12,fileNameBase:'source'},boxes:[box],selectedId:'one'})
  history=api.scatterHistoryReducer(history,{type:'begin'})
  for(const x of [2,3,4])history=api.scatterHistoryReducer(history,{type:'change',update:draft=>({...draft,boxes:[{...box,x}]})})
  history=api.scatterHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
  history=api.scatterHistoryReducer(history,{type:'undo'});assert.equal(history.present.boxes[0].x,1)
  history=api.scatterHistoryReducer(history,{type:'redo'});assert.equal(history.present.boxes[0].x,4)
  const boxes=Array.from({length:4096},(_,index)=>({...box,id:String(index),name:'a'.repeat(1000)}))
  history=api.createScatterHistory({...history.present,boxes})
  for(let i=0;i<30;i++)history=api.scatterHistoryReducer(history,{type:'change',update:draft=>({...draft,boxes:draft.boxes.map(box=>({...box,x:i%5}))})})
  assert.ok(history.past.length<10);assert.equal(history.present.boxes.length,4096)
})

test('scatter preview Worker rejects foreign replies and closes canceled late bitmaps',async()=>{
  const oldWorker=globalThis.Worker,oldBitmap=globalThis.ImageBitmap,workers=[]
  class Bitmap{width=8;height=6;closed=0;close(){this.closed++}}
  globalThis.ImageBitmap=Bitmap
  globalThis.Worker=class{constructor(){workers.push(this);this.stopped=0}postMessage(value){this.request=value}terminate(){this.stopped++}}
  try{
    const file=new File(['source'],'source.png'),abort=new AbortController(),pending=api.scatterSourceWorker(file,2*1024**3,0,abort.signal),worker=workers[0]
    assert.equal(worker.request.operation,'image.scatterDetect');assert.equal(worker.request.action,'preview')
    const foreign=new Bitmap();worker.onmessage({data:{...worker.request,id:'foreign',bitmap:foreign}});assert.equal(foreign.closed,1);assert.equal(worker.stopped,0)
    abort.abort();await assert.rejects(pending,{name:'AbortError'})
    const late=new Bitmap();worker.onmessage({data:{...worker.request,bitmap:late,width:16,height:12,color:[0,0,0,255]}});assert.equal(late.closed,1);assert.equal(worker.stopped,1)
    const invalid=api.scatterSourceWorker(file,2*1024**3,0,new AbortController().signal),next=workers[1],bitmap=new Bitmap()
    next.onmessage({data:{...next.request,bitmap,width:16,height:12,color:[0,-1,0,255]}});await assert.rejects(invalid,/RESPONSE_INVALID/);assert.equal(bitmap.closed,1)
  }finally{globalThis.Worker=oldWorker;globalThis.ImageBitmap=oldBitmap}
})

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('source Workers transfer bounded previews, reject foreign replies and invalidate canceled or malformed samples',async()=>{
  const previousWorker=globalThis.Worker,previousBitmap=globalThis.ImageBitmap,workers=[]
  class Bitmap{width=4;height=3;closed=0;close(){this.closed++}}
  globalThis.ImageBitmap=Bitmap
  globalThis.Worker=class{constructor(){workers.push(this);this.stopped=0}postMessage(value){this.request=value}terminate(){this.stopped++}}
  try{
    const file=new File(['source'],'source.png'),first=api.runNormalSourceWorker(file,'preview',2*1024**3,0,new AbortController().signal),worker=workers[0],foreign=new Bitmap()
    worker.onmessage({data:{...worker.request,id:'foreign',bitmap:foreign,width:4,height:3}});assert.equal(foreign.closed,1);assert.equal(worker.stopped,0)
    const bitmap=new Bitmap();worker.onmessage({data:{...worker.request,bitmap,width:4,height:3}})
    assert.equal((await first).bitmap,bitmap);assert.equal(worker.stopped,1);bitmap.close()
    const invalid=api.runNormalSourceWorker(file,'sample',2*1024**3,0,new AbortController().signal,0,0),second=workers[1]
    second.onmessage({data:{...second.request,color:[0,0,0,256]}});await assert.rejects(invalid,/RESPONSE_INVALID/);assert.equal(second.stopped,1)
    const abort=new AbortController(),canceled=api.runNormalSourceWorker(file,'preview',2*1024**3,0,abort.signal),third=workers[2]
    abort.abort();await assert.rejects(canceled,{name:'AbortError'});const late=new Bitmap()
    third.onmessage({data:{...third.request,bitmap:late,width:4,height:3}});assert.equal(late.closed,1);assert.equal(third.stopped,1)
  }finally{globalThis.Worker=previousWorker;globalThis.ImageBitmap=previousBitmap}
})

test('normal documents retain source, main-result ancestry and separate matte preview; task and metadata failures precede content reads',async()=>{
  const native=globalThis.fetch,defaults=api.normalImageDefaults
  const source=new File(['source'],'source.png',{type:'image/png'}),main=new File(['main'],'main.png',{type:'image/png'}),extended=new File(['extended'],'extended.png',{type:'image/png'}),matte=new File(['matte'],'matte.png',{type:'image/png'})
  const extendParams={mode:'extendBottom',...defaults},matteParams={...defaults,mode:'mattePreview',cropLeft:3,cropRight:5,cropTop:7,cropBottom:9}
  const report=(name,parameters)=>new File([JSON.stringify({operation:'image.normal',outputFrames:1,parameters})],name,{type:'application/json'})
  const extendReport=report('extend-report.json',extendParams),matteReport=report('matte-report.json',matteParams)
  const records=[[source,192,144],[main,97,113],[extended,97,150],[matte,184,128],[extendReport,0,0],[matteReport,0,0]]
  const byId=new Map(records.map(([file,w,h],i)=>[id(i+1),{file,w,h}]))
  let imports=0,reads=0,badDimensions=false,badState=false
  const version=key=>{const r=byId.get(key);return {id:key,metadata:{kind:r.w?'image':'document',bytes:r.file.size,extension:r.w?'.png':'.json',containerFormat:r.w?'PNG':undefined,width:badDimensions&&key===id(3)?98:r.w,height:r.h}}}
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:'normal-doc'},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){imports++;const file=options.body.get('file'),key=[...byId].find(([,r])=>r.file.name===file.name)[0];return Response.json(version(key))}
    if(String(url).startsWith('/api/tasks/')){
      const isExtend=String(url).endsWith(id(10)),parameters=isExtend?extendParams:matteParams
      return Response.json({state:badState?'canceled':'succeeded',results:isExtend?[id(3),id(5)]:[id(4),id(6)],payload:{operation:'image.normal',inputs:[isExtend?id(2):id(1)],parameters}})
    }
    if(String(url).startsWith('/api/versions/')){
      const key=String(url).split('/')[3]
      if(String(url).endsWith('/content')){reads++;return new Response(byId.get(key).file)}
      return Response.json(version(key))
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try{
    const draft={settings:{...defaults,width:97,height:113},source,preview:{file:extended,input:main,report:extendReport,taskId:id(10)},matte:{file:matte,input:source,report:matteReport,taskId:id(11)}}
    const stored=await api.serializeNormalImage(draft),restored=await api.restoreNormalImage(stored)
    assert.equal(imports,6);assert.equal(reads,6);assert.equal(await restored.preview.input.text(),'main');assert.equal(await restored.matte.file.text(),'matte')
    await api.serializeNormalImage(restored);assert.equal(imports,6)
    const before=reads;badDimensions=true;await assert.rejects(api.restoreNormalImage(stored),/RESULT_DIMENSIONS/);assert.equal(reads,before);badDimensions=false
    badState=true;await assert.rejects(api.restoreNormalImage(stored),/TASK_MISMATCH/);assert.equal(reads,before);badState=false
    for(const change of [v=>v.source=null,v=>v.extra=true,v=>v.settings.command='run',v=>v.preview.file.name='../outside.png',v=>v.matte.taskId='invalid']){
      const invalid=structuredClone(stored);change(invalid);await assert.rejects(api.restoreNormalImage(invalid));assert.equal(reads,before)
    }
  }finally{globalThis.fetch=native}
})

test('normal history keeps independent matte/main results and extension input across a complete crop gesture and undo/redo',()=>{
  const source=new File(['source'],'source.png'),main={file:new File(['main'],'main.png'),input:source,report:new File(['report'],'r.json'),taskId:id(1)}
  const matte={...main,file:new File(['matte'],'matte.png'),taskId:id(2)}
  let history=api.createNormalImageHistory({...api.initialNormalImageDraft(),source,preview:main,matte})
  history=api.normalImageHistoryReducer(history,{type:'begin'})
  for(const cropLeft of [1,2,3])history=api.normalImageHistoryReducer(history,{type:'change',update:draft=>({...draft,settings:{...draft.settings,cropLeft}})})
  history=api.normalImageHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
  history=api.normalImageHistoryReducer(history,{type:'undo'});assert.equal(history.present.settings.cropLeft,0);assert.equal(history.present.matte,matte)
  history=api.normalImageHistoryReducer(history,{type:'redo'});assert.equal(history.present.settings.cropLeft,3)
  const extended={...main,file:new File(['extended'],'extended.png'),input:main.file,taskId:id(3)}
  history=api.normalImageHistoryReducer(history,{type:'change',update:draft=>({...draft,preview:extended})})
  history=api.normalImageHistoryReducer(history,{type:'undo'});assert.equal(history.present.preview,main)
  history=api.normalImageHistoryReducer(history,{type:'redo'});assert.equal(history.present.preview.input,main.file);assert.equal(history.present.matte,matte)
})

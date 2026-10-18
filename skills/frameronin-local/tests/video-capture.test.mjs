import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../.runtime/js/algorithms.mjs'
import {runManagedTask} from '../.runtime/js/managed-tasks.mjs'

const layout={sourceWidth:64,sourceHeight:48,start:0,end:1,fps:10,maxFrames:2000,crop:{left:0,top:0,right:0,bottom:0}}
test('native capture plans retain original floating timestamps and crop truncation while bounding decoder and encoded cache',()=>{
 const p=api.videoCapturePlan({...layout,crop:{left:1.5,top:2.25,right:3.75,bottom:4.5}},1000,2*1024**3,0,{width:64,height:48})
 assert.equal(p.timestamps.length,11);assert.equal(p.cropWidth,58.75);assert.equal(p.width,58);assert.equal(p.cropHeight,41.25);assert.equal(p.height,41)
 const one=api.videoCapturePlan({...layout,crop:{left:40,top:30,right:40,bottom:30}},1000,2*1024**3,0)
 assert.equal(one.width,1);assert.equal(one.height,1)
 for(const bad of [{...layout,command:'run'},{...layout,sourceWidth:true},{...layout,end:NaN},{...layout,start:1},{...layout,maxFrames:2001},{...layout,crop:{...layout.crop,left:64}},{...layout,crop:{...layout.crop,path:'../image'}}])assert.throws(()=>api.videoCapturePlan(bad,1000,2*1024**3,0))
 assert.throws(()=>api.videoCapturePlan(layout,1000,2*1024**3,0,{width:30000,height:30000}),/RESOURCE/)
 assert.throws(()=>api.videoCapturePlan(layout,201*1024**2,2*1024**3,0),/RESOURCE/)
})

/** Pure mocked browser APIs: these tests do not drive a real browser/UI. */
async function browserFixture(run){
 const saved=Object.fromEntries(['document','Worker','createImageBitmap','ImageBitmap'].map(key=>[key,globalThis[key]])),create=URL.createObjectURL,revoke=URL.revokeObjectURL
 const state={live:new Set(),urls:new Set(),openedSources:[],workers:[],bitmaps:[],times:[],created:0,mediaError:0,throwConstructor:false,throwFrame:false,late:false,resolveLate:null,badProgress:false}
 class Bitmap{constructor(){this.width=64;this.height=48;this.closed=0;state.bitmaps.push(this)}close(){this.closed++}}
 class Video extends EventTarget{
  constructor(){super();this.dataset={};this.style={};this.videoWidth=64;this.videoHeight=48;this.duration=1;this.error=null;this.source=''}
  set src(value){this.source=value}
  get src(){return this.source}
  set currentTime(value){state.times.push(value);queueMicrotask(()=>this.dispatchEvent(new Event('seeked')))}
  load(){if(this.source)queueMicrotask(()=>{if(state.mediaError){this.error={code:state.mediaError};this.dispatchEvent(new Event('error'))}else this.dispatchEvent(new Event('loadeddata'))})}
  pause(){}
  removeAttribute(){this.source=''}
  remove(){state.live.delete(this)}
 }
 class Worker{
  constructor(){if(state.throwConstructor)throw new Error('workers unavailable');this.stopped=false;state.workers.push(this)}
  terminate(){this.stopped=true}
  postMessage(message){
   if(message.action==='frame'&&state.throwFrame)throw new Error('transfer failed')
   queueMicrotask(()=>{
    const base={id:message.id,generation:message.generation}
    this.onmessage({data:{...base,generation:message.generation-1,error:'stale reply'}})
    if(message.action==='init'){this.total=api.videoCapturePlan(message.layout,message.fileBytes,message.budget,message.frontendBytes,message.physical).timestamps.length;this.onmessage({data:{...base,phase:'ready'}})}
    else if(message.action==='frame'){message.bitmap.close();this.onmessage({data:{...base,phase:'frame',index:message.index,progress:state.badProgress?NaN:(message.index+1)/this.total}})}
    else this.onmessage({data:{...base,blob:new Blob(['encoded frames'])}})
   })
  }
 }
 globalThis.document={createElement:name=>{assert.equal(name,'video');state.created++;return new Video()},body:{append:video=>state.live.add(video)}}
 globalThis.Worker=Worker;globalThis.ImageBitmap=Bitmap
 globalThis.createImageBitmap=()=>state.late?new Promise(resolve=>{state.resolveLate=()=>resolve(new Bitmap())}):Promise.resolve(new Bitmap())
 URL.createObjectURL=source=>{state.openedSources.push(source);const value='blob:owned-'+state.urls.size;state.urls.add(value);return value};URL.revokeObjectURL=value=>state.urls.delete(value)
 try{await run(state)}finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;URL.createObjectURL=create;URL.revokeObjectURL=revoke}
}
const limits={budget:2*1024**3,frontendBytes:0,physical:{width:64,height:48}}
const short={...layout,end:.5,fps:4,maxFrames:2}
test('capture serializes frames, ignores stale generations and closes decoder/Worker/object URLs',()=>browserFixture(async state=>{
 const source=new Blob(['selected video']),controller=new AbortController(),identity={id:'capture',generation:7},progress=[]
 const info=await api.inspectSelectedVideo(source,limits,controller.signal);assert.deepEqual(info,{width:64,height:48,duration:1});assert.equal(state.live.size,0)
 const result=await api.captureSelectedVideo(source,short,limits,controller.signal,identity,p=>progress.push(p))
 assert.equal(await result.text(),'encoded frames');assert.deepEqual(state.times,[0,.25]);assert.deepEqual(progress,[.5,1])
 assert(state.workers.every(w=>w.stopped));assert(state.bitmaps.every(b=>b.closed===1));assert.equal(state.live.size,0);assert.equal(state.urls.size,0)
}))
test('canceling capture rejects immediately and closes a snapshot that resolves late without transferring it',()=>browserFixture(async state=>{
 state.late=true;const controller=new AbortController(),pending=api.captureSelectedVideo(new Blob(['selected']),short,limits,controller.signal,{id:'cancel',generation:0})
 for(let i=0;i<20&&!state.resolveLate;i++)await new Promise(resolve=>setTimeout(resolve,0))
 assert(state.resolveLate);controller.abort();await assert.rejects(pending,error=>error.name==='AbortError')
 assert.equal(state.live.size,0);assert.equal(state.urls.size,0);assert(state.workers[0].stopped)
 state.resolveLate();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(state.bitmaps.length,1);assert.equal(state.bitmaps[0].closed,1)
}))
test('Worker construction/transfer failure and invalid progress preserve ownership cleanup',()=>browserFixture(async state=>{
 const capture=()=>api.captureSelectedVideo(new Blob(['selected']),short,limits,new AbortController().signal,{id:'failure',generation:0})
 state.throwConstructor=true;await assert.rejects(capture(),/unavailable/);assert.equal(state.live.size,0);assert.equal(state.urls.size,0)
 state.throwConstructor=false;state.throwFrame=true;await assert.rejects(capture(),/transfer failed/);assert.equal(state.bitmaps.at(-1).closed,1)
 state.throwFrame=false;state.badProgress=true;await assert.rejects(capture(),/FRAME_REPLY/)
 assert.equal(state.live.size,0);assert.equal(state.urls.size,0);assert(state.workers.every(w=>w.stopped));assert(state.bitmaps.every(b=>b.closed===1))
}))
test('pre-canceled and over-budget metadata inspection does not open a decoder; unsupported media cleans it up',()=>browserFixture(async state=>{
 const source=new Blob(['selected']),abort=new AbortController();abort.abort()
 await assert.rejects(api.inspectSelectedVideo(source,limits,abort.signal),error=>error.name==='AbortError');assert.equal(state.created,0)
 await assert.rejects(api.inspectSelectedVideo(source,{...limits,physical:{width:30000,height:30000}},new AbortController().signal),/RESOURCE/);assert.equal(state.created,0)
 state.mediaError=4;await assert.rejects(api.inspectSelectedVideo(source,limits,new AbortController().signal),/VIDEO_DECODE_FAILED: 4/)
 assert.equal(state.created,1);assert.equal(state.live.size,0);assert.equal(state.urls.size,0);assert.equal(state.workers.length,0)
}))
test('managed capture decodes its registered project version rather than the caller File',()=>browserFixture(async state=>{
 const nativeFetch=globalThis.fetch,nativeWindow=globalThis.window;globalThis.window=globalThis
 const version='00000000-0000-0000-0000-000000000001',stable=new Blob(['registered project copy'],{type:'video/mp4'});let published=false,reads=0
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'native-copy-project'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets')return Response.json({id:version,metadata:{kind:'video',bytes:stable.size,width:64,height:48,durationSeconds:1}})
  if(url==='/api/tasks')return Response.json({id:'task',state:'queued'})
  if(url==='/api/tasks/task')return Response.json({id:'task',state:published?'succeeded':'running',progress:published?1:.1,results:published?['output']:[]})
  if(url==='/api/tasks/task/browser')return Response.json({ready:true,generation:7})
  if(url==='/api/tasks/task/browser/heartbeat')return Response.json({accepted:true})
  if(url==='/api/tasks/task/browser/input?generation=7'){reads++;return new Response(stable)}
  if(url==='/api/tasks/task/browser/result'){assert.equal(await options.body.get('file').text(),'encoded frames');published=true;return Response.json({accepted:true})}
  if(url==='/api/tasks/task/results')return Response.json([{id:'output',metadata:{kind:'archive',bytes:3}}])
  if(url==='/api/versions/output/content')return new Response('zip')
  throw new Error('Unexpected capture API: '+url)
 }
 try{
  const result=await runManagedTask('video.capture',[new File(['caller file bytes'],'source.mp4')],{renderer:'browser-worker',frontendBytes:0,layout:short})
  assert.equal(result.taskId,'task');assert.equal(reads,1);assert.equal(state.openedSources.length,1);assert.equal(await state.openedSources[0].text(),await stable.text())
  assert.equal(state.live.size,0);assert.equal(state.urls.size,0);assert(state.workers[0].stopped)
 }finally{globalThis.fetch=nativeFetch;if(nativeWindow===undefined)delete globalThis.window;else globalThis.window=nativeWindow}
}))

import test from 'node:test'
import assert from 'node:assert/strict'
import {videoAssetPlan,videoAssets,videoCropHit,videoCropDrag,initialVideoDraft,validateStoredVideo} from '../.runtime/js/algorithms.mjs'

const budget=2*1024**3,file=new Blob(['frame ZIP']),size={w:64,h:48},page={action:'frames',file,size,count:1000,indices:[0,127,999],limit:256}
test('video previews and complete strokes are bounded before decoding or starting a Worker',()=>{
 assert(videoAssetPlan(page,budget,0).estimatedBytes<budget)
 assert.equal(videoAssetPlan({...page,size:{w:2048,h:2048}},budget,0).previewWidth,256)
})
test('video asset requests reject resource and index errors rather than shrinking formal input',()=>{
 for(const p of [{...page,indices:[0,0]},{...page,count:2001},{...page,indices:[1000]},{...page,limit:1025},{...page,size:{w:8192,h:8192}},{...page,size:{w:true,h:48}},{action:'sample',file,size,count:1,index:0,x:64,y:0},{action:'brush',size,mask:null,stroke:{size:3,points:[[1,2]]}},{action:'brush',size,mask:null,stroke:{size:4,points:[[Infinity,2]]}},{action:'brush',size,mask:null,stroke:{size:4,points:Array.from({length:32769},()=>[1,2])}}])assert.throws(()=>videoAssetPlan(p,budget,0))
 assert.throws(()=>videoAssetPlan(page,budget,budget))
})
test('video crop uses the original corner priority and every handle constraint',()=>{
 const c={left:20,top:30,right:40,bottom:50},w=320,h=240
 assert.equal(videoCropHit(w,h,c,20,30),'nw');assert.equal(videoCropHit(w,h,c,280,190),'se');assert.equal(videoCropHit(w,h,c,100,100),'move');assert.equal(videoCropHit(w,h,c,0,0),null)
 assert.deepEqual(videoCropDrag(w,h,c,'move',5,-10),{left:25,top:20,right:35,bottom:60})
 assert.deepEqual(videoCropDrag(w,h,c,'nw',500,500),{left:279,top:189,right:40,bottom:50})
 const expected={n:{...c,top:40},s:{...c,bottom:40},e:{...c,right:30},w:{...c,left:30},ne:{...c,top:40,right:30},nw:{...c,left:30,top:40},se:{...c,right:30,bottom:40},sw:{...c,left:30,bottom:40}}
 for(const [handle,value] of Object.entries(expected))assert.deepEqual(videoCropDrag(w,h,c,handle,10,10),value)
})
test('video preview transport rejects stale or malformed replies and releases every owned Worker',async()=>{
 const native=globalThis.Worker;let latest,mode='success',created=0
 class FakeWorker{
  constructor(){created++;latest=this;this.stopped=false}
  terminate(){this.stopped=true}
  postMessage(p){
   if(mode==='throw')throw new Error('transfer failed')
   if(mode==='pending')return
   queueMicrotask(()=>{
    this.onmessage({data:{id:p.id,generation:p.generation+1,error:'stale message'}})
    if(mode==='error'){this.onerror({message:'codec failed'});return}
    const data={id:p.id,generation:p.generation,files:[],previews:p.request.indices.map(()=>new Blob(['preview'],{type:'image/png'})),color:null}
    if(mode==='invalid')data.previews=[]
    this.onmessage({data})
   })
  }
 }
 globalThis.Worker=FakeWorker
 try{
  const good=await videoAssets(page,budget,0,new AbortController().signal);assert.equal(good.previews.length,3);assert(latest.stopped)
  for(const state of ['invalid','throw','error']){mode=state;await assert.rejects(videoAssets(page,budget,0,new AbortController().signal));assert(latest.stopped)}
  mode='pending';const abort=new AbortController(),pending=videoAssets(page,budget,0,abort.signal);await Promise.resolve();await Promise.resolve();const running=latest
  const queuedAbort=new AbortController(),queued=videoAssets(page,budget,0,queuedAbort.signal),before=created;queuedAbort.abort();await assert.rejects(queued,e=>e.name==='AbortError');assert.equal(created,before)
  abort.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert(running.stopped)
  mode='success';assert.equal((await videoAssets(page,budget,0,new AbortController().signal)).previews.length,3)
  const count=created;assert.throws(()=>videoAssets(page,budget,0,AbortSignal.abort()),e=>e.name==='AbortError');assert.equal(created,count)
 }finally{globalThis.Worker=native}
})
test('early format-1 video views gain only the known playback defaults',()=>{
 const d={formatVersion:1,...initialVideoDraft()};delete d.view.animationSpeed;delete d.view.animationLoop
 const normalized=validateStoredVideo(d);assert.equal(normalized.view.animationSpeed,1);assert.equal(normalized.view.animationLoop,true);assert.equal(d.view.animationSpeed,undefined)
 for(const alter of [v=>v.view.command='run',v=>v.view.animationSpeed=2]){const bad=structuredClone(d);alter(bad);assert.throws(()=>validateStoredVideo(bad))}
})

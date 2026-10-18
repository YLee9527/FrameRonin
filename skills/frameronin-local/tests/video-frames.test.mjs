import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../.runtime/js/algorithms.mjs'

test('video frame recipes reject unknown fields, duplicate or reordered selections, missing timestamps and resource overflow',()=>{
 const sizes=[{w:17,h:13},{w:7,h:9}],compose={mode:'compose',width:23.5,height:21.25,padding:2.5,spacing:1.25,columns:3,timestamps:[0,.2005],strokeWidth:.5,strokeColor:'#8325cd'}
 const plan=api.videoFramePlan(sizes,compose,1024,0,2*1024**3)
 assert.equal(plan.width,73);assert.equal(plan.height,21)
 for(const layout of [{mode:'analyze',command:'run'},{mode:'matte',selected:[1,0],background:'#fff000',tolerance:40,feather:10,mask:false},{mode:'archive',kind:'extracted',selected:[0,0]},{...compose,timestamps:[0]},{...compose,columns:NaN},{...compose,strokeWidth:17},{...compose,width:30000}])assert.throws(()=>api.videoFramePlan(sizes,layout,1024,0,2*1024**3))
 assert.throws(()=>api.videoFramePlan(sizes,{mode:'analyze'},1024,0,128*1024**2),/RESOURCE/)
 assert.throws(()=>api.videoFramePlan(sizes,{mode:'analyze'},1024,0,2*1024**3,{w:1,h:1}),/MASK/)
 assert.throws(()=>api.videoFramePlan(sizes,{mode:'matte',selected:[0],background:'#fff000',tolerance:40,feather:10,mask:true},1024,0,2*1024**3),/MASK/)
})
test('video capture timestamps and selected-range sampling retain original floating accumulation and prior selection semantics',()=>{
 assert.equal(api.videoTimestamps(0,1,10,2000).length,11)
 assert.deepEqual(api.videoTimestamps(.25,.75,4,2000),[.25,.5])
 assert.deepEqual(api.videoTimestamps(0,60,60,2),[0,1/60])
 assert.throws(()=>api.videoTimestamps(0,1,0,1));assert.throws(()=>api.videoTimestamps(1,1,12,1));assert.throws(()=>api.videoTimestamps(0,1,12,2001))
 assert.deepEqual(api.sampleVideoSelection([0,2,5,6,9],4,2,2),[2,6])
 assert.deepEqual(api.sampleVideoSelection([0,2,5],-1,99,0),[0,2,5])
})
test('sparse video fingerprints preserve the one-pixel terminal coercion and stable duplicate group assignment',()=>{
 assert.equal(api.videoFingerprint(Uint8ClampedArray.from([1,2,3,4])),'10_0')
 assert.deepEqual(api.videoDuplicateMarkers(['a','b','a','b','c']),[{index:0,groupId:0,totalInGroup:2},{index:2,groupId:0,totalInGroup:2},{index:1,groupId:1,totalInGroup:2},{index:3,groupId:1,totalInGroup:2}])
 const solid=new Uint8ClampedArray(5*5*4).fill(255),copy=Uint8ClampedArray.from(solid)
 api.videoInnerStroke(solid,5,5,16,'#000000');assert.deepEqual(solid,copy)
 const edge=Uint8ClampedArray.from(copy);for(let x=0;x<5;x++)edge[x*4+3]=0
 api.videoInnerStroke(edge,5,5,1,'#112233');assert.deepEqual([...edge.slice(20,24)],[17,34,51,255]);assert.deepEqual([...edge.slice(40,44)],[255,255,255,255])
})

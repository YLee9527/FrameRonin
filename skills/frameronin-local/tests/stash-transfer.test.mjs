import assert from 'node:assert/strict'
import test from 'node:test'
import {materializeStashUrl,stashTransferName} from '../.runtime/js/algorithms.mjs'

test('stash copies do not revoke a preview owned by another tool, including repeated transfers',async()=>{
 const Reader=globalThis.FileReader,bytes=new Uint8Array([0,20,255,128]),blob=new Blob([bytes],{type:'image/png'}),url=URL.createObjectURL(blob)
 globalThis.FileReader=class{readAsDataURL(b){void b.arrayBuffer().then(v=>{this.result='data:'+b.type+';base64,'+Buffer.from(v).toString('base64');this.onload()})}}
 try{
  const first=await materializeStashUrl(url),second=await materializeStashUrl(url)
  assert.equal(first,second);assert.equal(first,'data:image/png;base64,ABT/gA==')
  assert.deepEqual(new Uint8Array(await(await fetch(url)).arrayBuffer()),bytes)
  assert.equal(await materializeStashUrl(first),first)
  await materializeStashUrl(url,true);await assert.rejects(fetch(url))
 }finally{URL.revokeObjectURL(url);globalThis.FileReader=Reader}
})
test('failed stash decoding rejects and only releases an explicitly transferred temporary URL',async()=>{
 const Reader=globalThis.FileReader,url=URL.createObjectURL(new Blob(['source'],{type:'image/png'}))
 globalThis.FileReader=class{readAsDataURL(){queueMicrotask(()=>this.onerror())}}
 try{
  await assert.rejects(materializeStashUrl(url),/STASH_READ_FAILED/);assert.equal(await(await fetch(url)).text(),'source')
  await assert.rejects(materializeStashUrl(url,true),/STASH_READ_FAILED/);await assert.rejects(fetch(url))
 }finally{URL.revokeObjectURL(url);globalThis.FileReader=Reader}
})
test('stash transfers retain safe names and reject paths, controls and misleading extensions',()=>{
 assert.equal(stashTransferName('frame_001.png','image/png'),'frame_001.png')
 assert.equal(stashTransferName('frame.jpg','image/jpeg'),'frame.jpg');assert.equal(stashTransferName('frame.jpeg','image/jpeg'),'frame.jpeg')
 for(const value of ['../a.png','a/b.png','a\\b.png','a\n.png','frame.jpg','x'.repeat(256)+'.png',''])assert.match(stashTransferName(value,'image/png'),/^stash_\d+\.png$/)
})

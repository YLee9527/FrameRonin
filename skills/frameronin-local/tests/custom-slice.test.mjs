import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)

test('custom seam planning preserves transparent-gap counts and original uniform/L7 boundaries',()=>{
 const pixels=new Uint8ClampedArray(10*10*4)
 for(const top of [1,6])for(const left of [1,6])for(let y=top;y<top+3;y++)for(let x=left;x<left+3;x++)pixels[(y*10+x)*4+3]=255
 const p={mode:'auto',columns:8,rows:4,refine:'l7',bandPercent:25}
 const plan=api.computeCustomPlan(new ImageData(pixels,10,10),p)
 assert.deepEqual([plan.columns,plan.rows],[2,2]);assert.deepEqual(plan.colStarts,[0,5,10]);assert.deepEqual(plan.rowStarts,[0,5,10]);api.validateCustomPlan(plan,10,10)
 const one=api.computeCustomPlan(new ImageData(pixels,10,10),{...p,mode:'grid',columns:3,rows:1})
 assert.deepEqual(one.colStarts,[0,3,6,10]);assert.deepEqual(one.rowStarts,[0,10]);assert.equal(one.bendY,5)
 assert.throws(()=>api.computeCustomPlan(new ImageData(pixels,10,10),{...p,command:'run'}),/PARAMETERS/)
 assert.throws(()=>api.validateCustomPlan({...plan,deltaX:1},10,10),/PLAN_RESULT/)
})

test('reviewed custom slices retain remainder cells, fractional-region floors, jagged bands and clipped polylines',()=>{
 assert.deepEqual(api.customSliceSizes(13,11,{mode:'grid',columns:3,rows:2}),[{w:4,h:5},{w:4,h:5},{w:5,h:5},{w:4,h:6},{w:4,h:6},{w:5,h:6}])
 assert.equal(api.customSliceSizes(2,2,{mode:'grid',columns:4,rows:4}).length,16)
 assert.deepEqual(api.customSliceSizes(13,11,{mode:'regions',regions:[{id:'one',x:1.9,y:2.9,w:99,h:9.5}]}),[{w:12,h:9}])
 const bands={mode:'bands',colStarts:[0,4,8,13],rowStarts:[0,5,11],bandColOffset:[1,-1]}
 assert.deepEqual(api.customSliceSizes(13,11,bands),[{w:5,h:5},{w:4,h:5},{w:4,h:5},{w:3,h:6},{w:4,h:6},{w:6,h:6}])
 for(const bendY of [0,5,11]){
  const sizes=api.customSliceSizes(13,11,{mode:'polyline',colStarts:[0,4,8,13],bendY,deltaX:-2})
  assert.deepEqual(sizes.map(s=>s.h),[11,11,11]);assert.deepEqual(sizes.map(s=>s.w),bendY===11?[4,4,5]:[4,6,7])
 }
 for(const invalid of [{...bands,extra:'read'},{...bands,colStarts:[0,8,4,13]},{...bands,bandColOffset:[4,0]},{mode:'regions',regions:[{id:'one',x:13,y:0,w:1,h:1}]}])assert.throws(()=>api.validateCustomLayout(invalid,13,11))
 assert.throws(()=>api.checkCustomSliceBudget(8192,8192,100,2*1024**3,0,{mode:'grid',columns:1,rows:1}),/RESOURCE_LIMIT/)
})

test('composition validates signed frame indices, exact grids, full output dimensions and decoded budgets',()=>{
 const sizes=[{w:4,h:5},{w:7,h:3}],p={rows:2,columns:3,grid:[[1,-2,0],[2,0,-1]],expandUp:1,expandDown:2,expandLeft:3,expandRight:4}
 assert.deepEqual(api.customComposeSize(sizes,p),{width:42,height:16,cellW:7,cellH:5})
 for(const invalid of [{...p,grid:[[1,2],[2,1]]},{...p,grid:[[1,3,0],[0,0,0]]},{...p,grid:[[1,1.5,0],[0,0,0]]},{...p,command:'run'},{...p,expandLeft:129}])assert.throws(()=>api.customComposeSize(sizes,invalid))
 assert.throws(()=>api.checkCustomComposeBudget(sizes,p,10,20,2*1024**3,2*1024**3),/RESOURCE_LIMIT/)
})

test('custom ZIP preflight checks canonical ordered names and rejects oversized central-directory claims before inflation',async()=>{
 const bytes=await readFile(path.join(skill,'assets/fixtures/scatter/original/export-auto-ui-png.zip'))
 const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
 assert.throws(()=>api.inspectCustomZip(buffer,2*1024**3),/ARCHIVE_NAMES/)
 const JSZip=(await import('../assets/workbench/node_modules/jszip/lib/index.js')).default,zip=new JSZip()
 zip.file('frame_000.png','one');zip.file('frame_001.png','two');const valid=await zip.generateAsync({type:'arraybuffer'})
 assert.deepEqual(api.inspectCustomZip(valid,2*1024**3),{names:['frame_000.png','frame_001.png'],encodedBytes:6})
 const damaged=valid.slice(0),view=new DataView(damaged)
 for(let i=0;i<view.byteLength-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,0x7fffffff,true);break}
 assert.throws(()=>api.inspectCustomZip(damaged,2*1024**3),/ARCHIVE_LIMIT/)
})

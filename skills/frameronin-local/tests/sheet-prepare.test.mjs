import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const options=change=>({...api.sheetPreprocessDefaults,...change})
async function image(blob){const url=URL.createObjectURL(blob);try{return await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url})}finally{URL.revokeObjectURL(url)}}
const blob=c=>new Promise(resolve=>c.toBlob(resolve,'image/png'))
function sample(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const d=new ImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)d.data.set([x*13%256,y*17%256,(x+y)*19%256,255],(y*w+x)*4);c.getContext('2d').putImageData(d,0,0);return c}

test('sheet preprocess preserves stage order, rounded geometry and complete intermediate budgets',()=>{
 const p=options({cropTop:1.5,cropBottom:20,cropLeft:1,cropRight:2,padTop:2,padBottom:1,padLeft:4,padRight:3,resizeEnabled:true,resizeW:9.4,resizeH:7.5})
 assert.deepEqual(api.sheetPreprocessSize(13,11,p),{cropped:{width:10,height:1},padded:{width:17,height:4},output:{width:9,height:8}})
 api.checkSheetPreprocessBudget(13,11,1000,p,2*1024**3,0)
 assert.equal(api.sheetPreprocessHasEffect(options({cropTop:.1,padLeft:.4})),false)
 assert.throws(()=>api.checkSheetPreprocessBudget(13,11,1000,options({cropTop:.1}),2*1024**3,0),/NO_EFFECT/)
 for(const change of [{command:'run'},{watermark:1},{padLeft:-1},{cropTop:4097},{resizeW:8193},{matteTolerance:442},{matteFeather:65},{matteMode:'remote'}])assert.throws(()=>api.validateSheetPreprocess(options(change)))
 assert.throws(()=>api.checkSheetPreprocessBudget(8192,8192,1000,p,2*1024**3,0),/RESOURCE_LIMIT/)
 assert.throws(()=>api.checkSheetPreprocessBudget(13,11,1000,p,2*1024**3,2*1024**3),/RESOURCE_LIMIT/)
})

test('preprocessing uses explicit Worker adapters without a hidden watermark fallback',async()=>{
 const source=await blob(sample(13,11)),calls=[]
 const p=options({watermark:true,cropTop:1,cropBottom:2,cropLeft:1,cropRight:2,padTop:2,padBottom:1,padLeft:4,padRight:3,resizeEnabled:true,resizeW:9,resizeH:7,matteMode:'global',matteTolerance:44,matteFeather:3})
 const output=await api.applySheetProPreprocess(source,p,{watermark:async b=>{const i=await image(b);calls.push(['watermark',i.width,i.height]);return b},global:async(b,...rgb)=>{const i=await image(b);calls.push(['global',i.width,i.height,...rgb]);return b},contiguous:async()=>{throw new Error('Wrong matte adapter')}})
 const result=await image(output);assert.deepEqual([result.width,result.height],[9,7]);assert.deepEqual(calls,[['watermark',13,11],['global',9,7,0,0,0,44,3]])
 await assert.rejects(api.applySheetProPreprocess(source,options({watermark:true}),{watermark:async()=>{throw new Error('MASK_UNAVAILABLE')},global:async b=>b,contiguous:async b=>b}),/MASK_UNAVAILABLE/)
 assert.equal(await api.applySheetProPreprocess(source,options({})),source)
})

test('whole and uniform sheet preparation preserve their different remainder and dense-grid rules',async()=>{
 const whole={mode:'whole',columns:3,rows:2},uniform={mode:'uniform',columns:3,rows:2}
 assert.deepEqual(api.sheetPreparationSizes(13,11,whole),[{w:4,h:5},{w:4,h:5},{w:5,h:5},{w:4,h:6},{w:4,h:6},{w:5,h:6}]);assert.deepEqual(api.sheetPreparationSizes(13,11,uniform),Array(6).fill({w:4,h:5}))
 assert.equal(api.sheetPreparationSizes(2,2,{mode:'whole',columns:64,rows:64}).length,4096)
 assert.throws(()=>api.sheetPreparationSizes(2,2,{mode:'uniform',columns:3,rows:2}),/DENSE/)
 assert.throws(()=>api.validateSheetPreparation({mode:'transparent',columns:4}),/LAYOUT/)
 assert.throws(()=>api.checkSheetPrepareBudget(8192,8192,1000,{mode:'transparent'},2*1024**3,0),/RESOURCE_LIMIT/)
 assert.throws(()=>api.checkSheetPrepareBudget(-1,1,1000,{mode:'transparent'},2*1024**3,0,[{w:1,h:1}]),/DIMENSIONS/)
 const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js'),source=sample(13,11)
 for(const p of [whole,uniform]){
  const sizes=api.sheetPreparationSizes(13,11,p),archive=await JSZip.loadAsync(await(await api.prepareSheetGrid(source,13,11,p)).arrayBuffer())
  assert.deepEqual(Object.keys(archive.files),Array.from({length:6},(_,i)=>`frame_${String(i).padStart(3,'0')}.png`))
  for(let i=0;i<6;i++){const im=await image(new Blob([await archive.file(`frame_${String(i).padStart(3,'0')}.png`).async('uint8array')]));assert.deepEqual([im.width,im.height],[sizes[i].w,sizes[i].h])}
 }
})

test('frame ZIP materialization preserves order and bytes while appending a transparent blank',async()=>{
 const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js'),sizes=[{w:3,h:2},{w:2,h:4}],files=await Promise.all(sizes.map(s=>blob(sample(s.w,s.h))))
 const p={order:[1,0],blank:{width:2,height:4}};assert.deepEqual(api.sheetFramesSizes(p,sizes),[{w:2,h:4},{w:3,h:2},{w:2,h:4}])
 const zip=await JSZip.loadAsync(await(await api.packSheetFrames(sizes,p,i=>files[i])).arrayBuffer())
 assert.deepEqual(Object.keys(zip.files),['frame_000.png','frame_001.png','frame_002.png'])
 assert.deepEqual(await zip.file('frame_000.png').async('uint8array'),new Uint8Array(await files[1].arrayBuffer()));assert.deepEqual(await zip.file('frame_001.png').async('uint8array'),new Uint8Array(await files[0].arrayBuffer()))
 const blank=await image(new Blob([await zip.file('frame_002.png').async('uint8array')])),c=document.createElement('canvas');c.width=blank.width;c.height=blank.height;c.getContext('2d').drawImage(blank,0,0);assert.deepEqual([c.width,c.height],[2,4]);assert.ok(c.getContext('2d').getImageData(0,0,c.width,c.height).data.every(v=>v===0))
 for(const bad of [{order:[0,0],blank:null},{order:[],blank:p.blank},{order:[0],blank:{width:2.5,height:4}},{...p,command:'run'}])assert.throws(()=>api.sheetFramesSizes(bad,sizes))
 assert.throws(()=>api.checkSheetBudget(sizes,{order:[0],blank:{width:30000,height:30000}},'frames',1000,2*1024**3,0),/RESOURCE_LIMIT/)
})

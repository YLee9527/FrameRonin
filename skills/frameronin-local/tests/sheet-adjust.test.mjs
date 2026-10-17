import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const crop={top:0,bottom:0,left:0,right:0}
const frame=(sourceIndex,more={})=>({sourceIndex,dx:0,dy:0,crop:{...crop},...more})
const sizes=[{w:3,h:2},{w:2,h:4}]
const layout={columns:2,rows:1,frames:[frame(0),frame(1)]}

test('sheet adjustment validates strict placement, selection, fractional crops and operation-specific dimensions',()=>{
 assert.deepEqual(api.sheetLayout(sizes,layout),{cellW:3,cellH:4,width:6,height:4,gifWidth:3,gifHeight:4})
 const fractional={...layout,frames:[frame(0,{crop:{top:-.5,bottom:0,left:-1.25,right:.5}})]}
 assert.deepEqual(api.sheetLayout(sizes,fractional),{cellW:3.75,cellH:2.5,width:7,height:2,gifWidth:3,gifHeight:2})
 for(const p of [{...layout,unknown:1},{...layout,columns:65},{...layout,frames:[frame(2)]},{...layout,frames:[frame(0,{dx:.5})]},{...layout,frames:[frame(0,{crop:{...crop,command:'run'}})]}])assert.throws(()=>api.validateSheetCompose(p,sizes))
 for(const p of [{...layout,selected:[0,0],speedScale:1},{...layout,selected:[],speedScale:1},{...layout,selected:[0],speedScale:0}])assert.throws(()=>api.validateSheetCompose(p,sizes,true))
 const wide=[{w:1000,h:2}],gif={columns:64,rows:4096,frames:[frame(0)],selected:[0],speedScale:1}
 assert.throws(()=>api.sheetLayout(wide,gif),/DIMENSIONS/);assert.equal(api.sheetLayout(wide,gif,'gif').gifWidth,1000)
 api.checkSheetBudget(sizes,layout,'compose',1000,2*1024**3,0)
 assert.throws(()=>api.checkSheetBudget([{w:8192,h:8192}],{columns:1,rows:1,frames:[frame(0)]},'compose',1000,2*1024**3,0),/RESOURCE_LIMIT/)
 assert.throws(()=>api.checkSheetBudget(sizes,layout,'compose',1000,2*1024**3,2*1024**3),/RESOURCE_LIMIT/)
})

test('fixed pixel patches preserve latest overlap, alpha, unselected pixels and smaller-frame clipping',()=>{
 const p={selected:[0],referenceWidth:3,referenceHeight:2,fixes:[{imgX:0,imgY:0,range:2,data:Array.from({length:4},()=>[255,0,0,255]).flat()},{imgX:1,imgY:1,range:1,data:[0,255,0,128]}]}
 api.validateSheetFix(p,sizes)
 const image=new ImageData(2,2);image.data.fill(42);api.fixSheetPixels(image,p)
 assert.deepEqual([...image.data],[255,0,0,255,255,0,0,255,255,0,0,255,0,255,0,128])
 for(const patch of [{...p.fixes[0],imgX:2},{...p.fixes[0],range:9},{...p.fixes[0],data:[256]}])assert.throws(()=>api.validateSheetFix({...p,fixes:[patch]},sizes))
 assert.throws(()=>api.validateSheetFix({...p,command:'run'},sizes))
})

function solid(w,h,rgba){const c=document.createElement('canvas');c.width=w;c.height=h;const data=new ImageData(w,h);for(let i=0;i<data.data.length;i+=4)data.data.set(rgba,i);c.getContext('2d').putImageData(data,0,0);return c}
async function pixels(blob){const url=URL.createObjectURL(blob);try{const image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url}),c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);return {width:c.width,height:c.height,data:c.getContext('2d').getImageData(0,0,c.width,c.height).data}}finally{URL.revokeObjectURL(url)}}
test('sheet composition clips shifts into cells and GIF uses unselected frames for the common cell size',async()=>{
 const sources=[solid(3,2,[255,0,0,255]),solid(2,4,[0,255,0,255])];let opened=0,closed=0
 const load=async index=>{opened++;const c=sources[index];return {image:c,width:c.width,height:c.height,close:()=>closed++}}
 const output=await pixels(await api.composeSheet(sizes,{...layout,frames:[frame(0,{dx:1}),frame(1,{dy:-1})]},load))
 assert.deepEqual([output.width,output.height],[6,4]);assert.deepEqual([...output.data.slice(0,4)],[0,0,0,0]);assert.deepEqual([...output.data.slice(4,8)],[255,0,0,255]);assert.deepEqual([...output.data.slice(12,16)],[0,255,0,255]);assert.equal(opened,closed)
 const gif=await api.gifSheet(sizes,{...layout,selected:[0],speedScale:.75},load),decoded=api.decodeBrowserGif(await gif.arrayBuffer(),2*1024**3)
 assert.deepEqual([decoded.width,decoded.height,decoded.frames.length],[3,4,1]);assert.equal(decoded.frames[0].delay,130);assert.equal(opened,closed)
 const reversedSelection={...layout,selected:[1,0],speedScale:1},ordered=api.decodeBrowserGif(await(await api.gifSheet(sizes,reversedSelection,load)).arrayBuffer(),2*1024**3)
 assert.deepEqual([...ordered.frames[0].data.slice(0,4)],[255,0,0,255]);assert.deepEqual([...ordered.frames[1].data.slice(0,4)],[0,255,0,255]);assert.deepEqual(reversedSelection.selected,[1,0])
 await assert.rejects(api.composeSheet(sizes,layout,async()=>({image:sources[0],width:9,height:9,close:()=>closed++})),/SIZE_CHANGED/)
})

test('sheet fixes retain ordered PNG members and never re-encode unselected files',async()=>{
 const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js'),sources=[solid(3,2,[255,0,0,255]),solid(2,4,[0,255,0,255])]
 const blobs=await Promise.all(sources.map(c=>new Promise(resolve=>c.toBlob(resolve,'image/png'))))
 const p={selected:[0],referenceWidth:3,referenceHeight:2,fixes:[{imgX:1,imgY:0,range:1,data:[0,0,255,255]}]},load=async i=>({image:sources[i],width:sources[i].width,height:sources[i].height,close(){}})
 const archive=await JSZip.loadAsync(await(await api.fixSheet(sizes,p,load,i=>blobs[i])).arrayBuffer())
 assert.deepEqual(Object.keys(archive.files),['frame_000.png','frame_001.png'])
 assert.deepEqual(await archive.file('frame_001.png').async('uint8array'),new Uint8Array(await blobs[1].arrayBuffer()))
 const result=await pixels(new Blob([await archive.file('frame_000.png').async('uint8array')]))
 assert.deepEqual([...result.data.slice(4,8)],[0,0,255,255]);assert.deepEqual([...result.data.slice(0,4)],[255,0,0,255])
})

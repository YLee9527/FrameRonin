import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {installDom} from '../scripts/js-runtime/dom.mjs'
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
installDom(path.join(skill,'assets/workbench/public'),2*1024**3)
const api=await import(pathToFileURL(path.join(skill,'.runtime/js/algorithms.mjs')).href)
const p={columns:3,rows:2,order:[5,1,2,0],framesPerRow:3,duration:25}

test('sprite GIF rows preserve edited order, partial rows, maximum cell size and GIF duration rounding',()=>{
 assert.deepEqual(api.spriteGifRows(13,11,p),[{indices:[5,1,2],width:5,height:6,frames:3,durationMs:30},{indices:[0],width:4,height:5,frames:1,durationMs:30}])
 for(const value of [{...p,command:'run'},{...p,order:[1,1]},{...p,order:[true]},{...p,order:[6]},{...p,framesPerRow:129},{...p,duration:19},{...p,rows:1.5}])assert.throws(()=>api.validateSpriteGifLayout(value),/LAYOUT/)
 api.checkSpriteGifBudget(13,11,1000,p,2*1024**3,0)
 for(const args of [[8192,8192,1000,p,2*1024**3,0],[13,11,21*1024**2,p,2*1024**3,0],[13,11,1000,p,2*1024**3,-1]])assert.throws(()=>api.checkSpriteGifBudget(...args),/RESOURCE/)
})

test('sprite row encoding pads top-left and retains all selected frames and timing',async()=>{
 const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js')
 const frames=[new ImageData(new Uint8ClampedArray([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]),2,2),new ImageData(new Uint8ClampedArray([0,255,0,255,0,255,0,255,0,255,0,255]),3,1)]
 const layout={columns:2,rows:1,order:[0,1],framesPerRow:2,duration:25}
 const output=await api.encodeSpriteGifRows([{w:2,h:2},{w:3,h:1}],layout,async i=>frames[i])
 const archive=await JSZip.loadAsync(await output.arrayBuffer());assert.deepEqual(Object.keys(archive.files),['row_01.gif'])
 const decoded=api.decodeBrowserGif(await archive.file('row_01.gif').async('arraybuffer'),2*1024**3)
 assert.deepEqual([decoded.width,decoded.height,decoded.frames.length],[3,2,2]);assert.deepEqual(decoded.frames.map(f=>f.delay),[30,30])
 assert.equal(decoded.frames[0].data[(2*4)+3],0);assert.equal(decoded.frames[1].data[(3*4)+3],0)
 assert.deepEqual([...decoded.frames[0].data.slice(0,4)],[255,0,0,255]);assert.deepEqual([...decoded.frames[1].data.slice(0,4)],[0,255,0,255])
 await assert.rejects(api.encodeSpriteGifRows([{w:2,h:2}],layout,async i=>frames[i]),/SOURCE_FRAMES/)
})

const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
test('sprite documents bind both frame archives and historical GIF results, reuse seven resources and reject invalid candidates before reads',async()=>{
 const native=globalThis.fetch,splitLayout={mode:'grid',columns:4,rows:1},framesLayout={mode:'grid',columns:2,rows:2},gifLayout={columns:2,rows:2,order:[3,1,0],framesPerRow:2,duration:25}
 const params=[splitLayout,framesLayout,gifLayout].map(layout=>({layout,renderer:'browser-worker',frontendBytes:0}))
 const report=(name,i,rest)=>new File([JSON.stringify({operation:i===2?'image.spriteGifs':'image.customSlice',parameters:params[i],...rest})],name,{type:'application/json'})
 const files=[new File(['source'],'source.png',{type:'image/png'}),new File(['split'],'split.zip',{type:'application/zip'}),report('split-report.json',0,{outputFrames:4,frameSizes:api.customSliceSizes(16,12,splitLayout)}),new File(['frames'],'frames.zip',{type:'application/zip'}),report('frames-report.json',1,{outputFrames:4,frameSizes:api.customSliceSizes(16,12,framesLayout)}),new File(['gifs'],'gifs.zip',{type:'application/zip'}),report('gifs-report.json',2,{outputFrames:3,outputRows:2,gifRows:api.spriteGifRows(16,12,gifLayout).map(({width,height,frames,durationMs})=>({width,height,frames,durationMs}))})]
 let imports=0,reads=0,badSource=false,badTask=false,badArchive=false
 const version=key=>{const i=Array.from({length:7},(_,n)=>id(n+1)).indexOf(key);return {id:key,metadata:{kind:i===0?'image':i%2?'archive':'document',bytes:files[i].size,extension:i===0?'.png':i%2?badArchive?'.png':'.zip':'.json',containerFormat:i===0?badSource?'GIF':'PNG':undefined,width:i===0?16:undefined,height:i===0?12:undefined,frames:1}}}
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/project/context')return Response.json({project:{id:'sprite-doc'},memoryBudgetBytes:2*1024**3})
  if(url==='/api/assets'){imports++;return Response.json(version(id(files.findIndex(f=>f.name===options.body.get('file').name)+1)))}
  if(String(url).startsWith('/api/tasks/')){const i=[id(10),id(11),id(12)].indexOf(String(url).split('/').at(-1));return Response.json({state:badTask?'canceled':'succeeded',results:[id(i*2+2),id(i*2+3)],payload:{operation:i===2?'image.spriteGifs':'image.customSlice',inputs:[id(1)],parameters:params[i]}})}
  if(String(url).startsWith('/api/versions/')){const key=String(url).split('/')[3];if(String(url).endsWith('/content')){reads++;return new Response(files[Array.from({length:7},(_,n)=>id(n+1)).indexOf(key)])}return Response.json(version(key))}
  throw new Error('Unexpected request '+url)
 }
 try{
  const r=i=>({data:files[i*2+1],report:files[i*2+2],taskId:id(i+10)})
  const draft={...api.initialSpriteSheetDraft(),source:files[0],info:{w:16,h:12},columns:2,rows:2,order:[1,3],framesPerRow:3,duration:100,split:r(0),frames:r(1),gifs:r(2)}
  const stored=await api.serializeSpriteSheet(draft),restored=await api.restoreSpriteSheet(stored);assert.equal(imports,7);assert.equal(reads,7);assert.deepEqual(restored.order,[1,3]);assert.equal(restored.duration,100)
  await api.serializeSpriteSheet(restored);assert.equal(imports,7)
  const before=reads
  badSource=true;await assert.rejects(api.restoreSpriteSheet(stored),/SOURCE_METADATA/);assert.equal(reads,before);badSource=false
  badTask=true;await assert.rejects(api.restoreSpriteSheet(stored),/DOCUMENT_TASK/);assert.equal(reads,before);badTask=false
  badArchive=true;await assert.rejects(api.restoreSpriteSheet(stored),/RESULT_METADATA/);assert.equal(reads,before);badArchive=false
  for(const change of [v=>v.command='run',v=>v.order=[1,1],v=>v.columns=3,v=>v.frames=null,v=>v.gifs.data.name='../outside.zip',v=>v.duration=19]){const invalid=structuredClone(stored);change(invalid);await assert.rejects(api.restoreSpriteSheet(invalid));assert.equal(reads,before)}
 }finally{globalThis.fetch=native}
})

test('sprite frame edits and existing outputs use the same complete-gesture history',()=>{
 const file=new File(['zip'],'frames.zip'),result={data:file,report:new File(['report'],'report.json'),taskId:id(1)}
 let history=api.createSpriteSheetHistory({...api.initialSpriteSheetDraft(),order:[0,1,2],frames:result})
 history=api.spriteSheetHistoryReducer(history,{type:'begin'})
 for(const order of [[1,0,2],[1,2,0]])history=api.spriteSheetHistoryReducer(history,{type:'change',update:d=>({...d,order})})
 history=api.spriteSheetHistoryReducer(history,{type:'end'});assert.equal(history.past.length,1)
 history=api.spriteSheetHistoryReducer(history,{type:'undo'});assert.deepEqual(history.present.order,[0,1,2]);assert.equal(history.present.frames.data,file)
 history=api.spriteSheetHistoryReducer(history,{type:'redo'});assert.deepEqual(history.present.order,[1,2,0])
 history=api.spriteSheetHistoryReducer(history,{type:'change',update:d=>({...d,gifs:result})});history=api.spriteSheetHistoryReducer(history,{type:'undo'});assert.equal(history.present.gifs,null)
 history=api.spriteSheetHistoryReducer(history,{type:'redo'});assert.equal(history.present.gifs.data,file)
})

test('sprite assets ignore foreign replies and terminate canceled or malformed Workers',async()=>{
 const previous=globalThis.Worker,workers=[]
 globalThis.Worker=class{constructor(){workers.push(this);this.stopped=0}postMessage(v){this.request=v}terminate(){this.stopped++}}
 try{
  const abort=new AbortController(),request={action:'gifArchive',file:new Blob(['zip']),rowCount:1},pending=api.spriteSheetAssets(request,2*1024**3,0,abort.signal),worker=workers[0]
  worker.onmessage({data:{id:'other',generation:0,files:[]}});assert.equal(worker.stopped,0)
  abort.abort();await assert.rejects(pending,{name:'AbortError'});worker.onmessage({data:{...worker.request,files:[new Blob(['gif'],{type:'image/gif'})]}});assert.equal(worker.stopped,1)
  const next=api.spriteSheetAssets(request,2*1024**3,0,new AbortController().signal),w=workers[1]
  w.onmessage({data:{...w.request,files:[new Blob(['png'],{type:'image/png'})]}});await assert.rejects(next,/RESPONSE/);assert.equal(w.stopped,1)
  const png=new Blob(['png'],{type:'image/png'}),oversized=api.spriteSheetAssets({action:'preview',files:Array(129).fill(png),sizes:Array(129).fill({w:1,h:1,frames:1})},2*1024**3,0,new AbortController().signal),large=workers[2]
  large.onmessage({data:{...large.request,previews:Array(129).fill(png)}});await assert.rejects(oversized,/RESPONSE/);assert.equal(large.stopped,1)
 }finally{globalThis.Worker=previous}
})

test('bounded ZIP inflation rejects a stream larger than its declared resource allowance',async()=>{
 const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js'),zip=new JSZip()
 zip.file('frame_000.png',new Uint8Array(256*1024).fill(7));const bytes=await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'}),view=new DataView(bytes)
 for(let at=0;at<view.byteLength-46;at++)if(view.getUint32(at,true)===0x02014b50){view.setUint32(at+24,2,true);break}
 const inspected=api.inspectCustomZip(bytes,2*1024**3);assert.equal(inspected.encodedBytes,2)
 const loaded=await JSZip.loadAsync(bytes);await assert.rejects(api.boundedZipBlob(loaded.file('frame_000.png'),2),/INFLATION_LIMIT/)
 await assert.rejects(api.boundedZipBlob({},128),/STREAM_UNAVAILABLE/)
 const valid=new JSZip();valid.file('frame_000.png','valid');assert.equal(await(await api.boundedZipBlob(valid.file('frame_000.png'),16)).text(),'valid')
})

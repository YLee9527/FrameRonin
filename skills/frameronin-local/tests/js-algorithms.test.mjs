import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { installDom } from '../scripts/js-runtime/dom.mjs'

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dom = installDom(path.join(skill, 'assets/workbench/public'), 2 * 1024 ** 3)
const algorithms = await import(pathToFileURL(path.join(skill, '.runtime/js/algorithms.mjs')).href)

test('Ronin tool history keeps input order, complete processing results and gestures in one bounded undo stack',()=>{
  const input=new File(['source'],'source.png'),output=new File(['result'],'result.png'),report=new File(['report'],'report.json')
  let state=algorithms.createImageToolHistory({...algorithms.initialImageToolDraft('findDuplicates'),files:[input]})
  state=algorithms.imageToolHistoryReducer(state,{type:'begin'})
  for(const columns of [9,10,11])state=algorithms.imageToolHistoryReducer(state,{type:'change',update:draft=>({...draft,parameters:{...draft.parameters,columns}})})
  state=algorithms.imageToolHistoryReducer(state,{type:'end'});assert.equal(state.past.length,1)
  state=algorithms.imageToolHistoryReducer(state,{type:'change',update:draft=>({...draft,results:[output],reportFile:report,taskId:'known-task'})})
  state=algorithms.imageToolHistoryReducer(state,{type:'undo'});assert.deepEqual(state.present.results,[]);assert.equal(state.present.parameters.columns,11)
  state=algorithms.imageToolHistoryReducer(state,{type:'redo'});assert.equal(state.present.results[0],output);assert.equal(state.present.reportFile,report)
  state=algorithms.imageToolHistoryReducer(state,{type:'undo'});state=algorithms.imageToolHistoryReducer(state,{type:'undo'});assert.equal(state.present.parameters.columns,8)
})

test('Ronin tool documents bind selected versions and ordered results to their successful task and validate report groups',async()=>{
  const native=globalThis.fetch,project='ronin-tool-document-test',id=index=>`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`
  const source=new File(['source'],'source.png',{type:'image/png'}),first=new File(['one'],'first.png',{type:'image/png'}),second=new File(['two'],'second.png',{type:'image/png'})
  const originalReport={operation:'image.findDuplicates',outputFrames:2,indexBase:0,groups:[[0,1]],frameDimensions:[{width:8,height:12},{width:8,height:12}]}
  const report=new File([JSON.stringify(originalReport)],'report.json',{type:'application/json'})
  const entries=new Map([[id(1),source],[id(2),first],[id(3),second],[id(4),report]]),names=new Map([...entries].map(([key,file])=>[file.name,key]))
  let imports=0,contentReads=0,big=false,badKind=false,reportOverride=null
  const version=key=>({id:key,metadata:{kind:key===id(4)?'document':badKind?'script_pending_review':'image',extension:key===id(4)?'.json':'.png',bytes:big&&key!==id(4)?100*1024**2:entries.get(key).size,width:key===id(1)?16:8,height:12}})
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:project},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){imports++;return Response.json(version(names.get(options.body.get('file').name)))}
    if(url===`/api/tasks/${id(5)}`)return Response.json({state:'succeeded',results:[id(2),id(3),id(4)],payload:{operation:'image.findDuplicates',inputs:[id(1)]}})
    const key=String(url).split('/')[3]
    if(String(url).endsWith('/content')){contentReads++;return new Response(key===id(4)&&reportOverride?JSON.stringify(reportOverride):entries.get(key))}
    return Response.json(version(key))
  }
  try{
    const draft={...algorithms.initialImageToolDraft('findDuplicates'),files:[source],results:[first,second],reportFile:report,taskId:id(5)}
    const stored=await algorithms.serializeImageToolDocument(draft);assert.equal(imports,4)
    const restored=await algorithms.restoreImageToolDocument(stored)
    assert.deepEqual((await algorithms.imageToolReport(restored)).groups,[[0,1]])
    await algorithms.serializeImageToolDocument(restored);assert.equal(imports,4)
    for(const change of [v=>v.command='run',v=>v.files[0].name='../private.png',v=>v.parameters.shell=true,v=>v.results=Array(4097).fill(v.results[0]),v=>v.taskId=null]){
      const invalid=structuredClone(stored);change(invalid);assert.throws(()=>algorithms.validateStoredImageTool(invalid))
    }
    const swapped=structuredClone(stored);swapped.files[0].versionId=id(2)
    await assert.rejects(algorithms.restoreImageToolDocument(swapped),/TASK_MISMATCH/)
    reportOverride={...originalReport,groups:[[0,0]]}
    await assert.rejects(algorithms.restoreImageToolDocument(stored),/REPORT_GROUP/);reportOverride=null
    const before=contentReads;big=true
    await assert.rejects(algorithms.restoreImageToolDocument(stored),/DOCUMENT_RESOURCE_LIMIT/);assert.equal(contentReads,before);big=false;badKind=true
    await assert.rejects(algorithms.restoreImageToolDocument(stored),/RESOURCE_KIND/);assert.equal(contentReads,before)
  }finally{globalThis.fetch=native}
})

test('sprite grid exports are callable and preserve exact duplicate groups and uneven cell dimensions',async()=>{
  assert.equal(typeof algorithms.splitSpriteSheetGrid,'function');assert.equal(typeof algorithms.findDuplicateFrameIndexGroups,'function')
  for(const name of ['grid','uneven','tiny']){
    const bitmap=await dom.loadImage(await fs.readFile(path.join(skill,`assets/fixtures/ronin/${name}.png`)))
    const canvas=dom.createCanvas(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,0,0)
    const fixture=JSON.parse(await fs.readFile(path.join(skill,`assets/fixtures/ronin/original/duplicates-${name}/report.json`),'utf8'))
    const cells=algorithms.splitSpriteSheetGrid({native:canvas,naturalWidth:bitmap.width,naturalHeight:bitmap.height},name==='tiny'?4:3,name==='tiny'?3:2)
    assert.deepEqual(cells.map(cell=>({width:cell.width,height:cell.height})),fixture.frameDimensions)
    assert.deepEqual(algorithms.findDuplicateFrameIndexGroups(cells),fixture.groups)
  }
  await assert.rejects(algorithms.customScaleImage(new Blob(),{mode:'resize',pixelated:false}),/BROWSER_RENDERER_REQUIRED/)
})

test('sequence undo groups cropped parameters and keeps all selected/result files across reorder and removal', () => {
  const first=new File(['first'],'first.png'),second=new File(['second'],'second.png'),result=new File(['known-result'],'combined.png')
  let state=algorithms.createSequenceHistory({...algorithms.initialSequenceDraft(),combineFiles:[first,second]})
  state=algorithms.sequenceHistoryReducer(state,{type:'begin'})
  for(const cropLeft of [1,2,3])state=algorithms.sequenceHistoryReducer(state,{type:'change',update:value=>({...value,cropLeft})})
  state=algorithms.sequenceHistoryReducer(state,{type:'end'})
  assert.equal(state.past.length,1)
  state=algorithms.sequenceHistoryReducer(state,{type:'change',update:value=>({...value,combineFiles:[second,first],combinedFile:result})})
  state=algorithms.sequenceHistoryReducer(state,{type:'view',activeTab:'frames2gif'})
  state=algorithms.sequenceHistoryReducer(state,{type:'undo'})
  assert.deepEqual(state.present.combineFiles,[first,second]);assert.equal(state.present.combinedFile,null);assert.equal(state.present.activeTab,'frames2gif')
  state=algorithms.sequenceHistoryReducer(state,{type:'redo'})
  assert.equal(state.present.combinedFile,result);assert.deepEqual(state.present.combineFiles,[second,first])
  state=algorithms.sequenceHistoryReducer(state,{type:'change',update:value=>({...value,combineFiles:[]})})
  state=algorithms.sequenceHistoryReducer(state,{type:'undo'})
  assert.deepEqual(state.present.combineFiles,[second,first])
})
test('sequence documents preserve shared formal references and reject unsafe fields, resources and excessive frames', async () => {
  const first=new File(['first'],'first.png',{type:'image/png'}),second=new File(['second'],'second.png',{type:'image/png'})
  const native=globalThis.fetch
  const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002']
  const contents=new Map();let imports=0
  const metadata={kind:'image',bytes:5,width:16,height:12,extension:'.png'}
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:'document-project'},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){
      const file=options.body.get('file'),id=ids[imports++];contents.set(id,file)
      return Response.json({id,metadata:{...metadata,bytes:file.size}})
    }
    const id=String(url).split('/')[3]
    if(String(url).endsWith('/content'))return new Response(contents.get(id))
    return Response.json({id,metadata:{...metadata,bytes:contents.get(id).size}})
  }
  try{
    const draft={...algorithms.initialSequenceDraft(),frameFiles:[first,second],combineFiles:[second],cropLeft:-2.5}
    const notifications=[]
    const stored=await algorithms.serializeSequenceDocument(draft,(file,version)=>{
      notifications.push({file,previous:algorithms.sequenceMetadata.get(file),version})
    })
    assert.equal(notifications.length,2)
    assert(notifications.every(item=>item.previous===undefined))
    assert.equal(algorithms.sequenceMetadata.get(first).id,stored.frameFiles[0].versionId)
    assert.equal(imports,2);assert.equal(stored.combineFiles[0].versionId,stored.frameFiles[1].versionId)
    const restored=await algorithms.restoreSequenceDocument(stored)
    assert.equal(restored.combineFiles[0],restored.frameFiles[1]);assert.equal(restored.cropLeft,-2.5)
    await algorithms.serializeSequenceDocument(restored);assert.equal(imports,2)
    for(const change of [v=>v.shell='run',v=>v.frameFiles[0].name='../private.png',v=>v.frameDelay=0,
      v=>v.frameFiles[0].versionId='unselected-path',v=>v.frameFiles=Array(1001).fill(v.frameFiles[0])]){
      const invalid=structuredClone(stored);change(invalid);assert.throws(()=>algorithms.validateStoredSequence(invalid))
    }
  }finally{globalThis.fetch=native}
})

test('pixel history groups parameter gestures and restores existing input and result files across undo',()=>{
  const first=new File(['source'],'source.png'),result=new File(['processed'],'result.png'),second=new File(['another'],'another.png')
  let state=algorithms.createPixelHistory({...algorithms.initialPixelDraft(),file:first,resultFile:result,processingSize:{width:128,height:96}})
  state=algorithms.pixelHistoryReducer(state,{type:'begin'})
  state=algorithms.pixelHistoryReducer(state,{type:'view',activeTab:'color16'})
  state=algorithms.pixelHistoryReducer(state,{type:'end'});assert.equal(state.past.length,0)
  state=algorithms.pixelHistoryReducer(state,{type:'begin'})
  for(const ppGridCols of [16,24,48])state=algorithms.pixelHistoryReducer(state,{type:'change',update:v=>({...v,ppGridCols})})
  state=algorithms.pixelHistoryReducer(state,{type:'end'});assert.equal(state.past.length,1)
  state=algorithms.pixelHistoryReducer(state,{type:'change',update:v=>({...v,file:second,resultFile:null,processingSize:null})})
  state=algorithms.pixelHistoryReducer(state,{type:'undo'})
  assert.equal(state.present.file,first);assert.equal(state.present.resultFile,result);assert.equal(state.present.ppGridCols,48)
  state=algorithms.pixelHistoryReducer(state,{type:'undo'});assert.equal(state.present.ppGridCols,32);assert.equal(state.present.activeTab,'color16')
  state=algorithms.pixelHistoryReducer(state,{type:'redo'});assert.equal(state.present.resultFile,result)
})
test('pixel and sequence history budgets cover past, current and redo references together',()=>{
  const results=Array.from({length:4},(_,i)=>{
    const file=new File(['metadata-sized fixture'],`large-${i}.png`)
    Object.defineProperty(file,'size',{value:60*1024**2});return file
  })
  for(const kind of ['pixel','sequence']){
    const initial=kind==='pixel'?algorithms.initialPixelDraft:algorithms.initialSequenceDraft
    const create=kind==='pixel'?algorithms.createPixelHistory:algorithms.createSequenceHistory
    const reduce=kind==='pixel'?algorithms.pixelHistoryReducer:algorithms.sequenceHistoryReducer
    const key=kind==='pixel'?'resultFile':'combinedFile'
    let state=create({...initial(),[key]:results[0]})
    for(const file of results.slice(1))state=reduce(state,{type:'change',update:v=>({...v,[key]:file})})
    const size=()=>[...new Set([state.present,...state.past,...state.future].map(v=>v[key]))].reduce((sum,f)=>sum+f.size*2,0)
    assert(size()<=256*1024**2);assert.equal(state.present[key],results[3])
    state=reduce(state,{type:'undo'});assert.equal(state.present[key],results[2]);assert(size()<=256*1024**2)
    state=reduce(state,{type:'redo'});assert.equal(state.present[key],results[3])
  }
})
test('pixel documents roundtrip formal image versions and reject unsafe resources and out-of-bounds selections',async()=>{
  const native=globalThis.fetch,files=new Map(),ids=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'];let imports=0
  globalThis.fetch=async(url,options={})=>{
    if(url==='/api/project/context')return Response.json({project:{id:'pixel-project'},memoryBudgetBytes:2*1024**3})
    if(url==='/api/assets'){const file=options.body.get('file'),id=ids[imports++];files.set(id,file);return Response.json({id,metadata:{kind:'image',bytes:file.size,width:128,height:96,extension:'.png'}})}
    const id=String(url).split('/')[3]
    if(String(url).endsWith('/content'))return new Response(files.get(id))
    return Response.json({id,metadata:{kind:'image',bytes:files.get(id).size,width:128,height:96,extension:'.png'}})
  }
  try{
    const draft={...algorithms.initialPixelDraft(),file:new File(['source'],'source.png',{type:'image/png'}),resultFile:new File(['result'],'result.png',{type:'image/png'}),previewSelection:{x:8,y:8,w:64,h:48},processingSize:{width:128,height:96}}
    const stored=await algorithms.serializePixelDocument(draft),restored=await algorithms.restorePixelDocument(stored)
    assert.equal(imports,2);assert.deepEqual(restored.previewSelection,draft.previewSelection)
    assert.equal(await restored.resultFile.text(),'result')
    const again=await algorithms.serializePixelDocument(restored);assert.deepEqual(again,stored);assert.equal(imports,2)
    for(const change of [v=>v.command='execute',v=>v.file.name='../secret.png',v=>v.file.versionId='/private/file',v=>v.ppGridCols=1.5,v=>v.previewSelection.extra=true,v=>v.processingSize.width=0]){
      const invalid=structuredClone(stored);change(invalid);assert.throws(()=>algorithms.validateStoredPixel(invalid))
    }
    const outside=structuredClone(stored);outside.previewSelection.x=100
    await assert.rejects(algorithms.restorePixelDocument(outside),/REGION_OUTSIDE/)
    const oversized=structuredClone(stored);oversized.processingSize.width=129
    await assert.rejects(algorithms.restorePixelDocument(oversized),/PROCESSING_SIZE/)
  }finally{globalThis.fetch=native}
})

test('original GIF encoder retains transparent threshold, frame order and finite resource limits', async () => {
  const first=new dom.ImageData(new Uint8ClampedArray([255,0,0,255,0,0,255,127]),2,1)
  const second=new dom.ImageData(new Uint8ClampedArray([0,255,0,255,0,0,255,128]),2,1)
  const third=new dom.ImageData(new Uint8ClampedArray([0,0,255,255,0,0,255,129]),2,1)
  const gif=await algorithms.encodeBrowserGif([first,second,third],120)
  const bytes=await gif.arrayBuffer(),decoded=algorithms.decodeBrowserGif(bytes,2*1024**3)
  assert.equal(decoded.frames.length,3);assert.equal(decoded.width,2);assert.equal(decoded.height,1)
  assert.deepEqual(decoded.frames.map(f=>f.delay),[120,120,120])
  assert.deepEqual([...decoded.frames[0].data.slice(0,4)],[255,0,0,255])
  assert.equal(decoded.frames[0].data[7],0);assert.equal(decoded.frames[1].data[7],0);assert.equal(decoded.frames[2].data[7],255)
  assert.deepEqual([...decoded.frames[1].data.slice(0,4)],[0,255,0,255])
  assert.throws(()=>algorithms.decodeBrowserGif(bytes,128*1024**2),/RESOURCE_LIMIT/)
})

function graph() {
  return {version:7,nodes:[{id:'input',type:'workflowInputImage',params:{imageIndex:1}},
    {id:'resize',type:'resizeHard',params:{w:16,h:16}}],edges:[{id:'edge',source:'input',target:'resize'}]}
}
test('strict graph and legacy repairs have separate behavior', () => {
  assert.equal(algorithms.validateStrictWorkflow(graph(),1).nodes[1].params.keepAspect,0)
  for(const change of [value=>value.nodes[1].type='unknown',value=>value.nodes[1].params.shell=1,
    value=>value.nodes[1].id='input',value=>value.edges[0].source='missing',value=>value.edges[0].targetPort='inA',
    value=>value.nodes[1].params.w=null]) {
    const value=graph();change(value);assert.throws(()=>algorithms.validateStrictWorkflow(value,1))
  }
  const historical=graph();historical.nodes.push({id:'unknown',type:'unknown',params:{},x:0,y:0})
  const imported=algorithms.importLegacyWorkflow(JSON.stringify(historical))
  assert(imported.warnings.includes('NODE_DISCARDED:unknown'))
})
test('native canvas adapter preserves exact nearest-neighbor and grid pixels', async () => {
  const canvas=dom.createCanvas(8,8),context=canvas.getContext('2d')
  context.fillStyle='#ff0000';context.fillRect(0,0,4,4)
  const blob=new Blob([await canvas.encode('png')])
  const result=await algorithms.runWorkflowOnBlob(blob,[{id:'r',type:'resizeHard',params:{w:16,h:16,keepAspect:0}}])
  const image=await dom.loadImage(Buffer.from(await result.arrayBuffer()))
  const output=dom.createCanvas(16,16);output.getContext('2d').drawImage(image,0,0)
  const rgba=output.getContext('2d').getImageData(0,0,16,16).data
  assert.deepEqual([...rgba.slice(0,4)],[255,0,0,255])
  assert.deepEqual([...rgba.slice((15*16+15)*4,(15*16+15)*4+4)],[0,0,0,0])
})
test('PerfectPixel manual grid retains palette and reports a reduced grid', () => {
  const canvas=dom.createCanvas(64,64),context=canvas.getContext('2d')
  context.fillStyle='#ff0000';context.fillRect(0,0,32,64)
  context.fillStyle='#00ff00';context.fillRect(32,0,32,64)
  const result=algorithms.getPerfectPixel(context.getImageData(0,0,64,64),{gridSize:{cols:8,rows:8},refineIntensity:0,fixSquare:false})
  assert.equal(result.width,8);assert.equal(result.height,8)
  assert.deepEqual([...result.data.slice(0,4)],[255,0,0,255])
})
test('Rseprite shares one undo history across paint, frames, durations and layer state', () => {
  let state = algorithms.createInitialState(16,16)
  const reducer = algorithms.rsepriteReducer
  const actions = [
    {type:'PAINT_PIXELS',frameIndex:0,celIndex:0,pixels:[{x:2,y:3}],rgba:[255,0,0,255]},
    {type:'ADD_FRAME'},
    {type:'SET_FRAME_DURATION',frameIndex:1,durationMs:240},
    {type:'SET_LAYER_VISIBLE',layerIndex:0,visible:false},
    {type:'DELETE_FRAME',frameIndex:0},
  ]
  const snapshots = [state]
  for (const action of actions) { state=reducer(state,action);snapshots.push(state) }
  assert.equal(state.undoStack.length,5)
  for(let index=actions.length-1;index>=0;index--) {
    state=reducer(state,{type:'UNDO'})
    assert.deepEqual(state.document,snapshots[index].document)
    assert.equal(state.activeFrameIndex,snapshots[index].activeFrameIndex)
  }
  for(let index=1;index<snapshots.length;index++) {
    state=reducer(state,{type:'REDO'})
    assert.deepEqual(state.document,snapshots[index].document)
  }
  assert.equal(state.document.frames[0].durationMs,240)
  assert.equal(state.document.layers[0].visible,false)
})
test('stored Rseprite documents reject extra fields, invalid references and resource overflow', () => {
  const document = {formatVersion:1,width:16,height:16,layers:[{id:'layer',name:'Layer',visible:true,locked:false}],
    frames:[{id:'frame',durationMs:100,cels:[{layerId:'layer',versionId:'00000000-0000-4000-8000-000000000001'}]}]}
  algorithms.validateStoredRseprite(document)
  for (const change of [value=>value.command='write',value=>value.layers[0].locked='false',
    value=>value.layers.push(value.layers[0]),value=>value.frames[0].durationMs=0,
    value=>value.frames[0].cels[0].layerId='missing',value=>value.frames[0].cels[0].versionId='../private.png',
    value=>value.width=8192,value=>value.frames[0].cels[0].path='/secret']) {
    const value=structuredClone(document);change(value);assert.throws(()=>algorithms.validateStoredRseprite(value))
  }
})
test('stitch accepts shared or named ports and rejects mixing their semantics', () => {
  const value={version:7,nodes:[{id:'a',type:'workflowInputImage',params:{imageIndex:1}},
    {id:'b',type:'workflowInputImage',params:{imageIndex:2}},{id:'stitch',type:'simpleStitchVertical',params:{stitchMode:2}}],
    edges:[{id:'a-s',source:'a',target:'stitch'},{id:'b-s',source:'b',target:'stitch'}]}
  algorithms.validateStrictWorkflow(value,2)
  value.edges[0].targetPort='in1';value.edges[1].targetPort='in2'
  algorithms.validateStrictWorkflow(value,2)
  delete value.edges[0].targetPort
  assert.throws(()=>algorithms.validateStrictWorkflow(value,2))
})
test('private OpenCV loader preserves original optical-flow behavior without a thenable initialization loop', {timeout:10000}, async () => {
  const first=dom.createCanvas(64,64),second=dom.createCanvas(64,64)
  for (const [canvas,x] of [[first,10],[second,14]]) {
    const context=canvas.getContext('2d');context.fillStyle='#dd6633';context.fillRect(x,20,20,20)
  }
  const output=await algorithms.interpolateMidFrameOpticalFlow(first,second,{quality:'fast'})
  assert.equal(output.width,64);assert.equal(output.height,64)
  assert.deepEqual([...output.getContext('2d').getImageData(20,25,1,1).data],[221,102,51,255])
  assert.deepEqual([...output.getContext('2d').getImageData(0,0,1,1).data],[0,0,0,0])
})
test('blueprint history treats a node deletion with its edges and a complete drag as single undo steps', () => {
  const initial = {nodes:[{id:'a',type:'resizeHard',params:{w:8,h:8},x:0,y:0},
    {id:'b',type:'resizeHard',params:{w:8,h:8},x:300,y:0}],edges:[{id:'edge',source:'a',target:'b'}],presetName:'Original'}
  const reducer = algorithms.workflowHistoryReducer
  let history = algorithms.createWorkflowHistory(initial)
  history = reducer(history,{type:'begin'})
  for (let x=1;x<=20;x++) history = reducer(history,{type:'nodes',value:nodes=>nodes.map(node=>node.id==='a'?{...node,x}:node)})
  history = reducer(history,{type:'end'});assert.equal(history.past.length,1)
  history = reducer(history,{type:'change',value:draft=>({...draft,nodes:draft.nodes.filter(node=>node.id!=='a'),edges:[]})})
  assert.equal(history.past.length,2)
  history = reducer(history,{type:'undo'})
  assert.equal(history.present.nodes[0].x,20);assert.equal(history.present.edges.length,1)
  history = reducer(history,{type:'undo'});assert.deepEqual(history.present,initial)
  history = reducer(history,{type:'redo'});history = reducer(history,{type:'redo'})
  assert.deepEqual(history.present.nodes.map(node=>node.id),['b']);assert.equal(history.present.edges.length,0)
  history = reducer(history,{type:'restore',value:initial});assert.equal(history.past.length,0);assert.equal(history.future.length,0)
})
test('stored blueprints allow incomplete editing while rejecting unsafe fields and references', () => {
  const draft = {formatVersion:1,graph:{version:7,nodes:[],edges:[],presetName:'Draft'},inputs:[]}
  algorithms.validateStoredWorkflow(draft)
  assert.throws(()=>algorithms.validateStrictWorkflow(draft.graph,0))
  for (const change of [value=>value.execute='shell',value=>value.graph.nodes.push({id:'n',type:'unknown',params:{}}),
    value=>value.inputs.push({id:'00000000-0000-4000-8000-000000000001',name:'../secret.png',versionId:'00000000-0000-4000-8000-000000000002'}),
    value=>value.graph.edges.push({id:'e',source:'missing',target:'other'})]) {
    const value=structuredClone(draft);change(value);assert.throws(()=>algorithms.validateStoredWorkflow(value))
  }
})
test('all 13 historical preset layouts can be stored without relaxing strict AI identifier limits', async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve(skill, '../../doc/baseline/presets.json'), 'utf8'))
  for (const preset of manifest) {
    const relative = preset.source.replace('reference/frontend/public/', '')
    const text = await fs.readFile(path.join(skill, 'assets/workbench/public', relative), 'utf8')
    const { nodes, edges, presetName } = algorithms.importLegacyWorkflow(text)
    algorithms.validateStoredWorkflow({ formatVersion: 1, graph: { version: 7, nodes, edges, presetName: presetName ?? preset.id }, inputs: [] })
  }
  const value = graph();value.edges[0].id='e'.repeat(95)
  assert.throws(()=>algorithms.validateStrictWorkflow(value,1), /WORKFLOW_ID_INVALID/)
})

test('map undo keeps replaced images and coalesces an entire overlap gesture', () => {
  const image=(name)=>({file:new File(['fixture'],name),url:`blob:${name}`,image:{},width:64,height:64,memoryBudgetBytes:2*1024**3})
  const source=image('source.png'),old=image('old.png'),replacement=image('new.png')
  const initial={source,tiles:{'0.85,0':{x:.85,y:0,w:1,h:1}},tileUploads:{'0.85,0':old},
    tileFeathers:{'0.85,0':{top:5,right:10,bottom:15,left:20}},horizontalOverlapPercent:15,verticalOverlapPercent:15,
    expandSplit:4,hidePreviewBorders:false,hiddenPreviewTiles:{'0.85,0':true}}
  const reducer=algorithms.mapHistoryReducer
  let history=algorithms.createMapHistory(initial)
  history=reducer(history,{type:'begin'})
  for(let value=16;value<=30;value++)history=reducer(history,{type:'change',update:draft=>({...draft,horizontalOverlapPercent:value})})
  history=reducer(history,{type:'end'});assert.equal(history.past.length,1)
  history=reducer(history,{type:'change',update:draft=>({...draft,tileUploads:{'0.85,0':replacement}})})
  history=reducer(history,{type:'change',update:draft=>({...draft,tileUploads:{},tileFeathers:{},hiddenPreviewTiles:{}})})
  assert.deepEqual([...algorithms.mapImages([history.present,...history.past,...history.future])],[source,old,replacement])
  history=reducer(history,{type:'undo'});assert.equal(history.present.tileUploads['0.85,0'],replacement)
  assert.equal(history.present.tileFeathers['0.85,0'].left,20);assert.equal(history.present.hiddenPreviewTiles['0.85,0'],true)
  history=reducer(history,{type:'undo'});assert.equal(history.present.tileUploads['0.85,0'],old)
  history=reducer(history,{type:'undo'});assert.equal(history.present,initial)
  for(let i=0;i<3;i++)history=reducer(history,{type:'redo'})
  assert.deepEqual(history.present.tileUploads,{})
  history=reducer(history,{type:'restore',draft:initial});assert.equal(history.past.length,0);assert.equal(history.future.length,0)
})
test('stored maps reject unsafe resources, noncanonical coordinates and invalid view state', () => {
  const image={versionId:'00000000-0000-4000-8000-000000000001',name:'tile.png'}
  const value={formatVersion:1,source:image,tiles:{'0.85,0':{x:.85,y:0,w:1,h:1}},tileUploads:{'0.85,0':image},tileFeathers:{},
    horizontalOverlapPercent:15,verticalOverlapPercent:15,expandSplit:4,hidePreviewBorders:false,hiddenPreviewTiles:{},
    view:{pan:{x:24,y:-12},zoom:2,selectedKey:'0.85,0'}}
  algorithms.validateStoredMap(value)
  for(const change of [v=>v.execute='script',v=>v.source.name='../secret.png',v=>v.source.versionId='/secret.png',
    v=>v.tiles['0.85,0'].x=.9,v=>v.tiles['0,0']={x:0,y:0,w:1,h:1},v=>v.tiles['0.85,0'].w=101,
    v=>v.tileUploads.missing=image,v=>v.view.zoom=9,v=>v.view.pan.x=Infinity,v=>v.view.selectedKey='missing',
    v=>v.tileFeathers['0.85,0']={top:51,right:0,bottom:0,left:0}]){
    const invalid=structuredClone(value);change(invalid);assert.throws(()=>algorithms.validateStoredMap(invalid))
  }
})
test('map exporters preserve original compositing, PSD channels and trusted Godot structure', async () => {
  const source=dom.createCanvas(16,12),neighbor=dom.createCanvas(16,12)
  source.getContext('2d').fillStyle='#ff0000';source.getContext('2d').fillRect(0,0,16,12)
  neighbor.getContext('2d').fillStyle='#0033ff';neighbor.getContext('2d').fillRect(0,0,16,12)
  const feather={top:0,right:0,bottom:0,left:0}
  const layout={sourceName:'source.png',width:16,height:12,horizontalOverlapPercent:15,verticalOverlapPercent:15,
    layers:[{inputIndex:0,key:'0,0',tile:{x:0,y:0,w:1,h:1},feather},
      {inputIndex:1,key:'0.85,0',tile:{x:.85,y:0,w:1,h:1},feather}]}
  const png=await algorithms.renderMapExport([source,neighbor],layout,'png')
  const decoded=await dom.loadImage(Buffer.from(await png.arrayBuffer()))
  assert.equal(decoded.width,30);assert.equal(decoded.height,12)
  const canvas=dom.createCanvas(30,12),ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0)
  assert.deepEqual([...ctx.getImageData(0,0,1,1).data],[255,0,0,255])
  assert.deepEqual([...ctx.getImageData(14,0,1,1).data],[0,51,255,255])
  const psd=Buffer.from(await(await algorithms.renderMapExport([source,neighbor],layout,'psd')).arrayBuffer())
  assert.equal(psd.subarray(0,4).toString(),'8BPS');assert.equal(psd.readUInt32BE(14),12);assert.equal(psd.readUInt32BE(18),30)
  const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js')
  const archive=await JSZip.loadAsync(await(await algorithms.renderMapExport([source,neighbor],layout,'godot')).arrayBuffer())
  const manifest=JSON.parse(await archive.file('map_stitch_godot.json').async('text'))
  assert.equal(manifest.tiles.length,2);assert.equal(manifest.tiles[1].pixel.x,14)
  assert.equal(Object.keys(archive.files).some(name=>/\.(gd|cs|gdextension)$/.test(name)),false)
  const scene=await archive.file('map_stitch_godot.tscn').async('text');assert.match(scene,/centered = false/)
  const template=await algorithms.renderMapExport([source,neighbor],layout,'template',{x:-.85,y:0,w:1,h:1})
  const tile=await dom.loadImage(Buffer.from(await template.arrayBuffer()));assert.equal(tile.width,16)
  const preview=dom.createCanvas(16,12);preview.getContext('2d').drawImage(tile,0,0)
  assert.deepEqual([...preview.getContext('2d').getImageData(0,0,1,1).data],[0,0,0,0])
  assert.deepEqual([...preview.getContext('2d').getImageData(14,0,1,1).data],[255,0,0,255])
})
test('legacy map archive preflight rejects traversal, ZIP64 and declared memory overflow before inflation', async () => {
  const {default:JSZip}=await import('../assets/workbench/node_modules/jszip/lib/index.js')
  const zip=new JSZip();zip.file('map_stitch_state.json','{}');zip.file('images/tile.png',new Uint8Array([1,2,3]))
  const bytes=await zip.generateAsync({type:'arraybuffer',compression:'STORE'})
  algorithms.validateMapZipBudget(bytes,2*1024**3)
  const centralOffset=new DataView(bytes).getUint32(bytes.byteLength-6,true)
  for(const change of [view=>view.setUint32(centralOffset+24,0xffffffff,true),view=>view.setUint32(centralOffset+24,1024**3,true),
    view=>view.setUint16(bytes.byteLength-18,1,true),view=>view.setUint16(bytes.byteLength-12,65535,true)]){
    const altered=bytes.slice(0);change(new DataView(altered));assert.throws(()=>algorithms.validateMapZipBudget(altered,2*1024**3))
  }
  const traversal=new JSZip();traversal.file('../private.png',new Uint8Array([1]))
  const unsafe=await traversal.generateAsync({type:'arraybuffer'})
  assert.throws(()=>algorithms.validateMapZipBudget(unsafe,2*1024**3))
})

test('map expansion preserves four, eight and twelve neighbors and directional restrictions', () => {
  for(const split of [4,8,12]){
    const tiles=algorithms.expansionTilesFrom({x:0,y:0,w:1,h:1},split,.15,.25)
    assert.equal(tiles.length,split)
    const sides={top:tiles.filter(t=>t.y<0),bottom:tiles.filter(t=>t.y+t.h>1+1e-9),
      right:tiles.filter(t=>t.x+t.w>1+1e-9),left:tiles.filter(t=>t.x<0)}
    for(const side of Object.values(sides))assert.equal(side.length,split/4)
    for(const tile of tiles){assert.equal(tile.w,tile.h);assert(tile.w>0&&tile.w<=1)}
  }
  const right={x:.85,y:0,w:1,h:1}
  const candidates=algorithms.expansionTilesFrom(right,4,.15,.15)
  assert.equal(candidates.filter(tile=>algorithms.isOutwardExpansionTile(right,tile)).length,3)
  assert.equal(algorithms.isOutwardExpansionTile(right,{x:0,y:0,w:1,h:1}),false)
})

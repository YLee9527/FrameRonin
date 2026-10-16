import { featheredImageCanvas, makeRelativeTemplate, layeredPsdBlob } from '../.runtime/oracle/original-map'
import { mapFeatherPreview } from '../assets/workbench/src/lib/mapPreview'
import { interpolateMidFrameOpticalFlow } from '../assets/workbench/src/lib/opticalFlowInterpolate'
import { computeWorkflowRunStrategy, runDagExecution, runWorkflowOnBlob } from '../assets/workbench/src/lib/roninProWorkflow'
import { importLegacyWorkflow } from '../assets/workbench/src/lib/strictWorkflow'
import JSZip from '../assets/workbench/node_modules/jszip'
import { compressWavToMp3 } from '../assets/workbench/src/lib/audioMp3'
import { compositeFrame as originalComposite, originalEncode } from '../.runtime/oracle/original-gif'
import { parseGIF, decompressFrames } from '../assets/workbench/node_modules/gifuct-js'
import { combine as originalCombine, stitch as originalStitch, slice as originalSlice } from '../.runtime/oracle/original-sequence'
import { superSplitByTransparent as originalSuperSplit } from '../.runtime/oracle/original-super'
import * as originalPixel from '../.runtime/oracle/original-pixel'
import { getPerfectPixel as originalPerfect } from '../.runtime/oracle/original-perfectPixel/perfectPixel'
import { computeMeshWithScaling as originalMesh } from '../.runtime/oracle/original-pixellise/mesh'
import { processWithMesh as originalMeshProcess } from '../.runtime/oracle/original-pixellise/pixelate'
import { loadOpenCv } from '../assets/workbench/src/lib/pixellise/opencv'
import { originalScale } from '../.runtime/oracle/original-scale'
import { originalUnify } from '../.runtime/oracle/original-unify'
import {splitSpriteSheetGrid as originalSplitGrid,findDuplicateFrameIndexGroups as originalFindDuplicates} from '../.runtime/oracle/original-duplicate'
import {originalFineEditor} from '../.runtime/oracle/original-fine-editor'
import {runFineEditorWorker} from '../assets/workbench/src/lib/fineEditorWorker'
import {stampFineCircle} from '../assets/workbench/src/lib/fineEditorPixels'

// An explicit test page, built separately from the product. The original browser
// algorithm is the oracle; it deliberately bypasses the managed task adapter.
const files = document.querySelector<HTMLInputElement>('#frames')!
const status = document.querySelector<HTMLElement>('#status')!
const download = document.querySelector<HTMLAnchorElement>('#download')!
let url: string | null = null
async function publish(zip: JSZip, name: string) {
  const blob = await zip.generateAsync({ type: 'blob' })
  if (url) URL.revokeObjectURL(url)
  url = URL.createObjectURL(blob); download.href = url; download.download = name
  download.hidden = false
}
const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png')
})
async function runFlow() {
  const selected = [...files.files ?? []].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (selected.length < 2 || selected.length > 16) throw new Error('Select 2–16 fixed frames')
  const frames = await Promise.all(selected.map(file => createImageBitmap(file)))
  try {
    const zip = new JSZip()
    for (let index = 0; index < frames.length; index++) {
      const canvas = document.createElement('canvas'); canvas.width = frames[index].width; canvas.height = frames[index].height
      canvas.getContext('2d')!.drawImage(frames[index], 0, 0)
      zip.file(`frame_${String(index * 2 + 1).padStart(3, '0')}.png`, await png(canvas))
      if (index < frames.length - 1) {
        status.textContent = `Browser oracle: ${index + 1}/${frames.length - 1}`
        const mid = await interpolateMidFrameOpticalFlow(frames[index], frames[index + 1])
        zip.file(`frame_${String(index * 2 + 2).padStart(3, '0')}.png`, await png(mid))
      }
    }
    await publish(zip, 'browser-optical-flow-oracle.zip')
    status.textContent = `Browser oracle complete: ${frames.length * 2 - 1} frames`
  } finally { frames.forEach(frame => frame.close()) }
}
async function runPresets() {
  const presets = await (await fetch('/preset-manifest.json')).json() as { id: string; file: string }[]
  const input = await (await fetch('/fixed-rgba-grid-1024.png')).blob()
  const zip = new JSZip()
  for (const [index, preset] of presets.entries()) {
    status.textContent = `Browser preset oracle: ${index + 1}/${presets.length} ${preset.id}`
    const parsed = importLegacyWorkflow(await (await fetch(preset.file)).text())
    const count = Math.max(1, ...parsed.nodes.filter(node => node.type === 'workflowInputImage').map(node => node.params.imageIndex ?? 1))
    const blobs = Array.from({ length: count }, () => input)
    const result = computeWorkflowRunStrategy(parsed.nodes, parsed.edges, blobs.length)
    if (!result.ok) throw new Error(`${preset.id}: ${result.reason}`)
    const strategy = result.strategy
    const outputs: Blob[] = []
    if (strategy.kind === 'all') for (const blob of blobs) outputs.push(await runWorkflowOnBlob(blob, strategy.order))
    else if (strategy.kind === 'targeted') for (const plan of strategy.plans) outputs.push(await runWorkflowOnBlob(blobs[plan.fileIndex0], plan.steps))
    else if (strategy.kind === 'dag_per_file') for (const blob of blobs) outputs.push(await runDagExecution(strategy.topo, strategy.edges, strategy.sinkId, () => blob))
    else outputs.push(await runDagExecution(strategy.topo, strategy.edges, strategy.sinkId, node => blobs[(node.params.imageIndex ?? 1) - 1]))
    for (const [outputIndex, output] of outputs.entries()) zip.file(`${preset.id}/${outputIndex}.png`, output)
    zip.file(`${preset.id}/report.json`, JSON.stringify({ strategy: strategy.kind, warnings: parsed.warnings, outputs: outputs.length }))
  }
  await publish(zip, 'browser-preset-oracles.zip'); status.textContent = `Browser preset oracle complete: ${presets.length} presets`
}
async function runAudio() {
  const selected = [...document.querySelector<HTMLInputElement>('#audio')!.files ?? []]
  if (!selected.length || selected.length > 2) throw new Error('Select 1–2 fixed WAV samples')
  const zip = new JSZip()
  const report: object[] = []
  for (const [index, file] of selected.entries()) {
    status.textContent = `Original browser audio: ${index + 1}/${selected.length}`
    const result = await compressWavToMp3(file, 128)
    zip.file(`${file.name}.mp3`, result.blob)
    report.push({ file: file.name, duration: result.durationSec, sampleRate: result.sampleRate, channels: result.channels })
  }
  zip.file('report.json', JSON.stringify(report))
  await publish(zip, 'browser-audio-oracle.zip')
  status.textContent = `Original browser audio complete: ${selected.length} files`
}
async function runMap(){
  const selected=[...document.querySelector<HTMLInputElement>('#map')!.files??[]]
  if(selected.length!==2)throw new Error('Select source and right neighbor, in this order')
  const images=await Promise.all(selected.map(file=>new Promise<HTMLImageElement>((resolve,reject)=>{
    const image=new Image();const url=URL.createObjectURL(file)
    image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>reject(new Error('Map image decode failed'));image.src=url
  })))
  const width=images[0].naturalWidth,height=images[0].naturalHeight
  if(width!==64||height!==64||images[1].naturalWidth!==64||images[1].naturalHeight!==64)throw new Error('Use the fixed 64 x 64 map fixtures')
  const zip=new JSZip()
  for(const [name,feather]of [['plain',{top:0,right:0,bottom:0,left:0}],['left10',{top:0,right:0,bottom:0,left:10}],['edges20',{top:20,right:20,bottom:20,left:20}]] as const){
    const composite=document.createElement('canvas');composite.width=Math.round(1.85*width);composite.height=height
    const ctx=composite.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(images[0],0,0,width,height)
    const drawable=Object.values(feather).some(Boolean)?featheredImageCanvas(images[1],width,height,feather):images[1]
    ctx.drawImage(drawable,Math.round(.85*width),0,width,height)
    zip.file(`${name}/stitched.png`,await png(composite))
    const sourceCanvas=document.createElement('canvas');sourceCanvas.width=width;sourceCanvas.height=height;sourceCanvas.getContext('2d')!.drawImage(images[0],0,0)
    const neighborCanvas=document.createElement('canvas');neighborCanvas.width=width;neighborCanvas.height=height;neighborCanvas.getContext('2d')!.drawImage(drawable,0,0)
    zip.file(`${name}/stitched.psd`,layeredPsdBlob(composite.width,height,ctx.getImageData(0,0,composite.width,height),[
      {name:'source',left:0,top:0,imageData:sourceCanvas.getContext('2d')!.getImageData(0,0,width,height)},
      {name:'tile_0.85_0',left:Math.round(.85*width),top:0,imageData:neighborCanvas.getContext('2d')!.getImageData(0,0,width,height)}]))
    zip.file(`${name}/original-preview.png`,await png(featheredImageCanvas(images[1],width,height,feather)))
    zip.file(`${name}/worker-preview.png`,await mapFeatherPreview(selected[1],width,height,feather,2*1024**3,new AbortController().signal))
  }
  zip.file('template-left.png',await makeRelativeTemplate([{image:{image:images[0]},offsetX:Math.round(.85*width),offsetY:0,drawWidth:width,drawHeight:height}],width,height))
  await publish(zip,'browser-map-oracles.zip');status.textContent='Original map oracle complete: 3 blends, 3 worker previews, PSD and overlap template'
}
async function runGif(){
  const selected=[...document.querySelector<HTMLInputElement>('#gif-frames')!.files??[]]
  const input=document.querySelector<HTMLInputElement>('#gif-input')!.files?.[0]
  if(!input||!selected.length||selected.length>8)throw new Error('Use the fixed GIF and 1-8 PNG fixtures')
  const zip=new JSZip(),images:ImageData[]=[]
  let width=0,height=0
  for(const file of selected){
    const image=await createImageBitmap(file);width ||= image.width;height ||= image.height
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0,width,height);image.close()
    images.push(context.getImageData(0,0,width,height))
    zip.file(`prepared/${String(images.length-1).padStart(3,'0')}.png`,await png(canvas))
  }
  zip.file('encoded.gif',originalEncode(images,120))
  const gif=parseGIF(await input.arrayBuffer()),frames=decompressFrames(gif,true)
  let previous=new Uint8ClampedArray(gif.lsd.width*gif.lsd.height*4)
  for(const [index,frame]of frames.entries()){
    previous=originalComposite(previous,frame,gif.lsd.width,gif.lsd.height) as typeof previous
    const canvas=document.createElement('canvas');canvas.width=gif.lsd.width;canvas.height=gif.lsd.height
    const context=canvas.getContext('2d')!,pixels=context.createImageData(canvas.width,canvas.height);pixels.data.set(previous);context.putImageData(pixels,0,0)
    zip.file(`decoded/frame_${String(index).padStart(3,'0')}.png`,await png(canvas))
  }
  zip.file('report.json',JSON.stringify({encodedFrames:images.length,encodedDimensions:[width,height],delayMs:120,
    decodedFrames:frames.length,decodedDimensions:[gif.lsd.width,gif.lsd.height],disposals:frames.map(frame=>frame.disposalType),delays:frames.map(frame=>frame.delay)}))
  await publish(zip,'browser-gif-oracle.zip');status.textContent=`Original GIF oracle complete: ${images.length} encoded, ${frames.length} decoded frames`
}
async function runSequence(){
  const selected=[...document.querySelector<HTMLInputElement>('#sequence')!.files??[]]
  const regions=document.querySelector<HTMLInputElement>('#regions')!.files?.[0]
  if(selected.length!==3||!regions)throw new Error('Use the three fixed sequence PNGs and transparent-regions sample')
  const load=(file:File)=>new Promise<HTMLImageElement>((resolve,reject)=>{
    const image=new Image(),url=URL.createObjectURL(file);image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>reject(new Error('Image decode failed'));image.src=url
  })
  const images=await Promise.all(selected.map(load)),zip=new JSZip()
  zip.file('combine-default.png',await originalCombine(images,2,0,0,0,0))
  zip.file('combine-crop-expand.png',await originalCombine(images,2,1,-2,-1,2))
  for(const direction of ['vertical','horizontal','overlay'])zip.file(`stitch-${direction}.png`,await originalStitch(images,direction))
  for(const [index,file]of(await originalSlice(images[0],2,3)).entries())zip.file(`slice/${index}.png`,file)
  for(const [index,file]of(await originalSuperSplit(await load(regions),'regions')).entries())zip.file(`super/${index}.png`,file)
  await publish(zip,'browser-sequence-oracle.zip');status.textContent='Original sequence oracle complete: 2 crop/expand grids, 3 stitch modes, floor slices and transparent-region frames'
}
async function runPixel(){
  const selected=document.querySelector<HTMLInputElement>('#pixel')!.files?.[0]
  if(!selected)throw new Error('Use the fixed pixel fixture')
  const fixture=await(await fetch('/pixel-fixture.json')).json(),zip=new JSZip()
  const url=URL.createObjectURL(selected),image=await new Promise<HTMLImageElement>((resolve,reject)=>{
    const input=new Image();input.onload=()=>resolve(input);input.onerror=()=>reject(new Error('Image decode failed'));input.src=url
  });URL.revokeObjectURL(url)
  for(const entry of fixture.cases){
    const p=entry.parameters
    let output:Blob
    if(entry.operation==='image.pixelate')output=await originalPixel.pixelateImage(image,p.pixelSize)
    else if(entry.operation==='image.mergeNearby')output=await originalPixel.mergeNearbyColorsImage(image,p.strength)
    else if(entry.operation==='image.palette16')output=await originalPixel.reduceTo16Colors(image,p)
    else{
      const canvas=document.createElement('canvas');canvas.width=p.regionWidth||image.naturalWidth;canvas.height=p.regionHeight||image.naturalHeight
      const context=canvas.getContext('2d')!;context.drawImage(image,p.regionX||0,p.regionY||0,canvas.width,canvas.height,0,0,canvas.width,canvas.height)
      const data=context.getImageData(0,0,canvas.width,canvas.height)
      const result=entry.operation==='image.perfectPixel'?originalPerfect(data,{sampleMethod:'center',minSize:4,peakWidth:6,...p,gridSize:{cols:p.gridCols,rows:p.gridRows}})
        :originalMeshProcess(data,{...p,...originalMesh(await loadOpenCv(),data,p.upscale)})
      const out=document.createElement('canvas');out.width=result.width;out.height=result.height;out.getContext('2d')!.putImageData(result,0,0)
      output=await png(out)
    }
    zip.file(`${entry.id}.png`,output);status.textContent=`Original pixel oracle: ${entry.id}`
  }
  zip.file('fixture.json',JSON.stringify(fixture));await publish(zip,'browser-pixel-oracles.zip');status.textContent=`Original pixel oracle complete: ${fixture.cases.length} cases`
}
async function runRonin(){
  const fixture=await(await fetch('/ronin-fixtures/manifest.json')).json(),zip=new JSZip()
  const load=(file:File)=>new Promise<HTMLImageElement>((resolve,reject)=>{
    const image=new Image(),url=URL.createObjectURL(file);image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>reject(new Error('Image decode failed'));image.src=url
  })
  for(const entry of fixture.cases){
    const inputs:File[]=[]
    for(const path of entry.inputs){const response=await fetch(`/ronin-fixtures/${path}`);if(!response.ok)throw new Error(`Missing fixture: ${path}`);inputs.push(new File([await response.blob()],path.split('/').pop()))}
    const p=entry.parameters
    if(entry.operation==='image.customScale')zip.file(`${entry.id}/0.png`,await originalScale(inputs[0],p))
    else{
      const images=await Promise.all(inputs.map(load))
      if(entry.operation==='sequence.unifySize')zip.file(`${entry.id}/0.png`,await originalUnify(images,p.columns,p.horizontal,p.vertical))
      else{
        const cells=originalSplitGrid(images[0],p.columns,p.rows)
        zip.file(`${entry.id}/report.json`,JSON.stringify({groups:originalFindDuplicates(cells),indexBase:0,frameDimensions:cells.map(cell=>({width:cell.width,height:cell.height}))}))
        for(const [index,cell]of cells.entries())zip.file(`${entry.id}/${index}.png`,await png(cell))
      }
    }
    status.textContent=`Original Ronin tools: ${entry.id}`
  }
  zip.file('fixture.json',JSON.stringify(fixture));await publish(zip,'browser-ronin-oracles.zip');status.textContent=`Original Ronin tools complete: ${fixture.cases.length} cases`
}
async function runSmoothWorker(){
  const fixture=await(await fetch('/ronin-fixtures/manifest.json')).json(),zip=new JSZip()
  for(const entry of fixture.cases.filter((item:{parameters:{pixelated?:boolean}})=>item.parameters.pixelated===false)){
    const file=await(await fetch(`/ronin-fixtures/${entry.inputs[0]}`)).blob()
    const worker=new Worker(new URL('../assets/workbench/src/lib/smoothResize.worker.ts',import.meta.url),{type:'module'})
    try{
      const result=await new Promise<Blob>((resolve,reject)=>{
        worker.onerror=event=>reject(new Error(event.message));worker.onmessage=event=>{if(event.data.phase)return;event.data.error?reject(new Error(event.data.error)):resolve(event.data.blob)}
        worker.postMessage({id:entry.id,generation:0,file,parameters:entry.parameters})
      })
      zip.file(`${entry.id}/0.png`,result);status.textContent=`Worker smooth resize: ${entry.id}`
    }finally{worker.terminate()}
  }
  await publish(zip,'browser-smooth-worker.zip');status.textContent='Worker smooth resize complete: 6 cases'
}
async function runFineEditor(){
  const fixture=await(await fetch('/fine-editor/manifest.json')).json(),zip=new JSZip(),checks=[]
  for(const entry of fixture.cases){
    const file=await(await fetch(`/fine-editor/${entry.input??'source.png'}`)).blob()
    const url=URL.createObjectURL(file),image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Original image decode failed'));image.src=url
    }),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);URL.revokeObjectURL(url)
    const input=context.getImageData(0,0,canvas.width,canvas.height),raw=new Uint8ClampedArray(input.data)
    const originalCanvas={width:canvas.width,height:canvas.height,getContext:()=>({
      getImageData:context.getImageData.bind(context),
      putImageData:(image:ImageData,x:number,y:number)=>{raw.set(image.data);context.putImageData(image,x,y)},
    })} as unknown as HTMLCanvasElement
    const originalRect=originalFineEditor(originalCanvas,entry.action,entry.parameters),expected=await png(canvas)
    if(!entry.input)zip.file('raw-input.json',JSON.stringify([...input.data]))
    zip.file(`${entry.id}/raw-input.json`,JSON.stringify([...input.data]));zip.file(`${entry.id}/raw-original.json`,JSON.stringify([...raw]))
    const decoded=await runFineEditorWorker({action:'decode',file,budget:2*1024**3,retained:0},new AbortController().signal,0)
    let request:any={action:entry.action==='none'?'encode':entry.action,width:decoded.width,height:decoded.height,pixels:decoded.pixels,budget:2*1024**3,retained:0,...entry.parameters}
    if(entry.action==='brush'||entry.action==='eraser'){
      context.putImageData(new ImageData(decoded.pixels!,decoded.width,decoded.height),0,0)
      const p=entry.parameters
      stampFineCircle(context,decoded.width,decoded.height,p.x,p.y,entry.action==='brush'?p.brushSize:p.eraserSize,entry.action==='brush'?[24,86,192]:null)
      request={...request,action:'encode',pixels:context.getImageData(0,0,decoded.width,decoded.height).data}
    }
    const actual=await runFineEditorWorker(request,new AbortController().signal,1)
    zip.file(`${entry.id}/original.png`,expected);zip.file(`${entry.id}/actual.png`,actual.blob!)
    zip.file(`${entry.id}/size.json`,JSON.stringify({width:canvas.width,height:canvas.height}))
    checks.push({id:entry.id,originalRect,workerRect:actual.rect??null});status.textContent=`Fine editor: ${entry.id}`
  }
  zip.file('checks.json',JSON.stringify(checks));await publish(zip,'browser-fine-editor.zip');status.textContent=`Fine editor complete: ${fixture.cases.length} original/Worker comparisons`
}
for (const [selector, run] of [['#flow', runFlow], ['#presets', runPresets], ['#audio-run', runAudio], ['#map-run',runMap],['#gif-run',runGif],['#sequence-run',runSequence],['#pixel-run',runPixel],['#ronin-run',runRonin],['#smooth-worker',runSmoothWorker],['#fine-editor',runFineEditor]] as const) {
  document.querySelector<HTMLButtonElement>(selector)!.addEventListener('click', async () => {
    download.hidden = true
    try { await run() } catch (error) { status.textContent = `Oracle failed: ${String(error)}` }
  })
}

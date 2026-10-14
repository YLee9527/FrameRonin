import { featheredImageCanvas, makeRelativeTemplate, layeredPsdBlob } from '../.runtime/oracle/original-map'
import { mapFeatherPreview } from '../assets/workbench/src/lib/mapPreview'
import { interpolateMidFrameOpticalFlow } from '../assets/workbench/src/lib/opticalFlowInterpolate'
import { computeWorkflowRunStrategy, runDagExecution, runWorkflowOnBlob } from '../assets/workbench/src/lib/roninProWorkflow'
import { importLegacyWorkflow } from '../assets/workbench/src/lib/strictWorkflow'
import JSZip from '../assets/workbench/node_modules/jszip'
import { compressWavToMp3 } from '../assets/workbench/src/lib/audioMp3'

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
for (const [selector, run] of [['#flow', runFlow], ['#presets', runPresets], ['#audio-run', runAudio], ['#map-run',runMap]] as const) {
  document.querySelector<HTMLButtonElement>(selector)!.addEventListener('click', async () => {
    download.hidden = true
    try { await run() } catch (error) { status.textContent = `Oracle failed: ${String(error)}` }
  })
}

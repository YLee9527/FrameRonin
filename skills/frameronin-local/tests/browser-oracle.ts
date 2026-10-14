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
for (const [selector, run] of [['#flow', runFlow], ['#presets', runPresets], ['#audio-run', runAudio]] as const) {
  document.querySelector<HTMLButtonElement>(selector)!.addEventListener('click', async () => {
    download.hidden = true
    try { await run() } catch (error) { status.textContent = `Oracle failed: ${String(error)}` }
  })
}

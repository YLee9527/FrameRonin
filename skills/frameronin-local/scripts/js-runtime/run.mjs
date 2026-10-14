import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installDom } from './dom.mjs'
import JSZip from '../../assets/workbench/node_modules/jszip/lib/index.js'

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requestPath = await fs.realpath(process.argv[2])
const directory = path.dirname(requestPath)
const request = JSON.parse(await fs.readFile(requestPath, 'utf8'))
const allowed = ['operation', 'inputs', 'parameters', 'graph', 'compatibility', 'budgetBytes']
if (Object.keys(request).some(key => !allowed.includes(key))) throw new Error('REQUEST_FIELD_UNKNOWN')
if (!Number.isInteger(request.budgetBytes) || request.budgetBytes <= 0 || request.budgetBytes > 2 * 1024 ** 3) throw new Error('RESOURCE_BUDGET_INVALID')
const dom = installDom(path.join(skill, 'assets/workbench/public'), request.budgetBytes)
const algorithms = await import(pathToFileURL(path.join(skill, '.runtime/js/algorithms.mjs')).href)
const blobs = []
for (const input of request.inputs) {
  if (path.isAbsolute(input) || input.split(/[\\/]/).includes('..')) throw new Error('INPUT_PATH_INVALID')
  const resolved = await fs.realpath(path.join(directory, input))
  if (!resolved.startsWith(path.join(directory, 'inputs') + path.sep)) throw new Error('INPUT_PATH_OUTSIDE_TASK')
  blobs.push(new Blob([await fs.readFile(resolved)]))
}
const outputs = []
const extensions = []
let report = {}
if (request.operation === 'workflow') {
  const parsed = request.compatibility ? algorithms.importLegacyWorkflow(JSON.stringify(request.graph))
    : algorithms.validateStrictWorkflow(request.graph, blobs.length)
  const result = algorithms.computeWorkflowRunStrategy(parsed.nodes, parsed.edges, blobs.length)
  if (!result.ok) throw new Error(`WORKFLOW_INVALID:${result.reason}`)
  const strategy = result.strategy
  const nodes = strategy.order ?? strategy.topo
  if (strategy.kind === 'all') {
    for (const blob of blobs) outputs.push(await algorithms.runWorkflowOnBlob(blob, nodes))
  } else if (strategy.kind === 'targeted') {
    for (const plan of strategy.plans) outputs.push(await algorithms.runWorkflowOnBlob(blobs[plan.fileIndex0], plan.steps))
  } else if (strategy.kind === 'dag_per_file') {
    for (const blob of blobs) outputs.push(await algorithms.runDagExecution(nodes, strategy.edges, strategy.sinkId, () => blob))
  } else {
    outputs.push(await algorithms.runDagExecution(nodes, strategy.edges, strategy.sinkId, node => {
      const index = (node.params.imageIndex ?? 1) - 1
      if (!blobs[index]) throw new Error('WORKFLOW_INPUT_MISSING')
      return blobs[index]
    }))
  }
  report = { warnings: parsed.warnings ?? [], strategy: strategy.kind }
} else if (request.operation === 'perfectPixel') {
  const bitmap = await dom.loadImage(Buffer.from(await blobs[0].arrayBuffer()))
  const maximum = algorithms.PERFECT_PIXEL_MAX_SIDE
  const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = dom.createCanvas(width, height), context = canvas.getContext('2d')
  // Preserve the original browser pre-scaling, which uses the default smoothing.
  context.imageSmoothingEnabled = true
  context.drawImage(bitmap, 0, 0, width, height)
  const result = algorithms.getPerfectPixel(context.getImageData(0, 0, width, height), request.parameters)
  const output = dom.createCanvas(result.width, result.height)
  output.getContext('2d').putImageData(result, 0, 0)
  outputs.push(new Blob([await output.encode('png')]))
  report = { processingDimensions: { width, height }, originalDimensions: { width: bitmap.width, height: bitmap.height } }
} else if (request.operation === 'opticalFlow') {
  const frames = []
  for (const blob of blobs) frames.push(await dom.loadImage(Buffer.from(await blob.arrayBuffer())))
  const expanded = await algorithms.expandFramesWithOpticalMidpoints(frames, request.parameters,
    (done, total) => process.stdout.write(JSON.stringify({ progress: done / total * 0.9 }) + '\n'))
  for (const canvas of expanded) outputs.push(new Blob([await canvas.encode('png')]))
  report = { inputFrames: frames.length, outputFrames: expanded.length, method: 'original-opencv-farneback',
    processingDimensions: { width: frames[0].width, height: frames[0].height } }
} else if (request.operation === 'gif.split') {
  const {width,height,frames}=algorithms.decodeBrowserGif(await blobs[0].arrayBuffer(),request.budgetBytes)
  const zip=new JSZip(),records=[]
  for(const [index,frame]of frames.entries()){
    const canvas=dom.createCanvas(width,height)
    canvas.getContext('2d').putImageData(new dom.ImageData(frame.data,width,height),0,0)
    const png=new Blob([await canvas.encode('png')])
    canvas.width=1;canvas.height=1
    outputs.push(png);extensions.push('png')
    const name=`frame_${String(index).padStart(3,'0')}.png`
    zip.file(name,await png.arrayBuffer())
    records.push({file:name,durationMs:frame.delay,disposalType:frame.disposalType,width,height})
    process.stdout.write(JSON.stringify({progress:(index+1)/frames.length*.9})+'\n')
  }
  outputs.push(new Blob([await zip.generateAsync({type:'nodebuffer',compression:'STORE'})]));extensions.push('zip')
  report={method:'original-gifuct-browser-composite',frames:records}
} else if (request.operation === 'sequence.gif') {
  let width=0,height=0
  async function* frames(){
    for(const blob of blobs){
      const image=await dom.loadImage(Buffer.from(await blob.arrayBuffer()))
      width ||= image.width;height ||= image.height
      const canvas=dom.createCanvas(width,height),context=canvas.getContext('2d')
      if(image.width!==width||image.height!==height){
        // Normalize decoded image alpha into a canvas before native resampling.
        // Direct Image -> scaled Canvas produces premultiplied RGB at edges in
        // this pinned native runtime; Canvas -> Canvas retains browser colors.
        const source=dom.createCanvas(image.width,image.height)
        source.getContext('2d').drawImage(image,0,0)
        context.drawImage(source,0,0,width,height)
        source.width=1;source.height=1
      }else context.drawImage(image,0,0,width,height)
      yield context.getImageData(0,0,width,height)
      canvas.width=1;canvas.height=1
    }
  }
  outputs.push(await algorithms.encodeBrowserGif(frames(),request.parameters.duration,
    count=>process.stdout.write(JSON.stringify({progress:count/blobs.length*.9})+'\n')))
  extensions.push('gif')
  report={method:'original-gifenc-per-frame-palette',frames:blobs.length,width,height,durationMs:request.parameters.duration,
    sizePolicy:request.parameters.sizePolicy}
} else if (request.operation === 'map') {
  const images=[]
  for(const blob of blobs)images.push(await dom.loadImage(Buffer.from(await blob.arrayBuffer())))
  const {layout,format,target}=request.parameters
  outputs.push(await algorithms.renderMapExport(images,layout,format,target))
  extensions.push(format==='psd'?'psd':format==='godot'?'zip':'png')
  report={method:'original-map-canvas-exporter',format,layout,target:target??null}
} else throw new Error('OPERATION_UNKNOWN')
const outputDirectory = path.join(directory, 'output')
await fs.mkdir(outputDirectory, { recursive: true })
const files = []
for (let index = 0; index < outputs.length; index++) {
  const output = path.join(outputDirectory, `result-${String(index).padStart(4, '0')}.${extensions[index]??'png'}`)
  await fs.writeFile(output, Buffer.from(await outputs[index].arrayBuffer()), { flag: 'wx' })
  files.push(path.relative(directory, output))
}
await fs.writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ ...report, files }, null, 2))
process.stdout.write(JSON.stringify({ files, ...report }) + '\n')

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installDom } from './dom.mjs'

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
} else throw new Error('OPERATION_UNKNOWN')
const outputDirectory = path.join(directory, 'output')
await fs.mkdir(outputDirectory, { recursive: true })
const files = []
for (let index = 0; index < outputs.length; index++) {
  const output = path.join(outputDirectory, `result-${String(index).padStart(4, '0')}.png`)
  await fs.writeFile(output, Buffer.from(await outputs[index].arrayBuffer()), { flag: 'wx' })
  files.push(path.relative(directory, output))
}
await fs.writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ ...report, files }, null, 2))
process.stdout.write(JSON.stringify({ files, ...report }) + '\n')

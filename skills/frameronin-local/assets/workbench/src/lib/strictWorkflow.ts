import registry from '../../../workflow-operations.json'
import { computeWorkflowRunStrategy, parseWorkflowGraph, type GraphNode, type WorkflowEdge, type WorkflowNodeType } from './roninProWorkflow'

type Parameter = { default: number; minimum: number; maximum: number; type: string }
type Operation = { parameters: Record<string, Parameter>; ports: string[]; output: string }
export const WORKFLOW_OPERATIONS: Record<string, Operation> = registry.operations

function record(value: unknown, fields: string[], required: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('WORKFLOW_OBJECT_INVALID')
  const object = value as Record<string, unknown>
  if (Object.keys(object).some(key => !fields.includes(key))) throw new Error('WORKFLOW_UNKNOWN_FIELD')
  if (required.some(key => !(key in object))) throw new Error('WORKFLOW_REQUIRED_FIELD')
  return object
}

export function validateWorkflowStructure(value: unknown, fileCount: number, editable = false) {
  const graph = record(value, ['version', 'nodes', 'edges', 'presetName'], ['version', 'nodes', 'edges'])
  if (graph.version !== 7 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || (!editable && !graph.nodes.length) || graph.nodes.length > 200 || graph.edges.length > 400) throw new Error('WORKFLOW_SIZE_OR_VERSION')
  if (graph.presetName !== undefined && (typeof graph.presetName !== 'string' || graph.presetName.length > 120)) throw new Error('WORKFLOW_NAME_INVALID')
  const ids = new Set<string>()
  const uniqueId = (id: unknown) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id.length > (editable ? 256 : 80) || ids.has(id)) throw new Error('WORKFLOW_ID_INVALID')
    ids.add(id); return id
  }
  const nodes: GraphNode[] = graph.nodes.map(value => {
    const node = record(value, ['id', 'type', 'params', 'x', 'y', 'rearrangeGrid'], ['id', 'type', 'params'])
    if (typeof node.type !== 'string' || !(node.type in WORKFLOW_OPERATIONS)) throw new Error('WORKFLOW_UNKNOWN_OPERATION')
    const spec = WORKFLOW_OPERATIONS[node.type]!
    const parameters = record(node.params, Object.keys(spec.parameters), [])
    const params: Record<string, number> = {}
    for (const [key, schema] of Object.entries(spec.parameters)) {
      const value = Object.prototype.hasOwnProperty.call(parameters, key) ? parameters[key] : schema.default
      if (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum || (schema.type === 'integer' && !Number.isInteger(value))) throw new Error(`WORKFLOW_PARAMETER_INVALID:${key}`)
      params[key] = value
    }
    if (!editable && node.type === 'workflowInputImage' && params.imageIndex! > fileCount) throw new Error('WORKFLOW_INPUT_MISSING')
    for (const [key, size] of [['rowIndex', 'gRows'], ['colIndex', 'gCols'], ['atRow', 'gRows'], ['atCol', 'gCols']] as const) {
      if (!editable && params[key] !== undefined && params[key]! > params[size]! + (key.startsWith('at') ? 1 : 0)) throw new Error('WORKFLOW_GRID_INDEX_INVALID')
    }
    const result: GraphNode = { id: uniqueId(node.id), type: node.type as WorkflowNodeType, params, x: 0, y: 0 }
    for (const axis of ['x', 'y'] as const) {
      if (node[axis] !== undefined && (typeof node[axis] !== 'number' || !Number.isFinite(node[axis]) || Math.abs(node[axis]) > 100000)) throw new Error('WORKFLOW_POSITION_INVALID')
      result[axis] = typeof node[axis] === 'number' ? node[axis] : 0
    }
    if (node.type === 'customGridRearrange') {
      if (!Array.isArray(node.rearrangeGrid) || node.rearrangeGrid.length !== params.outRows) throw new Error('WORKFLOW_REARRANGE_INVALID')
      result.rearrangeGrid = node.rearrangeGrid.map(row => {
        if (!Array.isArray(row) || row.length !== params.outCols || row.some(cell => typeof cell !== 'number' || !Number.isInteger(cell) || Math.abs(cell) > params.splitCols! * params.splitRows!)) throw new Error('WORKFLOW_REARRANGE_INVALID')
        return row as number[]
      })
    } else if (node.rearrangeGrid !== undefined) throw new Error('WORKFLOW_REARRANGE_UNEXPECTED')
    return result
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  const ports = new Set<string>()
  const edges: WorkflowEdge[] = graph.edges.map(value => {
    const edge = record(value, ['id', 'source', 'target', 'targetPort'], ['id', 'source', 'target'])
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string' || !byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) throw new Error('WORKFLOW_EDGE_REFERENCE_INVALID')
    const target = byId.get(edge.target)!
    const port = edge.targetPort ?? ''
    if (typeof port !== 'string' || !WORKFLOW_OPERATIONS[target.type]!.ports.includes(port)) throw new Error('WORKFLOW_PORT_INVALID')
    if (target.type === 'simpleStitchVertical' && port && Number(port.slice(2)) > target.params.stitchSlotCount!) throw new Error('WORKFLOW_STITCH_PORT_RANGE')
    const identity = `${target.id}:${port}`
    if (ports.has(identity) && !(target.type === 'simpleStitchVertical' && port === '')) throw new Error('WORKFLOW_PORT_DUPLICATE')
    ports.add(identity)
    return { id: uniqueId(edge.id), source: edge.source, target: edge.target, targetPort: port || undefined }
  })
  for (const node of nodes.filter(node => node.type === 'simpleStitchVertical')) {
    const incoming = edges.filter(edge => edge.target === node.id)
    if (incoming.some(edge => !edge.targetPort) && incoming.some(edge => edge.targetPort)) throw new Error('WORKFLOW_STITCH_MIXED_PORTS')
  }
  return { nodes, edges }
}

export function validateStrictWorkflow(value: unknown, fileCount: number) {
  const { nodes, edges } = validateWorkflowStructure(value, fileCount)
  const strategy = computeWorkflowRunStrategy(nodes, edges, fileCount)
  if (!strategy.ok) throw new Error(`WORKFLOW_GRAPH_INVALID:${strategy.reason}`)
  return { nodes, edges, strategy: strategy.strategy }
}

export function importLegacyWorkflow(text: string) {
  const raw = JSON.parse(text) as { version?: number; nodes?: { id?: string }[]; edges?: { id?: string }[] }
  const migrated = parseWorkflowGraph(text)
  const warnings: string[] = []
  if (raw.version !== 7) warnings.push(`FORMAT_MIGRATED:${raw.version ?? 'unknown'}->7`)
  const nodeIds = new Set(migrated.nodes.map(node => node.id))
  const edgeIds = new Set(migrated.edges.map(edge => edge.id))
  for (const node of raw.nodes ?? []) if (!nodeIds.has(node.id ?? '')) warnings.push(`NODE_DISCARDED:${node.id ?? 'missing-id'}`)
  for (const edge of raw.edges ?? []) if (!edgeIds.has(edge.id ?? '')) warnings.push(`EDGE_DISCARDED:${edge.id ?? 'missing-id'}`)
  for (const node of migrated.nodes) {
    const original = raw.nodes?.find(item => item.id === node.id)
    if (original && JSON.stringify(original) !== JSON.stringify(node)) warnings.push(`NODE_NORMALIZED:${node.id}`)
  }
  return { ...migrated, warnings }
}

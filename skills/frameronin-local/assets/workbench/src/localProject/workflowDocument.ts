import { validateWorkflowStructure } from '../lib/strictWorkflow'
import type { WorkflowDraft } from './workflowHistory'
import { cacheManagedInput, importManagedInputs, type ManagedVersion } from './managedTasks'
import { localFetch, localJson } from './api'

export type WorkflowInputFile = { id: string; file: File; thumbUrl: string }
export type WorkflowSnapshot = { draft: WorkflowDraft; files: WorkflowInputFile[] }
export type StoredWorkflow = { formatVersion: 1; graph: WorkflowDraft & { version: 7 }; inputs: { id: string; name: string; versionId: string }[] }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
export function validateStoredWorkflow(value: unknown): StoredWorkflow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WORKFLOW_DOCUMENT_INVALID')
  const document = value as StoredWorkflow
  if (Object.keys(document).some(key => !['formatVersion', 'graph', 'inputs'].includes(key)) || document.formatVersion !== 1 ||
      !Array.isArray(document.inputs) || document.inputs.length > 1000) throw new Error('WORKFLOW_DOCUMENT_FIELDS')
  const ids = new Set<string>()
  for (const input of document.inputs) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['id', 'name', 'versionId'].includes(key)) ||
        !uuid(input.id) || ids.has(input.id) || !uuid(input.versionId) || typeof input.name !== 'string' ||
        !input.name.length || input.name.length > 255 || /[\\/]/.test(input.name) || [...input.name].some(character => character.charCodeAt(0) < 32)) throw new Error('WORKFLOW_DOCUMENT_INPUT')
    ids.add(input.id)
  }
  // Editable documents may be incomplete. Execution and AI proposals still
  // require the separate strict validator, including resource and DAG checks.
  const normalized = validateWorkflowStructure(document.graph, document.inputs.length, true)
  return { ...document, graph: { ...document.graph, ...normalized, presetName: document.graph.presetName ?? '' } }
}
export async function serializeWorkflowDocument(snapshot: WorkflowSnapshot): Promise<StoredWorkflow> {
  validateStoredWorkflow({ formatVersion: 1, graph: { ...snapshot.draft, version: 7 },
    inputs: snapshot.files.map(item => ({ id: item.id, name: item.file.name, versionId: '00000000-0000-0000-0000-000000000000' })) })
  const { inputs } = await importManagedInputs(snapshot.files.map(item => item.file))
  const document: StoredWorkflow = { formatVersion: 1, graph: { ...snapshot.draft, version: 7 },
    inputs: snapshot.files.map((item, index) => ({ id: item.id, name: item.file.name, versionId: inputs[index] })) }
  return validateStoredWorkflow(document)
}
export async function restoreWorkflowDocument(value: unknown): Promise<WorkflowSnapshot> {
  const document = validateStoredWorkflow(value)
  const { project, memoryBudgetBytes } = await localJson<{ project: { id: string }; memoryBudgetBytes: number }>('/api/project')
  if (!Number.isFinite(memoryBudgetBytes) || memoryBudgetBytes <= 0) throw new Error('WORKFLOW_DOCUMENT_BUDGET')
  const files: WorkflowInputFile[] = []
  let bytes = 0
  try {
    for (const input of document.inputs) {
      const version = await localJson<ManagedVersion>(`/api/versions/${input.versionId}`)
      if (version.metadata.kind !== 'image') throw new Error('WORKFLOW_DOCUMENT_RESOURCE_KIND')
      bytes += version.metadata.bytes * 2
      if (bytes > memoryBudgetBytes / 4) throw new Error('WORKFLOW_DOCUMENT_RESOURCE_LIMIT')
      const response = await localFetch(`/api/versions/${input.versionId}/content`)
      if (!response.ok) throw new Error('WORKFLOW_DOCUMENT_RESOURCE_MISSING')
      const file = new File([await response.blob()], input.name)
      cacheManagedInput(file, project.id, input.versionId)
      const thumbnail = version.metadata.thumbnailDataUrl
      files.push({ id: input.id, file, thumbUrl: thumbnail?.startsWith('data:image/png;base64,') ? thumbnail : URL.createObjectURL(file) })
    }
    return { draft: { nodes: document.graph.nodes, edges: document.graph.edges, presetName: document.graph.presetName }, files }
  } catch (error) {
    files.forEach(item => { if (item.thumbUrl.startsWith('blob:')) URL.revokeObjectURL(item.thumbUrl) })
    throw error
  }
}

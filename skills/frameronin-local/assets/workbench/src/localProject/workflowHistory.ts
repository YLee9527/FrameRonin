import type { GraphNode, WorkflowEdge } from '../lib/roninProWorkflow'

export type WorkflowDraft = { nodes: GraphNode[]; edges: WorkflowEdge[]; presetName: string }
type Update<T> = T | ((current: T) => T)
export type WorkflowHistory = { present: WorkflowDraft; past: WorkflowDraft[]; future: WorkflowDraft[]; checkpoint?: WorkflowDraft }
export type WorkflowAction =
  | { type: 'nodes'; value: Update<GraphNode[]> }
  | { type: 'edges'; value: Update<WorkflowEdge[]> }
  | { type: 'name'; value: Update<string> }
  | { type: 'change'; value: Update<WorkflowDraft> }
  | { type: 'restore'; value: WorkflowDraft }
  | { type: 'begin' } | { type: 'end' } | { type: 'undo' } | { type: 'redo' }
const resolve = <T,>(value: Update<T>, current: T): T => typeof value === 'function' ? (value as (current: T) => T)(current) : value
const same = (a: WorkflowDraft, b: WorkflowDraft) => a === b || JSON.stringify(a) === JSON.stringify(b)
function bounded(values: WorkflowDraft[]) {
  const history = values.slice(-50)
  let bytes = history.reduce((total, item) => total + JSON.stringify(item).length * 4, 0)
  while (history.length && bytes > 64 * 1024 ** 2) bytes -= JSON.stringify(history.shift()!).length * 4
  return history
}
export function createWorkflowHistory(present: WorkflowDraft = { nodes: [], edges: [], presetName: '' }): WorkflowHistory {
  return { present, past: [], future: [] }
}
export function workflowHistoryReducer(state: WorkflowHistory, action: WorkflowAction): WorkflowHistory {
  if (action.type === 'restore') return createWorkflowHistory(action.value)
  if (action.type === 'begin') return state.checkpoint ? state : { ...state, checkpoint: state.present }
  if (action.type === 'end') {
    if (!state.checkpoint) return state
    return { present: state.present, past: same(state.checkpoint, state.present) ? state.past : bounded([...state.past, state.checkpoint]),
      future: same(state.checkpoint, state.present) ? state.future : [] }
  }
  if (action.type === 'undo' || action.type === 'redo') {
    const current = workflowHistoryReducer(state, { type: 'end' })
    if (action.type === 'undo') {
      if (!current.past.length) return current
      return { present: current.past.at(-1)!, past: current.past.slice(0, -1), future: bounded([...current.future, current.present]) }
    }
    if (!current.future.length) return current
    return { present: current.future.at(-1)!, past: bounded([...current.past, current.present]), future: current.future.slice(0, -1) }
  }
  const present = action.type === 'nodes' ? { ...state.present, nodes: resolve(action.value, state.present.nodes) }
    : action.type === 'edges' ? { ...state.present, edges: resolve(action.value, state.present.edges) }
      : action.type === 'name' ? { ...state.present, presetName: resolve(action.value, state.present.presetName) }
        : resolve(action.value, state.present)
  if (same(state.present, present)) return state
  return { present, past: state.checkpoint ? state.past : bounded([...state.past, state.present]), future: [], checkpoint: state.checkpoint }
}

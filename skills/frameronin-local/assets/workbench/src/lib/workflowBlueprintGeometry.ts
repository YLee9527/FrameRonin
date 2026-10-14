import type { GraphNode } from './roninProWorkflow'

export const BLUEPRINT_WORLD_W = 8192
export const BLUEPRINT_WORLD_H = 6144
export const BLUEPRINT_NODE_WIDTH = 252
export const BLUEPRINT_INPUT_IMAGE_NODE_WIDTH = 136
export const BLUEPRINT_PIN_Y = 20

/** 自定义均分重组：按列数与切块编号位数估算节点宽度，避免表格局部横向滚动条 */
function customRearrangeMetrics(n: GraphNode) {
  const oc = Math.max(1, Math.round(n.params.outCols ?? 2))
  const sc = Math.max(1, Math.round(n.params.splitCols ?? 2))
  const sr = Math.max(1, Math.round(n.params.splitRows ?? 2))
  const maxIdx = Math.max(1, sc * sr)
  const maxStrLen = String(maxIdx).length + 1
  const inputW = Math.min(76, Math.max(38, 18 + maxStrLen * 10))
  return { oc, inputW, maxIdx }
}

export function getBlueprintNodeWidth(n: GraphNode): number {
  if (n.type === 'workflowInputImage') return BLUEPRINT_INPUT_IMAGE_NODE_WIDTH
  if (n.type === 'matteDoubleBackground') return Math.max(BLUEPRINT_NODE_WIDTH, 268)
  if (n.type !== 'customGridRearrange') return BLUEPRINT_NODE_WIDTH
  const { oc, inputW } = customRearrangeMetrics(n)
  const perCell = inputW + 10
  const inner = oc * perCell
  const w = 24 + inner + 12
  return Math.min(980, Math.max(BLUEPRINT_NODE_WIDTH, Math.ceil(w)))
}

/** 格子内 InputNumber 宽度（与 getBlueprintNodeWidth 一致） */
export function getCustomRearrangeInputWidth(n: GraphNode): number {
  if (n.type !== 'customGridRearrange') return 48
  return customRearrangeMetrics(n).inputW
}

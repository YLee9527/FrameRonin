import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import type { GraphNode, WorkflowEdge, WorkflowNodeType } from '../lib/roninProWorkflow'
import { getStitchInputSlotCount, WORKFLOW_DRAG_INPUT_IMAGE_INDEX } from '../lib/roninProWorkflow'

import { BLUEPRINT_WORLD_W, BLUEPRINT_WORLD_H, BLUEPRINT_NODE_WIDTH, BLUEPRINT_INPUT_IMAGE_NODE_WIDTH, BLUEPRINT_PIN_Y, getBlueprintNodeWidth } from '../lib/workflowBlueprintGeometry'

const WORLD_W = BLUEPRINT_WORLD_W
const WORLD_H = BLUEPRINT_WORLD_H
const HEADER_H = 40
const PIN_HIT = 28
/** 双背景抠图：左列上下两个输入口（世界坐标系内相对节点 top 的 Y 偏移） */
const DOUBLE_BG_PIN_A_Y = 16
const DOUBLE_BG_PIN_B_Y = 52
/** 简易拼接：多入口自上而下，与节点内 + 扩展一致 */
const STITCH_PIN_FIRST_Y = 22
const STITCH_PIN_STEP = 28

function stitchSlotIndexFromPort(port: string | undefined): number {
  if (!port || !/^in\d+$/.test(port)) return 1
  return Math.max(1, parseInt(port.slice(2), 10))
}

function inputPinWorld(n: GraphNode, port?: string): { x: number; y: number } {
  if (n.type === 'matteDoubleBackground') {
    const yOff = port === 'inB' ? DOUBLE_BG_PIN_B_Y : DOUBLE_BG_PIN_A_Y
    return { x: n.x, y: n.y + yOff }
  }
  if (n.type === 'simpleStitchVertical') {
    const slot = stitchSlotIndexFromPort(port)
    return { x: n.x, y: n.y + STITCH_PIN_FIRST_Y + (slot - 1) * STITCH_PIN_STEP }
  }
  return { x: n.x, y: n.y + BLUEPRINT_PIN_Y }
}

type ConnectingState = { sourceId: string } | null

function stitchNodeMinHeight(n: GraphNode): number | undefined {
  if (n.type !== 'simpleStitchVertical') return undefined
  const k = getStitchInputSlotCount(n)
  return HEADER_H + STITCH_PIN_FIRST_Y + (k - 1) * STITCH_PIN_STEP + 24 + 168
}

export type BlueprintToolPlaceAction =
  | { type: 'inputImage'; imageIndex1: number }
  | { type: 'resize' }

function digitFromKeyCode(code: string): number | null {
  const dm = /^Digit(\d)$/.exec(code)
  if (dm) {
    const n = parseInt(dm[1]!, 10)
    return n >= 1 && n <= 9 ? n : null
  }
  const nm = /^Numpad(\d)$/.exec(code)
  if (nm) {
    const n = parseInt(nm[1]!, 10)
    return n >= 1 && n <= 9 ? n : null
  }
  return null
}

export interface WorkflowBlueprintCanvasProps {
  nodes: GraphNode[]
  edges: WorkflowEdge[]
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>
  setEdges: React.Dispatch<React.SetStateAction<WorkflowEdge[]>>
  onDeleteNode: (id: string) => void
  onBeginNodeMove: () => void
  onEndNodeMove: () => void
  getNodeTitle: (n: GraphNode) => string
  renderNodeBody: (n: GraphNode) => React.ReactNode
  tHint: (key: string, params?: Record<string, string | number>) => string
  onPaletteDrop: (type: WorkflowNodeType, x: number, y: number) => void
  /** 从批量图列表拖入的 1-based 序号 */
  onInputImageDrop?: (imageIndex1: number, x: number, y: number) => void
  /** 按住快捷键后在空白处左键：放置节点（坐标为画布世界坐标，已由内部按节点宽度钳位） */
  onToolPlaceAt?: (action: BlueprintToolPlaceAction, x: number, y: number) => void
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(64, Math.abs(x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export default function WorkflowBlueprintCanvas({
  nodes,
  edges,
  setNodes,
  setEdges,
  onDeleteNode,
  onBeginNodeMove,
  onEndNodeMove,
  getNodeTitle,
  renderNodeBody,
  tHint,
  onPaletteDrop,
  onInputImageDrop,
  onToolPlaceAt,
}: WorkflowBlueprintCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  /** 按住数字 1–9：对应序号输入图；按住 S：缩放节点 */
  const heldPlaceRef = useRef({ heldDigit: 0 as number, keyS: false })
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [scale, setScale] = useState(0.85)
  const [connecting, setConnecting] = useState<ConnectingState>(null)
  const [wireEnd, setWireEnd] = useState<{ x: number; y: number } | null>(null)
  const connectRef = useRef<ConnectingState>(null)
  const wireEndRef = useRef<{ x: number; y: number } | null>(null)
  const nodesRef = useRef(nodes)
  useLayoutEffect(() => { nodesRef.current = nodes }, [nodes])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const panDrag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const nodeDrag = useRef<{
    id: string
    sx: number
    sy: number
    nx: number
    ny: number
  } | null>(null)

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const wr = worldRef.current?.getBoundingClientRect()
    if (!wr || wr.width < 1 || wr.height < 1) return { x: 0, y: 0 }
    return {
      x: ((clientX - wr.left) / wr.width) * WORLD_W,
      y: ((clientY - wr.top) / wr.height) * WORLD_H,
    }
  }, [])

  const snapNodeTopLeft = useCallback((w: { x: number; y: number }, nodeW = BLUEPRINT_NODE_WIDTH) => {
    const x = Math.max(0, Math.min(WORLD_W - nodeW, w.x - nodeW / 2))
    const y = Math.max(0, Math.min(WORLD_H - 120, w.y - HEADER_H))
    return { x, y }
  }, [])

  const outputPin = useCallback((n: GraphNode) => {
    return { x: n.x + getBlueprintNodeWidth(n), y: n.y + BLUEPRINT_PIN_Y }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (panDrag.current) {
        const d = panDrag.current
        setPan({
          x: d.px + (e.clientX - d.sx),
          y: d.py + (e.clientY - d.sy),
        })
        return
      }
      if (nodeDrag.current) {
        const d = nodeDrag.current
        const dx = (e.clientX - d.sx) / scale
        const dy = (e.clientY - d.sy) / scale
        setNodes((list) =>
          list.map((n) => (n.id === d.id ? { ...n, x: d.nx + dx, y: d.ny + dy } : n))
        )
        return
      }
      if (connectRef.current) {
        const w = clientToWorld(e.clientX, e.clientY)
        wireEndRef.current = w
        setWireEnd(w)
      }
    }
    const onUp = () => {
      if (panDrag.current) {
        panDrag.current = null
        return
      }
      if (nodeDrag.current) {
        nodeDrag.current = null
        onEndNodeMove()
        return
      }
      const c = connectRef.current
      const we = wireEndRef.current
      if (c && we) {
        const list = nodesRef.current
        const hit2 = PIN_HIT * PIN_HIT
        let best: { n: GraphNode; port?: string } | null = null
        let bestD = hit2
        for (const n of list) {
          if (n.id === c.sourceId) continue
          if (n.type === 'matteDoubleBackground') {
            for (const port of ['inA', 'inB'] as const) {
              const p = inputPinWorld(n, port)
              const dx = we.x - p.x
              const dy = we.y - p.y
              const d2 = dx * dx + dy * dy
              if (d2 < bestD) {
                bestD = d2
                best = { n, port }
              }
            }
          } else if (n.type === 'simpleStitchVertical') {
            const k = getStitchInputSlotCount(n)
            for (let s = 1; s <= k; s++) {
              const port = `in${s}`
              const p = inputPinWorld(n, port)
              const dx = we.x - p.x
              const dy = we.y - p.y
              const d2 = dx * dx + dy * dy
              if (d2 < bestD) {
                bestD = d2
                best = { n, port }
              }
            }
          } else {
            const p = inputPinWorld(n)
            const dx = we.x - p.x
            const dy = we.y - p.y
            const d2 = dx * dx + dy * dy
            if (d2 < bestD) {
              bestD = d2
              best = { n }
            }
          }
        }
        if (best && bestD < hit2) {
          const sid = c.sourceId
          const tid = best.n.id
          const tPort =
            best.n.type === 'matteDoubleBackground'
              ? best.port
              : best.n.type === 'simpleStitchVertical'
                ? best.port
                : undefined
          const edgeId = crypto.randomUUID()
          setEdges((prev) => {
            let next = prev.filter((ed) => ed.source !== sid)
            if (tPort === 'inA' || tPort === 'inB') {
              next = next.filter((ed) => !(ed.target === tid && ed.targetPort === tPort))
            } else if (best.n.type === 'simpleStitchVertical' && tPort && /^in\d+$/.test(tPort)) {
              next = next.filter((ed) => !(ed.target === tid && ed.targetPort === tPort))
              next = next.filter((ed) => !(ed.source === sid && ed.target === tid))
            } else {
              next = next.filter((ed) => ed.target !== tid)
            }
            next.push({
              id: edgeId,
              source: sid,
              target: tid,
              ...(tPort ? { targetPort: tPort } : {}),
            })
            return next
          })
        }
        connectRef.current = null
        wireEndRef.current = null
        setConnecting(null)
        setWireEnd(null)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    const onBlur = () => {
      if (nodeDrag.current) { nodeDrag.current = null; onEndNodeMove() }
      panDrag.current = null
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [setNodes, setEdges, scale, clientToWorld, onEndNodeMove])

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      if (!t) return false
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
      if (t.isContentEditable) return true
      return !!t.closest?.('input, textarea, select, [contenteditable="true"]')
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isTypingTarget(e.target)) return
      const d = digitFromKeyCode(e.code)
      if (d !== null) {
        heldPlaceRef.current.heldDigit = d
        return
      }
      if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        heldPlaceRef.current.keyS = true
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const d = digitFromKeyCode(e.code)
      if (d !== null && heldPlaceRef.current.heldDigit === d) {
        heldPlaceRef.current.heldDigit = 0
      }
      if (e.code === 'KeyS') heldPlaceRef.current.keyS = false
    }
    const onBlur = () => {
      heldPlaceRef.current = { heldDigit: 0, keyS: false }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      if (!t) return false
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
      if (t.isContentEditable) return true
      return !!t.closest?.('input, textarea, select, [contenteditable="true"]')
    }
    const onKey = (e: KeyboardEvent) => {
      // 输入框内不删节点；Backspace 不用于删除（避免误触），仅 Delete 删除选中连线/节点
      if (e.isComposing || e.key !== 'Delete') return
      if (isTypingTarget(e.target)) return
      if (e.repeat) return
      if (selectedEdgeId) {
        setEdges((prev) => prev.filter((x) => x.id !== selectedEdgeId))
        setSelectedEdgeId(null)
        return
      }
      if (selectedId) {
        onDeleteNode(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, selectedEdgeId, onDeleteNode, setEdges])

  const onViewportWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.92 : 1.09
    setScale((s) => Math.min(2.2, Math.max(0.35, s * factor)))
  }

  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 1 && e.button !== 2) return
    e.preventDefault()
    panDrag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
  }

  const onWorldBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && onToolPlaceAt) {
      const h = heldPlaceRef.current
      if (h.heldDigit >= 1 && h.heldDigit <= 9) {
        e.stopPropagation()
        e.preventDefault()
        const w = clientToWorld(e.clientX, e.clientY)
        const { x, y } = snapNodeTopLeft(w, BLUEPRINT_INPUT_IMAGE_NODE_WIDTH)
        onToolPlaceAt({ type: 'inputImage', imageIndex1: h.heldDigit }, x, y)
        return
      }
      if (h.keyS) {
        e.stopPropagation()
        e.preventDefault()
        const w = clientToWorld(e.clientX, e.clientY)
        const { x, y } = snapNodeTopLeft(w, BLUEPRINT_NODE_WIDTH)
        onToolPlaceAt({ type: 'resize' }, x, y)
        return
      }
    }
    if (e.button === 1 || e.button === 2) {
      e.stopPropagation()
      startPan(e)
    }
  }

  const onOutputMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    const state: ConnectingState = { sourceId: nodeId }
    connectRef.current = state
    setConnecting(state)
    const n = nodesRef.current.find((x) => x.id === nodeId)
    if (n) {
      const p = outputPin(n)
      wireEndRef.current = p
      setWireEnd(p)
    }
  }

  const onHeaderMouseDown = (e: React.MouseEvent, n: GraphNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    setSelectedId(n.id)
    onBeginNodeMove()
    nodeDrag.current = {
      id: n.id,
      sx: e.clientX,
      sy: e.clientY,
      nx: n.x,
      ny: n.y,
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const imgRaw = e.dataTransfer.getData(WORKFLOW_DRAG_INPUT_IMAGE_INDEX)
    if (imgRaw && onInputImageDrop) {
      const idx = parseInt(imgRaw, 10)
      if (Number.isFinite(idx) && idx >= 1) {
        const w = clientToWorld(e.clientX, e.clientY)
        const { x, y } = snapNodeTopLeft(w, BLUEPRINT_INPUT_IMAGE_NODE_WIDTH)
        onInputImageDrop(idx, x, y)
      }
      return
    }
    const type = e.dataTransfer.getData('application/workflow-node-type') as WorkflowNodeType
    if (!type) return
    const w = clientToWorld(e.clientX, e.clientY)
    const { x, y } = snapNodeTopLeft(w)
    onPaletteDrop(type, x, y)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        ref={viewportRef}
        onWheel={onViewportWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onMouseDown={(e) => {
          if (e.button === 0) {
            setSelectedId(null)
            setSelectedEdgeId(null)
            return
          }
          if (e.button === 1 || e.button === 2) {
            startPan(e)
          }
        }}
        style={{
          /* 蓝图主工作区：尽量占纵向空间，大屏上限约 940px */
          height: 'clamp(620px, min(72vh, calc(100dvh - 300px)), 940px)',
          minHeight: 620,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#12141a',
          border: '1px solid #2a2e3a',
          position: 'relative',
        }}
      >
        {/* 视口级无限网格：不随 world 尺寸截断，平移/缩放时与画布内容对齐 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            backgroundColor: '#16181f',
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)
            `,
            backgroundSize: `${24 * scale}px ${24 * scale}px`,
            backgroundPosition: `${pan.x - 1}px ${pan.y - 1}px`,
            backgroundRepeat: 'repeat',
            borderRadius: 8,
          }}
        />
        <div
          ref={worldRef}
          style={{
            width: WORLD_W,
            height: WORLD_H,
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 1,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            backgroundColor: 'transparent',
          }}
        >
          {/* 空白网格：平移 / 取消选中 */}
          <div
            onMouseDown={onWorldBackgroundMouseDown}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
            }}
          />

          <svg
            width={WORLD_W}
            height={WORLD_H}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              zIndex: 1,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            {edges.map((ed) => {
              const sn = nodes.find((n) => n.id === ed.source)
              const tn = nodes.find((n) => n.id === ed.target)
              if (!sn || !tn) return null
              const p0 = outputPin(sn)
              const p1 = inputPinWorld(tn, ed.targetPort)
              const d = bezierPath(p0.x, p0.y, p1.x, p1.y)
              return (
                <path
                  key={ed.id}
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedEdgeId(ed.id)
                    setSelectedId(null)
                  }}
                />
              )
            })}
            {edges.map((ed) => {
              const sn = nodes.find((n) => n.id === ed.source)
              const tn = nodes.find((n) => n.id === ed.target)
              if (!sn || !tn) return null
              const p0 = outputPin(sn)
              const p1 = inputPinWorld(tn, ed.targetPort)
              const d = bezierPath(p0.x, p0.y, p1.x, p1.y)
              const sel = selectedEdgeId === ed.id
              return (
                <path
                  key={`${ed.id}-vis`}
                  d={d}
                  fill="none"
                  stroke={sel ? '#6eb5ff' : '#7a8fa8'}
                  strokeWidth={sel ? 3.5 : 2.5}
                  style={{ pointerEvents: 'none' }}
                />
              )
            })}
            {connecting && wireEnd && (() => {
              const sn = nodes.find((n) => n.id === connecting.sourceId)
              if (!sn) return null
              const p0 = outputPin(sn)
              return (
                <path
                  d={bezierPath(p0.x, p0.y, wireEnd.x, wireEnd.y)}
                  fill="none"
                  stroke="#4fc3f7"
                  strokeWidth={2}
                  strokeDasharray="8 6"
                  pointerEvents="none"
                />
              )
            })()}
          </svg>

          {nodes.map((n) => {
            const sel = selectedId === n.id
            const nodeW = getBlueprintNodeWidth(n)
            const stitchMinH = stitchNodeMinHeight(n)
            return (
              <div
                key={n.id}
                style={{
                  position: 'absolute',
                  left: n.x,
                  top: n.y,
                  width: nodeW,
                  minHeight: stitchMinH ?? 72,
                  borderRadius: 6,
                  border: sel ? '2px solid #4fc3f7' : '1px solid #3d4555',
                  background: 'linear-gradient(180deg, #252830 0%, #1e2128 100%)',
                  boxShadow: sel ? '0 0 0 1px rgba(79,195,247,0.35)' : '0 4px 14px rgba(0,0,0,0.45)',
                  zIndex: sel ? 4 : 2,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {n.type === 'matteDoubleBackground' ? (
                  <>
                    <div
                      title={tHint('roninProWorkflowPinInBlack')}
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: DOUBLE_BG_PIN_A_Y - 8,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#1a1d24',
                        border: '2px solid #9ab8e8',
                        boxShadow: '0 0 6px rgba(154,184,232,0.45)',
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      title={tHint('roninProWorkflowPinInWhite')}
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: DOUBLE_BG_PIN_B_Y - 8,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#1a1d24',
                        border: '2px solid #e8e0c5',
                        boxShadow: '0 0 6px rgba(232,224,197,0.4)',
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                    />
                  </>
                ) : n.type === 'simpleStitchVertical' ? (
                  Array.from({ length: getStitchInputSlotCount(n) }, (_, i) => i + 1).map((slot) => (
                    <div
                      key={slot}
                      title={tHint('roninProWorkflowPinInStitchN', { n: slot })}
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: STITCH_PIN_FIRST_Y + (slot - 1) * STITCH_PIN_STEP - 8,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#1a1d24',
                        border: '2px solid #9ad4c8',
                        boxShadow: '0 0 6px rgba(154,212,200,0.4)',
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                    />
                  ))
                ) : (
                  <div
                    title={tHint('roninProWorkflowPinIn')}
                    style={{
                      position: 'absolute',
                      left: -10,
                      top: BLUEPRINT_PIN_Y - 8,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#1a1d24',
                      border: '2px solid #c5d4e8',
                      boxShadow: '0 0 6px rgba(197,212,232,0.4)',
                      zIndex: 5,
                      pointerEvents: 'none',
                    }}
                  />
                )}
                <div
                  title={tHint('roninProWorkflowPinOut')}
                  onMouseDown={(e) => onOutputMouseDown(e, n.id)}
                  style={{
                    position: 'absolute',
                    right: -10,
                    top: BLUEPRINT_PIN_Y - 8,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#1a1d24',
                    border: '2px solid #e8dcc5',
                    boxShadow: '0 0 6px rgba(232,220,197,0.35)',
                    cursor: 'crosshair',
                    zIndex: 5,
                  }}
                />
                <div
                  onMouseDown={(e) => onHeaderMouseDown(e, n)}
                  role="button"
                  tabIndex={0}
                  aria-label={getNodeTitle(n)}
                  aria-pressed={selectedId === n.id}
                  onClick={event => { setSelectedId(n.id); event.currentTarget.focus() }}
                  onKeyDown={event => {
                    if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault(); setSelectedId(n.id)
                    }
                  }}
                  style={{
                    height: HEADER_H,
                    padding: '0 28px 0 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'linear-gradient(90deg, #2a3140 0%, #232733 100%)',
                    borderRadius: '5px 5px 0 0',
                    borderBottom: '1px solid #3d4555',
                    cursor: 'grab',
                    userSelect: 'none',
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#e6eaf2',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {getNodeTitle(n)}
                  </span>
                  <CloseOutlined
                    style={{ fontSize: 12, color: '#8b93a5', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteNode(n.id)
                      if (selectedId === n.id) setSelectedId(null)
                    }}
                  />
                </div>
                <div
                  style={{
                    padding: '10px 12px 12px',
                    maxHeight: n.type === 'customGridRearrange' ? 560 : 440,
                    overflowX: 'hidden',
                    overflowY: 'auto',
                  }}
                  className="ronin-blueprint-node-body"
                >
                  {renderNodeBody(n)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#888' }}>
        <div>{tHint('roninProWorkflowBlueprintControls')}</div>
        {onToolPlaceAt && <div style={{ marginTop: 4 }}>{tHint('roninProWorkflowBlueprintHotkeys')}</div>}
      </div>
    </div>
  )
}

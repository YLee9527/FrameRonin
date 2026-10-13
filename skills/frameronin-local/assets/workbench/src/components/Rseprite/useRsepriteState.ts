import { useCallback, useReducer, type Dispatch } from 'react'
import { pushSnapshot, type DocumentSnapshot } from './history'
import { createInitialDocument, duplicateFrameDeep } from './documentFactory'
import { dedupePixels, paintPixelsOnDocument, type Rgba } from './paintDocument'
import type { Document, Layer, PixelPoint } from './types'

export interface RsepriteRootState {
  document: Document
  /** 当前编辑帧 */
  activeFrameIndex: number
  /** 当前编辑目标：与 frame.cels[activeLayerIndex]、layers[activeLayerIndex] 对齐 */
  activeLayerIndex: number
  undoStack: DocumentSnapshot[]
  redoStack: DocumentSnapshot[]
}

/** 第 1 步 RESET；第 3 步 PAINT_PIXELS；第 5 步 UNDO/REDO；第 6 步图层；第 7 步多帧 */
export type RsepriteAction =
  | { type: 'RESET'; width: number; height: number }
  | { type: 'RESTORE_DOCUMENT'; document: Document }
  | {
      type: 'PAINT_PIXELS'
      frameIndex: number
      celIndex: number
      pixels: readonly PixelPoint[]
      rgba: Rgba
    }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_ACTIVE_LAYER'; index: number }
  | { type: 'SET_ACTIVE_FRAME'; index: number }
  | { type: 'ADD_FRAME' }
  | { type: 'DELETE_FRAME'; frameIndex: number }
  | { type: 'SET_LAYER_VISIBLE'; layerIndex: number; visible: boolean }
  | { type: 'SET_LAYER_LOCKED'; layerIndex: number; locked: boolean }
  | { type: 'SET_FRAME_DURATION'; frameIndex: number; durationMs: number }
  | { type: 'NOOP' }

function updateLayerInDoc(
  doc: Document,
  index: number,
  patch: Partial<Layer>,
): Document {
  if (index < 0 || index >= doc.layers.length) return doc
  if (Object.entries(patch).every(([key, value]) => doc.layers[index]?.[key as keyof Layer] === value)) return doc
  const layers = doc.layers.map((l, i) =>
    i === index ? { ...l, ...patch } : l,
  )
  return { ...doc, layers }
}

function clampLayerIndex(doc: Document, index: number): number {
  if (doc.layers.length === 0) return 0
  return Math.max(0, Math.min(index, doc.layers.length - 1))
}

function clampFrameIndex(doc: Document, index: number): number {
  if (doc.frames.length === 0) return 0
  return Math.max(0, Math.min(index, doc.frames.length - 1))
}

export function createInitialState(width: number, height: number): RsepriteRootState {
  const document = createInitialDocument(width, height)
  return {
    document,
    activeFrameIndex: 0,
    activeLayerIndex: 0,
    undoStack: [],
    redoStack: [],
  }
}

export function rsepriteReducer(state: RsepriteRootState, action: RsepriteAction): RsepriteRootState {
  const snapshot = (value: RsepriteRootState): DocumentSnapshot => ({ document: value.document,
    activeFrameIndex: value.activeFrameIndex, activeLayerIndex: value.activeLayerIndex })
  if (action.type === 'UNDO' || action.type === 'REDO') {
    const undo = action.type === 'UNDO'
    const stack = undo ? state.undoStack : state.redoStack
    const target = stack.at(-1)
    if (!target) return state
    return { ...state, ...target,
      undoStack: undo ? stack.slice(0, -1) : pushSnapshot(state.undoStack, snapshot(state), target),
      redoStack: undo ? pushSnapshot(state.redoStack, snapshot(state), target) : stack.slice(0, -1) }
  }
  if (action.type === 'SET_ACTIVE_LAYER') return { ...state, activeLayerIndex: clampLayerIndex(state.document, action.index) }
  if (action.type === 'SET_ACTIVE_FRAME') return { ...state, activeFrameIndex: clampFrameIndex(state.document, action.index) }
  if (action.type === 'RESTORE_DOCUMENT') return { ...state, document: action.document, activeFrameIndex: 0,
    activeLayerIndex: 0, undoStack: [], redoStack: [] }
  let document = state.document
  let activeFrameIndex = state.activeFrameIndex
  let activeLayerIndex = state.activeLayerIndex
  switch (action.type) {
    case 'RESET': {
      if (!Number.isInteger(action.width) || !Number.isInteger(action.height) || action.width < 1 || action.height < 1 || action.width > 2048 || action.height > 2048) return state
      document = createInitialDocument(action.width, action.height)
      activeFrameIndex = 0; activeLayerIndex = 0
      break
    }
    case 'ADD_FRAME': {
      if (document.frames.length >= 1000) return state
      if ((document.frames.length + 1) * document.layers.length * document.width * document.height * 4 > 256 * 1024 ** 2) return state
      const index = clampFrameIndex(document, state.activeFrameIndex)
      const copied = duplicateFrameDeep(document, index)
      if (!copied) return state
      document = { ...document, frames: [...document.frames.slice(0, index + 1), copied, ...document.frames.slice(index + 1)] }
      activeFrameIndex = index + 1
      break
    }
    case 'DELETE_FRAME': {
      const index = action.frameIndex
      if (document.frames.length <= 1 || index < 0 || index >= document.frames.length) return state
      document = { ...document, frames: document.frames.filter((_, frame) => frame !== index) }
      activeFrameIndex = Math.max(0, Math.min(activeFrameIndex - (index < activeFrameIndex ? 1 : 0), document.frames.length - 1))
      break
    }
    case 'SET_LAYER_VISIBLE': document = updateLayerInDoc(document, action.layerIndex, { visible: action.visible }); break
    case 'SET_LAYER_LOCKED': document = updateLayerInDoc(document, action.layerIndex, { locked: action.locked }); break
    case 'SET_FRAME_DURATION': {
      if (action.frameIndex < 0 || action.frameIndex >= document.frames.length || !Number.isFinite(action.durationMs)) return state
      document = { ...document, frames: document.frames.map((frame, index) => index === action.frameIndex
        ? { ...frame, durationMs: Math.max(1, Math.min(60000, Math.round(action.durationMs))) } : frame) }
      break
    }
    case 'PAINT_PIXELS': {
      const layer = document.layers[action.celIndex]
      if (!layer || layer.locked || !document.frames[action.frameIndex]?.cels[action.celIndex]) return state
      const pixels = dedupePixels(action.pixels)
      if (!pixels.length) return state
      document = paintPixelsOnDocument(document, action.frameIndex, action.celIndex, pixels, action.rgba)
      break
    }
    default: return state
  }
  if (document === state.document) return state
  const next = { ...state, document, activeFrameIndex, activeLayerIndex, redoStack: [] }
  return { ...next, undoStack: pushSnapshot(state.undoStack, snapshot(state), snapshot(next)) }
}

export interface UseRsepriteStateResult {
  doc: Document
  activeFrameIndex: number
  activeLayerIndex: number
  dispatch: Dispatch<RsepriteAction>
  resetDocument: (width: number, height: number) => void
  setActiveLayer: (index: number) => void
  setActiveFrame: (index: number) => void
  addFrame: () => void
  deleteFrame: (frameIndex: number) => void
  setFrameDuration: (frameIndex: number, durationMs: number) => void
  setLayerVisible: (layerIndex: number, visible: boolean) => void
  setLayerLocked: (layerIndex: number, locked: boolean) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Rseprite 文档 + 当前帧/层 + 撤销/重做（第 5～7 步）
 */
export function useRsepriteState(
  initialW: number,
  initialH: number,
): UseRsepriteStateResult {
  const [state, dispatch] = useReducer(
    rsepriteReducer,
    { width: initialW, height: initialH },
    ({ width, height }: { width: number; height: number }) =>
      createInitialState(width, height),
  )

  const resetDocument = useCallback((width: number, height: number) => {
    dispatch({ type: 'RESET', width, height })
  }, [])

  const setActiveLayer = useCallback((index: number) => {
    dispatch({ type: 'SET_ACTIVE_LAYER', index })
  }, [])

  const setActiveFrame = useCallback((index: number) => {
    dispatch({ type: 'SET_ACTIVE_FRAME', index })
  }, [])

  const addFrame = useCallback(() => {
    dispatch({ type: 'ADD_FRAME' })
  }, [])

  const deleteFrame = useCallback((frameIndex: number) => {
    dispatch({ type: 'DELETE_FRAME', frameIndex })
  }, [])

  const setFrameDuration = useCallback((frameIndex: number, durationMs: number) => {
    dispatch({ type: 'SET_FRAME_DURATION', frameIndex, durationMs })
  }, [])

  const setLayerVisible = useCallback(
    (layerIndex: number, visible: boolean) => {
      dispatch({ type: 'SET_LAYER_VISIBLE', layerIndex, visible })
    },
    [],
  )

  const setLayerLocked = useCallback(
    (layerIndex: number, locked: boolean) => {
      dispatch({ type: 'SET_LAYER_LOCKED', layerIndex, locked })
    },
    [],
  )

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' })
  }, [])

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' })
  }, [])

  return {
    doc: state.document,
    activeFrameIndex: state.activeFrameIndex,
    activeLayerIndex: state.activeLayerIndex,
    dispatch,
    resetDocument,
    setActiveLayer,
    setActiveFrame,
    addFrame,
    deleteFrame,
    setFrameDuration,
    setLayerVisible,
    setLayerLocked,
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  }
}

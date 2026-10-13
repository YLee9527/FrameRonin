import type { Document } from './types'

export type DocumentSnapshot = { document: Document; activeFrameIndex: number; activeLayerIndex: number }

export function historyBytes(snapshots: DocumentSnapshot[]): number {
  const buffers = new Set<ArrayBufferLike>()
  let bytes = 0
  for (const snapshot of snapshots) for (const frame of snapshot.document.frames) for (const cel of frame.cels) {
    const buffer = cel.imageData.data.buffer
    if (!buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength }
  }
  return bytes
}

export function pushSnapshot(stack: DocumentSnapshot[], value: DocumentSnapshot, current: DocumentSnapshot): DocumentSnapshot[] {
  let next = [...stack, value].slice(-50)
  while (next.length && historyBytes([...next, current]) > 256 * 1024 ** 2) next = next.slice(1)
  return next
}

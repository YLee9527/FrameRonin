import type { Document } from '../components/Rseprite/types'
import { localJson } from './api'

type Version = { id: string; asset_id: string; metadata: { width: number; height: number; kind: string } }
type StoredCel = { layerId: string; versionId: string }
type StoredFrame = { id: string; durationMs?: number; cels: StoredCel[] }
type CachedCel = { key: string; imageData: ImageData; version: Version }
export type StoredRseprite = { formatVersion: 1; width: number; height: number; layers: Document['layers']; frames: StoredFrame[] }

export function validateStoredRseprite(value: unknown): asserts value is StoredRseprite {
  const record = (item: unknown, keys: string[]): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !keys.includes(key))) throw new Error('Unknown or invalid document field')
    return item as Record<string, unknown>
  }
  const identifier = (item: unknown): item is string => typeof item === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item)
  const document = record(value, ['formatVersion', 'width', 'height', 'layers', 'frames'])
  const width = document.width as number, height = document.height as number
  if (document.formatVersion !== 1 || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 2048 || height > 2048 ||
      !Array.isArray(document.layers) || !document.layers.length || document.layers.length > 32 ||
      !Array.isArray(document.frames) || !document.frames.length || document.frames.length > 1000 ||
      document.frames.length * document.layers.length * width * height * 4 > 256 * 1024 ** 2) throw new Error('Rseprite document exceeds its resource limits')
  const layerIds = new Set<string>(), frameIds = new Set<string>()
  for (const item of document.layers) {
    const layer = record(item, ['id', 'name', 'visible', 'locked'])
    if (!identifier(layer.id) || layerIds.has(layer.id) || typeof layer.name !== 'string' || layer.name.length > 200 ||
        typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw new Error('Invalid or duplicate layer')
    layerIds.add(layer.id)
  }
  const orderedLayers = [...layerIds]
  for (const item of document.frames) {
    const frame = record(item, ['id', 'durationMs', 'cels'])
    const duration = frame.durationMs as number | undefined
    if (!identifier(frame.id) || frameIds.has(frame.id) || !Array.isArray(frame.cels) || frame.cels.length !== layerIds.size ||
        (duration !== undefined && (!Number.isInteger(duration) || duration < 1 || duration > 60000))) throw new Error('Invalid frame data')
    frameIds.add(frame.id)
    for (const [index, item] of frame.cels.entries()) {
      const cel = record(item, ['layerId', 'versionId'])
      if (cel.layerId !== orderedLayers[index] || typeof cel.versionId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cel.versionId)) throw new Error('Invalid cel reference')
    }
  }
}

export class RsepritePersistence {
  private versions = new WeakMap<ImageData, Version>()
  private celAssets = new Map<string, string>()
  private prepared = new WeakMap<Document, CachedCel[]>()

  activate(document: Document) {
    const cached = this.prepared.get(document)
    if (!cached) throw new Error('The loaded document was not prepared by this project session')
    this.celAssets.clear()
    for (const { key, imageData, version } of cached) { this.versions.set(imageData, version); this.celAssets.set(key, version.asset_id) }
    this.prepared.delete(document)
  }

  async serialize(document: Document): Promise<StoredRseprite> {
    const frames: StoredFrame[] = []
    for (const frame of document.frames) {
      const cels: StoredCel[] = []
      for (const cel of frame.cels) {
        const key = `${frame.id}:${cel.layerId}`
        let version = this.versions.get(cel.imageData)
        if (!version) {
          const canvas = new OffscreenCanvas(document.width, document.height)
          canvas.getContext('2d')!.putImageData(cel.imageData, 0, 0)
          const blob = await canvas.convertToBlob({ type: 'image/png' })
          const form = new FormData()
          form.append('file', new File([blob], `frame-${frame.id}-${cel.layerId}.png`, { type: 'image/png' }))
          const asset = this.celAssets.get(key)
          if (asset) form.append('assetId', asset)
          version = await localJson<Version>('/api/assets', { method: 'POST', body: form })
          this.versions.set(cel.imageData, version)
        }
        this.celAssets.set(key, version.asset_id)
        cels.push({ layerId: cel.layerId, versionId: version.id })
      }
      frames.push({ id: frame.id, durationMs: frame.durationMs, cels })
    }
    return { formatVersion: 1, width: document.width, height: document.height, layers: document.layers, frames }
  }

  async deserialize(value: StoredRseprite): Promise<Document> {
    validateStoredRseprite(value)
    const cached: CachedCel[] = []
    const frames: Document['frames'] = []
    for (const frame of value.frames) {
      const cels: Document['frames'][number]['cels'] = []
      for (const [index, cel] of frame.cels.entries()) {
        if (cel.layerId !== value.layers[index]?.id) throw new Error('Cel/layer reference mismatch')
        const version = await localJson<Version>(`/api/versions/${encodeURIComponent(cel.versionId)}`)
        if (version.metadata.kind !== 'image' || version.metadata.width !== value.width || version.metadata.height !== value.height) throw new Error('Saved cel dimensions changed')
        const response = await fetch(`/api/versions/${encodeURIComponent(cel.versionId)}/content`)
        if (!response.ok) throw new Error('Saved cel is missing')
        const bitmap = await createImageBitmap(await response.blob())
        const canvas = new OffscreenCanvas(value.width, value.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0); bitmap.close()
        const imageData = context.getImageData(0, 0, value.width, value.height)
        cached.push({ key: `${frame.id}:${cel.layerId}`, imageData, version })
        cels.push({ layerId: cel.layerId, imageData })
      }
      frames.push({ id: frame.id, durationMs: frame.durationMs, cels })
    }
    const document = { width: value.width, height: value.height, layers: value.layers, frames }
    this.prepared.set(document, cached)
    return document
  }
}

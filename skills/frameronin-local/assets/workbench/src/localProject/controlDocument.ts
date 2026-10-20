import {cacheManagedInput, importManagedInputs, loadManagedVersions, type ManagedVersion} from './managedTasks'
import {localFetch, localJson} from './api'
import {fineEditorDimensions} from '../lib/fineEditorPixels'

export type ControlVariant = 'topdown' | 'arcade'
export type ControlRect = {x: number; y: number; w: number; h: number}
export type ControlSpawn = {x: number; y: number; facing: -1 | 1}
export type ControlDraft = {
  variant: ControlVariant
  bundledResourceVersion: 1
  sprite: File | null
  background: File | null
  foreground: File | null
  music: File | null
  obstacles: ControlRect[]
  obstacleEditMode: boolean
  musicOn: boolean
  spawn: ControlSpawn
}
type Resource = {versionId: string; name: string; type: string}
type Slot = 'sprite' | 'background' | 'foreground' | 'music'
export type StoredControl = Omit<ControlDraft, Slot> & {formatVersion: 1} & Record<Slot, Resource | null>
export const controlSlots: Slot[] = ['sprite', 'background', 'foreground', 'music']
export const controlMetadata = new WeakMap<File, ManagedVersion>()
export const controlArena = (variant: ControlVariant) => variant === 'arcade'
  ? {width: 688, height: 384, minY: 230, maxY: 272}
  : {width: 480, height: 320, minY: 0, maxY: 278}
export const initialControlDraft = (variant: ControlVariant): ControlDraft => ({
  variant, bundledResourceVersion: 1, sprite: null, background: null, foreground: null, music: null,
  obstacles: [], obstacleEditMode: false, musicOn: true,
  spawn: variant === 'arcade' ? {x: 333, y: 251, facing: 1} : {x: 219, y: 118, facing: 1},
})
export const controlFiles = (drafts: ControlDraft[]) => new Set(drafts.flatMap(d => controlSlots.map(k => d[k])).filter((f): f is File => !!f))
export function controlObstacle(start: {x: number; y: number}, end: {x: number; y: number}, variant: ControlVariant): ControlRect {
  const a = controlArena(variant)
  const x = Math.max(0, Math.min(a.width - 4, start.x, end.x)), y = Math.max(0, Math.min(a.height - 4, start.y, end.y))
  return {x, y, w: Math.max(4, Math.min(a.width - x, Math.abs(end.x - start.x))), h: Math.max(4, Math.min(a.height - y, Math.abs(end.y - start.y)))}
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const fields = (v: object, keys: string[]) => Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const safeText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && ![...v].some(c => c.charCodeAt(0) < 32)
function resource(value: unknown): asserts value is Resource {
  if (!object(value) || !fields(value, ['versionId', 'name', 'type']) || typeof value.versionId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.versionId)
    || !safeText(value.name, 255) || !value.name || /[\\/]/.test(String(value.name)) || ['.', '..'].includes(String(value.name))
    || !safeText(value.type, 100)) throw new Error('CONTROL_DOCUMENT_RESOURCE')
}
export function validateStoredControl(value: unknown, variant?: ControlVariant): StoredControl {
  if (!object(value) || !['topdown', 'arcade'].includes(String(value.variant)) || variant && value.variant !== variant
    || !fields(value, ['formatVersion', ...Object.keys(initialControlDraft('topdown'))])
    || value.formatVersion !== 1 || value.bundledResourceVersion !== 1
    || typeof value.obstacleEditMode !== 'boolean' || typeof value.musicOn !== 'boolean') throw new Error('CONTROL_DOCUMENT_FIELDS')
  const d = value as StoredControl, a = controlArena(d.variant)
  for (const slot of controlSlots) if (d[slot] !== null) resource(d[slot])
  if (d.variant === 'topdown' && d.foreground) throw new Error('CONTROL_DOCUMENT_FOREGROUND')
  const aliases = new Map<string, string>()
  for (const ref of controlSlots.map(k => d[k]).filter((v): v is Resource => !!v)) {
    const key = ref.name + '|' + ref.type
    if (aliases.has(ref.versionId) && aliases.get(ref.versionId) !== key) throw new Error('CONTROL_DOCUMENT_ALIAS')
    aliases.set(ref.versionId, key)
  }
  if (!Array.isArray(d.obstacles) || d.obstacles.length > 2048 || d.obstacles.some(r => !object(r) || !fields(r, ['x', 'y', 'w', 'h'])
    || !finite(r.x, 0, a.width) || !finite(r.y, 0, a.height) || !finite(r.w, 4, a.width)
    || !finite(r.h, 4, a.height) || r.x + r.w > a.width || r.y + r.h > a.height)) throw new Error('CONTROL_DOCUMENT_OBSTACLES')
  const s = d.spawn
  if (!object(s) || !fields(s, ['x', 'y', 'facing']) || !finite(s.x, 0, a.width - 21)
    || !finite(s.y, a.minY, a.maxY) || ![-1, 1].includes(s.facing)) throw new Error('CONTROL_DOCUMENT_SPAWN')
  return d
}
function encode(d: ControlDraft, reference: (f: File) => Resource): StoredControl {
  return validateStoredControl({...d, formatVersion: 1, ...Object.fromEntries(controlSlots.map(k => [k, d[k] ? reference(d[k]!) : null]))})
}
/** Include decoded textures, encoded history, audio PCM and fixed scene/canvas overhead. */
export function checkControlAssets(d: StoredControl, versions: Map<string, ManagedVersion>, budget: number, retainedBytes = 0) {
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 2 * 1024 ** 3) throw new Error('CONTROL_DOCUMENT_BUDGET')
  let bytes = 96 * 1024 ** 2 + retainedBytes
  for (const slot of controlSlots) {
    const ref = d[slot]
    if (!ref) continue
    const version = versions.get(ref.versionId), m = version?.metadata
    if (!m || version?.id !== ref.versionId || !Number.isSafeInteger(m.bytes) || m.bytes < 1) throw new Error('CONTROL_ASSET_METADATA')
    bytes += m.bytes * 2
    if (slot === 'music') {
      if (m.kind !== 'audio' || !finite(m.bytes, 1, 64 * 1024 ** 2) || !finite(m.durationSeconds, .001, 3600)
        || !finite(m.sampleRate, 1, 192000) || !finite(m.channels, 1, 8)) throw new Error('CONTROL_AUDIO_LIMIT')
      bytes += m.durationSeconds * m.sampleRate * m.channels * 8
    } else {
      const size = fineEditorDimensions(m)
      if (m.kind !== 'image' || !finite(m.bytes, 1, 20 * 1024 ** 2) || (m.frames ?? 1) !== 1
        || !['PNG', 'JPEG', 'WEBP'].includes(m.containerFormat ?? '') || !Number.isSafeInteger(size.width)
        || !Number.isSafeInteger(size.height) || !finite(size.width, 1, 30000) || !finite(size.height, 1, 30000)) throw new Error('CONTROL_IMAGE_LIMIT')
      if (slot === 'sprite' && (size.width < 252 || size.height < 252)) throw new Error('CONTROL_SPRITE_LAYOUT')
      bytes += size.width! * size.height! * 24
    }
  }
  if (!Number.isFinite(bytes) || bytes > budget) throw new Error('CONTROL_RESOURCE_LIMIT')
  return Math.ceil(bytes)
}
export async function prepareControlAssets(d: ControlDraft, signal?: AbortSignal, retained: File[] = []) {
  const files = [...controlFiles([d])], imported = await importManagedInputs(files, signal)
  const refs = new Map(files.map((f, i) => [f, {versionId: imported.versions[i].id, name: f.name, type: f.type}]))
  const stored = encode(d, f => refs.get(f)!)
  const retainedBytes = [...new Set(retained)].filter(f => !files.includes(f)).reduce((n, f) => n + f.size * 2, 0)
  checkControlAssets(stored, new Map(imported.versions.map(v => [v.id, v])), imported.memoryBudgetBytes, retainedBytes)
  files.forEach((f, i) => controlMetadata.set(f, imported.versions[i]))
  return imported
}
export async function serializeControl(d: ControlDraft): Promise<StoredControl> {
  // Validate the shape before importing any selected source.
  const fake = new Map([...controlFiles([d])].map((f, i) => [f, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]))
  encode(d, f => ({versionId: fake.get(f)!, name: f.name, type: f.type}))
  await prepareControlAssets(d)
  return encode(d, f => ({versionId: controlMetadata.get(f)!.id, name: f.name, type: f.type}))
}
export async function restoreControl(value: unknown, variant: ControlVariant, retained: File[] = [], current?: ControlDraft): Promise<ControlDraft> {
  const d = validateStoredControl(value, variant), refs = [...new Map(controlSlots.map(k => d[k]).filter((r): r is Resource => !!r).map(r => [r.versionId, r])).values()]
  const {project, memoryBudgetBytes} = await localJson<{project: {id: string}; memoryBudgetBytes: number}>('/api/project/context')
  const versions = new Map((await loadManagedVersions(refs.map(r => r.versionId))).map(v => [v.id, v]))
  let liveBytes = 0
  if (current) for (const slot of controlSlots) {
    const file = current[slot], m = file ? controlMetadata.get(file)?.metadata : undefined
    if (!m) continue
    if (slot === 'music') liveBytes += (m.durationSeconds ?? 0) * (m.sampleRate ?? 0) * (m.channels ?? 0) * 8
    else { const size = fineEditorDimensions(m); liveBytes += (size.width ?? 0) * (size.height ?? 0) * 16 }
  }
  checkControlAssets(d, versions, memoryBudgetBytes, Math.ceil(liveBytes) + [...new Set(retained)].reduce((n, f) => n + f.size * 2, 0))
  const loaded = new Map<string, File>()
  for (const ref of refs) {
    const response = await localFetch(`/api/versions/${ref.versionId}/content`)
    if (!response.ok) throw new Error('CONTROL_ASSET_MISSING')
    const blob = await response.blob()
    if (blob.size !== versions.get(ref.versionId)!.metadata.bytes) throw new Error('CONTROL_ASSET_CHANGED')
    const file = new File([blob], ref.name, {type: ref.type})
    controlMetadata.set(file, versions.get(ref.versionId)!); cacheManagedInput(file, project.id, ref.versionId); loaded.set(ref.versionId, file)
  }
  const {formatVersion: _, ...settings} = d; void _
  const file = (slot: Slot) => d[slot] ? loaded.get(d[slot]!.versionId)! : null
  return {...settings, sprite: file('sprite'), background: file('background'), foreground: file('foreground'), music: file('music')}
}

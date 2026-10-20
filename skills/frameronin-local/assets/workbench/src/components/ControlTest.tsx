import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { Alert, Button, ConfigProvider, Switch, Typography, Upload, message, theme } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import StashDropZone from './StashDropZone'
import {useControlDocument} from '../localProject/useControlDocument'
import {ControlDocumentSurface} from '../localProject/ControlDocumentSurface'
import {useControlImages} from '../localProject/useControlImages'
import {controlObstacle, type ControlRect} from '../localProject/controlDocument'
import './ControlTest.css'

const { Dragger } = Upload
const { Text } = Typography

type ControlTestVariant = 'topdown' | 'arcade'

interface ControlTestProps {
  onBack?: () => void
  variant?: ControlTestVariant
}

const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']
const AUDIO_ACCEPT = ['.mp3', '.wav', '.ogg', '.m4a', '.aac']
const DEFAULT_BGM_URL = `${import.meta.env.BASE_URL}defultbgm.ogg`
const DEFAULT_ARCADE_BGM_URL = `${import.meta.env.BASE_URL}acbgm.ogg`
const ZOMBIE_FRAME_W = 32
const ZOMBIE_FRAME_H = 64
const ZOMBIE_FRAMES = 6
const ZOMBIE2_FRAMES = 7
const ZOMBIE3_FRAMES = 10
const ZOMBIE4_FRAMES = 7
const ZOMBIE_SCALE = 0.7
const ZOMBIE_DISPLAY_W = ZOMBIE_FRAME_W * ZOMBIE_SCALE
const ZOMBIE_DISPLAY_H = ZOMBIE_FRAME_H * ZOMBIE_SCALE

/** 帧区域定义：id -> {x, y, w, h}，对应 GDScript Rect2i */
const REGIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  uk1xb: { x: 0, y: 168, w: 42, h: 42 },
  m5je3: { x: 42, y: 168, w: 42, h: 42 },
  '2ij6o': { x: 84, y: 168, w: 42, h: 42 },
  kmxfq: { x: 126, y: 168, w: 42, h: 42 },
  cpoga: { x: 168, y: 168, w: 42, h: 42 },
  '02845': { x: 210, y: 168, w: 42, h: 42 },
  hg6s0: { x: 0, y: 210, w: 42, h: 42 },
  kwjof: { x: 42, y: 210, w: 42, h: 42 },
  '5u6fn': { x: 126, y: 84, w: 21, h: 42 },
  t2na7: { x: 147, y: 84, w: 21, h: 42 },
  '3kx8u': { x: 168, y: 84, w: 21, h: 42 },
  y5pas: { x: 189, y: 84, w: 21, h: 42 },
  '8pc1g': { x: 210, y: 84, w: 21, h: 42 },
  '3cyhk': { x: 231, y: 84, w: 21, h: 42 },
  w25ly: { x: 168, y: 126, w: 21, h: 42 },
  rdd8s: { x: 189, y: 210, w: 63, h: 42 },
  '72hcl': { x: 210, y: 126, w: 21, h: 42 },
  rydce: { x: 189, y: 126, w: 21, h: 42 },
  '1et3y': { x: 231, y: 126, w: 21, h: 42 },
  uwgfa: { x: 147, y: 210, w: 21, h: 42 },
  y65iy: { x: 168, y: 210, w: 21, h: 42 },
  '8al5y': { x: 105, y: 210, w: 21, h: 42 },
  '3js2j': { x: 126, y: 210, w: 21, h: 42 },
  bbcvv: { x: 0, y: 126, w: 28, h: 42 },
  foxtp: { x: 28, y: 126, w: 28, h: 42 },
  aw8dg: { x: 56, y: 126, w: 28, h: 42 },
  evrtr: { x: 84, y: 126, w: 28, h: 42 },
  pyoh8: { x: 112, y: 126, w: 28, h: 42 },
  t4rff: { x: 140, y: 126, w: 28, h: 42 },
  koy62: { x: 0, y: 0, w: 21, h: 42 },
  '3ygc0': { x: 21, y: 0, w: 21, h: 42 },
  yfrrb: { x: 42, y: 0, w: 21, h: 42 },
  '2enbr': { x: 63, y: 0, w: 21, h: 42 },
  s2yql: { x: 84, y: 0, w: 21, h: 42 },
  idc64: { x: 105, y: 0, w: 21, h: 42 },
  '8mwul': { x: 0, y: 42, w: 21, h: 42 },
  snwwj: { x: 21, y: 42, w: 21, h: 42 },
  ynglr: { x: 42, y: 42, w: 21, h: 42 },
  p3oo0: { x: 63, y: 42, w: 21, h: 42 },
  pfwvy: { x: 84, y: 42, w: 21, h: 42 },
  tvkvf: { x: 105, y: 42, w: 21, h: 42 },
  '20ynl': { x: 84, y: 210, w: 21, h: 42 },
  '3c66l': { x: 0, y: 84, w: 21, h: 42 },
  wq5ia: { x: 21, y: 84, w: 21, h: 42 },
  '11gwb': { x: 42, y: 84, w: 21, h: 42 },
  iitav: { x: 63, y: 84, w: 21, h: 42 },
  '360a7': { x: 84, y: 84, w: 21, h: 42 },
  ffd0g: { x: 105, y: 84, w: 21, h: 42 },
  ahlcx: { x: 126, y: 0, w: 21, h: 42 },
  '4i3vm': { x: 147, y: 0, w: 21, h: 42 },
  '0qwcd': { x: 168, y: 0, w: 21, h: 42 },
  y1030: { x: 189, y: 0, w: 21, h: 42 },
  '3sl87': { x: 210, y: 0, w: 21, h: 42 },
  '8kwsb': { x: 231, y: 0, w: 21, h: 42 },
  umveo: { x: 126, y: 42, w: 21, h: 42 },
  v6ado: { x: 147, y: 42, w: 21, h: 42 },
  syfy0: { x: 168, y: 42, w: 21, h: 42 },
  us0w8: { x: 189, y: 42, w: 21, h: 42 },
  pf2m2: { x: 210, y: 42, w: 21, h: 42 },
  '876dv': { x: 231, y: 42, w: 21, h: 42 },
}

/** 动画定义 */
const ANIMS: { name: string; frames: string[]; loop: boolean; speed: number }[] = [
  { name: 'attractL', frames: ['uk1xb', 'm5je3', '2ij6o', 'kmxfq', 'cpoga', '02845', 'hg6s0', 'kwjof'], loop: false, speed: 5 },
  { name: 'climb', frames: ['5u6fn', 't2na7', '3kx8u', 'y5pas', '8pc1g', '3cyhk'], loop: true, speed: 7 },
  { name: 'defence', frames: ['w25ly'], loop: true, speed: 5 },
  { name: 'die', frames: ['rdd8s'], loop: true, speed: 5 },
  { name: 'idleL', frames: ['72hcl'], loop: true, speed: 5 },
  { name: 'idledown', frames: ['rydce'], loop: true, speed: 5 },
  { name: 'idleup', frames: ['1et3y'], loop: true, speed: 5 },
  { name: 'item', frames: ['uwgfa', 'y65iy'], loop: false, speed: 5 },
  { name: 'jump', frames: ['8al5y', '3js2j'], loop: true, speed: 1 },
  { name: 'runL', frames: ['bbcvv', 'foxtp', 'aw8dg', 'evrtr', 'pyoh8', 't4rff'], loop: true, speed: 5 },
  { name: 'rundown', frames: ['koy62', '3ygc0', 'yfrrb', '2enbr', 's2yql', 'idc64'], loop: true, speed: 5 },
  { name: 'runup', frames: ['8mwul', 'snwwj', 'ynglr', 'p3oo0', 'pfwvy', 'tvkvf'], loop: true, speed: 5 },
  { name: 'sitdown', frames: ['20ynl'], loop: false, speed: 5 },
  { name: 'walkL', frames: ['3c66l', 'wq5ia', '11gwb', 'iitav', '360a7', 'ffd0g'], loop: true, speed: 5 },
  { name: 'walkdown', frames: ['ahlcx', '4i3vm', '0qwcd', 'y1030', '3sl87', '8kwsb'], loop: true, speed: 5 },
  { name: 'walkup', frames: ['umveo', 'v6ado', 'syfy0', 'us0w8', 'pf2m2', '876dv'], loop: true, speed: 5 },
]

const MOVE_SPEED = 0.375
const RUN_SPEED_MUL = 2
const ARENA_W = 480
const ARENA_H = 320
const ARENA_ARCADE_W = 688
const ARENA_ARCADE_H = 384
const ARCADE_BG_SCALE = 0.8
const ARCADE_WALK_MIN_Y = 230
const ARCADE_WALK_MAX_Y = 272
const PIXEL_SCALE = 2

/** 脚底阴影：相对脚底 y 偏移、缩放（与 Godot 一致） */
const SHADOW_OFFSET_Y = -2
const SHADOW_SCALE = 0.8

let shadowTexCache: HTMLCanvasElement | null = null
/** 程序生成椭圆阴影贴图，对应 Godot _ShadowTex.build_texture() */
function getShadowTexture(): HTMLCanvasElement {
  if (shadowTexCache) return shadowTexCache
  const c = document.createElement('canvas')
  const w = 28
  const h = 10
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2)
  ctx.fill()
  shadowTexCache = c
  return c
}

/** AABB 碰撞检测 */
function rectOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function extractFrame(img: ImageBitmap, key: string): HTMLCanvasElement | null {
  const r = REGIONS[key]
  if (!r) return null
  const c = document.createElement('canvas')
  c.width = r.w
  c.height = r.h
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return c
}

export default function ControlTest({ onBack, variant = 'topdown' }: ControlTestProps) {
  const { t, lang } = useLanguage()
  const tx = (zh: string, en: string, ja: string) => lang === 'zh' ? zh : lang === 'ja' ? ja : en
  const imageError = (error: string) => error.includes('CANCELED') ? tx('已取消素材加载，可重新加载。', 'Asset loading canceled. You can retry.', '素材の読み込みを取り消しました。再試行できます。')
    : error.includes('RESOURCE_LIMIT') || error.includes('BUDGET') ? tx('素材超出内存预算，请减小图片尺寸或缩短音乐。', 'Assets exceed the memory budget. Use smaller images or shorter music.', 'メモリ予算を超えました。画像を小さくするか音楽を短くしてください。')
    : error.includes('SPRITE_LAYOUT') ? tx('角色图至少需要 252×252 像素，并使用一图全动作布局。', 'Use an all-actions character sheet of at least 252×252 pixels.', '252×252 ピクセル以上の全アクションシートを使用してください。')
    : error.includes('AUDIO_LIMIT') ? tx('音乐超出支持的大小、时长或声道范围，请更换素材。', 'Music exceeds the supported size, duration or channel limits.', '音楽のサイズ、長さ、チャンネル数が対応範囲を超えています。')
    : tx('无法读取场景素材，请重试或更换受支持的文件。', 'Scene assets could not be loaded. Retry or choose a supported file.', 'シーン素材を読み込めません。再試行するか対応形式のファイルを選択してください。')
  const isArcade = variant === 'arcade'
  const model = useControlDocument(variant), draft = model.draft
  const {sprite: spriteFile, background: bgFile, foreground: fgFile, music: musicFile, obstacles, obstacleEditMode} = draft
  const {set, dispatch} = model
  const selectFile = useCallback((slot: 'sprite' | 'background' | 'foreground' | 'music', file: File | null) => {
    const extensions = slot === 'music' ? /\.(wav|mp3|ogg|m4a|aac)$/i : /\.(png|jpe?g|webp)$/i
    if (file && (!extensions.test(file.name) || file.size < 1 || file.size > (slot === 'music' ? 64 : 20) * 1024 ** 2 || /[\\/]/.test(file.name))) {
      message.error(lang === 'zh' ? '请选择有效的图片（最多 20 MiB）或音乐（最多 64 MiB）。' : lang === 'ja' ? '有効な画像（20 MiB 以下）または音楽（64 MiB 以下）を選択してください。' : 'Choose a valid image (up to 20 MiB) or music file (up to 64 MiB).'); return
    }
    set(slot, file)
  }, [set, lang])
  const setSpriteFile = useCallback((file: File | null) => selectFile('sprite', file), [selectFile])
  const setBgFile = useCallback((file: File | null) => selectFile('background', file), [selectFile])
  const setFgFile = useCallback((file: File | null) => selectFile('foreground', file), [selectFile])
  const setMusicFile = useCallback((file: File | null) => selectFile('music', file), [selectFile])
  const setObstacles = useCallback((value: SetStateAction<ControlRect[]>) => set('obstacles', value), [set])
  const setObstacleEditMode = useCallback((value: boolean) => set('obstacleEditMode', value), [set])
  const decoded = useControlImages(draft, model.retained)
  const frameCanvases = useMemo(() => {
    const frames = new Map<string, HTMLCanvasElement>()
    if (decoded.images?.sprite) for (const key of Object.keys(REGIONS)) {
      const frame = extractFrame(decoded.images.sprite, key); if (frame) frames.set(key, frame)
    }
    return frames
  }, [decoded.images])
  const ready = !!decoded.images?.sprite && !decoded.loading && !decoded.error
  const [dragRect, setDragRect] = useState<{x1: number; y1: number; x2: number; y2: number} | null>(null)
  const pointer = useRef(false)
  const onInteraction = useCallback((active: boolean) => { pointer.current = active }, [])
  const [live, setLive] = useState({x: draft.spawn.x, y: draft.spawn.y, action: 'idledown', monsters: 0})
  const [audioError, setAudioError] = useState('')
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'failed'>('idle')
  const actionText = live.action.startsWith('run') ? tx('跑步', 'Running', '走る') : live.action.startsWith('walk') ? tx('行走', 'Walking', '歩く')
    : live.action === 'item' ? tx('使用物品', 'Using item', 'アイテム') : live.action === 'attractL' ? tx('吸引', 'Attract', '誘う')
    : live.action === 'defence' ? tx('防御', 'Defending', '防御') : tx('待机', 'Idle', '待機')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const obstaclesRef = useRef<{ x: number; y: number; w: number; h: number }[]>([])
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const dragCurrentRef = useRef<{ x: number; y: number } | null>(null)
  const gameImages = useRef(decoded.images)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const zombieCanvasRef = useRef<HTMLCanvasElement[]>([])
  const zombie2CanvasRef = useRef<HTMLCanvasElement[]>([])
  const zombie3CanvasRef = useRef<HTMLCanvasElement[]>([])
  const zombie4CanvasRef = useRef<HTMLCanvasElement[]>([])
  // 怪物列表: x(中心X), y(脚底Y), facing(1=右,-1=左), frameIdx, speed, type(0=类型1, 1=类型2)
  const monstersRef = useRef<{ x: number; y: number; facing: number; frameIdx: number; accum: number; speed: number; type: number }[]>([])
  const monsterSpawnTimerRef = useRef(0)
  const keysRef = useRef<Set<string>>(new Set())
  const arenaW = isArcade ? ARENA_ARCADE_W : ARENA_W
  const arenaH = isArcade ? ARENA_ARCADE_H : ARENA_H
  const posRef = useRef(
    isArcade
      ? { x: Math.floor(ARENA_ARCADE_W / 2 - 21 / 2), y: 251 }
      : { x: ARENA_W / 2 - 21, y: ARENA_H / 2 - 42 }
  )
  const animRef = useRef({ name: 'idledown', frameIdx: 0, accum: 0 })
  const facingRef = useRef(1) // 1=right, -1=left
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const obstacleEditModeRef = useRef(false)
  const dragRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  useEffect(() => {
    obstaclesRef.current = obstacles
  }, [obstacles])
  useLayoutEffect(() => {
    if (!ready) {
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [ready])
  useLayoutEffect(() => { obstacleEditModeRef.current = obstacleEditMode; dragRectRef.current = dragRect }, [obstacleEditMode, dragRect])

  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  const clientToLogic = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * arenaW
      const y = ((clientY - rect.top) / rect.height) * arenaH
      return { x: Math.max(0, Math.min(arenaW, x)), y: Math.max(0, Math.min(arenaH, y)) }
    },
    [arenaW, arenaH]
  )

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!obstacleEditMode || e.button !== 0) return
      const { x, y } = clientToLogic(e.clientX, e.clientY)
      dragStartRef.current = { x, y }
      setDragRect({ x1: x, y1: y, x2: x, y2: y })
    },
    [obstacleEditMode, clientToLogic]
  )
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!obstacleEditMode || !dragStartRef.current) return
      const { x, y } = clientToLogic(e.clientX, e.clientY)
      dragCurrentRef.current = { x, y }
      setDragRect((r) => (r ? { ...r, x2: x, y2: y } : null))
    },
    [obstacleEditMode, clientToLogic]
  )
  const finishDrag = useCallback(() => {
    const start = dragStartRef.current
    const current = dragCurrentRef.current
    if (!start || !current) return
    const rect = controlObstacle(start, current, variant)
    if (obstaclesRef.current.length >= 2048) message.error(lang === 'zh' ? '碰撞区域已达到 2048 个上限。' : lang === 'ja' ? '障害物は 2048 個までです。' : 'The scene supports up to 2048 obstacles.')
    else setObstacles(prev => [...prev, rect])
    dragStartRef.current = null
    dragCurrentRef.current = null
    setDragRect(null)
  }, [setObstacles, variant, lang])
  const handleCanvasMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!obstacleEditMode || e.button !== 0) return
      dragCurrentRef.current = clientToLogic(e.clientX, e.clientY)
      finishDrag()
    },
    [obstacleEditMode, clientToLogic, finishDrag]
  )
  const handleCanvasMouseLeave = useCallback(() => {
    if (obstacleEditMode) {
      dragStartRef.current = null
      dragCurrentRef.current = null
      setDragRect(null)
    }
  }, [obstacleEditMode])

  useEffect(() => {
    const onWindowMouseUp = () => {
      if (dragStartRef.current) {
        if (!dragCurrentRef.current) dragCurrentRef.current = dragStartRef.current
        finishDrag()
      }
    }
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => window.removeEventListener('mouseup', onWindowMouseUp)
  }, [finishDrag])

  useLayoutEffect(() => {
    gameImages.current = decoded.images
    const cuts = [zombieCanvasRef, zombie2CanvasRef, zombie3CanvasRef, zombie4CanvasRef]
    const names = ['zombie', 'zombie2', 'zombie3', 'zombie4'] as const
    const counts = [ZOMBIE_FRAMES, ZOMBIE2_FRAMES, ZOMBIE3_FRAMES, ZOMBIE4_FRAMES]
    for (let type = 0; type < names.length; type++) {
      const image = decoded.images?.[names[type]]
      cuts[type].current = image ? Array.from({length: counts[type]}, (_, i) => {
        const canvas = document.createElement('canvas'); canvas.width = ZOMBIE_FRAME_W; canvas.height = ZOMBIE_FRAME_H
        const context = canvas.getContext('2d')!
        context.imageSmoothingEnabled = false
        context.drawImage(image, i * ZOMBIE_FRAME_W, 0, ZOMBIE_FRAME_W, ZOMBIE_FRAME_H, 0, 0, ZOMBIE_FRAME_W, ZOMBIE_FRAME_H)
        return canvas
      }) : []
    }
  }, [decoded.images])
  useEffect(() => {
    const timer = window.setInterval(() => setLive({x: posRef.current.x, y: posRef.current.y, action: animRef.current.name, monsters: monstersRef.current.length}), 100)
    return () => window.clearInterval(timer)
  }, [])
  useLayoutEffect(() => {
    posRef.current = {x: draft.spawn.x, y: draft.spawn.y}; facingRef.current = draft.spawn.facing
    animRef.current = {name: 'idledown', frameIdx: 0, accum: 0}; keysRef.current.clear()
    monstersRef.current = []; monsterSpawnTimerRef.current = 0
  }, [draft.spawn])
  const beforeAction = useCallback(async () => {
    if (dragStartRef.current) throw new Error('CONTROL_FINISH_OBSTACLE_GESTURE')
    keysRef.current.clear(); dispatch({type: 'end'})
  }, [dispatch])
  const pending = useCallback(() => pointer.current || !!dragStartRef.current, [])

  useEffect(() => {
    if (!draft.musicOn || decoded.loading || decoded.error) return
    const url = musicFile ? URL.createObjectURL(musicFile) : null
    const audio = new Audio(url ?? (isArcade ? DEFAULT_ARCADE_BGM_URL : DEFAULT_BGM_URL))
    let active = true
    audio.loop = true; audioRef.current = audio
    void Promise.resolve().then(() => { if (active) setAudioState('loading') })
    audio.onerror = () => { if (active) { setAudioError('CONTROL_AUDIO_DECODE_FAILED'); setAudioState('failed') } }
    audio.onplaying = () => { if (active) { setAudioError(''); setAudioState('playing') } }
    audio.onpause = () => { if (active) setAudioState('paused') }
    audio.onwaiting = () => { if (active) setAudioState('loading') }
    void audio.play().catch(error => { if (active) { setAudioError(error?.name === 'NotAllowedError' ? 'CONTROL_AUDIO_PLAY_REQUIRED' : 'CONTROL_AUDIO_PLAY_FAILED'); setAudioState('failed') } })
    return () => {
      active = false; audio.onerror = null; audio.onplaying = null; audio.onpause = null; audio.onwaiting = null
      audio.pause(); audio.src = ''; if (url) URL.revokeObjectURL(url)
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [musicFile, isArcade, draft.musicOn, decoded.loading, decoded.error])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || document.activeElement !== canvasRef.current) return
      const k = e.code || e.key
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyI', 'KeyJ', 'KeyK', 'ShiftLeft', 'ShiftRight'].includes(k)) {
        e.preventDefault()
      }
      keysRef.current.add(e.code || e.key.toLowerCase())
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code || e.key.toLowerCase())
    }
    const clear = () => { keysRef.current.clear(); dragStartRef.current = null; dragCurrentRef.current = null; setDragRect(null) }
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', clear)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const gameLoop = useCallback(
    function gameLoop(now?: number) {
      const canvas = canvasRef.current
      const keys = keysRef.current
      rafRef.current = requestAnimationFrame(gameLoop)
      if (!canvas || !ready) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false

      const aw = arenaW
      const ah = arenaH
      const minY = isArcade ? ARCADE_WALK_MIN_Y : 0
      const maxY = isArcade ? ARCADE_WALK_MAX_Y : ah - 42

      const t = typeof now === 'number' ? now : performance.now()
      const dt = lastTimeRef.current ? Math.min((t - lastTimeRef.current) / 1000, 1 / 15) : 1 / 60
      lastTimeRef.current = t

      const pos = posRef.current
      const anim = animRef.current
      const facing = facingRef.current

      let nextAnim = anim.name
    const w = keys.has('KeyW') || keys.has('w')
    const a = keys.has('KeyA') || keys.has('a')
    const s = keys.has('KeyS') || keys.has('s')
    const d = keys.has('KeyD') || keys.has('d')
    const i = keys.has('KeyI') || keys.has('i')
    const j = keys.has('KeyJ') || keys.has('j')
    const k = keys.has('KeyK') || keys.has('k')
    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const moveSpeed = shift ? MOVE_SPEED * RUN_SPEED_MUL : MOVE_SPEED
    const walkPrefix = shift ? 'run' : 'walk'
    const arcadeHoriSpeed = 0.45
    const arcadeVertSpeed = 0.15

    const CHAR_W = 21
    const CHAR_H = 42
    const CHAR_HITBOX_H = 6 // 脚底往上 6 像素有碰撞
    const obs = obstaclesRef.current
    const tryMove = (newX: number, newY: number) => {
      const charRect = {
        x: newX,
        y: newY + CHAR_H - CHAR_HITBOX_H,
        w: CHAR_W,
        h: CHAR_HITBOX_H,
      }
      for (const o of obs) {
        if (rectOverlap(charRect, o)) return false
      }
      return true
    }

    if (i) {
      nextAnim = 'item'
    } else if (j) {
      nextAnim = 'attractL'
    } else if (k) {
      nextAnim = 'defence'
    } else if (w && !s) {
      nextAnim = isArcade ? 'walkL' : walkPrefix + 'up'
      const vertSpeed = isArcade ? arcadeVertSpeed : moveSpeed
      const newY = Math.max(minY, pos.y - vertSpeed)
      if (tryMove(pos.x, newY)) pos.y = newY
    } else if (s && !w) {
      nextAnim = isArcade ? 'walkL' : walkPrefix + 'down'
      const vertSpeed = isArcade ? arcadeVertSpeed : moveSpeed
      const newY = Math.min(maxY, pos.y + vertSpeed)
      if (tryMove(pos.x, newY)) pos.y = newY
    } else if (a && !d) {
      nextAnim = isArcade ? 'runL' : walkPrefix + 'L'
      facingRef.current = 1
      const horiSpeed = isArcade ? arcadeHoriSpeed : moveSpeed
      const newX = Math.max(0, pos.x - horiSpeed)
      if (tryMove(newX, pos.y)) pos.x = newX
    } else if (d && !a) {
      nextAnim = isArcade ? 'runL' : walkPrefix + 'L'
      facingRef.current = -1
      const horiSpeed = isArcade ? arcadeHoriSpeed : moveSpeed
      const newX = Math.min(aw - CHAR_W, pos.x + horiSpeed)
      if (tryMove(newX, pos.y)) pos.x = newX
    } else {
      nextAnim = facing === 1 ? 'idleL' : 'idledown'
    }

    let useAnim = anim
    if (nextAnim !== anim.name) {
      useAnim = { name: nextAnim, frameIdx: 0, accum: 0 }
      animRef.current = useAnim
    }

    const aDef = ANIMS.find((x) => x.name === useAnim.name) || ANIMS.find((x) => x.name === 'idledown')!
    const frameKey = aDef.frames[useAnim.frameIdx % aDef.frames.length]
    const frameCanvas = frameCanvases.get(frameKey)

    ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0)
    const bgImg = gameImages.current?.background
    if (bgImg && bgImg.width > 0) {
      const fitScale = Math.min(aw / bgImg.width, ah / bgImg.height)
      const scale = isArcade ? fitScale * ARCADE_BG_SCALE : fitScale
      const drawW = bgImg.width * scale
      const drawH = bgImg.height * scale
      const dx = (aw - drawW) / 2
      const dy = (ah - drawH) / 2
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, aw, ah)
      ctx.drawImage(bgImg, 0, 0, bgImg.width, bgImg.height, dx, dy, drawW, drawH)
    } else {
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, aw, ah)
      ctx.fillStyle = '#16213e'
      for (let gy = 0; gy < ah; gy += 32) {
        for (let gx = 0; gx < aw; gx += 32) {
          if ((gx / 32 + gy / 32) % 2 === 0) ctx.fillRect(gx, gy, 32, 32)
        }
      }
    }

    // 街机模式: 怪物生成与更新 (在背景后渲染)
    if (isArcade && zombieCanvasRef.current.length > 0 && zombie2CanvasRef.current.length > 0 && zombie3CanvasRef.current.length > 0 && zombie4CanvasRef.current.length > 0) {
      // 生成新怪物 (每2-4秒一个)
      monsterSpawnTimerRef.current -= dt
      if (monsterSpawnTimerRef.current <= 0) {
        const fromRight = Math.random() > 0.5
        // 随机选择僵尸类型 (0, 1, 2, 3) 每种25%概率
        const rand = Math.random()
        const monsterType = rand < 0.25 ? 0 : rand < 0.5 ? 1 : rand < 0.75 ? 2 : 3
        // 玩家左上角Y范围是 230-272, 脚底Y = 左上角Y + 42 = 272-314
        // 僵尸脚底Y应该与玩家脚底Y在同一范围: 272-314
        const playerTopY = ARCADE_WALK_MIN_Y + Math.random() * (ARCADE_WALK_MAX_Y - ARCADE_WALK_MIN_Y)
        const feetY = playerTopY + 42 // 与玩家脚底Y对齐
        // m.x 存储为中心X, m.y 存储为脚底Y坐标
        monstersRef.current.push({
          x: fromRight ? arenaW + ZOMBIE_DISPLAY_W / 2 : -ZOMBIE_DISPLAY_W / 2,
          y: feetY,
          facing: fromRight ? -1 : 1,
          frameIdx: 0,
          accum: 0,
          speed: 0.3 + Math.random() * 0.2, // 0.3-0.5 移动速度
          type: monsterType,
        })
        monsterSpawnTimerRef.current = 2 + Math.random() * 2 // 2-4秒
      }

      // 更新怪物
      monstersRef.current = monstersRef.current.map(source => {
        const m = {...source}
        m.x += m.facing * m.speed
        // 动画更新 (根据类型使用不同帧数)
        m.accum += 8 * dt // 8fps 动画速度
        const frameCount = m.type === 0 ? ZOMBIE_FRAMES : m.type === 1 ? ZOMBIE2_FRAMES : m.type === 2 ? ZOMBIE3_FRAMES : ZOMBIE4_FRAMES
        while (m.accum >= 1) {
          m.accum -= 1
          m.frameIdx = (m.frameIdx + 1) % frameCount
        }
        return m
      })
      // 移除超出边界的怪物 (m.x 是中心X)
      monstersRef.current = monstersRef.current.filter(
        (m) => m.x > -ZOMBIE_DISPLAY_W && m.x < arenaW + ZOMBIE_DISPLAY_W
      )
    }

    // 按Y坐标深度排序渲染所有实体 (玩家 + 怪物)
    type Entity = { type: 'player' | 'zombie'; y: number; render: () => void }
    const entities: Entity[] = []

    // 添加玩家
    if (frameCanvas) {
      entities.push({
        type: 'player',
        y: pos.y + frameCanvas.height,
        render: () => {
          const feetX = pos.x + frameCanvas.width / 2
          const feetY = pos.y + frameCanvas.height
          const shadowTex = getShadowTexture()
          const sw = shadowTex.width
          const sh = shadowTex.height
          const scale = SHADOW_SCALE
          ctx.save()
          ctx.translate(feetX, feetY + SHADOW_OFFSET_Y)
          ctx.scale(scale, scale)
          ctx.translate(-sw / 2, -sh / 2)
          ctx.drawImage(shadowTex, 0, 0)
          ctx.restore()

          ctx.save()
          ctx.translate(pos.x + frameCanvas.width / 2, pos.y + frameCanvas.height)
          ctx.scale(facingRef.current, 1)
          ctx.translate(-frameCanvas.width / 2, -frameCanvas.height)
          ctx.drawImage(frameCanvas, 0, 0)
          ctx.restore()
        }
      })
    }

    // 添加僵尸
    if (isArcade && zombieCanvasRef.current.length > 0 && zombie2CanvasRef.current.length > 0 && zombie3CanvasRef.current.length > 0 && zombie4CanvasRef.current.length > 0) {
      for (const m of monstersRef.current) {
        entities.push({
          type: 'zombie',
          y: m.y, // m.y 已经是脚底Y坐标
          render: () => {
            // 根据类型选择画布数组 (0=类型1, 1=类型2, 2=类型3, 3=类型4)
            const zombies = m.type === 0 ? zombieCanvasRef.current : m.type === 1 ? zombie2CanvasRef.current : m.type === 2 ? zombie3CanvasRef.current : zombie4CanvasRef.current
            const frame = zombies[m.frameIdx]
            if (!frame) return
            // m.x 是僵尸中心X, m.y 是脚底Y坐标
            const feetX = m.x
            const feetY = m.y
            // 阴影 (脚底中心)
            const shadowTex = getShadowTexture()
            const sx = feetX - (shadowTex.width * SHADOW_SCALE) / 2
            const sy = feetY + SHADOW_OFFSET_Y - (shadowTex.height * SHADOW_SCALE) / 2
            ctx.drawImage(shadowTex, 0, 0, shadowTex.width, shadowTex.height, sx, sy, shadowTex.width * SHADOW_SCALE, shadowTex.height * SHADOW_SCALE)
            // 僵尸 (缩放到0.7倍, 脚底中心对齐)
            const drawW = ZOMBIE_DISPLAY_W
            const drawH = ZOMBIE_DISPLAY_H
            const dx = feetX - drawW / 2 // 左侧X
            const dy = feetY - drawH // 顶部Y (脚底往上)
            // 水平翻转时, 从右侧开始绘制
            if (m.facing === -1) {
              ctx.save()
              ctx.translate(feetX + drawW / 2, feetY)
              ctx.scale(-1, 1)
              ctx.drawImage(frame, 0, 0, ZOMBIE_FRAME_W, ZOMBIE_FRAME_H, 0, -drawH, drawW, drawH)
              ctx.restore()
            } else {
              ctx.drawImage(frame, 0, 0, ZOMBIE_FRAME_W, ZOMBIE_FRAME_H, dx, dy, drawW, drawH)
            }
          }
        })
      }
    }

    // 按Y坐标从小到大排序 (Y小的在后, Y大的在前)
    entities.sort((a, b) => a.y - b.y)

    // 渲染所有实体
    for (const entity of entities) {
      entity.render()
    }

    const fgImg = gameImages.current?.foreground
    if (fgImg && fgImg.width > 0) {
      const fitScale = Math.min(aw / fgImg.width, ah / fgImg.height)
      const scale = isArcade ? fitScale * ARCADE_BG_SCALE : fitScale
      const drawW = fgImg.width * scale
      const drawH = fgImg.height * scale
      const dx = (aw - drawW) / 2
      const dy = (ah - drawH) / 2
      ctx.drawImage(fgImg, 0, 0, fgImg.width, fgImg.height, dx, dy, drawW, drawH)
    }

    if (obstacleEditModeRef.current) {
      ctx.fillStyle = 'rgba(200, 80, 80, 0.4)'
      ctx.strokeStyle = 'rgba(200, 80, 80, 0.9)'
      ctx.lineWidth = 1
      for (const o of obstaclesRef.current) {
        ctx.fillRect(o.x, o.y, o.w, o.h)
        ctx.strokeRect(o.x, o.y, o.w, o.h)
      }
      const dr = dragRectRef.current
      if (dr) {
        const rx = Math.min(dr.x1, dr.x2)
        const ry = Math.min(dr.y1, dr.y2)
        const rw = Math.max(4, Math.abs(dr.x2 - dr.x1))
        const rh = Math.max(4, Math.abs(dr.y2 - dr.y1))
        ctx.fillStyle = 'rgba(255, 150, 150, 0.5)'
        ctx.strokeStyle = 'rgba(255, 100, 100, 1)'
        ctx.setLineDash([4, 4])
        ctx.fillRect(rx, ry, rw, rh)
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.setLineDash([])
      }
    }

    const animSpeedMul = isArcade && useAnim.name === 'walkL' && (w || s) ? 1.5 : 1
    useAnim.accum += aDef.speed * animSpeedMul * dt
    while (useAnim.accum >= 1) {
      useAnim.accum -= 1
      useAnim.frameIdx += 1
      if (!aDef.loop && useAnim.frameIdx >= aDef.frames.length) {
        useAnim.frameIdx = aDef.frames.length - 1
        useAnim.accum = 0
        break
      } else {
        useAnim.frameIdx %= aDef.frames.length
      }
    }
    animRef.current = useAnim
  }, [ready, frameCanvases, arenaW, arenaH, isArcade])

  useEffect(() => {
    lastTimeRef.current = 0
    rafRef.current = requestAnimationFrame(gameLoop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [gameLoop])

  return (
    <ControlDocumentSurface model={model} beforeAction={beforeAction} pending={pending} onInteraction={onInteraction}>
    <ConfigProvider theme={{inherit: false, algorithm: theme.darkAlgorithm, token: {colorPrimary: '#c45c3e'}}}>
    <div
      className="control-test-scene"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10,
        background: '#0f0f1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        {onBack && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            {t('backToHome')}
          </Button>
        )}
        <StashDropZone onStashDrop={(f) => setSpriteFile(f)}>
          <div style={{ width: 200 }}>
            <Dragger
              accept={IMAGE_ACCEPT.join(',')}
              maxCount={1}
              fileList={spriteFile ? [{ uid: '1', name: spriteFile.name } as UploadFile] : []}
              beforeUpload={(f) => {
                setSpriteFile(f)
                return false
              }}
              onRemove={() => setSpriteFile(null)}
              style={{ padding: '8px' }}
            >
              <p className="ant-upload-text" style={{ margin: 0, fontSize: 12 }}>
                {t('controlTestUploadHint')}
              </p>
              <p className="ant-upload-hint" style={{ margin: 0, fontSize: 11 }}>
                {t('controlTestUploadNote')}
              </p>
            </Dragger>
          </div>
        </StashDropZone>
        <StashDropZone onStashDrop={(f) => setBgFile(f)}>
          <div style={{ width: 200 }}>
            <Dragger
              accept={IMAGE_ACCEPT.join(',')}
              maxCount={1}
              fileList={bgFile ? [{ uid: 'bg', name: bgFile.name } as UploadFile] : []}
              beforeUpload={(f) => {
                setBgFile(f)
                return false
              }}
              onRemove={() => setBgFile(null)}
              style={{ padding: '8px' }}
            >
              <p className="ant-upload-text" style={{ margin: 0, fontSize: 12 }}>
                {t('controlTestBgUploadHint')}
              </p>
            </Dragger>
          </div>
        </StashDropZone>
        {isArcade && (
          <StashDropZone onStashDrop={(f) => setFgFile(f)}>
            <div style={{ width: 200 }}>
              <Dragger
                accept={IMAGE_ACCEPT.join(',')}
                maxCount={1}
                fileList={fgFile ? [{ uid: 'fg', name: fgFile.name } as UploadFile] : []}
                beforeUpload={(f) => {
                  setFgFile(f)
                  return false
                }}
                onRemove={() => setFgFile(null)}
                style={{ padding: '8px' }}
              >
                <p className="ant-upload-text" style={{ margin: 0, fontSize: 12 }}>
                  {t('controlTestFgUploadHint')}
                </p>
              </Dragger>
            </div>
          </StashDropZone>
        )}
        <div style={{ width: 200 }}>
          <Dragger
            accept={AUDIO_ACCEPT.join(',')}
            maxCount={1}
            fileList={musicFile ? [{ uid: 'music', name: musicFile.name } as UploadFile] : []}
            beforeUpload={(f) => {
              setMusicFile(f)
              return false
            }}
            onRemove={() => setMusicFile(null)}
            style={{ padding: '8px' }}
          >
            <p className="ant-upload-text" style={{ margin: 0, fontSize: 12 }}>
              {t('controlTestMusicUploadHint')}
            </p>
          </Dragger>
        </div>
        <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              aria-label={t('controlTestObstacleEdit')}
              checked={obstacleEditMode}
              onChange={setObstacleEditMode}
              size="small"
            />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
              {t('controlTestObstacleEdit')}
            </span>
          </div>
          {obstacleEditMode && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t('controlTestObstacleEditHint')}
              </Typography.Text>
              {obstacles.length > 0 && (
                <Button
                  size="small"
                  danger
                  onClick={() => setObstacles([])}
                >
                  {t('controlTestObstacleClear')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <div
          style={{
            padding: 16,
            background: '#1a1a2e',
            borderRadius: 8,
            border: '1px solid #333',
          }}
        >
          <div
            ref={canvasWrapperRef}
            style={{
              position: 'relative',
              cursor: obstacleEditMode ? 'crosshair' : 'default',
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label={tx('游戏测试场景', 'Game test scene', 'ゲームテストシーン')}
              onMouseDown={() => canvasRef.current?.focus()}
              onBlur={() => keysRef.current.clear()}
              width={arenaW * PIXEL_SCALE}
              height={arenaH * PIXEL_SCALE}
              style={{
                display: 'block',
                imageRendering: 'pixelated',
                maxWidth: 'calc(100vw - 48px)',
                maxHeight: 'calc(100vh - 200px)',
              }}
            />
          </div>
        </div>
      </div>
      <div style={{position: 'absolute', bottom: 48, left: 64, color: '#fff', maxWidth: 'calc(100% - 80px)'}}>
        <div role="status" aria-live="off" aria-label={tx('游戏状态', 'Game status', 'ゲーム状態')}>
          {tx('位置', 'Position', '位置')} {live.x.toFixed(2)}, {live.y.toFixed(2)} · <span data-animation={live.action}>{actionText}</span> · {tx('碰撞区', 'Obstacles', '障害物')} {obstacles.length} · {tx('怪物', 'Monsters', 'モンスター')} {live.monsters}
        </div>
        <Button onClick={() => set('spawn', {x: posRef.current.x, y: posRef.current.y, facing: facingRef.current as -1 | 1})}>{tx('将当前位置设为起点', 'Use current position as spawn', '現在位置を開始地点にする')}</Button>
        <Button onClick={() => {posRef.current = {x: draft.spawn.x, y: draft.spawn.y}; keysRef.current.clear(); monstersRef.current = []}}>{tx('重置角色', 'Reset player', 'キャラクターをリセット')}</Button>
        <Switch aria-label={tx('播放背景音乐', 'Play background music', 'BGM を再生')} checked={draft.musicOn} onChange={v => set('musicOn', v)}/>
        <span role="status" aria-live="off" aria-label={tx('背景音乐状态', 'Background music status', 'BGM 状態')}>
          {' · '}{!draft.musicOn ? tx('音乐已关闭', 'Music off', 'BGM オフ') : decoded.loading ? tx('音乐加载中', 'Music loading', 'BGM 読み込み中') : audioState === 'playing' ? tx('音乐播放中', 'Music playing', 'BGM 再生中') : audioState === 'failed' ? tx('音乐未能播放', 'Music could not play', 'BGM を再生できません') : tx('音乐等待播放', 'Music waiting', 'BGM 待機中')}
        </span>
        {!!audioError && draft.musicOn && !decoded.loading && !decoded.error && <Alert type="warning" title={tx('音乐未能自动播放，请点击播放；仍失败时请更换受支持的文件。', 'Music could not start. Click Play music, or choose another supported file if it fails.', '音楽を開始できません。再生を押すか、対応する別のファイルを選択してください。')} action={<Button onClick={() => {
          const audio = audioRef.current
          if (audio) void audio.play().catch(() => { if (audioRef.current === audio) setAudioError('CONTROL_AUDIO_PLAY_FAILED') })
        }}>{tx('播放音乐', 'Play music', '音楽を再生')}</Button>}/>}
        {decoded.loading && <Alert type="info" title={tx('正在加载场景素材', 'Loading scene assets', 'シーン素材を読み込み中')} action={<Button onClick={decoded.cancel}>{tx('取消加载', 'Cancel loading', '読み込みを取消')}</Button>}/>}
        {decoded.error && <Alert type="error" title={imageError(decoded.error)} action={<Button onClick={decoded.retry}>{tx('重试加载', 'Retry loading', '再読み込み')}</Button>}/>}
        <div>{tx('点击场景后使用键盘；场景设置与起点可保存到项目。', 'Click the scene to use game keys. Scene settings and spawn can be saved to the project.', 'シーンをクリックしてキー操作。設定と開始地点をプロジェクトに保存できます。')}</div>
      </div>
      <Text
        type="secondary"
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        {t('controlTestKeys')}
      </Text>
    </div>
    </ConfigProvider>
    </ControlDocumentSurface>
  )
}

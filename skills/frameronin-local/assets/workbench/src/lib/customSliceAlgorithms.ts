// Mature algorithms copied from the frozen RoninProCustomSlice reference.
// SliceImage carries the decoded host image without introducing an extra source raster.
export type SliceImage={source:CanvasImageSource;naturalWidth:number;naturalHeight:number}

/** 找出完全透明的行索引 */
export function findTransparentRows(data: Uint8ClampedArray, width: number, height: number): number[] {
  const rows: number[] = []
  for (let y = 0; y < height; y++) {
    let allTransparent = true
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] !== 0) {
        allTransparent = false
        break
      }
    }
    if (allTransparent) rows.push(y)
  }
  return rows
}

/** 找出完全透明的列索引（在 y0..y1 范围内） */
export function findTransparentCols(
  data: Uint8ClampedArray,
  width: number,
  y0: number,
  y1: number
): number[] {
  const cols: number[] = []
  for (let x = 0; x < width; x++) {
    let allTransparent = true
    for (let y = y0; y < y1; y++) {
      if (data[(y * width + x) * 4 + 3] !== 0) {
        allTransparent = false
        break
      }
    }
    if (allTransparent) cols.push(x)
  }
  return cols
}

export function getRuns(arr: number[]): [number, number][] {
  if (arr.length === 0) return []
  const runs: [number, number][] = []
  let runStart = arr[0]!
  let runEnd = runStart
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === runEnd + 1) {
      runEnd = arr[i]!
    } else {
      runs.push([runStart, runEnd])
      runStart = arr[i]!
      runEnd = runStart
    }
  }
  runs.push([runStart, runEnd])
  return runs
}

export function gapsFromRuns(runs: [number, number][], total: number): [number, number][] {
  if (runs.length === 0) return [[0, total - 1]]
  const regions: [number, number][] = []
  regions.push([0, runs[0]![0] - 1])
  for (let i = 0; i < runs.length - 1; i++) {
    regions.push([runs[i]![1] + 1, runs[i + 1]![0] - 1])
  }
  regions.push([runs[runs.length - 1]![1] + 1, total - 1])
  return regions.filter(([a, b]) => a <= b)
}

/** 基于透明行列检测，返回建议的 cols × rows（用于均匀切分） */
export function detectAutoSplit(imageData: ImageData): { cols: number; rows: number } {
  const { data, width, height } = imageData
  const transparentRows = findTransparentRows(data, width, height)
  const rowRuns = getRuns(transparentRows)
  const rowRegions = gapsFromRuns(rowRuns, height)
  const transparentCols = findTransparentCols(data, width, 0, height)
  const colRuns = getRuns(transparentCols)
  const colRegions = gapsFromRuns(colRuns, width)
  const rows = Math.max(1, rowRegions.length)
  const cols = Math.max(1, colRegions.length)
  return { cols, rows }
}

export interface Region {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 一行像素 Alpha 之和；越小表示该横线越像「缝」、越不容易切断肢体 */
export function rowAlphaSum(data: Uint8ClampedArray, width: number, y: number): number {
  let s = 0
  const o = y * width * 4
  for (let x = 0; x < width; x++) {
    s += data[o + x * 4 + 3]!
  }
  return s
}

export function colAlphaSum(data: Uint8ClampedArray, width: number, height: number, x: number): number {
  let s = 0
  for (let y = 0; y < height; y++) {
    s += data[(y * width + x) * 4 + 3]!
  }
  return s
}

/**
 * L7：在相邻两格名义分界附近做小范围搜索，取整行/整列 Alpha 和最小的切线，
 * 常用于手/尾巴伸入邻格时，避免均分线正好劈在笔画中间。
 */
export function uniformRowStarts(fullH: number, rowsNum: number): number[] {
  return Array.from({ length: rowsNum + 1 }, (_, i) =>
    i === rowsNum ? fullH : Math.floor((i * fullH) / rowsNum)
  )
}

export function uniformColStarts(fullW: number, colsNum: number): number[] {
  return Array.from({ length: colsNum + 1 }, (_, j) =>
    j === colsNum ? fullW : Math.floor((j * fullW) / colsNum)
  )
}

export function adjustRowBoundariesL7(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rowsNum: number,
  bandRatio = 0.25
): number[] {
  const starts: number[] = []
  for (let i = 0; i <= rowsNum; i++) {
    starts.push(Math.floor((i * height) / rowsNum))
  }
  starts[0] = 0
  starts[rowsNum] = height

  for (let i = 1; i < rowsNum; i++) {
    const yNom = starts[i]!
    const prev = starts[i - 1]!
    const next = starts[i + 1]!
    const span = next - prev
    const band = Math.max(4, Math.min(64, Math.floor(span * bandRatio)))
    const yMin = Math.max(prev + 1, yNom - band)
    const yMax = Math.min(next - 1, yNom + band)
    if (yMin >= yMax) continue
    let bestY = yNom
    let bestCost = Infinity
    for (let y = yMin; y <= yMax; y++) {
      const c = rowAlphaSum(data, width, y)
      if (c < bestCost || (c === bestCost && Math.abs(y - yNom) < Math.abs(bestY - yNom))) {
        bestCost = c
        bestY = y
      }
    }
    starts[i] = bestY
  }
  return starts
}

export function adjustColBoundariesL7(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  colsNum: number,
  bandRatio = 0.25
): number[] {
  const starts: number[] = []
  for (let j = 0; j <= colsNum; j++) {
    starts.push(Math.floor((j * width) / colsNum))
  }
  starts[0] = 0
  starts[colsNum] = width

  for (let j = 1; j < colsNum; j++) {
    const xNom = starts[j]!
    const prev = starts[j - 1]!
    const next = starts[j + 1]!
    const span = next - prev
    const band = Math.max(2, Math.min(64, Math.floor(span * bandRatio)))
    const xMin = Math.max(prev + 1, xNom - band)
    const xMax = Math.min(next - 1, xNom + band)
    if (xMin >= xMax) continue
    let bestX = xNom
    let bestCost = Infinity
    for (let x = xMin; x <= xMax; x++) {
      const c = colAlphaSum(data, width, height, x)
      if (c < bestCost || (c === bestCost && Math.abs(x - xNom) < Math.abs(bestX - xNom))) {
        bestCost = c
        bestX = x
      }
    }
    starts[j] = bestX
  }
  return starts
}

/** 按已算好的横纵切线切分 */
export function splitSpriteSheetWithStarts(
  img: SliceImage,
  colStarts: number[],
  rowStarts: number[]
): HTMLCanvasElement[] {
  const colsNum = colStarts.length - 1
  const rowsNum = rowStarts.length - 1
  const results: HTMLCanvasElement[] = []
  for (let row = 0; row < rowsNum; row++) {
    for (let col = 0; col < colsNum; col++) {
      const sx = colStarts[col]!
      const ex = colStarts[col + 1]!
      const sy = rowStarts[row]!
      const ey = rowStarts[row + 1]!
      const w = Math.max(1, ex - sx)
      const h = Math.max(1, ey - sy)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(img.source, sx, sy, w, h, 0, 0, w, h)
      results.push(c)
    }
  }
  return results
}

/** 同一行带内所有竖线同时加同一 offset 时，offset 的可行区间（像素，整数） */
export function bandColOffsetBounds(colStarts: number[]): { min: number; max: number } {
  const n = colStarts.length
  if (n < 2) return { min: 0, max: 0 }
  let lo = -Infinity
  let hi = Infinity
  for (let j = 1; j < n - 1; j++) {
    lo = Math.max(lo, colStarts[j - 1]! + 1 - colStarts[j]!)
    hi = Math.min(hi, colStarts[j + 1]! - 1 - colStarts[j]!)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return { min: 0, max: 0 }
  return { min: Math.ceil(lo), max: Math.floor(hi) }
}

export function segColXWithBandOff(
  bandOff: number,
  j: number,
  colStarts: number[],
  fullW: number
): number {
  if (j <= 0) return 0
  if (j >= colStarts.length - 1) return fullW
  return colStarts[j]! + bandOff
}

/**
 * 按行带竖线整体偏移（锯齿）：第 r 行带内竖线 x = colStarts[j] + bandColOffset[r]，
 * 行带之间可在横缝处形成阶梯错位。
 */
export function splitSpriteSheetWithBandOffsets(
  img: SliceImage,
  colStarts: number[],
  rowStarts: number[],
  bandColOffset: number[]
): HTMLCanvasElement[] {
  const colsNum = colStarts.length - 1
  const rowsNum = rowStarts.length - 1
  if (bandColOffset.length !== rowsNum) {
    throw new Error('bandColOffset length must equal row count')
  }
  const fullW = img.naturalWidth
  const results: HTMLCanvasElement[] = []
  for (let row = 0; row < rowsNum; row++) {
    const off = bandColOffset[row] ?? 0
    for (let col = 0; col < colsNum; col++) {
      const sx = segColXWithBandOff(off, col, colStarts, fullW)
      const ex = segColXWithBandOff(off, col + 1, colStarts, fullW)
      const sy = rowStarts[row]!
      const ey = rowStarts[row + 1]!
      const w = Math.max(1, ex - sx)
      const h = Math.max(1, ey - sy)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(img.source, sx, sy, w, h, 0, 0, w, h)
      results.push(c)
    }
  }
  return results
}

/** 单行条带：竖线先沿名义 x 下到拐点 y=L，再水平偏移 dx，再垂直到底；每格为七边形/梯形裁切 */
export function buildStripCellVertices(
  xL: number,
  xR: number,
  L: number,
  H: number,
  dx: number
): [number, number][] {
  const Lc = Math.max(0, Math.min(H, Math.floor(L)))
  const d = Math.round(dx)
  if (Lc <= 0) {
    return [
      [xL, 0],
      [xR, 0],
      [xR + d, H],
      [xL + d, H],
    ]
  }
  if (Lc >= H) {
    return [
      [xL, 0],
      [xR, 0],
      [xR, H],
      [xL, H],
    ]
  }
  return [
    [xL, 0],
    [xR, 0],
    [xR, Lc],
    [xR + d, Lc],
    [xR + d, H],
    [xL + d, H],
    [xL, Lc],
  ]
}

/** 单行折线：水平偏移上限（避免格宽被挤没） */
export function maxPolyDeltaX(colStarts: number[], fullW: number): number {
  const n = colStarts.length
  if (n < 2) return 1
  let minW = Infinity
  for (let c = 0; c < n - 1; c++) {
    minW = Math.min(minW, colStarts[c + 1]! - colStarts[c]!)
  }
  if (!Number.isFinite(minW) || minW < 1) return 1
  return Math.max(1, Math.min(Math.floor(fullW / 2) - 1, Math.floor(minW) - 1))
}

export function extractPolygonFromImage(img: SliceImage, verts: [number, number][]): HTMLCanvasElement {
  const xs = verts.map((v) => v[0])
  const ys = verts.map((v) => v[1])
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(img.naturalWidth, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(img.naturalHeight, Math.ceil(Math.max(...ys)))
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(verts[0]![0] - minX, verts[0]![1] - minY)
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(verts[i]![0] - minX, verts[i]![1] - minY)
  }
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img.source, -minX, -minY)
  ctx.restore()
  return c
}

/**
 * L7 折线格裁切：拐点在条带内部时，格 = 上下两个轴对齐矩形，用两次 drawImage 1:1 拷贝，
 * 避免 polygon clip 在斜边上的抗锯齿导致拐点下方像素发糊。
 */
export function extractStripCellCrisp(
  img: SliceImage,
  xL: number,
  xR: number,
  bendY: number,
  fullH: number,
  deltaX: number
): HTMLCanvasElement {
  const H = fullH
  const Lc = Math.max(0, Math.min(H, Math.floor(bendY)))
  const d = Math.round(deltaX)
  const sw = xR - xL
  if (sw < 1) {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = Math.max(1, H)
    return c
  }

  if (Lc >= H) {
    const minX = Math.max(0, xL)
    const w = Math.max(1, Math.min(img.naturalWidth, xR) - minX)
    const c = document.createElement('canvas')
    c.width = w
    c.height = H
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img.source, xL, 0, sw, H, xL - minX, 0, sw, H)
    return c
  }

  if (Lc <= 0) {
    const verts = buildStripCellVertices(xL, xR, bendY, H, deltaX)
    return extractPolygonFromImage(img, verts)
  }

  const minX = Math.max(0, Math.min(xL, xL + d, xR, xR + d))
  const maxX = Math.min(img.naturalWidth, Math.max(xL, xL + d, xR, xR + d))
  const w = Math.max(1, maxX - minX)
  const c = document.createElement('canvas')
  c.width = w
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const sh1 = Lc
  const sh2 = H - Lc
  ctx.drawImage(img.source, xL, 0, sw, sh1, xL - minX, 0, sw, sh1)
  ctx.drawImage(img.source, xL + d, Lc, sw, sh2, xL + d - minX, Lc, sw, sh2)
  return c
}

export function splitSpriteSheetSingleRowPolyline(
  img: SliceImage,
  colStarts: number[],
  fullH: number,
  bendY: number,
  deltaX: number
): HTMLCanvasElement[] {
  const colsNum = colStarts.length - 1
  const H = fullH
  const results: HTMLCanvasElement[] = []
  for (let col = 0; col < colsNum; col++) {
    const xL = colStarts[col]!
    const xR = colStarts[col + 1]!
    results.push(extractStripCellCrisp(img, xL, xR, bendY, H, deltaX))
  }
  return results
}

/** 网格均匀切分；可选 L7 在名义接缝附近优化横纵切线 */
export function splitSpriteSheet(
  img: SliceImage,
  cols: number,
  rows: number,
  l7?: ImageData | null,
  bandRatio = 0.25
): HTMLCanvasElement[] {
  const fullW = img.naturalWidth
  const fullH = img.naturalHeight
  const colsNum = Math.max(1, Math.floor(cols))
  const rowsNum = Math.max(1, Math.floor(rows))

  let colStarts: number[]
  let rowStarts: number[]
  if (
    l7 &&
    l7.width === fullW &&
    l7.height === fullH &&
    (rowsNum > 1 || colsNum > 1)
  ) {
    rowStarts = adjustRowBoundariesL7(l7.data, fullW, fullH, rowsNum, bandRatio)
    colStarts = adjustColBoundariesL7(l7.data, fullW, fullH, colsNum, bandRatio)
  } else {
    rowStarts = uniformRowStarts(fullH, rowsNum)
    colStarts = uniformColStarts(fullW, colsNum)
  }
  return splitSpriteSheetWithStarts(img, colStarts, rowStarts)
}

/** 按自定义区域切分 */
export function splitByRegions(img: SliceImage, regions: Region[]): HTMLCanvasElement[] {
  const results: HTMLCanvasElement[] = []
  const fullW = img.naturalWidth
  const fullH = img.naturalHeight

  for (const r of regions) {
    const x = Math.max(0, Math.floor(r.x))
    const y = Math.max(0, Math.floor(r.y))
    const w = Math.max(1, Math.min(Math.floor(r.w), fullW - x))
    const h = Math.max(1, Math.min(Math.floor(r.h), fullH - y))

    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(img.source, x, y, w, h, 0, 0, w, h)
    results.push(c)
  }
  return results
}


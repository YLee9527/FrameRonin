/** Original pixel editor algorithms, executed by the controlled local runtime. */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let x = r / 255, y = g / 255, z = b / 255
  x = x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92
  y = y > 0.04045 ? ((y + 0.055) / 1.055) ** 2.4 : y / 12.92
  z = z > 0.04045 ? ((z + 0.055) / 1.055) ** 2.4 : z / 12.92
  x *= 100
  y *= 100
  z *= 100
  const l = 116 * f(y / 100) - 16
  const a = 500 * (f(x / 95.047) - f(y / 100))
  const b_ = 200 * (f(y / 100) - f(z / 108.883))
  return [l, a, b_]
}
function f(t: number): number {
  return t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116
}

/** 与上方 rgbToLab 同一套线性 RGB → Lab 定义的可逆变换 */
function fInv(ft: number): number {
  const cube = ft * ft * ft
  return cube > 0.008856 ? cube : (ft - 16 / 116) / 7.787
}

function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const rLin = fInv(fx) * (95.047 / 100)
  const gLin = fInv(fy)
  const bLin = fInv(fz) * (108.883 / 100)
  const toSrgbByte = (u: number) => {
    const c = Math.max(0, Math.min(1, u))
    const x = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(x * 255)))
  }
  return [toSrgbByte(rLin), toSrgbByte(gLin), toSrgbByte(bLin)]
}

/** 在 LAB 空间按网格对齐相近颜色；strength 0～100，越大合并越强 */
function applyMergeNearbyLab(imageData: ImageData, strength: number): void {
  if (strength <= 0) return
  const t = strength / 100
  const stepL = 2 + t * 26
  const stepA = 1.5 + t * 14
  const stepB = 1.5 + t * 14
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 128) continue
    let [L, la, lb] = rgbToLab(d[i]!, d[i + 1]!, d[i + 2]!)
    L = Math.round(L / stepL) * stepL
    la = Math.round(la / stepA) * stepA
    lb = Math.round(lb / stepB) * stepB
    const [r, g, b] = labToRgb(L, la, lb)
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
}

interface Color16Options {
  method: 'rgb' | 'lab'
  dither: boolean
}

/** 中位切分法生成 16 色调色板，再用最近邻映射输出。支持 LAB 感知距离与抖动。 */
export function reduceTo16Colors(img: HTMLImageElement, opts: Color16Options): Promise<Blob> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h)
  const pixels: [number, number, number][] = []
  for (let i = 0; i < data.data.length; i += 4) {
    const a = data.data[i + 3]
    if (a < 128) continue
    pixels.push([data.data[i]!, data.data[i + 1]!, data.data[i + 2]!])
  }
  if (pixels.length === 0) pixels.push([255, 255, 255])

  const maxPixels = 10000
  const sampled = pixels.length > maxPixels
    ? pixels.filter((_, i) => i % Math.ceil(pixels.length / maxPixels) === 0)
    : pixels

  let boxes: [number, number, number][][] = [[...sampled]]
  while (boxes.length < 16) {
    let maxRange = -1
    let splitIdx = 0
    let channel = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!
      if (box.length <= 1) continue
      const r1 = Math.max(...box.map((p) => p[0])), r0 = Math.min(...box.map((p) => p[0]))
      const g1 = Math.max(...box.map((p) => p[1])), g0 = Math.min(...box.map((p) => p[1]))
      const b1 = Math.max(...box.map((p) => p[2])), b0 = Math.min(...box.map((p) => p[2]))
      const dr = r1 - r0, dg = g1 - g0, db = b1 - b0
      const max = Math.max(dr, dg, db)
      if (max > maxRange) {
        maxRange = max
        splitIdx = i
        channel = dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2
      }
    }
    const box = boxes[splitIdx]!
    if (box.length <= 1) break
    box.sort((a, b) => a[channel] - b[channel])
    const mid = Math.floor(box.length / 2)
    const left = box.slice(0, mid)
    const right = box.slice(mid)
    boxes = [...boxes.slice(0, splitIdx), left, right, ...boxes.slice(splitIdx + 1)]
  }
  const palette: [number, number, number][] = boxes.map((box) => {
    const r = Math.round(box.reduce((s, p) => s + p[0], 0) / box.length)
    const g = Math.round(box.reduce((s, p) => s + p[1], 0) / box.length)
    const b = Math.round(box.reduce((s, p) => s + p[2], 0) / box.length)
    return [r, g, b]
  })
  while (palette.length < 16) palette.push([0, 0, 0])

  const paletteLab = opts.method === 'lab' ? palette.map((p) => rgbToLab(p[0], p[1], p[2])) : null

  function nearest([r, g, b]: [number, number, number]): [number, number, number] {
    let best = palette[0]!
    let bestD = Infinity
    if (opts.method === 'lab' && paletteLab) {
      const [l, a, b_] = rgbToLab(r, g, b)
      for (let i = 0; i < palette.length; i++) {
        const [pl, pa, pb] = paletteLab[i]!
        const d = (l - pl) ** 2 + (a - pa) ** 2 + (b_ - pb) ** 2
        if (d < bestD) {
          bestD = d
          best = palette[i]!
        }
      }
    } else {
      for (const p of palette) {
        const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
    }
    return best
  }

  if (opts.dither) {
    const errBuf = new Float32Array((w + 2) * (h + 2) * 3)
    const ei = (y: number, x: number, c: number) => ((y + 1) * (w + 2) + (x + 1)) * 3 + c
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const a = data.data[i + 3]!
        if (a < 128) {
          data.data[i] = 0
          data.data[i + 1] = 0
          data.data[i + 2] = 0
          data.data[i + 3] = 0
          continue
        }
        const r = Math.max(0, Math.min(255, data.data[i]! + errBuf[ei(y, x, 0)]))
        const g = Math.max(0, Math.min(255, data.data[i + 1]! + errBuf[ei(y, x, 1)]))
        const b = Math.max(0, Math.min(255, data.data[i + 2]! + errBuf[ei(y, x, 2)]))
        const [pr, pg, pb] = nearest([r, g, b])
        data.data[i] = pr
        data.data[i + 1] = pg
        data.data[i + 2] = pb
        const er = (r - pr) / 16
        const eg = (g - pg) / 16
        const eb = (b - pb) / 16
        errBuf[ei(y, x + 1, 0)] += er * 7
        errBuf[ei(y, x + 1, 1)] += eg * 7
        errBuf[ei(y, x + 1, 2)] += eb * 7
        errBuf[ei(y + 1, x - 1, 0)] += er * 3
        errBuf[ei(y + 1, x - 1, 1)] += eg * 3
        errBuf[ei(y + 1, x - 1, 2)] += eb * 3
        errBuf[ei(y + 1, x, 0)] += er * 5
        errBuf[ei(y + 1, x, 1)] += eg * 5
        errBuf[ei(y + 1, x, 2)] += eb * 5
        errBuf[ei(y + 1, x + 1, 0)] += er * 1
        errBuf[ei(y + 1, x + 1, 1)] += eg * 1
        errBuf[ei(y + 1, x + 1, 2)] += eb * 1
      }
    }
  } else {
    for (let i = 0; i < data.data.length; i += 4) {
      const a = data.data[i + 3]
      if (a < 128) {
        data.data[i] = 0
        data.data[i + 1] = 0
        data.data[i + 2] = 0
        data.data[i + 3] = 0
      } else {
        const [r, g, b] = nearest([data.data[i]!, data.data[i + 1]!, data.data[i + 2]!])
        data.data[i] = r
        data.data[i + 1] = g
        data.data[i + 2] = b
      }
    }
  }
  ctx.putImageData(data, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png')
  })
}

export function pixelateImage(img: HTMLImageElement, pixelSize: number): Promise<Blob> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const block = Math.max(1, Math.floor(pixelSize))
  const scaledW = Math.max(1, Math.floor(w / block))
  const scaledH = Math.max(1, Math.floor(h / block))

  const small = document.createElement('canvas')
  small.width = scaledW
  small.height = scaledH
  small.getContext('2d')!.drawImage(img, 0, 0, w, h, 0, 0, scaledW, scaledH)

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, scaledW, scaledH, 0, 0, w, h)
  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png')
  })
}

export function mergeNearbyColorsImage(img: HTMLImageElement, strength: number): Promise<Blob> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  applyMergeNearbyLab(imageData, strength)
  ctx.putImageData(imageData, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png')
  })
}

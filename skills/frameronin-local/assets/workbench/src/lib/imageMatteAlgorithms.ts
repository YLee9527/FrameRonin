// Original standalone ImageMatte algorithms. The dedicated Worker supplies
// bounded Canvas/WebGL adapters; GPU math is kept intact.
/** Canvas 2D 色度键，与取色使用相同像素源，避免色彩空间偏差 */
export function chromaKeyCanvas(
  img: HTMLImageElement,
  keyColor: [number, number, number],
  tolerance: number,
  smoothness: number,
  spill: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const [kr, kg, kb] = keyColor
  const thresh = (tolerance / 100) * 100
  // 过渡带需足够宽，主体边缘混合像素的 RGB 距离约 80-150
  const smooth = 50 + (smoothness / 100) * 120
  const spillStr = spill / 100

  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i]!
    const g = data.data[i + 1]!
    const b = data.data[i + 2]!
    const dr = r - kr, dg = g - kg, db = b - kb
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)

    let alpha: number
    if (dist <= thresh) {
      alpha = 0
    } else if (dist < thresh + smooth) {
      alpha = (dist - thresh) / smooth
      alpha = Math.min(1, alpha)
    } else {
      alpha = 1
    }

    // 抑色：去饱和度 + 针对绿/蓝幕的通道抑制（边缘溢色时 G/B 偏高，限制到 (R+B)/2 或 (R+G)/2）
    if (spillStr > 0 && alpha > 0) {
      const baseMask = Math.max(0, dist - thresh)
      const spillVal = Math.pow(Math.min(1, baseMask / Math.max(1, spillStr * 120)), 1.5)
      const gray = r * 0.2126 + g * 0.7152 + b * 0.0722
      const rr = gray * (1 - spillVal) + r * spillVal
      let gg = gray * (1 - spillVal) + g * spillVal
      let bb = gray * (1 - spillVal) + b * spillVal
      const strength = Math.min(1, spillStr * (1.2 - spillVal * 0.4))
      // 绿幕溢色：G 偏高，将 G 向 (R+B)/2 收紧
      if (kg >= kr && kg >= kb && g > Math.max(r, b)) {
        const limit = (rr + bb) / 2
        gg = gg - strength * (gg - limit)
      }
      // 蓝幕溢色：B 偏高，将 B 向 (R+G)/2 收紧
      if (kb >= kr && kb >= kg && b > Math.max(r, g)) {
        const limit = (rr + gg) / 2
        bb = bb - strength * (bb - limit)
      }
      data.data[i] = Math.round(Math.max(0, Math.min(255, rr)))
      data.data[i + 1] = Math.round(Math.max(0, Math.min(255, gg)))
      data.data[i + 2] = Math.round(Math.max(0, Math.min(255, bb)))
    }
    data.data[i + 3] = Math.round(alpha * 255)
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/** Canvas 2D alpha 侵蚀：3×3 取最小 alpha，去除边缘绿痕/白边 */
export function erodeAlphaOnCanvas(canvas: HTMLCanvasElement, passes: number): HTMLCanvasElement {
  if (passes <= 0) return canvas
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  let read = ctx.getImageData(0, 0, w, h)
  let write = new ImageData(new Uint8ClampedArray(read.data), w, h)
  const dx = [-1, -1, -1, 0, 0, 1, 1, 1]
  const dy = [-1, 0, 1, -1, 1, -1, 0, 1]
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        write.data[i] = read.data[i]!
        write.data[i + 1] = read.data[i + 1]!
        write.data[i + 2] = read.data[i + 2]!
        let minA = read.data[i + 3]!
        for (let k = 0; k < 8; k++) {
          const nx = x + dx[k]!
          const ny = y + dy[k]!
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            minA = Math.min(minA, read.data[(ny * w + nx) * 4 + 3]!)
          }
        }
        write.data[i + 3] = minA
      }
    }
    ;[read, write] = [write, read]
  }
  ctx.putImageData(read, 0, 0)
  return canvas
}

const WHITE_KEY_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`
const WHITE_KEY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tex;
uniform float tolerance;
uniform float smoothness;
void main() {
  vec4 c = texture2D(tex, vUv);
  float w = min(min(c.r, c.g), c.b);
  float a = 1.0 - smoothstep(tolerance - smoothness, tolerance + smoothness, w);
  gl_FragColor = vec4(c.rgb, c.a * a);
}
`
const ERODE_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tex;
uniform vec2 texelSize;
void main() {
  vec4 c = texture2D(tex, vUv);
  float minA = c.a;
  minA = min(minA, texture2D(tex, vUv + vec2(-1., -1.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2( 0., -1.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2( 1., -1.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2(-1.,  0.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2( 1.,  0.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2(-1.,  1.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2( 0.,  1.) * texelSize).a);
  minA = min(minA, texture2D(tex, vUv + vec2( 1.,  1.) * texelSize).a);
  gl_FragColor = vec4(c.rgb, minA);
}
`

/** GLSL 白底抠图 + 边缘侵蚀，去除白边和白斑 */
export function whiteKeyErodeGLSL(
  img: HTMLImageElement,
  tolerance: number,
  smoothness: number,
  erosion: number
): HTMLCanvasElement {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const glRaw = canvas.getContext('webgl', { preserveDrawingBuffer: true })
  if (!glRaw) throw new Error('WebGL not supported')
  const gl = glRaw

  const quadBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  function createProgram(vert: string, frag: string): WebGLProgram {
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, vert)
    gl.compileShader(vs)
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs) || 'vert compile')
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, frag)
    gl.compileShader(fs)
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs) || 'frag compile')
    const p = gl.createProgram()!
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link')
    return p
  }

  const whiteKeyProg = createProgram(WHITE_KEY_VERT, WHITE_KEY_FRAG)
  const erodeProg = createProgram(WHITE_KEY_VERT, ERODE_FRAG)

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)

  const fb = gl.createFramebuffer()!
  function createFboTex(): WebGLTexture {
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    return t
  }
  const texA = createFboTex()
  const texB = createFboTex()

  const tol = (tolerance / 100) * 0.4 + 0.55
  const smooth = (smoothness / 100) * 0.12 + 0.02
  const erodePasses = Math.min(5, Math.round((erosion / 100) * 10))

  function drawQuad(program: WebGLProgram) {
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  gl.viewport(0, 0, w, h)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texA, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.useProgram(whiteKeyProg)
  gl.uniform1i(gl.getUniformLocation(whiteKeyProg, 'tex')!, 0)
  gl.uniform1f(gl.getUniformLocation(whiteKeyProg, 'tolerance')!, tol)
  gl.uniform1f(gl.getUniformLocation(whiteKeyProg, 'smoothness')!, smooth)
  drawQuad(whiteKeyProg)

  let readTex: WebGLTexture = texA
  let writeTex: WebGLTexture = texB
  for (let p = 0; p < erodePasses; p++) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, readTex)
    gl.useProgram(erodeProg)
    gl.uniform1i(gl.getUniformLocation(erodeProg, 'tex')!, 0)
    gl.uniform2f(gl.getUniformLocation(erodeProg, 'texelSize')!, 1 / w, 1 / h)
    drawQuad(erodeProg)
    ;[readTex, writeTex] = [writeTex, readTex]
  }

  const blitFrag = 'precision mediump float;varying vec2 vUv;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,vUv);}'
  const blitProg = createProgram(WHITE_KEY_VERT, blitFrag)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, readTex)
  gl.useProgram(blitProg)
  gl.uniform1i(gl.getUniformLocation(blitProg, 'tex')!, 0)
  drawQuad(blitProg)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = w
  outCanvas.height = h
  outCanvas.getContext('2d')!.drawImage(canvas, 0, 0)
  return outCanvas
}

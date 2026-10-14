import { createCanvas, Image as NativeImage, ImageData, loadImage } from '@napi-rs/canvas'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function installDom(publicDirectory, budget) {
  const assets = path.resolve(publicDirectory)
  const nativeFetch = globalThis.fetch
  globalThis.__frameroninAssetsBase = pathToFileURL(assets + path.sep).href
  globalThis.window = globalThis
  globalThis.self = globalThis
  globalThis.ImageData = ImageData
  globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
  globalThis.ImageBitmap = NativeImage
  globalThis.FileReader = class {
    result = null
    error = null
    onload = null
    onerror = null
    aborted = false
    readAsDataURL(blob) { this.read(blob, bytes => `data:${blob.type || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`) }
    readAsArrayBuffer(blob) { this.read(blob, bytes => bytes) }
    readAsText(blob) { this.read(blob, bytes => Buffer.from(bytes).toString('utf8')) }
    abort() { this.aborted = true }
    read(blob, convert) {
      blob.arrayBuffer().then(bytes => {
        if (this.aborted) return
        this.result = convert(bytes); this.onload?.({ target: this })
      }).catch(error => { this.error = error; this.onerror?.({ target: this }) })
    }
  }
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0)
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('blob:') || String(url).startsWith('data:')) return nativeFetch(url, options)
    if (!String(url).startsWith('file:')) throw new Error('NETWORK_ACCESS_DISABLED_IN_LOCAL_ALGORITHMS')
    const resolved = await fs.realpath(fileURLToPath(url))
    if (!resolved.startsWith(assets + path.sep)) throw new Error('STATIC_ASSET_OUTSIDE_PACKAGE')
    return new Response(await fs.readFile(resolved))
  }
  class LocalImage {
    native = new NativeImage()
    onload = null
    onerror = null
    crossOrigin = ''
    _src = ''
    get width() { return this.native.width }
    get height() { return this.native.height }
    get naturalWidth() { return this.native.width }
    get naturalHeight() { return this.native.height }
    get complete() { return this.native.complete }
    get src() { return this._src }
    set src(value) {
      this._src = value
      Promise.resolve().then(async () => {
        const response = await globalThis.fetch(value)
        this.native = await loadImage(Buffer.from(await response.arrayBuffer()))
        this.onload?.()
      }).catch(error => this.onerror?.(error))
    }
  }
  globalThis.Image = LocalImage
  globalThis.document = {
    createElement(name) {
      if (name !== 'canvas') throw new Error('DOM_ELEMENT_UNSUPPORTED_IN_LOCAL_ALGORITHMS')
      const canvas = createCanvas(300, 150)
      canvas.style = {}
      const getContext = canvas.getContext.bind(canvas)
      canvas.getContext = (...args) => {
        if (canvas.width * canvas.height * 4 * 4 + 128 * 1024 ** 2 > budget) throw new Error('CANVAS_RESOURCE_LIMIT')
        const context = getContext(...args)
        return new Proxy(context, {
          get(target, name) {
            if (name === 'drawImage') return (source, ...rest) => target.drawImage(source?.native ?? source, ...rest)
            const value = Reflect.get(target, name, target)
            return typeof value === 'function' ? value.bind(target) : value
          },
          set(target, name, value) { Reflect.set(target, name, value, target); return true },
        })
      }
      canvas.toBlob = (callback, type = 'image/png') => {
        canvas.encode(type === 'image/jpeg' ? 'jpeg' : 'png').then(bytes => callback(new Blob([bytes], { type }))).catch(() => callback(null))
      }
      return canvas
    },
  }
  return { createCanvas, loadImage, ImageData }
}

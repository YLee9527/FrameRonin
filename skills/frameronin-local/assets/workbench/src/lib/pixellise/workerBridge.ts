import type { Mesh, WorkerInput, WorkerOutput } from './types'
import { copyImageDataBuffer } from './imageDataOps'

const WORKER_TIMEOUT_MS = 5 * 60 * 1000

export interface RunWorkerOptions {
  onProgress?: (message: string, percent?: number) => void
  signal?: AbortSignal
}

export function runWorkerProcessing(
  imageData: ImageData,
  mesh: Mesh,
  opts: {
    scaledWidth: number
    scaledHeight: number
    numColors: number | null
    scaleResult: number
    transparentBackground: boolean
  },
  bridgeOpts?: RunWorkerOptions,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    if (bridgeOpts?.signal?.aborted) {
      reject(new DOMException('Canceled', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Worker timeout'))
    }, WORKER_TIMEOUT_MS)

    const cleanup = () => {
      window.clearTimeout(timer)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      bridgeOpts?.signal?.removeEventListener('abort', abort)
    }

    const abort = () => { cleanup(); reject(new DOMException('Canceled', 'AbortError')) }
    bridgeOpts?.signal?.addEventListener('abort', abort, { once: true })

    worker.onerror = (ev) => {
      cleanup()
      reject(new Error(ev.message || 'Worker error'))
    }

    worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
      if (bridgeOpts?.signal?.aborted) return
      const msg = e.data
      if (msg.type === 'progress') {
        bridgeOpts?.onProgress?.(msg.message, msg.percent)
        return
      }
      if (msg.type === 'error') {
        cleanup()
        reject(new Error(msg.message))
        return
      }
      if (msg.type === 'result') {
        cleanup()
        const arr = new Uint8ClampedArray(msg.imageBuffer)
        resolve(new ImageData(arr, msg.width, msg.height))
      }
    }

    const imageBuffer = copyImageDataBuffer(imageData)
    const input: WorkerInput = {
      imageBuffer,
      width: imageData.width,
      height: imageData.height,
      mesh,
      scaledWidth: opts.scaledWidth,
      scaledHeight: opts.scaledHeight,
      numColors: opts.numColors,
      scaleResult: opts.scaleResult,
      transparentBackground: opts.transparentBackground,
    }
    worker.postMessage(input, [imageBuffer])
  })
}

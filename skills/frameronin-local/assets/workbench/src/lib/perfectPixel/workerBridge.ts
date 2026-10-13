import type { PerfectPixelOptions } from './perfectPixel'

export function runPerfectPixelWorker(input: ImageData, options: PerfectPixelOptions, signal?: AbortSignal): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Canceled', 'AbortError')); return }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error?: Error, output?: ImageData) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error); else resolve(output!)
    }
    const abort = () => finish(new DOMException('Canceled', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('PerfectPixel worker timed out')), 300000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = event => finish(new Error(event.message))
    worker.onmessage = event => {
      if (signal?.aborted) { abort(); return }
      const result = event.data as { ok: boolean; error?: string; data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }
      if (!result.ok) finish(new Error(result.error)); else finish(undefined, new ImageData(result.data, result.width, result.height))
    }
    const copy = new Uint8ClampedArray(input.data)
    worker.postMessage({ data: copy, width: input.width, height: input.height, options }, [copy.buffer])
  })
}

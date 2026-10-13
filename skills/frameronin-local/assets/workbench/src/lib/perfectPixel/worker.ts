/// <reference lib="webworker" />
import { getPerfectPixel, type PerfectPixelOptions } from './perfectPixel'

self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; options: PerfectPixelOptions }>) => {
  try {
    const { data, width, height, options } = event.data
    const output = getPerfectPixel(new ImageData(data, width, height), options)
    self.postMessage({ ok: true, width: output.width, height: output.height, data: output.data }, [output.data.buffer])
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) })
  }
}

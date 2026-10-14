import { parseGIF, decompressFrames } from 'gifuct-js'
// @ts-expect-error gifenc has no declarations
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export function compositeFrame(
  prevBuf: Uint8ClampedArray,
  frame: { patch: Uint8ClampedArray; dims: { top: number; left: number; width: number; height: number }; disposalType?: number },
  width: number,
  height: number
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(prevBuf)
  const { patch, dims, disposalType = 1 } = frame
  const { top, left, width: pw, height: ph } = dims

  if (disposalType === 2) {
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 0
      buf[i + 1] = 0
      buf[i + 2] = 0
      buf[i + 3] = 0
    }
  }

  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const idx = (py * pw + px) * 4
      const a = patch[idx + 3]
      const outY = top + py
      const outX = left + px
      if (outY >= 0 && outY < height && outX >= 0 && outX < width) {
        const outIdx = (outY * width + outX) * 4
        if (a === 0) {
          buf[outIdx] = 0
          buf[outIdx + 1] = 0
          buf[outIdx + 2] = 0
          buf[outIdx + 3] = 0
        } else {
          buf[outIdx] = patch[idx]
          buf[outIdx + 1] = patch[idx + 1]
          buf[outIdx + 2] = patch[idx + 2]
          buf[outIdx + 3] = a
        }
      }
    }
  }
  return buf
}

// Preserve the original browser disposal and transparent-patch behavior. This
// compatibility decoder is deliberately separate from Pillow's GIF decoder.
export function decodeBrowserGif(bytes: ArrayBuffer, budgetBytes: number) {
  const gif = parseGIF(bytes)
  const patches = gif.frames.filter(frame => 'image' in frame)
  const count = patches.length
  const width = gif.lsd.width, height = gif.lsd.height
  const patchPixels = patches.reduce((total, frame) => 'image' in frame
    ? total + frame.image.descriptor.width * frame.image.descriptor.height : total, 0)
  const estimate = 256 * 1024 ** 2 + bytes.byteLength * 4 + width * height * count * 32 + patchPixels * 16
  if (!count || count > 1000 || !width || !height || estimate > budgetBytes) throw new Error('GIF_DECODE_RESOURCE_LIMIT')
  const frames = decompressFrames(gif, true)
  let previous = new Uint8ClampedArray(width * height * 4)
  return { width, height, frames: frames.map(frame => {
    previous = compositeFrame(previous, frame, width, height) as typeof previous
    return { data: previous, delay: frame.delay, disposalType: frame.disposalType }
  }) }
}

export async function encodeBrowserGif(frames: AsyncIterable<ImageData> | Iterable<ImageData>, delay: number,
  onProgress?: (completed: number) => void): Promise<Blob> {
  const gif = GIFEncoder()
  let completed = 0
  for await (const frame of frames) {
    const { data, width, height } = frame
    const palette = quantize(data, 255, {
      format: 'rgba4444',
      oneBitAlpha: 128,
      clearAlpha: true,
      clearAlphaThreshold: 128,
    })
    const index = applyPalette(data, palette, 'rgba4444')
    const transIdx = palette.findIndex((c: number[]) => c[3] === 0)
    let finalPalette: number[][]
    let finalIndex: Uint8Array
    let transparentIndex: number
    if (transIdx >= 0) {
      finalPalette = [...palette]
      finalIndex = index
      transparentIndex = transIdx
    } else {
      finalPalette = [[0, 0, 0, 0], ...palette]
      finalIndex = new Uint8Array(index.length)
      for (let j = 0; j < data.length; j += 4) {
        if (data[j + 3] < 128) {
          finalIndex[j / 4] = 0
        } else {
          finalIndex[j / 4] = index[j / 4]! + 1
        }
      }
      transparentIndex = 0
    }
    gif.writeFrame(finalIndex, width, height, {
      palette: finalPalette,
      delay,
      transparent: true,
      transparentIndex,
    })
    completed++
    onProgress?.(completed)
  }
  if (!completed) throw new Error('GIF_FRAMES_EMPTY')
  gif.finish()
  return new Blob([Uint8Array.from(gif.bytes())], { type: 'image/gif' })
}

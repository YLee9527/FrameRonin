import type { MapFeather } from '../localProject/mapDocument'
const MAX_FEATHER = 50
const FEATHER_STEP = 5
// Preserve the original four-edge alpha product, including its five-percent ramp.
export function applyMapFeather(data: Uint8ClampedArray, width: number, height: number, feather: MapFeather): void {
  const alphaForDistancePct = (distancePct: number, featherPct: number) => {
    if (featherPct <= 0) return 1
    const endPct = Math.max(0, Math.min(MAX_FEATHER, featherPct))
    const startPct = Math.max(0, endPct - FEATHER_STEP)
    if (distancePct <= startPct) return 0
    if (distancePct >= endPct) return 1
    return (distancePct - startPct) / Math.max(0.0001, endPct - startPct)
  }

  const xDenom = Math.max(1, width - 1)
  const yDenom = Math.max(1, height - 1)
  for (let y = 0; y < height; y++) {
    const topPct = (y / yDenom) * 100
    const bottomPct = ((height - 1 - y) / yDenom) * 100
    const yAlpha =
      alphaForDistancePct(topPct, feather.top) *
      alphaForDistancePct(bottomPct, feather.bottom)
    for (let x = 0; x < width; x++) {
      const leftPct = (x / xDenom) * 100
      const rightPct = ((width - 1 - x) / xDenom) * 100
      const alpha =
        yAlpha *
        alphaForDistancePct(leftPct, feather.left) *
        alphaForDistancePct(rightPct, feather.right)
      data[(y * width + x) * 4 + 3] = Math.round((data[(y * width + x) * 4 + 3] ?? 0) * alpha)
    }
  }
}

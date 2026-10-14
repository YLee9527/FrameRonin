import { mapTileKey as tileKey, type MapTile as Tile } from '../localProject/mapDocument'
type ExpandSplit=4|8|12
type TileKey=string
const CENTER_KEY='0,0'
function splitSegments(start: number, size: number, count: number, overlapRatio: number): Array<{ start: number; size: number }> {
  if (count <= 1) return [{ start, size }]
  const clampedOverlap = Math.max(0, Math.min(0.95, overlapRatio))
  const segmentSize = size / (count - (count - 1) * clampedOverlap)
  const segmentStep = segmentSize * (1 - clampedOverlap)
  return Array.from({ length: count }, (_, i) => ({
    start: i === count - 1 ? start + size - segmentSize : start + i * segmentStep,
    size: segmentSize,
  }))
}

export function expansionTilesFrom(origin: Tile, split: ExpandSplit, horizontalOverlapRatio: number, verticalOverlapRatio: number): Tile[] {
  const count = split / 4
  const clampedHorizontalOverlap = Math.max(0, Math.min(0.95, horizontalOverlapRatio))
  const clampedVerticalOverlap = Math.max(0, Math.min(0.95, verticalOverlapRatio))
  const horizontalSegments = splitSegments(origin.x, origin.w, count, horizontalOverlapRatio)
  const verticalSegments = splitSegments(origin.y, origin.h, count, verticalOverlapRatio)
  const out: Tile[] = []
  for (const segment of horizontalSegments) {
    const tileSize = segment.size
    out.push({ x: segment.start, y: origin.y - tileSize * (1 - clampedVerticalOverlap), w: tileSize, h: tileSize })
    out.push({ x: segment.start, y: origin.y + origin.h - tileSize * clampedVerticalOverlap, w: tileSize, h: tileSize })
  }
  for (const segment of verticalSegments) {
    const tileSize = segment.size
    out.push({ x: origin.x + origin.w - tileSize * clampedHorizontalOverlap, y: segment.start, w: tileSize, h: tileSize })
    out.push({ x: origin.x - tileSize * (1 - clampedHorizontalOverlap), y: segment.start, w: tileSize, h: tileSize })
  }
  return out
}

export function isOutwardExpansionTile(origin: Tile, target: Tile): boolean {
  if (tileKey(origin.x, origin.y) === CENTER_KEY) return true
  if (origin.x > 0 && target.x < origin.x) return false
  if (origin.x < 0 && target.x > origin.x) return false
  if (origin.y > 0 && target.y < origin.y) return false
  if (origin.y < 0 && target.y > origin.y) return false
  return true
}

export function tilesRecord(items: Tile[]): Record<TileKey, Tile> {
  return Object.fromEntries(items.map((tile) => [tileKey(tile.x, tile.y), tile])) as Record<TileKey, Tile>
}

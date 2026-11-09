/**
 * The tile tests' kit, shared by `tiles.test.ts` and `tiles.long-test.ts`: the built map's tiles
 * read from disk, every tile dropped from memory, the walls near a spot as text, and where the play
 * area's outline crosses a tile seam.
 *
 * @module sim/map/__tests__/tile-kit
 */
import { MAP, wallsNear } from "../index.ts"
import { TILE, tileKey } from "../kinds.ts"
import { setTileSource, tileFromDisk } from "../source.ts"
import { dropTile } from "../tiles.ts"

const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))

/** Every tile out of memory, then the source back. */
export const emptied = () => {
  for (const key of KEYS) dropTile(key)
  setTileSource(tileFromDisk)
}

/** Walls near (x, y) as text, in answer order. */
export const wallsAt = (
  kind: "walk" | "land" | "drive" | "traffic",
  x: number,
  y: number,
  r: number,
) => wallsNear(kind, x - r, y - r, x + r, y + r).map((s) => `${s.ax},${s.ay},${s.bx},${s.by}`)

/** Where the play area's outline crosses a tile seam nearest the tile corner (0, 0): a bounds wall there reaches into the next tile. */
export const outlineOnSeam = (): readonly [number, number] => {
  let best: readonly [number, number] = [NaN, NaN],
    least = Infinity
  const take = (x: number, y: number) => {
    if (x * x + y * y < least) [best, least] = [[x, y], x * x + y * y]
  }
  for (const ring of MAP.outline)
    for (let k = 0; k < ring.length; k += 2) {
      const ax = ring[k]!,
        ay = ring[k + 1]!,
        bx = ring[(k + 2) % ring.length]!,
        by = ring[(k + 3) % ring.length]!
      if (ax !== bx)
        for (let s = Math.ceil(Math.min(ax, bx) / TILE); TILE * s <= Math.max(ax, bx); s++)
          take(TILE * s, ay + ((by - ay) * (TILE * s - ax)) / (bx - ax))
      if (ay !== by)
        for (let s = Math.ceil(Math.min(ay, by) / TILE); TILE * s <= Math.max(ay, by); s++)
          take(ax + ((bx - ax) * (TILE * s - ay)) / (by - ay), TILE * s)
    }
  return best
}

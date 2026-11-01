// The roads and rivers of the tiles round a spot, whole and in the whole map's order: what a test
// (`pnpm test`) reads where it once read the whole map's lists, which the map checks read instead
// (`wholeMap` in src/tools/map-file.ts).
import { MAP, type Road, type Water } from "../index.ts"
import type { Layer, TileVectors } from "../packed.ts"
import { tilesOver, tileVectors } from "../tiles.ts"

/** Layer `of` of the tiles over the box [x ± r, y ± r]: each feature once, with its index, by index. */
const near = <T>(
  x: number,
  y: number,
  r: number,
  of: (vectors: TileVectors) => Layer<T>,
): Array<readonly [number, T]> => {
  const byId = new Map<number, T>()
  for (const key of tilesOver(x - r, y - r, x + r, y + r)) {
    const { ids, items } = of(tileVectors(key))
    ids.forEach((id, k) => byId.set(id, items[k]!))
  }
  return [...byId].sort(([a], [b]) => a - b)
}

/** Every road of the tiles over the box [x ± r, y ± r], its attributes and its line, with its index into `MAP.roads`, by index. */
export const roadsNear = (
  x: number,
  y: number,
  r: number,
): Array<Road & { readonly index: number }> =>
  near(x, y, r, (v) => v.roads).map(([index, line]) => ({ ...MAP.roads[index]!, ...line, index }))

/** Every river and stream of the tiles over the box [x ± r, y ± r], in the whole map's order. */
export const waterNear = (x: number, y: number, r: number): Array<Water> =>
  near(x, y, r, (v) => v.water).map(([, water]) => water)

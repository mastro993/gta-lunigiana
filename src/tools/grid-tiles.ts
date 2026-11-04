// The terrain grid by map tile: the window of nodes each listed 2 km tile works on (its 501 × 501
// nodes, the borders shared with its neighbours, cut to the grid), the nodes those windows hold, and
// the tile whose own cells hold a point's cell, so the build works the grid one tile at a time with
// the whole grid's arithmetic (`Grid` in terrain.ts). A tile of the bounds' box the region leaves
// off its list (an L's notch) has no window: the build reads no terrain there, and a node only it
// holds reads what the game reads there, the nearest listed node (`extendEdges`).
import { TILE, tileKey, tileRange, tilesRound } from "../sim/map/kinds.ts"
import { BOUNDS } from "./geometry.ts"
import { REGION, type Region } from "./region.ts"
import { anchorNode, cellOf, type Grid, type Span } from "./terrain.ts"

/** The whole grid's lattice: its cell, size and south-west node. */
type Lattice = Pick<Grid, "cell" | "cols" | "rows" | "x0" | "y0">

/** A map tile and the window of grid nodes the build works it on. */
interface GridTile {
  readonly key: string
  readonly i: number
  readonly j: number
  readonly span: Span
}

/** Grid cells along a tile's side, and the whole grid's first node in cells from the origin. */
const steps = (g: Lattice) => {
  const n = TILE / g.cell,
    cx = Math.round(g.x0 / g.cell),
    cy = Math.round(g.y0 / g.cell)
  if (!Number.isInteger(n) || cx * g.cell !== g.x0 || cy * g.cell !== g.y0)
    throw new Error(`the ${g.cell} m grid at (${g.x0}, ${g.y0}) does not line up with the tiles`)
  return { n, cx, cy }
}

/**
 * The listed tiles (the region's, `REGION.tiles`, by default), in their order (south to north then
 * west to east), each with its window: the nodes it holds, cut to the grid.
 */
export const gridTiles = (g: Lattice, tiles: Region["tiles"] = REGION.tiles): Array<GridTile> => {
  const { n, cx, cy } = steps(g)
  return tiles.map(({ i, j }) => {
    const i0 = Math.max(0, n * i - cx),
      i1 = Math.min(g.cols - 1, n * (i + 1) - cx),
      j0 = Math.max(0, n * j - cy),
      j1 = Math.min(g.rows - 1, n * (j + 1) - cy)
    return { key: tileKey(i, j), i, j, span: { i0, j0, cols: i1 - i0 + 1, rows: j1 - j0 + 1 } }
  })
}

/** Per node of the grid, row-major, 1 where one of `tiles`' windows holds it (`gridTiles`), else 0: an L's notch's nodes, but its sides'. */
export const listedNodes = (g: Lattice, tiles: Region["tiles"]): Uint8Array => {
  const listed = new Uint8Array(g.cols * g.rows)
  for (const { span } of gridTiles(g, tiles))
    for (let r = 0; r < span.rows; r++) {
      const k = (span.j0 + r) * g.cols + span.i0
      listed.fill(1, k, k + span.cols)
    }
  return listed
}

/**
 * Gives each node of `g` that no listed tile holds (`listed` 0: an L's notch) the listed node the
 * game reads there (`nodeAt` in src/sim/map/tiles.ts, `readAt` in the cut): in the tiles round its
 * own (`tilesRound`), the node nearest it, the first in key order on a tie. So the ground past an
 * inner edge of the play area extends that edge, as the grid's clamp does past the bounds.
 */
export const extendEdges = (
  g: Grid,
  listed: Uint8Array,
  tiles: Region["tiles"] = REGION.tiles,
): void => {
  const { n, cx, cy } = steps(g),
    { cols, rows } = g
  // The box of the listed tiles, which the game's tile of a node is clamped to.
  const i0 = Math.min(...tiles.map((t) => t.i)),
    i1 = Math.max(...tiles.map((t) => t.i)),
    j0 = Math.min(...tiles.map((t) => t.j)),
    j1 = Math.max(...tiles.map((t) => t.j))
  const keys = new Set(tiles.map((t) => tileKey(t.i, t.j)))
  const isListed = (i: number, j: number) => keys.has(tileKey(i, j))
  // Per tile of the box, the listed tiles round it, found once.
  const round: Array<ReadonlyArray<readonly [number, number]> | undefined> = []
  for (let gj = 0; gj < rows; gj++)
    for (let gi = 0; gi < cols; gi++) {
      const k = gj * cols + gi
      if (listed[k] === 1) continue
      // Counted from the origin, as the game counts them.
      const ni = cx + gi,
        nj = cy + gj,
        ti = Math.min(i1, Math.max(i0, Math.floor(ni / n))),
        tj = Math.min(j1, Math.max(j0, Math.floor(nj / n))),
        slot = (tj - j0) * (i1 - i0 + 1) + ti - i0
      const near = (round[slot] ??= tilesRound(ti, tj, isListed))
      let best = Infinity,
        from = k
      for (const [ri, rj] of near) {
        const x = Math.min(cx + cols - 1, n * ri + n, Math.max(cx, n * ri, ni)),
          y = Math.min(cy + rows - 1, n * rj + n, Math.max(cy, n * rj, nj)),
          d = (x - ni) * (x - ni) + (y - nj) * (y - nj)
        if (d < best) [best, from] = [d, (y - cy) * cols + x - cx]
      }
      g.z[k] = g.z[from]!
    }
}

/**
 * The key of the tile whose own cells hold the grid cell `sampleGrid` reads at (x, y): every node
 * of that cell is in the tile, so its window answers as the whole grid does. The tile may be one
 * the region leaves off its list, which has no window.
 */
export const cellTile = (g: Omit<Grid, "z" | "span">): ((x: number, y: number) => string) => {
  const { n, cx, cy } = steps(g),
    range = tileRange(BOUNDS),
    [oi, oj] = anchorNode(g)
  return (x, y) => {
    const i = cellOf((x - g.ax) / g.cell, oi, g.cols),
      j = cellOf((y - g.ay) / g.cell, oj, g.rows)
    return tileKey(
      Math.min(range.i1, Math.max(range.i0, Math.floor((i + cx) / n))),
      Math.min(range.j1, Math.max(range.j0, Math.floor((j + cy) / n))),
    )
  }
}

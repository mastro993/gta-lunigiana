// The terrain grid by map tile: the window of nodes each 2 km tile works on (its 501 × 501 nodes,
// the borders shared with its neighbours, plus a halo, cut to the grid) and the tile whose own cells
// hold a point's cell, so the build works the grid one tile at a time with the whole grid's
// arithmetic (`Grid` in terrain.ts).
import { TILE, tileKey, tileRange } from "../sim/map/kinds.ts"
import { BOUNDS } from "./geometry.ts"
import type { Grid, Span } from "./terrain.ts"

/** The whole grid's lattice: its cell, size and south-west node. */
type Lattice = Omit<Grid, "z" | "span">

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
  return { n, cx, cy, range: tileRange(BOUNDS) }
}

/**
 * The map's tiles, south to north then west to east (the tile list's order), each with its window:
 * the nodes it holds plus `halo` more on every side, cut to the grid.
 */
export const gridTiles = (g: Lattice, halo: number): Array<GridTile> => {
  const { n, cx, cy, range } = steps(g)
  const tiles: Array<GridTile> = []
  for (let j = range.j0; j <= range.j1; j++)
    for (let i = range.i0; i <= range.i1; i++) {
      const i0 = Math.max(0, n * i - cx - halo),
        i1 = Math.min(g.cols - 1, n * (i + 1) - cx + halo),
        j0 = Math.max(0, n * j - cy - halo),
        j1 = Math.min(g.rows - 1, n * (j + 1) - cy + halo)
      tiles.push({
        key: tileKey(i, j),
        i,
        j,
        span: { i0, j0, cols: i1 - i0 + 1, rows: j1 - j0 + 1 },
      })
    }
  return tiles
}

/**
 * The key of the tile whose own cells hold the grid cell `sampleGrid` reads at (x, y): every node
 * of that cell is in the tile, so its window answers as the whole grid does.
 */
export const cellTile = (g: Lattice): ((x: number, y: number) => string) => {
  const { n, cx, cy, range } = steps(g)
  return (x, y) => {
    const i = Math.min(g.cols - 2, Math.max(0, Math.floor((x - g.x0) / g.cell))),
      j = Math.min(g.rows - 2, Math.max(0, Math.floor((y - g.y0) / g.cell)))
    return tileKey(
      Math.min(range.i1, Math.max(range.i0, Math.floor((i + cx) / n))),
      Math.min(range.j1, Math.max(range.j0, Math.floor((j + cy) / n))),
    )
  }
}

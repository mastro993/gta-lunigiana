// The game's ground model (src/sim/map/ground-model.ts) over the map build's data, so the build
// traces the ground under the decks, the walls there and the parapets on the ground the game reads
// (issue #113): the terrain's nodes in the whole decimetres the file ships, and the roads and
// platforms as shipped.
import { type Ground, type GroundRoad, wholeGround } from "../sim/map/ground-model.ts"
import type { PlatformOut } from "./platforms.ts"
import type { Grid } from "./terrain.ts"

/** A whole lattice of terrain nodes: its first node, its anchor where that is not it (`anchorOf`), its cell and its size. */
interface Lattice {
  readonly cell: number
  readonly cols: number
  readonly rows: number
  readonly x0: number
  readonly y0: number
  readonly ax?: number
  readonly ay?: number
}

/**
 * The ground over the terrain nodes of `lattice`, node n (row-major, row 0 = south) `node(n)`
 * decimetres, read on every lookup (deck-ground.ts lowers the grid while it reads it), the nodes
 * past the lattice's edge the edge's; and over `roads` (their index their place) and `platforms`.
 */
export const latticeGround = (
  lattice: Lattice,
  node: (n: number) => number,
  roads: ReadonlyArray<Omit<GroundRoad, "index">> = [],
  platforms: ReadonlyArray<Pick<PlatformOut, "rings" | "axis" | "top">> = [],
): Ground => {
  const { cell, cols, rows, x0, y0 } = lattice,
    ax = lattice.ax ?? x0,
    ay = lattice.ay ?? y0,
    oi = (ax - x0) / cell,
    oj = (ay - y0) / cell
  return wholeGround({
    anchor: { x: ax, y: ay },
    cell,
    corners: (fi, fj, out) => {
      for (let k = 0; k < 4; k++) {
        const i = Math.min(cols - 1, Math.max(0, fi + oi + (k & 1))),
          j = Math.min(rows - 1, Math.max(0, fj + oj + (k >> 1)))
        out[k] = node(j * cols + i)
      }
    },
    roads,
    platforms,
  })
}

/**
 * The ground over the whole grid `g` as the file ships it, each node rounded to the decimetre, and
 * over `roads` with their shipped `lines` and the laid `platforms`. The roads' walkers' verges are
 * set later (rail-clear.ts): only `footZ` and `groundZ` with verges read them, which the build does not.
 */
export const gridGround = (
  g: Grid,
  roads: ReadonlyArray<Pick<GroundRoad, "cls" | "w" | "bridge" | "tunnel">> = [],
  lines: ReadonlyArray<Pick<GroundRoad, "pts" | "z">> = [],
  platforms: ReadonlyArray<Pick<PlatformOut, "rings" | "axis" | "top">> = [],
): Ground =>
  latticeGround(
    g,
    (n) => Math.round(g.z[n]! * 10),
    roads.map(({ cls, w, bridge, tunnel }, i) => ({ cls, w, bridge, tunnel, ...lines[i]! })),
    platforms,
  )

/** Road `road`'s surface at its point nearest (x, y) on `ground` (`roadLevel`); throws where that lies farther than `HALO` off it. */
export const levelOn =
  (ground: Ground) =>
  (road: number, x: number, y: number): number => {
    const z = ground.roadLevel(road, x, y)
    if (z === undefined) throw new Error(`road ${road} is out of reach of (${x}, ${y})`)
    return z
  }

// The small map the cut's and the upgrader's tests build: four tiles meeting at the origin.
import { MAP_VERSION } from "../../sim/map/format/sections.ts"
import type { BuiltMap } from "../tile-map.ts"

/** The 6 × 6 cells' land cover. */
export const cover = Array.from({ length: 36 }, (_, k) => k % 22)

/** A 24 m map on the origin: its four tiles meet at (0, 0). */
export const built = (data: ReadonlyArray<number>): BuiltMap => ({
  version: MAP_VERSION,
  origin: { lat: 44.2, lon: 10.1 },
  mPerDeg: { lat: 111_000, lon: 80_000 },
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 },
  outline: [[-12, -12, 12, -12, 12, 12, -12, 12]],
  tiles: [
    { i: -1, j: -1 },
    { i: 0, j: -1 },
    { i: -1, j: 0 },
    { i: 0, j: 0 },
  ],
  heightmap: { cell: 4, cols: 7, rows: 7, x0: -12, y0: -12, data: Int16Array.from(data) },
  roads: [],
  buildings: [],
  water: [],
  rail: [],
  railway: { lines: [], stations: [], crossings: [], platforms: [] },
  areas: [],
  barriers: [],
  pois: [],
  districts: [],
  graph: { xy: [], edges: [], traffic: [], walk: [] },
  // A wall across the x = 0 seam (its midpoint east of it), one in the south-west tile, a shore wall
  // on the edge; the drive wall at a level (a parapet's).
  walls: {
    walk: [-3, 5, 1, 5, -10, -10, -8, -9],
    shore: [12, -12, 12, 12],
    drive: [-3, 5, 1, 5],
    levels: { walk: [NaN, NaN], drive: [148.5] },
  },
  // Sparse ids, as the scatter numbers trees (lattice cells, bank trees past 2^28): in id order the
  // trees are not in their tiles' order (0_0's comes before 0_-1's).
  trees: [-5, -5, 1.2, 0, 0, 0.9, 7, -3, 1],
  treeIds: [12, 40_000, 2 ** 28 + 5],
  treeCorner: [-11, -11],
  cover: (b) =>
    Array.from({ length: b.cols * b.rows }, (_, k) => {
      const c = b.c0 + (k % b.cols),
        r = b.r0 + Math.floor(k / b.cols)
      return cover[r * 6 + c]!
    }),
  spawns: { player: { x: 1, y: 2, angle: 0 }, parked: [] },
})
/** Its nodes' heights, decimetres. */
export const data = Array.from({ length: 49 }, (_, k) => 2000 + 13 * k)

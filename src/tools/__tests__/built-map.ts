// The small map the cut's and the upgrader's tests build: four tiles meeting at the origin, with
// vectors over them or without.
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

/** `built(data)` with vectors near and far from the seams (the bounds are only the terrain's: the cut clamps a feature past them to the edge tiles, as a lookup's tile is clamped). */
export const withVectors = (map: BuiltMap): BuiltMap => ({
  ...map,
  roads: [
    // across the x = 0 seam, 50 m north of y = 0: both northern tiles
    {
      id: 1,
      cls: "residential",
      w: 4.5,
      surface: "asphalt",
      pts: [-100, 50, 100, 50],
      z: [300, 301.5],
    },
    // 500 m into the south-east tile
    { id: 2, cls: "track", w: 3, surface: "gravel", pts: [500, -500, 600, -500], z: [310, 311] },
  ],
  buildings: [
    {
      id: 3,
      kind: "house",
      h: 6,
      z0: 290,
      style: "stone",
      tint: 1,
      outer: [-300, -300, -290, -300, -290, -290],
    },
    // in the north-east tile alone
    {
      id: 4,
      kind: "house",
      h: 6,
      z0: 290,
      style: "stone",
      tint: 1,
      outer: [100, 100, 110, 100, 110, 110],
    },
  ],
  // 10 m east of x = 0, south of y = 0: its bed's box within the halo of both southern tiles
  water: [
    {
      id: 5,
      kind: "stream",
      w: 2,
      bed: 3,
      depth: 1,
      pts: [10, -40, 10, -100],
      z: [280, 279],
      area: [1.5, 1.6],
    },
  ],
  // over every tile
  areas: [{ kind: "forest", rings: [[-500, -500, 500, -500, 500, 500, -500, 500]] }],
  barriers: [{ kind: "wall", pts: [40, 40, 60, 60] }],
})

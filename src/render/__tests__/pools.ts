// The lakes' and river polygons' cells and the quads `poolWater` draws over them, which
// water.test.ts (Lunigiana) and water-cesena.test.ts (Cesena) share. It reads the map's grid as it
// loads: a process that provides another map imports it after that.
import assert from "node:assert/strict"

import { pointInRing } from "../../sim/collide.ts"
import { type Area, isWaterArea, MAP } from "../../sim/map/index.ts"
import { chunkCells, chunkOf } from "../chunks.ts"
import { WaterTriangles } from "../geometry.ts"
import type { Vectors } from "../testing.ts"
import { poolWater } from "../water.ts"

const hm = MAP.heightmap
/** The grid's last cell along x and y: an apron cell continues the edge cell it lies beyond. */
export const LAST = { i: hm.cols - 2, j: hm.rows - 2 } as const

/** The lakes and river polygons among `near`'s areas: the water areas `poolWater` draws. */
export const poolAreas = (near: Vectors): ReadonlyArray<Area> =>
  near.areas.items.filter(
    (a) => isWaterArea(a.kind) && (a.level !== undefined || a.waters !== undefined),
  )

/** Whether `rings` hold (x, y), even-odd over them all, as the land cover fills them. */
export const holds = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number): boolean =>
  rings.reduce((inside, r) => inside !== pointInRing(x, y, r), false)

/** The box of an area's outer ring: minX, minY, maxX, maxY. */
export const boxOf = (area: Area): readonly [number, number, number, number] => {
  const ring = area.rings[0]!,
    xs = ring.filter((_, k) => k % 2 === 0),
    ys = ring.filter((_, k) => k % 2 === 1)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** The centre of grid cell (i, j), or in the apron of the edge cell it continues. */
export const centreOf = (i: number, j: number) => ({
  x: hm.x0 + (Math.min(LAST.i, Math.max(0, i)) + 0.5) * hm.cell,
  y: hm.y0 + (Math.min(LAST.j, Math.max(0, j)) + 0.5) * hm.cell,
})

/** Which cells `areas` hold: one of them holds a cell's centre (in the apron, the edge cell's it continues). */
export const wetCells = (areas: ReadonlyArray<Area>) => {
  const wetCell = (i: number, j: number): boolean => {
    const { x, y } = centreOf(i, j)
    return areas.some((a) => holds(a.rings, x, y))
  }
  /** The cells of chunk `key` the areas cover, as "i,j", sorted. */
  const wetCellsOf = (key: number): Array<string> => {
    const { i0, j0, i1, j1 } = chunkCells(key),
      out: Array<string> = []
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) if (wetCell(i, j)) out.push(`${i},${j}`)
    return out.sort()
  }
  return { wetCell, wetCellsOf }
}

/** The grid cells of `area` (their centres inside its rings), as (i, j). */
export const cellsOf = (area: Area): Array<{ readonly i: number; readonly j: number }> => {
  const [x0, y0, x1, y1] = boxOf(area),
    out: Array<{ i: number; j: number }> = []
  for (let j = Math.floor((y0 - hm.y0) / hm.cell); j <= Math.ceil((y1 - hm.y0) / hm.cell); j++)
    for (let i = Math.floor((x0 - hm.x0) / hm.cell); i <= Math.ceil((x1 - hm.x0) / hm.cell); i++) {
      const { x, y } = centreOf(i, j)
      if (holds(area.rings, x, y)) out.push({ i, j })
    }
  return out
}

/** The distinct chunks holding `cells`. */
export const chunksOf = (cells: ReadonlyArray<{ readonly i: number; readonly j: number }>) => [
  ...new Set(
    cells.map(({ i, j }) => {
      const { x, y } = centreOf(i, j)
      return chunkOf(x, y)
    }),
  ),
]

/** A drawn water vertex: its node (i, j: the grid index of its map point, unclamped), render height and attributes. */
export interface Corner {
  readonly i: number
  readonly j: number
  readonly h: number
  readonly stage: number
  readonly flow: ReadonlyArray<number>
  readonly still: number
}

/** A quad of water over cell (i, j): its corners south-west, south-east, north-east, north-west. */
export interface Quad {
  readonly i: number
  readonly j: number
  readonly corners: readonly [Corner, Corner, Corner, Corner]
}

/** The quads `poolWater` drew into `w`, each checked to be two triangles over exactly one grid cell. */
const quadsOf = (w: WaterTriangles): Array<Quad> => {
  const vertex = (v: number) => ({
    x: w.position[3 * v]!,
    y: -w.position[3 * v + 2]!,
    h: w.position[3 * v + 1]!,
    stage: w.stage[v]!,
    flow: w.flow.slice(3 * v, 3 * v + 3),
    still: w.still[v]!,
  })
  const corner = ({ x, y, ...rest }: ReturnType<typeof vertex>): Corner => ({
    i: (x - hm.x0) / hm.cell,
    j: (y - hm.y0) / hm.cell,
    ...rest,
  })
  assert.equal(w.position.length % 18, 0, "whole quads")
  return Array.from({ length: w.position.length / 18 }, (_, q) => {
    const [sw, se, ne, sw2, ne2, nw] = [0, 1, 2, 3, 4, 5].map((k) => corner(vertex(6 * q + k)))
    assert.deepEqual([sw2, ne2], [sw, ne], "two triangles of one quad")
    const { i, j } = sw!
    assert.ok(Number.isInteger(i) && Number.isInteger(j), `on the grid's nodes: ${i}, ${j}`)
    assert.deepEqual(
      [se, ne, nw].map((c) => [c!.i, c!.j]),
      [
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ],
      "over one cell",
    )
    return { i, j, corners: [sw!, se!, ne!, nw!] }
  })
}

/** The quads `poolWater` draws for chunk `key`. */
export const drawn = (key: number): Array<Quad> => {
  const w = new WaterTriangles()
  poolWater(key, w)
  return quadsOf(w)
}

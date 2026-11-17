/**
 * The lakes, the sea and the river polygons, drawn chunk by chunk into the water mesh: a quad over
 * each of their cells (a cell whose centre the polygon holds, as the land cover paints it), its
 * corners on the cell's nodes. A lake's and the sea's lie at their level, each with how deep the
 * water stands over its node (`still`), which the water shader shades it by, the sea's flagged
 * (`sea`) and coloured as the sea; a river polygon's lie on the bed of its nearest waterway with
 * that reach's stage and flow and how far the sea holds it up there (`heldBySea`), which the water
 * shader lifts to the level the river runs at, as it lifts the river's ribbon (`render/lines`), so
 * the water drawn stands where `waterAt` has it. The terrain above the level hides the water: the
 * shore is where they meet.
 *
 * @module render/water
 */
import { fillPolygon, pointInRing } from "../sim/collide.ts"
import { terrainNodeZ } from "../sim/map/ground.ts"
import { MAP } from "../sim/map/index.ts"
import { anchorOf } from "../sim/map/kinds.ts"
import { heldBySea } from "../sim/water/channel.ts"
import { poolsAt, poolsIn } from "../sim/water/rivers.ts"
import { chunkCells } from "./chunks.ts"
import type { Flowing, WaterTriangles } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"

const hm = MAP.heightmap,
  anchor = anchorOf(hm)
/**
 * Running water lies this far over its bed, m: over the river's ribbon (0.02) and the deep channel
 * of a wide one (0.04) where they overlap, so a ribbon's quad the area's water half covers stays
 * under it.
 */
const OVER_BED = 0.05
/** The grid's last cell along x and y: an apron cell takes the edge cell it continues, as the terrain does. */
const LAST = { i: hm.cols - 2, j: hm.rows - 2 } as const

/** Cell index `c` clamped to the grid's cells 0 … `last`. */
const clampCell = (c: number, last: number) => Math.min(last, Math.max(0, c))

/**
 * Whether the cell holding (x, y), or in the apron the edge cell it continues, is a cell of a lake,
 * the sea or a river polygon (its centre inside, even-odd over the rings): a river's ribbon stops
 * where the area's water is drawn instead.
 */
export const inPool = (x: number, y: number): boolean => {
  const ci = clampCell(Math.floor((x - anchor.x) / hm.cell) + anchor.i, LAST.i),
    cj = clampCell(Math.floor((y - anchor.y) / hm.cell) + anchor.j, LAST.j)
  const cx = hm.x0 + (ci + 0.5) * hm.cell,
    cy = hm.y0 + (cj + 0.5) * hm.cell
  return poolsAt(cx, cy).some((pool) => {
    if (cx < pool.box[0] || cx > pool.box[2] || cy < pool.box[1] || cy > pool.box[3]) return false
    let inside = false
    for (const ring of pool.rings) if (pointInRing(cx, cy, ring)) inside = !inside
    return inside
  })
}

/**
 * Draws the lakes', the sea's and the river polygons' cells of chunk `key` into `into`; in the apron,
 * the edge cells' water carried on as the terrain carries their nodes, so the sea runs on past the
 * map's edge over the edge's sea floor. Reads the terrain and the water areas of the tiles under the
 * chunk's own cells.
 */
export const poolWater = (key: number, into: WaterTriangles): void => {
  const { i0, j0, i1, j1 } = chunkCells(key)
  // The grid's cells the chunk's cells take their water from.
  const c0 = clampCell(i0, LAST.i),
    c1 = clampCell(i1 - 1, LAST.i),
    r0 = clampCell(j0, LAST.j),
    r1 = clampCell(j1 - 1, LAST.j)
  const cols = c1 - c0 + 1,
    rows = r1 - r0 + 1
  const minX = hm.x0 + c0 * hm.cell,
    minY = hm.y0 + r0 * hm.cell,
    maxX = hm.x0 + (c1 + 1) * hm.cell,
    maxY = hm.y0 + (r1 + 1) * hm.cell
  for (const pool of poolsIn(minX, minY, maxX, maxY)) {
    const [px0, py0, px1, py1] = pool.box
    if (px1 < minX || px0 > maxX || py1 < minY || py0 > maxY) continue
    const wet = new Uint8Array(cols * rows)
    fillPolygon(
      pool.rings,
      anchor.x,
      anchor.y,
      hm.cell,
      { c0: c0 - anchor.i, r0: r0 - anchor.j, cols, rows },
      (k) => (wet[k] = 1),
    )
    // Each node's values once, read at the grid node it stands for (the apron's, the edge's), so the
    // cells round it share its corner exactly.
    const nodes = new Map<
      number,
      { readonly y: number; readonly f: Flowing; readonly s: number; readonly h: number }
    >()
    const node = (i: number, j: number) => {
      const ni = Math.min(hm.cols - 1, Math.max(0, i)),
        nj = Math.min(hm.rows - 1, Math.max(0, j)),
        key = nj * hm.cols + ni
      let v = nodes.get(key)
      if (v === undefined) {
        const { bed, stage, ux, uy, speed } = pool.surface(
          hm.x0 + ni * hm.cell,
          hm.y0 + nj * hm.cell,
        )
        v =
          pool.level === undefined
            ? { y: yOf(bed) + OVER_BED, f: [stage, ux, uy, speed], s: 0, h: heldBySea(bed) }
            : {
                y: yOf(bed),
                f: [0, ux, uy, 0],
                s: Math.max(0, bed - terrainNodeZ(ni, nj)),
                h: 0,
              }
        nodes.set(key, v)
      }
      return v
    }
    const sea = pool.kind === "sea",
      hex = sea ? PALETTE.seaShallow : PALETTE.waterShallow
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        if (wet[(clampCell(j, LAST.j) - r0) * cols + clampCell(i, LAST.i) - c0] === 0) continue
        const sw = node(i, j),
          se = node(i + 1, j),
          ne = node(i + 1, j + 1),
          nw = node(i, j + 1)
        const x = hm.x0 + i * hm.cell,
          y = hm.y0 + j * hm.cell,
          x1 = x + hm.cell,
          y1 = y + hm.cell
        into.waterQuad(
          [x, sw.y, -y],
          [x1, se.y, -y],
          [x1, ne.y, -y1],
          [x, nw.y, -y1],
          hex,
          [sw.f, se.f, ne.f, nw.f],
          { still: [sw.s, se.s, ne.s, nw.s], held: [sw.h, se.h, ne.h, nw.h], sea },
        )
      }
  }
}

// The terrain chain's sea step (issue #13): the 1 m cells of a crop seaward of OSM's coastline
// (`coast.ts`, the part's own extract), and the shore between it and the land the sources before
// have data for, filled at 0 m as the source `sea`. Liguria's DTM has no data over the sea, and its
// bilinear none beside a cell without any (`sample`); on the magra-coast test region it stops short
// of OSM's coastline on the beaches, by up to 60 m, and leaves the Magra's last 140 m between its
// jetties, which OSM's coastline closes at their heads, empty as sea. The chain's bend (`fillStep`,
// faded over SEA_FADE m) carries the land's height at its rim down to the sea's 0 across that shore.
// The build's sea carving sets the sea's own nodes again.
import { type CoastLine, seaAreas } from "./coast.ts"
import { latLonToGaussBoaga } from "./crs.ts"
import { type Crop, localBoxOf } from "./dtm-mosaic.ts"
import type { Filler } from "./fill-chain.ts"
import { fillPolygon, fromLocal } from "./geometry.ts"
import { codeOf } from "./terrain-sources.ts"

/**
 * How far past the coastline the sea fills the cells still empty that it reaches through empty
 * cells, m (8-connected steps): the widest shore Liguria's DTM leaves empty on the magra-coast test
 * region is the Magra's mouth, 138 m in from OSM's closure across it, and its beaches' up to 60 m.
 */
export const SEA_REACH = 150
/**
 * How far the chain's bend of the sea reaches past the cells it is fitted on, m (`Filler`'s `fade`):
 * one step of its lattice, so the land's height at the shore falls to the sea's 0 within about it
 * rather than lifting the sea round a cliff far out.
 */
export const SEA_FADE = 50

/**
 * The sea's filler over `crop`, its heights `dm` (NaN where no source has given one yet), or
 * undefined when no cell of it is sea: 0 m on the cells seaward of `lines` (their sea over the local
 * box round the crop, `seaAreas`, filled onto its cells in EPSG:3003) and on the empty cells the sea
 * reaches through empty cells within SEA_REACH m, bent onto the land with SEA_FADE.
 */
export const seaFiller = (
  lines: ReadonlyArray<CoastLine>,
  crop: Crop,
  dm: Float32Array,
): Filler | undefined => {
  const { e0, n0, cols, rows } = crop,
    [x0, y0, x1, y1] = localBoxOf(crop)
  const sea = new Uint8Array(cols * rows),
    block = { c0: 0, r0: 0, cols, rows }
  for (const { rings } of seaAreas(lines, [[x0 - 1, y0 - 1, x1 + 1, y1 + 1]]))
    fillPolygon(
      rings.map((ring) =>
        ring.flatMap((v, i) =>
          i % 2 === 1 ? [] : latLonToGaussBoaga(...fromLocal(v, ring[i + 1]!)),
        ),
      ),
      e0 - 0.5,
      n0 - 0.5,
      1,
      block,
      (k) => (sea[k] = 1),
    )
  if (!sea.includes(1)) return undefined
  const shore = flooded(sea, dm, cols, rows)
  return { source: codeOf("sea"), at: () => 0, where: (k) => shore[k] === 1, fade: SEA_FADE }
}

/**
 * 1 on the `sea` cells of a `cols` × `rows` grid and on each cell `dm` holds no height for that a
 * path of such cells joins to the sea within SEA_REACH steps to any of the 8 cells round, else 0:
 * breadth first from the sea's edge.
 */
const flooded = (sea: Uint8Array, dm: Float32Array, cols: number, rows: number): Uint8Array => {
  const out = Uint8Array.from(sea)
  /** Calls `visit` with each of the cells round cell k in the grid, until it returns true; whether one did. */
  const round = (k: number, visit: (q: number) => boolean): boolean => {
    const c = k % cols,
      r = (k - c) / cols
    for (let b = Math.max(0, r - 1); b <= Math.min(rows - 1, r + 1); b++)
      for (let a = Math.max(0, c - 1); a <= Math.min(cols - 1, c + 1); a++)
        if ((a !== c || b !== r) && visit(b * cols + a)) return true
    return false
  }
  let front: Array<number> = []
  for (let k = 0; k < sea.length; k++)
    if (sea[k] === 1 && round(k, (q) => sea[q] === 0)) front.push(k)
  for (let step = 0; step < SEA_REACH && front.length > 0; step++) {
    const next: Array<number> = []
    for (const k of front)
      round(k, (q) => {
        if (out[q] === 0 && Number.isNaN(dm[q]!)) {
          out[q] = 1
          next.push(q)
        }
        return false
      })
    front = next
  }
  return out
}

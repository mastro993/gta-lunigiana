// The check deck-ground.test.ts runs on made-up grids and deck-ground.map-test.ts on every built
// map: where the ground reaches into a bridge's deck, read on the mesh the game draws.
import { DECK_SLAB } from "../../sim/map/kinds.ts"
import { abeamOf, jointsOf, railSlab, roadSlab, type Slab } from "../deck-ground.ts"
import type { JoinedMap } from "../map-file.ts"
import { BED } from "../rail-bed.ts"

/** Every road and rail bridge of `map` as its deck's slab, each named. */
export const mapDecks = (map: JoinedMap): Array<readonly [string, Slab]> => [
  ...map.roads
    .filter((r) => r.bridge === true)
    .map((r) => [`${r.cls} bridge ${r.id}`, roadSlab(r, r)] as const),
  ...map.rail
    .filter((r) => r.bridge === true)
    .map((r) => [`rail bridge ${r.id}`, railSlab(r)] as const),
]

/**
 * `map`'s drawn mesh: the terrain at (x, y), each 4 m cell split along its south-west to north-east
 * diagonal as `terrainZ` (src/sim/map/ground.ts) reads the map the game loaded, and the nodes of the
 * triangle drawn there (x, y).
 */
export interface Mesh {
  readonly at: (x: number, y: number) => number
  readonly corners: (x: number, y: number) => ReadonlyArray<readonly [number, number]>
}

/** `map`'s drawn mesh (`Mesh`). */
export const meshOf = (map: Pick<JoinedMap, "heightmap">): Mesh => {
  const hm = map.heightmap,
    ax = hm.ax ?? hm.x0,
    ay = hm.ay ?? hm.y0,
    ai = (ax - hm.x0) / hm.cell,
    aj = (ay - hm.y0) / hm.cell
  const node = (i: number, j: number) =>
    hm.data[
      Math.min(hm.rows - 1, Math.max(0, j)) * hm.cols + Math.min(hm.cols - 1, Math.max(0, i))
    ]! / 10
  const cell = (x: number, y: number) => {
    const fx = (x - ax) / hm.cell,
      fy = (y - ay) / hm.cell
    const fi = Math.floor(fx),
      fj = Math.floor(fy)
    return { fi, fj, u: fx - fi, v: fy - fj }
  }
  return {
    at: (x, y) => {
      const { fi, fj, u, v } = cell(x, y)
      const sw = node(fi + ai, fj + aj),
        se = node(fi + ai + 1, fj + aj),
        nw = node(fi + ai, fj + aj + 1),
        ne = node(fi + ai + 1, fj + aj + 1)
      return u >= v ? sw + (se - sw) * u + (ne - se) * v : sw + (ne - nw) * u + (nw - sw) * v
    },
    corners: (x, y) => {
      const { fi, fj, u, v } = cell(x, y)
      const at = (di: number, dj: number) =>
        [ax + (fi + di) * hm.cell, ay + (fj + dj) * hm.cell] as const
      return [at(0, 0), u >= v ? at(1, 0) : at(0, 1), at(1, 1)]
    },
  }
}

/** How far apart the check reads the ground under a slab, along and across it, at most, m. */
const STEP = 0.5
/** Past this far in from a deck's outer ends no ground stands in its slab, m: issue #92's "more than a few metres", as it measured. */
const IN_FROM_ENDS = 4

/**
 * Where the terrain reaches into a deck, read every STEP m along and across its slab: more than
 * IN_FROM_ENDS from its outer ends (a joint with the next piece of the bridge is none, `jointsOf`)
 * within DECK_SLAB.depth of its top, or nearer them more than BED over its profile (a road's surface
 * floats `ROAD_LIFT` over it: the ground buries the road). Where a node behind the deck's ends and
 * its joined pieces' is a corner of the triangle drawn there, the abutment, the approach's ground
 * decides. One line per deck, at its worst; empty when the ground keeps out of every one.
 */
export const deckShortfalls = (
  decks: ReadonlyArray<readonly [string, Slab]>,
  mesh: Mesh,
): Array<string> => {
  const joints = jointsOf(decks.map(([, slab]) => slab))
  return decks.flatMap(([name, slab], i) => {
    const { pts, z, half, lift } = slab,
      [first, last] = joints[i]!,
      joined = [slab, ...[...first, ...last].map((j) => decks[j]![1])]
    const lengths = z
        .slice(1)
        .map((_, k) =>
          Math.hypot(pts[2 * k + 2]! - pts[2 * k]!, pts[2 * k + 3]! - pts[2 * k + 1]!),
        ),
      total = lengths.reduce((sum, l) => sum + l, 0)
    let worst = 0,
      at = ""
    for (let k = 0, s = 0; k + 1 < z.length; s += lengths[k]!, k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        len = lengths[k]!
      if (len === 0) continue
      const ux = (pts[2 * k + 2]! - ax) / len,
        uy = (pts[2 * k + 3]! - ay) / len
      const along = Math.ceil(len / STEP),
        across = Math.ceil((2 * half) / STEP)
      for (let a = 0; a <= along; a++) {
        const d = (len * a) / along,
          top = z[k]! + ((z[k + 1]! - z[k]!) * d) / len + lift
        const fromEnd = Math.min(
          first.length === 0 ? s + d : Infinity,
          last.length === 0 ? total - s - d : Infinity,
        )
        const need = fromEnd > IN_FROM_ENDS + 1e-9 ? DECK_SLAB.depth : lift - BED
        for (let c = 0; c <= across; c++) {
          const o = -half + (2 * half * c) / across,
            x = ax + ux * d - uy * o,
            y = ay + uy * d + ux * o,
            gap = top - mesh.at(x, y)
          if (need - gap <= worst + 1e-6) continue
          if (!mesh.corners(x, y).every(([cx, cy]) => joined.some((j) => abeamOf(j, cx, cy))))
            continue
          worst = need - gap
          at = `${gap.toFixed(2)} m under its top at (${x.toFixed(1)}, ${y.toFixed(1)}), ${(s + d).toFixed(1)} m along, ${need.toFixed(2)} m wanted`
        }
      }
    }
    return worst > 0 ? [`${name}: the ground ${at}`] : []
  })
}

// The parapets along both sides of every drivable bridge's deck: walls for the cars, each at its
// deck's level, so a car meets one only on the deck (issue #91). A parapet opens only where a road
// on the deck's own level reaches it: a junction on the deck, the next piece of the same bridge (OSM
// splits bridges), a road or tunnel carrying on from it, the inside of the deck's own bends. A road
// passing under the deck, or over it, leaves it closed: before, any road's carriageway opened it, and
// a car on the SR445's viaduct west of Gragnola drove off it over the road under it.
import { isDrivable, ONE_LEVEL } from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { r1, segIndex } from "./geometry.ts"
import { opened, pushPolyline } from "./walls.ts"

/** A bridge's parapets stand this far beyond half its carriageway, m: where `lines.ts` draws them. */
export const PARAPET = 0.25

/**
 * The parapets' walls, flat (ax, ay, bx, by) pieces of at most 16 m, and each one's level: its deck's
 * top at its middle, m a.s.l.; and how many bridges' parapets close over a road on another level (the
 * build's report).
 */
interface Parapets {
  readonly walls: Array<number>
  readonly levels: Array<number>
  readonly over: number
}

/**
 * The parapets of every drivable bridge of `roads`, `level` (`roadLevel` in
 * src/sim/map/ground-model.ts, on their shipped lines) a road's surface by its index: one piece per
 * deck segment and side, w/2 + PARAPET off its centreline, opened wherever a road's
 * carriageway reaches it with its surface there within ONE_LEVEL of the deck's top, the deck itself
 * included (the inside of its bends, where the piece along one segment runs on across the next one's
 * carriageway: a 2.4 m segment off a junction on the SR445's bridge by Montefiore put it 3.6 m from
 * the centreline, inside the 7.6 m deck). Each wall takes its deck's top at its middle, to 0.1 m.
 */
export const parapets = (
  roads: ReadonlyArray<RoadF>,
  level: (road: number, x: number, y: number) => number,
): Parapets => {
  const ways = segIndex<number>()
  roads.forEach((r, i) => ways.addLine(r.pts, r.w / 2, i))
  const walls: Array<number> = [],
    levels: Array<number> = []
  let over = 0
  roads.forEach((r, i) => {
    if (r.bridge !== true || !isDrivable(r.cls)) return
    let closesOver = false
    const pieces = opened(
      r.pts.slice(1).flatMap((b, k) => {
        const a = r.pts[k]!,
          len = Math.hypot(b.x - a.x, b.y - a.y) || 1,
          nx = -(b.y - a.y) / len,
          ny = (b.x - a.x) / len
        return [-1, 1].map((side) => {
          const o = side * (r.w / 2 + PARAPET)
          return {
            kind: "wall" as const,
            pts: [r1(a.x + nx * o), r1(a.y + ny * o), r1(b.x + nx * o), r1(b.y + ny * o)],
          }
        })
      }),
      // A piece stands PARAPET past its own segment's carriageway, so only another segment covers it.
      (x, y) => {
        let reached = false,
          open = false
        ways.within(x, y, (s) => {
          reached = true
          open ||= Math.abs(level(s.data, x, y) - level(i, x, y)) < ONE_LEVEL
        })
        closesOver ||= reached && !open
        return open
      },
    )
    if (closesOver) over++
    for (const p of pieces) {
      const from = walls.length
      pushPolyline(walls, p.pts, false)
      for (let w = from; w < walls.length; w += 4)
        levels.push(
          r1(level(i, (walls[w]! + walls[w + 2]!) / 2, (walls[w + 1]! + walls[w + 3]!) / 2)),
        )
    }
  })
  return { walls, levels, over }
}

// The clearance check map.map-test.ts (the Lucido) and cesena.map-test.ts share: every drivable road
// under a road bridge keeps road-levels.ts's clearance under its deck; and the box and the crossings
// it and levels.map-test.ts find ways by.
import { DECK, passesOver, UNDERPASS } from "../../../tools/road-levels.ts"
import type { Road } from "../index.ts"
import { isDrivable } from "../kinds.ts"

/** The map's elevations are rounded to 0.1 m, so a gap can read up to this much short of the rule. */
const ROUNDING = 0.1

/** The [minX, minY, maxX, maxY] box of a flat polyline. */
export const boxOf = (pts: ReadonlyArray<number>) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!)
    y0 = Math.min(y0, pts[i + 1]!)
    x1 = Math.max(x1, pts[i]!)
    y1 = Math.max(y1, pts[i + 1]!)
  }
  return [x0, y0, x1, y1] as const
}

/**
 * Where the flat polyline `up` crosses `down`: the point (x, y), the segments' indices (`k` into
 * `up`'s points, `m` into `down`'s, each a segment's first) and how far along each it lies (`t`,
 * `u`, 0–1). A crossing at a vertex both have is a junction, not a crossing, and is left out.
 */
export function* crossings(up: ReadonlyArray<number>, down: ReadonlyArray<number>) {
  for (let k = 0; k + 1 < up.length / 2; k++)
    for (let m = 0; m + 1 < down.length / 2; m++) {
      const px = up[2 * k]!,
        py = up[2 * k + 1]!,
        ex = up[2 * k + 2]! - px,
        ey = up[2 * k + 3]! - py,
        qx = down[2 * m]!,
        qy = down[2 * m + 1]!,
        fx = down[2 * m + 2]! - qx,
        fy = down[2 * m + 3]! - qy,
        den = ex * fy - ey * fx
      if (den === 0) continue
      const t = ((qx - px) * fy - (qy - py) * fx) / den,
        u = ((qx - px) * ey - (qy - py) * ex) / den
      if (t < 0 || t > 1 || u < 0 || u > 1) continue
      const atVertex = (s: number) => s < 1e-6 || s > 1 - 1e-6
      if (atVertex(t) && atVertex(u)) continue
      yield { x: px + ex * t, y: py + ey * t, k, m, t, u }
    }
}

/**
 * Where a profiled road's bridge (paths and steps follow the terrain) passes over a drivable road
 * with less than that road's `maxheight` (UNDERPASS when untagged) plus a DECK between their
 * surfaces: one line per crossing, empty when every one keeps it.
 */
export const overpassShortfalls = (roads: ReadonlyArray<Road>): Array<string> => {
  const boxes = roads.map((r) => boxOf(r.pts))
  const out: Array<string> = []
  roads.forEach((up, i) => {
    if (up.bridge !== true || up.cls === "path" || up.cls === "steps") return
    const [ax0, ay0, ax1, ay1] = boxes[i]!
    roads.forEach((down, j) => {
      const [bx0, by0, bx1, by1] = boxes[j]!
      if (i === j || !isDrivable(down.cls) || !passesOver(up, down)) return
      if (ax0 > bx1 || bx0 > ax1 || ay0 > by1 || by0 > ay1) return
      const need = (down.maxheight ?? UNDERPASS) + DECK - ROUNDING
      for (const { x, y, k, m, t, u } of crossings(up.pts, down.pts)) {
        const zu = up.z[k]! + (up.z[k + 1]! - up.z[k]!) * t,
          zd = down.z[m]! + (down.z[m + 1]! - down.z[m]!) * u
        if (zu - zd < need)
          out.push(
            `${up.cls} bridge ${up.id} only ${(zu - zd).toFixed(2)} m over ${down.cls} ${down.id} at ${x.toFixed(0)},${y.toFixed(0)}`,
          )
      }
    })
  })
  return out
}

// The clearance check map.map-test.ts (the Lucido) and cesena.map-test.ts share: every drivable road
// under a road bridge keeps road-levels.ts's clearance under its deck.
import { DECK, passesOver, UNDERPASS } from "../../../tools/road-levels.ts"
import type { Road } from "../index.ts"
import { isDrivable } from "../kinds.ts"

/** The map's elevations are rounded to 0.1 m, so a gap can read up to this much short of the rule. */
const ROUNDING = 0.1

/** The [minX, minY, maxX, maxY] box of a flat polyline. */
const boxOf = (pts: ReadonlyArray<number>) => {
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
 * Where a profiled road's bridge (paths and steps follow the terrain) passes over a drivable road
 * with less than that road's `maxheight` (UNDERPASS when untagged) plus a DECK between their
 * surfaces: one line per crossing, empty when every one keeps it. A crossing at a vertex both
 * roads have is their junction, not an overpass.
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
      for (let k = 0; k + 3 < up.pts.length; k += 2)
        for (let m = 0; m + 3 < down.pts.length; m += 2) {
          const px = up.pts[k]!,
            py = up.pts[k + 1]!,
            ex = up.pts[k + 2]! - px,
            ey = up.pts[k + 3]! - py,
            qx = down.pts[m]!,
            qy = down.pts[m + 1]!,
            fx = down.pts[m + 2]! - qx,
            fy = down.pts[m + 3]! - qy,
            den = ex * fy - ey * fx
          if (den === 0) continue
          const t = ((qx - px) * fy - (qy - py) * fx) / den,
            u = ((qx - px) * ey - (qy - py) * ex) / den
          if (t < 0 || t > 1 || u < 0 || u > 1) continue
          const atVertex = (s: number) => s < 1e-6 || s > 1 - 1e-6
          if (atVertex(t) && atVertex(u)) continue
          const zu = up.z[k / 2]! + (up.z[k / 2 + 1]! - up.z[k / 2]!) * t,
            zd = down.z[m / 2]! + (down.z[m / 2 + 1]! - down.z[m / 2]!) * u
          if (zu - zd < need)
            out.push(
              `${up.cls} bridge ${up.id} only ${(zu - zd).toFixed(2)} m over ${down.cls} ${down.id} at ${(px + ex * t).toFixed(0)},${(py + ey * t).toFixed(0)}`,
            )
        }
    })
  })
  return out
}

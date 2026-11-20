// What the coast test region's map tests (coast-sea.map-test.ts, coast-shore.map-test.ts) both
// read off its built map: where a line ends, and the water that ends in the sea.
import type { JoinedMap } from "../map-file.ts"
import { inAreas } from "../water-areas.ts"

/** The point `by` m on past the last vertex of the flat line `pts`, along its last segment. */
export const pastEnd = (pts: ReadonlyArray<number>, by: number): { x: number; y: number } => {
  const n = pts.length / 2,
    x = pts[2 * n - 2]!,
    y = pts[2 * n - 1]!,
    dx = x - pts[2 * n - 4]!,
    dy = y - pts[2 * n - 3]!,
    d = Math.hypot(dx, dy)
  return { x: x + (dx / d) * by, y: y + (dy / d) * by }
}

/** The pieces of `map`'s water that end in the sea: 1 m on past each one's last vertex lies in it. */
export const intoSea = (map: JoinedMap): JoinedMap["water"] => {
  const sea = inAreas(map.areas, (kind) => kind === "sea")
  return map.water.filter((w) => {
    const p = pastEnd(w.pts, 1)
    return sea(p.x, p.y)
  })
}

/**
 * The road tunnels' lines, as the bake of their mouths reads them (`bakeMouths` in render/mouths):
 * the roads in a tunnel joined end to end, how long they are and how high the ground stands over
 * them, a point along one, a tunnel's end by its mouth (its lines from the mouth in, on along those
 * roads), and over that end how high the ground stands and whether a house stands over the way at
 * its level (a covered way, which the house hides).
 *
 * @module render/mouths/tunnel-lines
 */
import { pointInRing } from "../../sim/collide.ts"
import { terrainZ } from "../../sim/map/ground.ts"
import type { Building, Road } from "../../sim/map/index.ts"
import { buildingBox } from "../../sim/map/vectors.ts"

/** The ground over a road tunnel is sampled every this many metres along it. */
const SAMPLE = 2
/** Over a tunnel's end by its mouth, the ground and the houses are probed every this many metres along it: finer, so a house's corner over the way is not missed. */
const PROBE = 0.5

/** A road's line: its points and their elevations. */
type Line = Pick<Road, "pts" | "z">

/** The roads in a tunnel joined end to end with each road of `roads` that is in one (each a list of indices into `roads`). */
export const tunnelsOf = (roads: ReadonlyArray<Road>): Map<number, Array<number>> => {
  const at = new Map<string, Array<number>>()
  roads.forEach((road, i) => {
    if (road.tunnel !== true) return
    for (const k of [0, road.z.length - 1]) {
      const key = `${road.pts[2 * k]},${road.pts[2 * k + 1]}`
      at.set(key, [...(at.get(key) ?? []), i])
    }
  })
  const tunnels = new Map<number, Array<number>>()
  roads.forEach((road, i) => {
    if (road.tunnel !== true || tunnels.has(i)) return
    const tunnel = [i]
    for (let n = 0; n < tunnel.length; n++) {
      const { pts, z } = roads[tunnel[n]!]!
      for (const k of [0, z.length - 1])
        for (const j of at.get(`${pts[2 * k]},${pts[2 * k + 1]}`)!)
          if (!tunnel.includes(j)) tunnel.push(j)
    }
    for (const j of tunnel) tunnels.set(j, tunnel)
  })
  return tunnels
}

/** How long the roads `tunnel` of `roads` are together, m, and how high the ground stands over them at most (m over the road's profile, every SAMPLE m along them). */
export const measure = (
  roads: ReadonlyArray<Road>,
  tunnel: ReadonlyArray<number>,
): { readonly length: number; readonly cover: number } => {
  let length = 0,
    cover = Number.NEGATIVE_INFINITY
  for (const i of tunnel) {
    const { pts, z } = roads[i]!
    for (let k = 0; k + 1 < z.length; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        dx = pts[2 * k + 2]! - ax,
        dy = pts[2 * k + 3]! - ay,
        l = Math.hypot(dx, dy),
        n = Math.max(1, Math.ceil(l / SAMPLE))
      length += l
      for (let j = 0; j <= n; j++)
        cover = Math.max(
          cover,
          terrainZ(ax + (dx * j) / n, ay + (dy * j) / n) - (z[k]! + ((z[k + 1]! - z[k]!) * j) / n),
        )
    }
  }
  return { length, cover }
}

/**
 * The point `s` m into the tunnel along `road`'s line from its end `end` (index of its first or
 * last vertex), or its other end past that: map x, y and the profile there (m a.s.l.).
 */
export const inFrom = (
  road: Line,
  end: number,
  s: number,
): { readonly x: number; readonly y: number; readonly z: number } => {
  const step = end === 0 ? 1 : -1
  let left = s,
    k = end
  for (; k + step >= 0 && k + step < road.z.length; k += step) {
    const ax = road.pts[2 * k]!,
      ay = road.pts[2 * k + 1]!,
      bx = road.pts[2 * (k + step)]!,
      by = road.pts[2 * (k + step) + 1]!,
      l = Math.hypot(bx - ax, by - ay)
    if (left <= l) {
      const t = l > 0 ? left / l : 0
      return {
        x: ax + (bx - ax) * t,
        y: ay + (by - ay) * t,
        z: road.z[k]! + (road.z[k + step]! - road.z[k]!) * t,
      }
    }
    left -= l
  }
  return { x: road.pts[2 * k]!, y: road.pts[2 * k + 1]!, z: road.z[k]! }
}

/**
 * A tunnel's end by its mouth, the end `end` (index of its first or last vertex) of road `line` of
 * `roads`: its lines from the mouth in, each the road's line run on from where it ends along each
 * road of `tunnel` (the roads in a tunnel joined end to end with it, indices into `roads`) that
 * goes on from there, one for each way a fork takes, until `to` m long or the tunnel ends. A way
 * split into pieces inside a tunnel reads as the whole way.
 */
export const linesIn = (
  roads: ReadonlyArray<Road>,
  tunnel: ReadonlyArray<number>,
  line: number,
  end: number,
  to: number,
): Array<Line> => {
  // Road `i`'s line from its vertex `k` (its first or last) on, and how long it is.
  const from = (i: number, k: number) => {
    const { pts, z } = roads[i]!,
      order = z.map((_, j) => (k === 0 ? j : z.length - 1 - j)),
      line = {
        pts: order.flatMap((j) => [pts[2 * j]!, pts[2 * j + 1]!]),
        z: order.map((j) => z[j]!),
      }
    let length = 0
    for (let j = 2; j < line.pts.length; j += 2)
      length += Math.hypot(line.pts[j]! - line.pts[j - 2]!, line.pts[j + 1]! - line.pts[j - 1]!)
    return { ...line, length, road: i }
  }
  // The line `pts`, `z` (`length` m long, through the roads `used`) run on from where it ends.
  const grow = (
    pts: ReadonlyArray<number>,
    z: ReadonlyArray<number>,
    length: number,
    used: ReadonlyArray<number>,
  ): Array<Line> => {
    if (length >= to) return [{ pts, z }]
    const x = pts.at(-2)!,
      y = pts.at(-1)!,
      on = tunnel.flatMap((j) => {
        const { pts: next, z: rises } = roads[j]!
        return used.includes(j)
          ? []
          : [0, rises.length - 1].flatMap((k) =>
              next[2 * k] === x && next[2 * k + 1] === y ? [from(j, k)] : [],
            )
      })
    if (on.length === 0) return [{ pts, z }]
    return on.flatMap((leg) =>
      grow([...pts, ...leg.pts.slice(2)], [...z, ...leg.z.slice(1)], length + leg.length, [
        ...used,
        leg.road,
      ]),
    )
  }
  const own = from(line, end)
  return grow(own.pts, own.z, own.length, [line])
}

/** The points every PROBE m along each of `lines` (from a mouth in) up to `to` m in, each with the profile there. */
const probes = (lines: ReadonlyArray<Line>, to: number) => {
  const n = Math.max(1, Math.ceil(to / PROBE))
  return lines.flatMap((line) =>
    Array.from({ length: n + 1 }, (_, j) => inFrom(line, 0, (to * j) / n)),
  )
}

/** How high the ground stands at most (m over the profile) over `lines` (a tunnel's end by its mouth, `linesIn`) up to `to` m in, every PROBE m. */
export const groundOver = (lines: ReadonlyArray<Line>, to: number): number =>
  Math.max(...probes(lines, to).map(({ x, y, z }) => terrainZ(x, y) - z))

/**
 * Whether a building of `houses` stands over `lines` (a tunnel's end by its mouth, `linesIn`) at
 * the way's level up to `to` m in (probed every PROBE m), the ground under its lowest corner (`z0`)
 * less than `clear` m over the road there: a covered way, which the house hides. A house on the hill
 * over a bore hides nothing.
 */
export const housed = (
  lines: ReadonlyArray<Line>,
  to: number,
  clear: number,
  houses: ReadonlyArray<Building>,
): boolean =>
  probes(lines, to).some(({ x, y, z }) =>
    houses.some(
      ({ outer, holes, z0 }) =>
        z0 - z < clear &&
        pointInRing(x, y, outer) &&
        !(holes ?? []).some((hole) => pointInRing(x, y, hole)),
    ),
  )

/** A lookup of the buildings of `buildings` whose outer ring's box comes within `reach` m of map point (x, y). */
export const housesNear = (
  buildings: ReadonlyArray<Building>,
): ((x: number, y: number, reach: number) => Array<Building>) => {
  const boxes = buildings.map(({ outer }) => buildingBox(outer))
  return (x, y, reach) =>
    buildings.filter((_, i) => {
      const [minX, minY, maxX, maxY] = boxes[i]!
      return minX <= x + reach && maxX >= x - reach && minY <= y + reach && maxY >= y - reach
    })
}

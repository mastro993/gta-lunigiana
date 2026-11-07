/**
 * The road tunnels' lines, as the bake of their mouths reads them (`bakeMouths` in render/portals):
 * the roads in a tunnel joined end to end, how long they are and how high the ground stands over
 * them, a point along one, and, over a tunnel's end by its mouth, how high the ground stands and
 * whether a house stands over the way (a covered way, which the house hides).
 *
 * @module render/tunnel-lines
 */
import { pointInRing } from "../sim/collide.ts"
import { terrainZ } from "../sim/map/ground.ts"
import type { Building, Road } from "../sim/map/index.ts"
import { boxOver } from "./geometry.ts"

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

/** The points every PROBE m along `road`'s line from `from` to `to` m in from its end `end`, each with the profile there. */
const probes = (road: Line, end: number, from: number, to: number) => {
  const n = Math.max(1, Math.ceil((to - from) / PROBE))
  return Array.from({ length: n + 1 }, (_, j) => inFrom(road, end, from + ((to - from) * j) / n))
}

/** How high the ground stands at most (m over the profile) over `road`'s line from `from` to `to` m in from its end `end`, every PROBE m. */
export const groundOver = (road: Line, end: number, from: number, to: number): number =>
  Math.max(...probes(road, end, from, to).map(({ x, y, z }) => terrainZ(x, y) - z))

/** Whether a building of `houses` stands over `road`'s line within `to` m in from its end `end` (probed every PROBE m): a covered way, which the house hides. */
export const housed = (
  road: Line,
  end: number,
  to: number,
  houses: ReadonlyArray<Building>,
): boolean =>
  probes(road, end, 0, to).some(({ x, y }) =>
    houses.some(
      ({ outer, holes }) =>
        pointInRing(x, y, outer) && !(holes ?? []).some((hole) => pointInRing(x, y, hole)),
    ),
  )

/** A lookup of the buildings of `buildings` whose outer ring's box comes within `reach` m of map point (x, y). */
export const housesNear = (
  buildings: ReadonlyArray<Building>,
): ((x: number, y: number, reach: number) => Array<Building>) => {
  const boxes = buildings.map(({ outer }) => boxOver(outer))
  return (x, y, reach) =>
    buildings.filter((_, i) => {
      const [minX, minY, maxX, maxY] = boxes[i]!
      return minX <= x + reach && maxX >= x - reach && minY <= y + reach && maxY >= y - reach
    })
}

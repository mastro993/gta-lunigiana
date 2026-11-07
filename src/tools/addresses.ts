// Street names OSM has only on addresses (`addr:street` of shops, farms and houses), given to the
// play area's roads they name. An address stands by its own road, so it votes for its nearest OSM
// road way, whole and over every part's extract: an address by a road beyond the play area, or
// kilometres from any road in it, names none of them.
import { staticGrid } from "../sim/collide.ts"
import { extractRoads, type RoadF } from "./features.ts"
import { toLocal } from "./geometry.ts"
import type { Osm } from "./osm.ts"

/**
 * How far an address's vote reaches, m: a road whose nearest vertex lies farther is not its own.
 * The farthest right vote on Lunigiana's map is 32 m; the farm shop with `addr:street=SS63` stood
 * 604 m from the play area's road it named, 48 m from the SS63 itself.
 */
const REACH = 100

/**
 * Names `roads` (the play area's pieces) take from addresses: each address votes for the OSM road
 * way of `osm` with the vertex nearest it within REACH (the lower id on a tie), counted only where
 * that way has a piece in `roads` and none of them named. Each street name goes to the way most of
 * its addresses vote for (the lower id on a tie), whose pieces take it. The streets with more votes
 * for their way name first, so a way two streets vote for takes the one with more: Cesena's
 * 23562742, Via Fiorenzuola by 19 of its 50 addresses, not Via Emilia Levante by its 4.
 */
export const nameFromAddresses = (osm: Osm, roads: ReadonlyArray<RoadF>): void => {
  const pieces = new Map<number, Array<RoadF>>()
  for (const r of roads) {
    const of = pieces.get(r.id)
    if (of === undefined) pieces.set(r.id, [r])
    else of.push(r)
  }
  const open = new Set(
    [...pieces].flatMap(([id, of]) => (of.every((r) => r.name === undefined) ? [id] : [])),
  )
  // Every road way whole, its vertices flat (Lunigiana: 90,174 on 4,323 ways; Cesena: 16,550).
  const ways = extractRoads(osm, (pts) => [{ pts: [...pts], from: 0 }])
  const count = ways.reduce((n, w) => n + w.pts.length, 0)
  const xs = new Float64Array(count),
    ys = new Float64Array(count),
    ids = new Float64Array(count)
  let k = 0
  for (const w of ways)
    for (const p of w.pts) {
      xs[k] = p.x
      ys[k] = p.y
      ids[k++] = w.id
    }
  const near = staticGrid(count, (i) => [xs[i]!, ys[i]!, xs[i]!, ys[i]!], REACH)
  const votes = new Map<string, Map<number, number>>()
  for (const n of osm.nodes.values()) {
    const street = n.tags["addr:street"]
    if (street === undefined) continue
    const [x, y] = toLocal(n.lat, n.lon)
    let id = 0,
      least = REACH * REACH
    near(x - REACH, y - REACH, x + REACH, y + REACH, (i) => {
      const dx = xs[i]! - x,
        dy = ys[i]! - y,
        d = dx * dx + dy * dy
      if (d < least || (d === least && ids[i]! < id)) [id, least] = [ids[i]!, d]
    })
    if (!open.has(id)) continue
    const v = votes.get(street) ?? new Map<number, number>()
    v.set(id, (v.get(id) ?? 0) + 1)
    votes.set(street, v)
  }
  // Each street's way and its votes, most first (a stable sort: on a tie, the street seen first).
  const won = [...votes]
    .map(
      ([street, v]) => [street, ...[...v].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!] as const,
    )
    .sort((a, b) => b[2] - a[2])
  for (const [street, id] of won) {
    const name = street.startsWith("Via") ? street : `Via ${street}`
    for (const r of pieces.get(id)!) r.name ??= name
  }
}

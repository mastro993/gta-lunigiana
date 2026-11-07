// The checks of road tunnels' mouths, portals and head walls that tunnels.test.ts and the tunnels
// map tests share (through tunnel-checks.ts): where the mouths are, a portal or an underpass's head
// wall facing out of the hill in the road bridges' colour, standing clear of every other road and
// the track, or none, and why none, by geometry.
import assert from "node:assert/strict"

import { pointInRing, segDist2 } from "../../sim/collide.ts"
import { ROAD_LIFT, roadZ, terrainZ } from "../../sim/map/ground.ts"
import { MAP, outlineDistance, type Road, roadClassOf } from "../../sim/map/index.ts"
import type { Layer } from "../../sim/map/packed.ts"
import { boreOf, UNDER } from "../bores.ts"
import { boxOver, emptySink, type Piece, type Sink } from "../geometry.ts"
import { terrainY, yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { leastWall, portalPieces } from "../portals.ts"
import type { Vectors } from "../testing.ts"
import { type Tri, trianglesOf } from "./rail-checks.ts"

/** `piece` drawn whole into one sink. */
export const drawn = (piece: Piece): Sink => {
  const all = emptySink()
  piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
  return all
}

/** A road tunnel's mouth: its road (index in the whole map's roads), its end and the heading out of the hill (rad). */
export interface Mouth {
  readonly road: number
  readonly x: number
  readonly y: number
  readonly angle: number
}

/** An end of a road's line, and the heading out along it from the vertex before it over 5 m or more. */
const endOf = (road: Road, end: 0 | 1) => {
  const n = road.z.length,
    k = end === 0 ? 0 : n - 1,
    step = end === 0 ? 1 : -1,
    x = road.pts[2 * k]!,
    y = road.pts[2 * k + 1]!
  let i = k + step
  while (i > 0 && i < n - 1 && Math.hypot(road.pts[2 * i]! - x, road.pts[2 * i + 1]! - y) < 5)
    i += step
  return { x, y, angle: Math.atan2(y - road.pts[2 * i + 1]!, x - road.pts[2 * i]!) }
}

/** The ends of `road` as mouths, heading out along it. */
export const endsOf = (road: Road, id: number): Array<Mouth> =>
  ([0, 1] as const).map((end) => ({ road: id, ...endOf(road, end) }))

/**
 * The mouths of the road tunnels of `roads` (the whole map's, or every road within reach of the
 * tunnels it is asked about): each end of a road in a tunnel, not a building passage, that no other
 * road in a tunnel ends at, inside the play area (farther than 0.5 m from its outline, where a road
 * runs on past it).
 */
export const mouthsOf = ({ ids, items }: Layer<Road>): Array<Mouth> => {
  const ends = new Map<string, number>()
  for (const road of items)
    if (road.tunnel === true)
      for (const k of [0, road.z.length - 1]) {
        const key = `${road.pts[2 * k]},${road.pts[2 * k + 1]}`
        ends.set(key, (ends.get(key) ?? 0) + 1)
      }
  return items.flatMap((road, n) =>
    road.tunnel !== true || road.passage === true
      ? []
      : ([0, 1] as const).flatMap((end) => {
          const { x, y, angle } = endOf(road, end)
          return ends.get(`${x},${y}`) === 1 && outlineDistance(x, y) > 0.5
            ? [{ road: ids[n]!, x, y, angle }]
            : []
        }),
  )
}

/** Road `road`'s profile (m a.s.l.) where its line passes nearest map point (x, y). */
const profileAt = (road: Road, x: number, y: number): number => {
  let best = Number.POSITIVE_INFINITY,
    z = road.z[0]!
  for (let k = 0; k + 1 < road.z.length; k++) {
    const { d2, t } = segDist2(
      x,
      y,
      road.pts[2 * k]!,
      road.pts[2 * k + 1]!,
      road.pts[2 * k + 2]!,
      road.pts[2 * k + 3]!,
    )
    if (d2 < best) [best, z] = [d2, road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t]
  }
  return z
}

/** The portal or head wall standing at map point (x, y). */
const portalAt = (x: number, y: number): Piece => {
  const piece = portalPieces().find(({ pts }) => pts[0] === x && pts[1] === y)
  assert.ok(piece !== undefined, `no portal at (${x}, ${y})`)
  return piece
}

/** The dark triangles of `solid` within reach of road `road`'s carriageway at `mouth`, each facing out of the hill (its normal across within 37° of the heading out). */
const darkMouth = (solid: Sink["solid"], road: Road, mouth: Mouth): Array<Tri> => {
  const reach = road.w / 2 + 2,
    dark = trianglesOf(solid, PALETTE.tunnelDark).filter((tri) =>
      tri.every(([px, , pz]) => Math.hypot(px - mouth.x, -pz - mouth.y) < reach),
    )
  const ox = Math.cos(mouth.angle),
    oy = Math.sin(mouth.angle)
  for (const [a, b, c] of dark) {
    // The triangle's normal across (x, z of three space) against the way out (map ox, oy is three ox, −oy).
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    assert.ok((nx * ox - nz * oy) / Math.hypot(nx, nz) > 0.8, "facing out of the hill")
  }
  return dark
}

/**
 * The portal at `mouth` of road `road` (where it stands: the road's end, or stood back into the
 * tunnel): a dark mouth of 6 triangles or more facing out of the hill, its crown over the road's
 * clearance (OSM's `maxheight`, 4 m untagged), and a face in `face`'s colour (concrete on the main,
 * provincial and unclassified roads, old stone on the rest).
 */
export const checkPortal = (road: Road, mouth: Mouth, face: number): void => {
  const { solid } = drawn(portalAt(mouth.x, mouth.y)),
    dark = darkMouth(solid, road, mouth)
  assert.ok(dark.length >= 6, `the mouth at ${mouth.x}, ${mouth.y}: ${dark.length} dark triangles`)
  const floor = yOf(profileAt(road, mouth.x, mouth.y))
  assert.ok(
    dark.some((tri) => tri.some(([, h]) => h > floor + (road.maxheight ?? 4))),
    "a crown over the road's clearance",
  )
  assert.ok(trianglesOf(solid, face).length >= 6, "its face in the road bridges' colour")
}

/**
 * The head wall at `mouth`, the end of road `road`: a dark opening facing out of the hill, as wide
 * as the bore and flat at its clear height (OSM's `maxheight`, 4 m untagged) over the road's
 * surface; a face in `face`'s colour (concrete on the main, provincial and unclassified roads, old
 * stone on the rest); and its top UNDER or more under the bank its box meets, the highest ground
 * over the box's axis (its face wall's metre and `throat` m behind it), so it never stands out of
 * its bank.
 */
export const checkHeadWall = (road: Road, mouth: Mouth, face: number, throat: number): void => {
  const { solid } = drawn(portalAt(mouth.x, mouth.y)),
    dark = darkMouth(solid, road, mouth),
    { half, clear } = boreOf(road),
    floor = yOf(profileAt(road, mouth.x, mouth.y) + ROAD_LIFT[roadClassOf(road)]),
    where = `the head wall at (${mouth.x.toFixed(1)}, ${mouth.y.toFixed(1)})`
  assert.ok(dark.length >= 2, `${where}: ${dark.length} dark triangles`)
  const ux = Math.cos(mouth.angle),
    uy = Math.sin(mouth.angle),
    corners = dark.flat(),
    tops = corners.map(([, h]) => h - floor),
    across = corners.map(([px, , pz]) => Math.abs((-pz - mouth.y) * ux - (px - mouth.x) * uy))
  assert.ok(
    Math.abs(Math.max(...tops) - clear) < 1e-6,
    `${where}: its opening ${Math.max(...tops).toFixed(2)} m high, not ${clear} m`,
  )
  assert.ok(
    Math.abs(Math.max(...across) - half) < 1e-6,
    `${where}: its opening ${Math.max(...across).toFixed(2)} m either side, not the bore's ${half} m`,
  )
  assert.ok(trianglesOf(solid, face).length >= 6, `${where}: its face in the road bridges' colour`)
  let top = Number.NEGATIVE_INFINITY
  for (let t = 1; t < solid.position.length; t += 3) top = Math.max(top, solid.position[t]!)
  let bank = Number.NEGATIVE_INFINITY
  for (let a = 0; a <= 1 + throat; a += 0.25)
    bank = Math.max(bank, terrainY(mouth.x - ux * a, mouth.y - uy * a))
  assert.ok(
    top <= bank - UNDER + 1e-6,
    `${where}: its top ${(top - floor).toFixed(2)} m over the road, the bank its box meets ${(bank - floor).toFixed(2)} m`,
  )
}

/** No portal stands within 5 m of map point (x, y). */
export const checkNoPortal = (x: number, y: number): void => {
  const near = portalPieces().filter(({ pts }) => Math.hypot(pts[0]! - x, pts[1]! - y) < 5)
  assert.equal(near.length, 0, `a portal by (${x}, ${y})`)
}

/**
 * A portal stood `back` m into the tunnel from its mouth `end` (an end of road `road`): on the
 * road's line `back` m in, and facing out along it.
 */
export const checkStoodBack = (road: Road, end: Mouth, at: Mouth, back: number): void => {
  const first = end.x === road.pts[0] && end.y === road.pts[1],
    n = road.z.length,
    order = Array.from({ length: n }, (_, k) => (first ? k : n - 1 - k))
  let left = back
  for (let i = 0; i + 1 < n; i++) {
    const a = order[i]!,
      b = order[i + 1]!,
      dx = road.pts[2 * b]! - road.pts[2 * a]!,
      dy = road.pts[2 * b + 1]! - road.pts[2 * a + 1]!,
      l = Math.hypot(dx, dy)
    if (left > l) {
      left -= l
      continue
    }
    const x = road.pts[2 * a]! + (dx * left) / l,
      y = road.pts[2 * a + 1]! + (dy * left) / l
    assert.ok(
      Math.hypot(at.x - x, at.y - y) < 1e-6,
      `the portal ${back} m into road ${road.id}'s tunnel from (${end.x}, ${end.y}) stands on its line`,
    )
    assert.ok(
      -(Math.cos(at.angle) * dx + Math.sin(at.angle) * dy) / l > 0.9,
      `the portal ${back} m into road ${road.id}'s tunnel faces out along it`,
    )
    return
  }
  assert.fail(`road ${road.id}'s tunnel is shorter than ${back} m`)
}

/** A track's bed, m either side of its centreline: its shoulders' foot (`BED` in render/rail). */
const BED = 2.1
/** A segment a portal must keep off: its ends, its surface's height (render y) at a point `t` of the way along it, its half width, whether it carries on out of the mouth. */
interface Way {
  readonly a: readonly [number, number]
  readonly b: readonly [number, number]
  readonly at: (t: number) => number
  readonly half: number
  readonly out: boolean
  readonly name: string
}

/** The roads of `roads` (by id) in road `id`'s tunnel: the roads in a tunnel joined end to end with it. */
const tunnelOf = ({ ids, items }: Layer<Road>, id: number): Set<number> => {
  const own = new Set([id]),
    keyOf = (road: Road, k: number) => `${road.pts[2 * k]},${road.pts[2 * k + 1]}`
  for (let grew = true; grew;) {
    grew = false
    const ends = new Set(
      items.flatMap((road, i) =>
        own.has(ids[i]!) ? [keyOf(road, 0), keyOf(road, road.z.length - 1)] : [],
      ),
    )
    items.forEach((road, i) => {
      if (road.tunnel !== true || own.has(ids[i]!)) return
      if (ends.has(keyOf(road, 0)) || ends.has(keyOf(road, road.z.length - 1))) {
        own.add(ids[i]!)
        grew = true
      }
    })
  }
  return own
}

/**
 * The segments within 80 m of map point (x, y) of every road of `roads` but those of the tunnel of
 * the mouth `end` (`tunnelOf`) and of the track out of tunnels; one from `end` out of the hill
 * carries on out of the mouth.
 */
const waysNear = ({ ids, items }: Layer<Road>, end: Mouth, x: number, y: number): Array<Way> => {
  const own = tunnelOf({ ids, items }, end.road),
    ox = Math.cos(end.angle),
    oy = Math.sin(end.angle),
    ways: Array<Way> = []
  const add = (
    pts: ReadonlyArray<number>,
    z: ReadonlyArray<number>,
    half: number,
    name: string,
    surface: (z: number, x: number, y: number) => number,
  ) => {
    for (let k = 0; k + 1 < z.length; k++) {
      const a = [pts[2 * k]!, pts[2 * k + 1]!] as const,
        b = [pts[2 * k + 2]!, pts[2 * k + 3]!] as const
      if (segDist2(x, y, a[0], a[1], b[0], b[1]).d2 > 80 ** 2) continue
      const out =
        (a[0] === end.x && a[1] === end.y && (b[0] - end.x) * ox + (b[1] - end.y) * oy > 0) ||
        (b[0] === end.x && b[1] === end.y && (a[0] - end.x) * ox + (a[1] - end.y) * oy > 0)
      ways.push({
        a,
        b,
        at: (t) =>
          yOf(
            surface(
              z[k]! + (z[k + 1]! - z[k]!) * t,
              a[0] + (b[0] - a[0]) * t,
              a[1] + (b[1] - a[1]) * t,
            ),
          ),
        half,
        out,
        name,
      })
    }
  }
  items.forEach((road, i) => {
    if (own.has(ids[i]!)) return
    const lift = ROAD_LIFT[roadClassOf(road)],
      lifted = road.bridge === true || road.tunnel === true
    add(road.pts, road.z, road.w / 2, `road ${road.id} (${road.cls})`, (z, x, y) =>
      roadZ(z, x, y, lift, lifted),
    )
  })
  for (const rail of MAP.rail)
    if (rail.tunnel !== true) add(rail.pts, rail.z, BED, `the track ${rail.id}`, (z) => z)
  return ways
}

/**
 * The portal or head wall of road `road`'s tunnel at its mouth `end`, standing at `at`, stands on
 * no other road of `roads` (no road of its tunnel: the roads in a tunnel joined end to end with it)
 * nor on the track: every 0.25 m over the tops of its face wall, cornice and throat, no carriageway
 * (a track's bed) reaches under them, from their foot to 5 cm under their top, but where a road
 * carrying on out of the mouth fills the arch (the bore's width either side of the portal's axis).
 */
export const checkClear = (roads: Layer<Road>, end: Mouth, at: Mouth): void => {
  const ways = waysNear(roads, end, at.x, at.y)
  // The ways in 4 m cells by their carriageways' boxes.
  const cells = new Map<string, Array<Way>>(),
    cell = (x: number, y: number) => `${Math.floor(x / 4)},${Math.floor(y / 4)}`
  for (const way of ways)
    for (
      let i = Math.floor((Math.min(way.a[0], way.b[0]) - way.half) / 4);
      i <= Math.floor((Math.max(way.a[0], way.b[0]) + way.half) / 4);
      i++
    )
      for (
        let j = Math.floor((Math.min(way.a[1], way.b[1]) - way.half) / 4);
        j <= Math.floor((Math.max(way.a[1], way.b[1]) + way.half) / 4);
        j++
      )
        cells.set(`${i},${j}`, [...(cells.get(`${i},${j}`) ?? []), way])
  const solid = drawn(portalAt(at.x, at.y)).solid,
    tris: Array<Tri> = []
  for (let t = 0; t < solid.position.length; t += 9)
    tris.push(
      [0, 1, 2].map((i) => solid.position.slice(t + 3 * i, t + 3 * i + 3)) as unknown as Tri,
    )
  const foot = Math.min(...tris.flatMap((tri) => tri.map(([, h]) => h))),
    arch = boreOf(MAP.roads[end.road]!).half,
    ux = Math.cos(at.angle),
    uy = Math.sin(at.angle)
  for (const [a, b, c] of tris) {
    // A top: its normal up.
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      ny = u[2]! * v[0]! - u[0]! * v[2]!,
      nl = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, ny, u[0]! * v[1]! - u[1]! * v[0]!)
    if (nl < 1e-9 || ny < 0.9 * nl) continue
    const m = Math.ceil(Math.max(Math.hypot(u[0]!, u[2]!), Math.hypot(v[0]!, v[2]!)) / 0.25)
    for (let i = 0; i <= m; i++)
      for (let j = 0; i + j <= m; j++) {
        const x = a[0] + (u[0]! * i + v[0]! * j) / m,
          h = a[1] + (u[1]! * i + v[1]! * j) / m,
          y = -(a[2] + (u[2]! * i + v[2]! * j) / m),
          across = Math.abs((y - at.y) * ux - (x - at.x) * uy)
        for (const way of cells.get(cell(x, y)) ?? []) {
          const { d2, t } = segDist2(x, y, way.a[0], way.a[1], way.b[0], way.b[1])
          if (d2 >= (way.half - 0.05) ** 2 || (way.out && across <= arch)) continue
          const surface = way.at(t)
          assert.ok(
            surface <= foot + 0.05 || surface >= h - 0.05,
            `the portal at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}) stands ${(h - surface).toFixed(2)} m over ${way.name} at (${x.toFixed(1)}, ${y.toFixed(1)})`,
          )
        }
      }
  }
}

/** Why a road tunnel's mouth has neither a portal nor a head wall: a house over its end of the tunnel, the ground over that end lower than a head wall, or no room for either. */
export type Open = "housed" | "low" | "crowded"

/**
 * Why the mouth `end` (of the whole map's roads and buildings, or those round it, `vectors`) is
 * open, from what stands round it. Its end of the tunnel is its road's line from the mouth 40 m in,
 * run on along the roads of its tunnel that go on from it, short of the tunnel's middle, probed
 * every 0.25 m: a house stands over the way there at its level, the ground under its lowest corner
 * less than the clear height over the road ("housed": a covered way, which the house hides); else
 * the ground over it never rises as high over the road as a head wall's top and its margin
 * (`leastWall`: "low"); else another road or the track runs through the room a head wall and its
 * box would take, beside the bore's axis and between the road and that height ("crowded"), or it
 * fails.
 */
export const whyOpen = ({ roads, buildings }: Vectors, end: Mouth): Open => {
  const own = tunnelOf(roads, end.road),
    road = roads.items[roads.ids.indexOf(end.road)]!
  let length = 0
  roads.items.forEach(({ pts }, i) => {
    if (own.has(roads.ids[i]!))
      for (let k = 2; k < pts.length; k += 2)
        length += Math.hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!)
  })
  const span = Math.min(40, length / 2),
    probes: Array<{ readonly x: number; readonly y: number; readonly z: number }> = []
  // Along `line` from its first vertex (`ahead`) or its last, `from` m into the tunnel there, then
  // on along each road of the tunnel that goes on from where it ends (each way a fork takes).
  const walk = (line: Road, ahead: boolean, from: number, used: ReadonlySet<Road>): void => {
    const n = line.z.length,
      order = Array.from({ length: n }, (_, k) => (ahead ? k : n - 1 - k))
    let s = from
    for (let i = 0; i + 1 < n && s <= span; i++) {
      const a = order[i]!,
        b = order[i + 1]!,
        l = Math.hypot(
          line.pts[2 * b]! - line.pts[2 * a]!,
          line.pts[2 * b + 1]! - line.pts[2 * a + 1]!,
        )
      for (let d = Math.ceil(s / 0.25) * 0.25 - s; d <= l && s + d <= span; d += 0.25) {
        const t = l > 0 ? d / l : 0
        probes.push({
          x: line.pts[2 * a]! + (line.pts[2 * b]! - line.pts[2 * a]!) * t,
          y: line.pts[2 * a + 1]! + (line.pts[2 * b + 1]! - line.pts[2 * a + 1]!) * t,
          z: line.z[a]! + (line.z[b]! - line.z[a]!) * t,
        })
      }
      s += l
    }
    if (s > span) return
    const x = line.pts[2 * order[n - 1]!]!,
      y = line.pts[2 * order[n - 1]! + 1]!
    roads.items.forEach((next, i) => {
      if (!own.has(roads.ids[i]!) || used.has(next)) return
      const last = next.z.length - 1
      for (const k of [0, last])
        if (next.pts[2 * k] === x && next.pts[2 * k + 1] === y)
          walk(next, k === 0, s, new Set([...used, next]))
    })
  }
  const first = road.pts[0] === end.x && road.pts[1] === end.y
  walk(road, first, 0, new Set([road]))
  // The houses whose box comes within `span` of the mouth.
  const houses = buildings.items.filter(({ outer }) => {
    const [minX, minY, maxX, maxY] = boxOver(outer)
    return (
      minX <= end.x + span && maxX >= end.x - span && minY <= end.y + span && maxY >= end.y - span
    )
  })
  // A house at the way's level (its lowest corner's ground under the clear height over the road),
  // not one on the hill over a bore.
  const { clear } = boreOf(road)
  if (
    probes.some(({ x, y, z }) =>
      houses.some(
        ({ outer, holes, z0 }) =>
          z0 - z < clear &&
          pointInRing(x, y, outer) &&
          !(holes ?? []).some((hole) => pointInRing(x, y, hole)),
      ),
    )
  )
    return "housed"
  const least = leastWall(road)
  if (Math.max(...probes.map(({ x, y, z }) => terrainZ(x, y) - z)) < least) return "low"
  const floor = yOf(road.z[first ? 0 : road.z.length - 1]! + ROAD_LIFT[roadClassOf(road)]),
    ux = Math.cos(end.angle),
    uy = Math.sin(end.angle),
    room = boreOf(road).half + 2
  const crowding = waysNear(roads, end, end.x, end.y).find((way) => {
    if (way.out) return false
    const m = Math.max(1, Math.ceil(Math.hypot(way.b[0] - way.a[0], way.b[1] - way.a[1]) / 0.25))
    for (let j = 0; j <= m; j++) {
      const x = way.a[0] + ((way.b[0] - way.a[0]) * j) / m,
        y = way.a[1] + ((way.b[1] - way.a[1]) * j) / m,
        deep = (end.x - x) * ux + (end.y - y) * uy,
        across = Math.abs((y - end.y) * ux - (x - end.x) * uy),
        over = way.at(j / m) - floor
      if (
        deep >= -2 - way.half &&
        deep <= span + 1 + way.half &&
        across <= room + way.half &&
        over >= 0 &&
        over <= least
      )
        return true
    }
    return false
  })
  assert.ok(
    crowding !== undefined,
    `the mouth at (${end.x.toFixed(1)}, ${end.y.toFixed(1)}) is open, though the ground over it rises to ${least.toFixed(2)} m and nothing stands in the way of a head wall`,
  )
  return "crowded"
}

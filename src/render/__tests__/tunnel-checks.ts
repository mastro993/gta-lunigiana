// The checks tunnels.test.ts (the SR445's tunnel by Groppoli, the 196 m track east of Equi Terme
// and Via Casola's building passage) and the tunnels map tests (every road tunnel of Lunigiana,
// Cesena and the L) share: a road in a tunnel drawn at its floor, its bore's dark walls under the
// hill, a portal at every mouth the hill stands over, a passage's road on under its house.
import assert from "node:assert/strict"

import { ROAD_LIFT, terrainZ } from "../../sim/map/ground.ts"
import { MAP, outlineDistance, type Road, roadClassOf } from "../../sim/map/index.ts"
import type { Layer } from "../../sim/map/packed.ts"
import { tileVectors } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS, chunkOf } from "../chunks.ts"
import { type Piece, type Sink, Triangles, WaterTriangles } from "../geometry.ts"
import { terrainY, yOf } from "../ground.ts"
import { bridgeHex, roadHex, roadPieces } from "../lines.ts"
import { PALETTE } from "../palette.ts"
import { Pieces } from "../pieces.ts"
import { leastCover, portalPieces } from "../portals.ts"
import type { Vectors } from "../testing.ts"
import { assertChunkCut, wholeBuild } from "./chunk-cut.ts"
import { heightIn, type Tri, trianglesOf } from "./rail-checks.ts"

const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})

/** `piece` drawn whole into one sink. */
const drawn = (piece: Piece): Sink => {
  const all = sink()
  piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
  return all
}

/** Points every `step` m along `road`'s line (its ends left out), each with the road's profile there, m a.s.l. */
const along = (
  road: Road,
  step: number,
): Array<{ readonly x: number; readonly y: number; readonly z: number }> => {
  const out = []
  for (let k = 0; k + 1 < road.z.length; k++) {
    const ax = road.pts[2 * k]!,
      ay = road.pts[2 * k + 1]!,
      bx = road.pts[2 * k + 2]!,
      by = road.pts[2 * k + 3]!,
      n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let j = 1; j < n; j++) {
      const t = j / n
      out.push({
        x: ax + (bx - ax) * t,
        y: ay + (by - ay) * t,
        z: road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t,
      })
    }
  }
  return out
}

/** The cells (m) the ribbon checks bucket triangles in. */
const CELL = 2

/** `tris` bucketed in CELL m cells by their boxes, seen from above: a lookup of those that may cover map point (x, y). */
const bucketed = (tris: ReadonlyArray<Tri>): ((x: number, y: number) => ReadonlyArray<Tri>) => {
  const cells = new Map<string, Array<Tri>>()
  for (const tri of tris) {
    const xs = tri.map(([x]) => x),
      ys = tri.map(([, , z]) => -z)
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
      for (
        let j = Math.floor(Math.min(...ys) / CELL);
        j <= Math.floor(Math.max(...ys) / CELL);
        j++
      ) {
        const key = `${i},${j}`
        const list = cells.get(key)
        if (list === undefined) cells.set(key, [tri])
        else list.push(tri)
      }
  }
  return (x, y) => cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []
}

/**
 * Road `road` in a tunnel has its ribbon along its whole line at its floor, as the sim stands
 * wheels and feet on it (its profile and `ROAD_LIFT`, never the hill over it): every 2 m along it,
 * a triangle of its surface's colour covers the centreline, 2 cm or less off that height. Returns
 * how many points it checked.
 */
export const checkRibbon = (road: Road): number => {
  const pieces = roadPieces(road)
  assert.ok(pieces.length > 0, `road ${road.id} in a tunnel: no piece drawn`)
  const near = bucketed(trianglesOf(drawn(pieces[0]!).decal, roadHex(road))),
    lift = ROAD_LIFT[roadClassOf(road)]
  const points = along(road, 2)
  for (const { x, y, z } of points) {
    const floor = yOf(z + lift),
      heights = near(x, y).flatMap((tri) => heightIn(tri, x, y) ?? [])
    assert.ok(
      heights.some((h) => Math.abs(h - floor) <= 0.02),
      `road ${road.id} in a tunnel: no ribbon at its floor at (${x.toFixed(1)}, ${y.toFixed(1)}): ${heights.map((h) => (h - floor).toFixed(2)).join(", ") || "none"}`,
    )
  }
  return points.length
}

/**
 * Road `road` in a tunnel draws its bore's walls, dark, every corner of them 0.2 m or more under
 * the terrain (they never stand out of the hill), and nothing else solid: none for a building
 * passage, whose house stands over it. Returns how many wall triangles it draws.
 */
export const checkBore = (road: Road): number => {
  const solid = roadPieces(road)
    .slice(1)
    .map((piece) => drawn(piece).solid)
  const all = solid.flatMap((tris) => trianglesOf(tris, PALETTE.tunnelDark))
  assert.equal(
    all.length,
    solid.reduce((n, tris) => n + tris.position.length / 9, 0),
    `road ${road.id} in a tunnel: nothing but its dark walls`,
  )
  for (const tri of all)
    for (const [x, h, z] of tri)
      assert.ok(
        h <= terrainY(x, -z) - 0.2 + 1e-6,
        `road ${road.id}: a wall corner ${(h - terrainY(x, -z)).toFixed(2)} m over the terrain at (${x.toFixed(1)}, ${(-z).toFixed(1)})`,
      )
  return all.length
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

/**
 * The portal at `mouth` of road `road`: a dark mouth of 6 triangles or more facing out of the hill,
 * its crown over the road's clearance (OSM's `maxheight`, 4 m untagged), and a face in `face`'s
 * colour (concrete on the main, provincial and unclassified roads, old stone on the rest).
 */
export const checkPortal = (road: Road, mouth: Mouth, face: number): void => {
  const piece = portalPieces().find(({ pts }) => pts[0] === mouth.x && pts[1] === mouth.y)
  assert.ok(piece !== undefined, `no portal at road ${road.id}'s mouth (${mouth.x}, ${mouth.y})`)
  const { solid } = drawn(piece),
    reach = road.w / 2 + 2
  const dark = trianglesOf(solid, PALETTE.tunnelDark).filter((tri) =>
    tri.every(([px, , pz]) => Math.hypot(px - mouth.x, -pz - mouth.y) < reach),
  )
  assert.ok(dark.length >= 6, `the mouth at ${mouth.x}, ${mouth.y}: ${dark.length} dark triangles`)
  const end = mouth.x === road.pts[0] && mouth.y === road.pts[1] ? 0 : road.z.length - 1,
    floor = yOf(road.z[end]!)
  assert.ok(
    dark.some((tri) => tri.some(([, h]) => h > floor + (road.maxheight ?? 4))),
    "a crown over the road's clearance",
  )
  const ox = Math.cos(mouth.angle),
    oy = Math.sin(mouth.angle)
  for (const [a, b, c] of dark) {
    // The triangle's normal across (x, z of three space) against the way out (map ox, oy is three ox, −oy).
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    assert.ok((nx * ox - nz * oy) / Math.hypot(nx, nz) > 0.8, "facing out of the hill")
  }
  assert.ok(trianglesOf(solid, face).length >= 6, "its face in the road bridges' colour")
}

/** No portal stands within 5 m of map point (x, y). */
export const checkNoPortal = (x: number, y: number): void => {
  const near = portalPieces().filter(({ pts }) => Math.hypot(pts[0]! - x, pts[1]! - y) < 5)
  assert.equal(near.length, 0, `a portal by (${x}, ${y})`)
}

/** The ends of `road` as mouths, heading out along it. */
export const endsOf = (road: Road, id: number): Array<Mouth> =>
  ([0, 1] as const).map((end) => ({ road: id, ...endOf(road, end) }))

/** What a region's road tunnels are, which its map test pins so that a change to them shows. */
export interface TunnelCounts {
  /** Roads in a tunnel, the building passages among them, and how long they are together, whole metres. */
  readonly tunnels: number
  readonly passages: number
  readonly metres: number
  /** The tunnels' mouths, and the portals at those the hill stands over (the rest are open). */
  readonly mouths: number
  readonly portals: number
}

/** The chunks over the map box (minX, minY)–(maxX, maxY). */
const chunksOver = (minX: number, minY: number, maxX: number, maxY: number): Array<number> => {
  const lo = chunkOf(minX, minY),
    hi = chunkOf(maxX, maxY),
    out = []
  for (let cy = Math.floor(lo / CHUNKS.x); cy <= Math.floor(hi / CHUNKS.x); cy++)
    for (let cx = lo % CHUNKS.x; cx <= hi % CHUNKS.x; cx++) out.push(cy * CHUNKS.x + cx)
  return out
}

/**
 * Checks every road tunnel of the map the sim has loaded (`whole`: all its vectors): each road in a
 * tunnel draws its ribbon at its floor and its bore's walls under the hill (none through a building
 * passage); the build baked its mouths (`MAP.derived.mouths`) as `mouthsOf` finds them, every one
 * and no other; at each with a portal the portal faces out of the hill in the road bridges' colour,
 * and at each open one no portal stands and the ground over its road never rises high enough for
 * one (`leastCover`); and the chunks over each road in a tunnel, 60 m round, built from the pieces of the
 * map's tiles, keep exactly their cut of a whole-map build. Returns the counts.
 */
export const checkTunnels = (whole: Vectors): TunnelCounts => {
  const { roads } = whole,
    tunnels = roads.items.flatMap((road, k) =>
      road.tunnel === true ? [[road, roads.ids[k]!] as const] : [],
    )
  let metres = 0
  for (const [road] of tunnels) {
    checkRibbon(road)
    const walls = checkBore(road)
    if (road.passage === true) assert.equal(walls, 0, `building passage ${road.id}: no walls`)
    for (let k = 2; k < road.pts.length; k += 2)
      metres += Math.hypot(road.pts[k]! - road.pts[k - 2]!, road.pts[k + 1]! - road.pts[k - 1]!)
  }
  // Every mouth the build baked is one, and every one is baked, in the roads' order.
  const found = mouthsOf(roads),
    baked = MAP.derived.mouths
  assert.deepEqual(
    baked.map(({ road, x, y }) => [road, x, y]),
    found.map(({ road, x, y }) => [road, x, y]),
    "the baked mouths are the tunnels' mouths",
  )
  let portals = 0
  for (const [n, mouth] of baked.entries()) {
    const road = MAP.roads[mouth.road]!,
      line = roads.items[roads.ids.indexOf(mouth.road)]!
    assert.ok(
      Math.abs(mouth.angle - found[n]!.angle) < 1e-9,
      `the mouth at ${mouth.x}, ${mouth.y} heads out of the hill`,
    )
    if ("open" in mouth) {
      checkNoPortal(mouth.x, mouth.y)
      const least = leastCover(road)
      for (const { x, y, z } of along(line, 2))
        assert.ok(
          terrainZ(x, y) - z < least,
          `open mouth at ${mouth.x}, ${mouth.y}: the ground ${(terrainZ(x, y) - z).toFixed(1)} m over its road at (${x.toFixed(1)}, ${y.toFixed(1)})`,
        )
    } else {
      checkPortal(line, mouth, bridgeHex(road))
      portals++
    }
  }
  // The chunks over every road in a tunnel, as a whole-map build cuts them.
  const plan = chunkTiles(),
    pieces = new Pieces(plan),
    build = wholeBuild(whole)
  for (const [t, key] of plan.keys.entries()) pieces.provide(t, tileVectors(key))
  for (const [road] of tunnels) {
    const xs = road.pts.filter((_, k) => k % 2 === 0),
      ys = road.pts.filter((_, k) => k % 2 === 1)
    assertChunkCut(
      build,
      pieces,
      chunksOver(
        Math.min(...xs) - 60,
        Math.min(...ys) - 60,
        Math.max(...xs) + 60,
        Math.max(...ys) + 60,
      ),
    )
  }
  return {
    tunnels: tunnels.length,
    passages: tunnels.filter(([road]) => road.passage === true).length,
    metres: Math.round(metres),
    mouths: baked.length,
    portals,
  }
}

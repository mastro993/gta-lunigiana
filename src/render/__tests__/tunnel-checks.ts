// The checks tunnels.test.ts (the SR445's tunnel by Groppoli, the 196 m track east of Equi Terme,
// the 87 m path under the line at Equi Terme, Pieve San Lorenzo's underpass and Via Casola's
// building passage) and the tunnels map tests (every road tunnel of Lunigiana, Cesena and the L)
// share: a road in a tunnel drawn at its floor, its bore's dark walls under the hill along both its
// sides, a portal or a head wall clear of every other road at every mouth the hill stands over, or
// a reason for none (mouth-checks.ts), a passage's road on under its house.
import assert from "node:assert/strict"

import { ROAD_LIFT } from "../../sim/map/ground.ts"
import { MAP, type Road, roadClassOf } from "../../sim/map/index.ts"
import { tileVectors } from "../../sim/map/tiles.ts"
import { boreOf, isBored } from "../bores.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS, chunkOf } from "../chunks.ts"
import { terrainY, yOf } from "../ground.ts"
import { bridgeHex, roadHex, roadPieces } from "../lines.ts"
import { PALETTE } from "../palette.ts"
import { Pieces } from "../pieces.ts"
import type { Vectors } from "../testing.ts"
import { assertChunkCut, wholeBuild } from "./chunk-cut.ts"
import {
  checkClear,
  checkHeadWall,
  checkNoPortal,
  checkPortal,
  checkStoodBack,
  drawn,
  mouthsOf,
  type Open,
  whyOpen,
} from "./mouth-checks.ts"
import { heightIn, type Tri, trianglesOf } from "./rail-checks.ts"

/** A point inside the SR445's tunnel by Groppoli, Lunigiana (tunnels.test.ts, world.test.ts). */
export const SR445 = { x: -2330, y: 4420 }

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

/** Whether triangle `tri` (three space) holds point `p`, within 1 cm of its plane. */
const holds = ([a, b, c]: Tri, p: readonly [number, number, number]): boolean => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const dot = (x: ReadonlyArray<number>, y: ReadonlyArray<number>) =>
    x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!
  const uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v),
    wu = dot(w, u),
    wv = dot(w, v),
    det = uu * vv - uv * uv
  if (det < 1e-9) return false
  const s = (vv * wu - uv * wv) / det,
    t = (uu * wv - uv * wu) / det,
    off = w.map((x, i) => x - s * u[i]! - t * v[i]!)
  return s >= -1e-6 && t >= -1e-6 && s + t <= 1 + 1e-6 && Math.hypot(...off) < 0.01
}

/**
 * Road `road` in a tunnel draws its bore's walls, dark, in the buried layer, and nothing solid: so
 * nothing of it under the hill casts a shadow, as the hill over it casts none. None for a building
 * passage, whose house stands over it. Every edge of them stands 0.2 m or more under the terrain
 * (sampled every 0.1 m: they never stand out of the hill, between their corners as at them), and
 * they stand on both sides of the road all along it (Decision 3): every 2 m along each side, where
 * the terrain stands 0.5 m or more over the road's floor, a wall holds the point at the floor's
 * height. Returns how many wall triangles it draws.
 */
export const checkBore = (road: Road): number => {
  const sinks = roadPieces(road).slice(1).map(drawn),
    buried = sinks.map((sink) => sink.buried)
  assert.ok(
    sinks.every((sink) => sink.solid.empty && sink.pieces.length === 0),
    `road ${road.id} in a tunnel: nothing in the solid layer, which casts shadows`,
  )
  const all = buried.flatMap((tris) => trianglesOf(tris, PALETTE.tunnelDark))
  assert.equal(
    all.length,
    buried.reduce((n, tris) => n + tris.position.length / 9, 0),
    `road ${road.id} in a tunnel: nothing but its dark walls`,
  )
  for (const tri of all)
    for (let i = 0; i < 3; i++) {
      const p = tri[i]!,
        q = tri[(i + 1) % 3]!,
        n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[2] - p[2]) / 0.1))
      for (let j = 0; j <= n; j++) {
        const x = p[0] + ((q[0] - p[0]) * j) / n,
          h = p[1] + ((q[1] - p[1]) * j) / n,
          y = -(p[2] + ((q[2] - p[2]) * j) / n)
        assert.ok(
          h <= terrainY(x, y) - 0.2 + 1e-6,
          `road ${road.id}: a wall ${(h - terrainY(x, y)).toFixed(2)} m over the terrain at (${x.toFixed(1)}, ${y.toFixed(1)})`,
        )
      }
    }
  if (!isBored(road)) return all.length
  const { half } = boreOf(road),
    lift = ROAD_LIFT[roadClassOf(road)],
    near = bucketed(all)
  for (let k = 0; k + 1 < road.z.length; k++) {
    const ax = road.pts[2 * k]!,
      ay = road.pts[2 * k + 1]!,
      dx = road.pts[2 * k + 2]! - ax,
      dy = road.pts[2 * k + 3]! - ay,
      l = Math.hypot(dx, dy),
      n = Math.max(2, Math.ceil(l / 2))
    for (let j = 1; j < n; j++)
      for (const side of [-1, 1]) {
        const x = ax + (dx * j) / n - (dy / l) * half * side,
          y = ay + (dy * j) / n + (dx / l) * half * side,
          floor = yOf(road.z[k]! + ((road.z[k + 1]! - road.z[k]!) * j) / n + lift)
        if (terrainY(x, y) - floor < 0.5) continue
        assert.ok(
          near(x, y).some((tri) => holds(tri, [x, floor, -y])),
          `road ${road.id} in a tunnel: no wall at (${x.toFixed(1)}, ${y.toFixed(1)}), ${(terrainY(x, y) - floor).toFixed(1)} m under the hill`,
        )
      }
  }
  return all.length
}

/** What a region's road tunnels are, which its map test pins so that a change to them shows. */
interface TunnelCounts {
  /** Roads in a tunnel, the building passages among them, and how long they are together, whole metres. */
  readonly tunnels: number
  readonly passages: number
  readonly metres: number
  /** The triangles of their bores' walls. */
  readonly walls: number
  /** The tunnels' mouths, the portals at those the hill stands over and the head walls at those under a lower bank. */
  readonly mouths: number
  readonly portals: number
  readonly heads: number
  /** The open mouths (`whyOpen`): under a house, under ground lower than a head wall, with no room for either. */
  readonly housed: number
  readonly low: number
  readonly crowded: number
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
 * tunnel draws its ribbon at its floor and its bore's walls under the hill, along both its sides
 * (none through a building passage); the build baked its mouths (`MAP.derived.mouths`) as `mouthsOf`
 * finds them, every one and no other, each portal at its road's end or stood back along its line,
 * each head wall at its end; at each with a portal the portal faces out of the hill in the road
 * bridges' colour, at each with a head wall the head wall's opening faces out of its bank at the
 * bore's width and clear height, in that colour, its top under the bank, and either stands on no
 * other road nor the track (`checkClear`); at each open one no portal stands, for a reason
 * `whyOpen` finds by geometry; and the chunks over each road in a tunnel, 60 m round, built from
 * the pieces of the map's tiles, keep exactly their cut of a whole-map build. Returns the counts.
 */
export const checkTunnels = (whole: Vectors): TunnelCounts => {
  const { roads } = whole,
    tunnels = roads.items.flatMap((road, k) =>
      road.tunnel === true ? [[road, roads.ids[k]!] as const] : [],
    )
  let metres = 0,
    walls = 0
  for (const [road] of tunnels) {
    checkRibbon(road)
    const sides = checkBore(road)
    if (road.passage === true) assert.equal(sides, 0, `building passage ${road.id}: no walls`)
    walls += sides
    for (let k = 2; k < road.pts.length; k += 2)
      metres += Math.hypot(road.pts[k]! - road.pts[k - 2]!, road.pts[k + 1]! - road.pts[k - 1]!)
  }
  // Every mouth the build baked is one, and every one is baked, in the roads' order.
  const found = mouthsOf(roads),
    baked = MAP.derived.mouths
  assert.deepEqual(
    baked.map(({ road }) => road),
    found.map(({ road }) => road),
    "the baked mouths are the tunnels' mouths",
  )
  let portals = 0,
    heads = 0
  const open: Record<Open, number> = { housed: 0, low: 0, crowded: 0 }
  for (const [n, mouth] of baked.entries()) {
    const end = found[n]!,
      road = MAP.roads[mouth.road]!,
      line = roads.items[roads.ids.indexOf(mouth.road)]!,
      back = "back" in mouth ? mouth.back : 0
    if (back === 0) {
      assert.deepEqual([mouth.x, mouth.y], [end.x, end.y], `road ${road.id}'s mouth`)
      assert.ok(
        Math.abs(mouth.angle - end.angle) < 1e-9,
        `the mouth at ${mouth.x}, ${mouth.y} heads out of the hill`,
      )
    } else checkStoodBack(line, end, mouth, back)
    if ("crown" in mouth) {
      checkPortal(line, mouth, bridgeHex(road))
      checkClear(roads, end, mouth)
      portals++
    } else if ("head" in mouth) {
      assert.equal(back, 0, `the head wall at road ${road.id}'s mouth stands at its end`)
      checkHeadWall(line, mouth, bridgeHex(road), mouth.throat)
      checkClear(roads, end, mouth)
      heads++
    } else {
      checkNoPortal(mouth.x, mouth.y)
      open[whyOpen(whole, end)]++
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
    walls,
    mouths: baked.length,
    portals,
    heads,
    ...open,
  }
}

import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { pointInRing, segDist2 } from "../../collide.ts"
import { allowsModel, laneSide, walkSide } from "../../route.ts"
import { VEHICLE_MODELS } from "../../vehicles.ts"
import { graph, MAP, vergeOf } from "../index.ts"

/** The ATR 220's half-width (1.44 m), a person's radius (0.35 m) and 1 m between them. */
const CLEAR = 2.8
const running = MAP.rail.filter(
  (r) => r.kind === undefined && r.bridge !== true && r.tunnel !== true,
)
/** The at-grade running track nearest (x, y): the distance and the bed there. */
const track = (x: number, y: number) => {
  let best = { d2: Number.MAX_VALUE, z: 0 }
  for (const r of running) {
    for (let k = 0; k + 1 < r.z.length; k++) {
      const ax = r.pts[2 * k]!,
        ay = r.pts[2 * k + 1]!,
        bx = r.pts[2 * k + 2]!,
        by = r.pts[2 * k + 3]!
      if (Math.min(ax, bx) > x + 8 || Math.max(ax, bx) < x - 8) continue
      if (Math.min(ay, by) > y + 8 || Math.max(ay, by) < y - 8) continue
      const { d2, t } = segDist2(x, y, ax, ay, bx, by)
      if (d2 < best.d2) best = { d2, z: r.z[k]! + (r.z[k + 1]! - r.z[k]!) * t }
    }
  }
  return { d: Math.sqrt(best.d2), z: best.z }
}
/** A road's profile at the point of it nearest (x, y), and how far that is. */
const along = (road: (typeof MAP.roads)[number], x: number, y: number) => {
  let best = { d2: Number.MAX_VALUE, z: 0 }
  for (let k = 0; k + 1 < road.z.length; k++) {
    const { d2, t } = segDist2(
      x,
      y,
      road.pts[2 * k]!,
      road.pts[2 * k + 1]!,
      road.pts[2 * k + 2]!,
      road.pts[2 * k + 3]!,
    )
    if (d2 < best.d2) best = { d2, z: road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t }
  }
  return { d: Math.sqrt(best.d2), z: best.z }
}
/** Inside a level-crossing box: within 15 m of its nodes, on its road or that road's verges. */
const inBox = (x: number, y: number, road: number) =>
  MAP.railway.crossings.some((c) => {
    const box = MAP.roads[c.road]!
    return (
      c.nodes.some((n) => Ops.hypot(graph.nodes[n]!.x - x, graph.nodes[n]!.y - y) <= 15) &&
      (c.road === road || along(box, x, y).d <= vergeOf(box.cls, box.w) + 0.35)
    )
  })
const onPlatform = (x: number, y: number) =>
  MAP.railway.platforms.some(({ area }) => {
    const [outer, ...holes] = MAP.areas[area]!.rings
    return pointInRing(x, y, outer!) && !holes.some((h) => pointInRing(x, y, h))
  })

// Regression: Piazza della Liberazione's verge ran 1.96 m from the line by
// Monzone station and Via Riolo's 1.9 m beside it, in the way of every train.
test("rail: outside crossing boxes and platforms, no verge or lane comes within 2.8 m of at-grade running track at its level", () => {
  // 32 m cells within 30 m of the track's segments: an edge (at most 25 m) starting outside them never comes within 2.8 m.
  const near = new Set<number>()
  for (const r of running)
    for (let k = 0; k + 3 < r.pts.length; k += 2)
      for (
        let i = Math.floor((Math.min(r.pts[k]!, r.pts[k + 2]!) - 30) / 32);
        i <= Math.floor((Math.max(r.pts[k]!, r.pts[k + 2]!) + 30) / 32);
        i++
      )
        for (
          let j = Math.floor((Math.min(r.pts[k + 1]!, r.pts[k + 3]!) - 30) / 32);
          j <= Math.floor((Math.max(r.pts[k + 1]!, r.pts[k + 3]!) + 30) / 32);
          j++
        )
          near.add(i * 8192 + j)
  const close = (x: number, y: number) => near.has(Math.floor(x / 32) * 8192 + Math.floor(y / 32))
  const offenders: Array<string> = []
  /** Samples every 0.5 m along edge e, `off` m right of a -> b (negative: left). */
  const check = (e: number, off: number, what: string) => {
    const { a, b, road } = graph.edges[e]!
    const A = graph.nodes[a]!,
      B = graph.nodes[b]!,
      len = Ops.hypot(B.x - A.x, B.y - A.y)
    if (len === 0 || !close(A.x, A.y)) return
    const nx = (B.y - A.y) / len,
      ny = -(B.x - A.x) / len,
      n = Math.ceil(len / 0.5)
    for (let q = 0; q <= n; q++) {
      const cx = A.x + ((B.x - A.x) * q) / n,
        cy = A.y + ((B.y - A.y) * q) / n,
        x = cx + nx * off,
        y = cy + ny * off
      const t = track(x, y)
      if (t.d >= CLEAR || Math.abs(along(MAP.roads[road]!, cx, cy).z - t.z) >= 2) continue
      if (inBox(x, y, road) || onPlatform(x, y)) continue
      offenders.push(
        `${what} of edge ${e} (road ${MAP.roads[road]!.id}) at (${x.toFixed(1)}, ${y.toFixed(1)}): ${t.d.toFixed(2)} m`,
      )
    }
  }
  for (const e of graph.walkEdges) {
    const verge = walkSide(MAP.roads[graph.edges[e]!.road]!)
    check(e, verge, "verge")
    check(e, -verge, "verge")
  }
  for (const e of graph.trafficEdges)
    for (const forward of [true, false]) {
      const models = VEHICLE_MODELS.filter((m) => allowsModel(e, m))
      if (models.length === 0) continue
      const side = Math.max(...models.map((m) => laneSide({ edge: e, forward }, m)))
      check(e, forward ? side : -side, forward ? "lane a → b" : "lane b → a")
    }
  assert.deepEqual(offenders.slice(0, 10), [])
})

// The car's box against the track: rail.test.ts.
test("rail: no parked car within 20 m of a level crossing (Codice della Strada art. 158)", () => {
  const nodes = MAP.railway.crossings.flatMap((c) => c.nodes.map((n) => graph.nodes[n]!))
  for (const p of MAP.spawns.parked) {
    for (const n of nodes)
      assert.ok(
        Ops.hypot(n.x - p.x, n.y - p.y) >= 20,
        `parked car at (${p.x}, ${p.y}) ${Ops.hypot(n.x - p.x, n.y - p.y).toFixed(1)} m from the crossing at (${n.x}, ${n.y})`,
      )
  }
})

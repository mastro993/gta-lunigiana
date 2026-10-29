import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { pointInRing as inRing, ringBox } from "../../../tools/geometry.ts"
import { wholeMap } from "../../../tools/map-file.ts"
import { moveCircles, segmentDistance, staticGrid } from "../../collide.ts"
import {
  BUILDING_STYLES,
  districtAt,
  graph,
  heightAt,
  isAreaKind,
  isDrivable,
  MAP,
  ROAD_CLASSES,
  type Segment,
  wallsNear,
} from "../index.ts"

const { hypot } = Ops
/** The dense layers live in the tiles: these checks read them all, joined. */
const WHOLE = wholeMap()
const segsOf = (flat: ReadonlyArray<number>, closed = false): Array<Segment> => {
  const out: Array<Segment> = [],
    n = flat.length / 2
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n
    out.push({ ax: flat[2 * i]!, ay: flat[2 * i + 1]!, bx: flat[2 * j]!, by: flat[2 * j + 1]! })
  }
  return out
}
/** Points every `step` m along a flat polyline. */
const samples = (pts: ReadonlyArray<number>, step: number) =>
  segsOf(pts).flatMap((s) => {
    const len = hypot(s.bx - s.ax, s.by - s.ay),
      out: Array<{ x: number; y: number }> = []
    for (let d = 0; d < len; d += step)
      out.push({ x: s.ax + ((s.bx - s.ax) * d) / len, y: s.ay + ((s.by - s.ay) * d) / len })
    return out
  })
/** Crossing points of two flat polylines with the parameter along each segment. */
const crossings = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const out: Array<{ x: number; y: number; i: number; t: number; j: number; u: number }> = []
  segsOf(a).forEach((p, i) =>
    segsOf(b).forEach((q, j) => {
      const ex = p.bx - p.ax,
        ey = p.by - p.ay,
        fx = q.bx - q.ax,
        fy = q.by - q.ay,
        den = ex * fy - ey * fx
      if (den === 0) return
      const t = ((q.ax - p.ax) * fy - (q.ay - p.ay) * fx) / den,
        u = ((q.ax - p.ax) * ey - (q.ay - p.ay) * ex) / den
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
        out.push({ x: p.ax + ex * t, y: p.ay + ey * t, i, t, j, u })
    }),
  )
  return out
}
const zAt = (z: ReadonlyArray<number>, i: number, t: number) => z[i]! + (z[i + 1]! - z[i]!) * t
/**
 * Items gridded by the bounding box of their flat coordinates grown by `pad` m: `near` lists, in
 * input order, every item whose grown box may overlap the query box (a broad phase for the exact test).
 */
const bucketed = <T>(
  items: ReadonlyArray<T>,
  flat: (t: T) => ReadonlyArray<number>,
  pad: number,
) => {
  const boxes = items.map((t) => {
    const [x0, y0, x1, y1] = ringBox(flat(t))
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad] as const
  })
  const grid = staticGrid(items.length, (k) => boxes[k]!, 32)
  return (x0: number, y0: number, x1 = x0, y1 = y0): Array<T> => {
    const found: Array<number> = []
    grid(x0, y0, x1, y1, (k) => found.push(k))
    return found.sort((a, b) => a - b).map((k) => items[k]!)
  }
}
const clear = (kind: "walk" | "drive", x: number, y: number, r: number) =>
  wallsNear(kind, x - r, y - r, x + r, y + r).every((s) => segmentDistance(s, x, y) >= r)
const inside = (x: number, y: number) =>
  x > MAP.bounds.minX && x < MAP.bounds.maxX && y > MAP.bounds.minY && y < MAP.bounds.maxY
const nearEdge = (x: number, y: number, m: number) =>
  x < MAP.bounds.minX + m ||
  x > MAP.bounds.maxX - m ||
  y < MAP.bounds.minY + m ||
  y > MAP.bounds.maxY - m
const STATION = { x: -493.8, y: 436.9 },
  ALTO = { x: -34.4, y: -300.3 }
/** OSM place nodes of the villages the map was widened for. */
const VILLAGES = {
  "Equi Terme": { x: 1804.9, y: 721 },
  Gragnola: { x: -1751.2, y: 3360.4 },
  Colognola: { x: -1732.9, y: 1119.4 },
  Campiglione: { x: -2255.9, y: 1473.2 },
  Viano: { x: -2319.6, y: 58.6 },
  Vinca: { x: 2273.6, y: -2620.3 },
  Ugliancaldo: { x: 4157.6, y: 1461.8 },
  Tenerano: { x: -2169.5, y: -986.6 },
}

test("bounds and heightmap cover the play area", () => {
  assert.deepEqual(MAP.bounds, { minX: -2900, minY: -6100, maxX: 4900, maxY: 3900 })
  const hm = WHOLE.heightmap
  assert.deepEqual(MAP.heightmap, {
    cell: hm.cell,
    cols: hm.cols,
    rows: hm.rows,
    x0: hm.x0,
    y0: hm.y0,
  })
  assert.equal(hm.data.length, hm.cols * hm.rows)
  assert.ok(hm.x0 <= MAP.bounds.minX && hm.x0 + (hm.cols - 1) * hm.cell >= MAP.bounds.maxX)
  assert.ok(hm.y0 <= MAP.bounds.minY && hm.y0 + (hm.rows - 1) * hm.cell >= MAP.bounds.maxY)
  assert.ok(Array.from(hm.data).every((v) => Number.isInteger(v) && v > 1400 && v < 18500)) // the Aulella below Gragnola to the Apuan ridge
})

// Regression: rounded to the metre, neighbouring lattice trees could land on one spot (drawn and collided twice).
test("trees: inside the bounds, at most one per spot", () => {
  const spots = new Set<number>()
  const { trees } = WHOLE
  for (let i = 0; i < trees.length; i += 3) {
    const x = trees[i]!,
      y = trees[i + 1]!
    assert.ok(inside(x, y), `tree at ${x},${y}`)
    spots.add(x * 65536 + y)
  }
  assert.equal(spots.size, trees.length / 3)
})

test("heightAt: station on the valley floor, Monzone Alto on its spur", () => {
  const station = heightAt(STATION.x, STATION.y),
    alto = heightAt(ALTO.x, ALTO.y)
  assert.ok(station > 205 && station < 225, `station ${station}`)
  assert.ok(alto > 270 && alto < 310, `alto ${alto}`)
  assert.equal(heightAt(-1e6, -1e6), heightAt(MAP.bounds.minX, MAP.bounds.minY)) // clamped
})

test("player spawn and parked cars are inside the bounds, clear of walls and off traffic lanes", () => {
  const spots = [MAP.spawns.player, ...MAP.spawns.parked]
  assert.ok(
    MAP.spawns.parked.length >= 700 && MAP.spawns.parked.length <= 950,
    `${MAP.spawns.parked.length} parked`,
  )
  for (const name of Object.keys(VILLAGES))
    assert.ok(
      MAP.spawns.parked.some((p) => districtAt(p.x, p.y).name === name),
      `no parking in ${name}`,
    )
  for (const s of spots) {
    assert.ok(inside(s.x, s.y), JSON.stringify(s))
    assert.ok(clear("walk", s.x, s.y, 1.2) && clear("drive", s.x, s.y, 1.2), JSON.stringify(s))
  }
  const police = MAP.pois.find((p) => p.kind === "amenity=police")!
  assert.ok(
    hypot(MAP.spawns.player.x - police.x, MAP.spawns.player.y - police.y) < 40,
    "player near the Carabinieri",
  )
  // Regression: spread over five villages, the hash draw left Monzone's station without a spot within 50 m.
  assert.ok(
    MAP.spawns.parked.filter((p) => hypot(p.x - police.x, p.y - police.y) < 40).length >= 2,
    "two parked spots by the Carabinieri",
  )
  const lanes = graph.trafficEdges.map((e) => {
    const { a, b, road } = graph.edges[e]!
    return {
      ax: graph.nodes[a]!.x,
      ay: graph.nodes[a]!.y,
      bx: graph.nodes[b]!.x,
      by: graph.nodes[b]!.y,
      half: MAP.roads[road]!.w / 2,
    }
  })
  const lanesNear = bucketed(lanes, (l) => [l.ax, l.ay, l.bx, l.by], 10)
  for (const p of MAP.spawns.parked) {
    const c = Ops.cos(p.angle),
      s = Ops.sin(p.angle)
    for (const [u, v] of [
      [0, 0],
      [1.85, 0.85],
      [1.85, -0.85],
      [-1.85, 0.85],
      [-1.85, -0.85],
    ] as const) {
      const x = p.x + c * u - s * v,
        y = p.y + s * u + c * v
      for (const l of lanesNear(x, y))
        assert.ok(
          segmentDistance(l, x, y) >= l.half - 0.05,
          `parked ${JSON.stringify(p)} on a lane`,
        )
    }
  }
})

test("walls: none on a road; only buildings and barriers come inside w/2", () => {
  assert.ok(WHOLE.walls.walk.length > 0 && WHOLE.walls.drive.length > 0)
  const near = (x: number, y: number, ring: ReadonlyArray<number>, d: number) =>
    inRing(x, y, ring) || segsOf(ring, true).some((s) => segmentDistance(s, x, y) < d)
  const buildings = bucketed(MAP.buildings, (b) => b.outer, 0.35),
    barriers = bucketed(MAP.barriers, (b) => b.pts, 0.05)
  const fixed = (s: Segment) => {
    const on = (x: number, y: number) =>
      buildings(x, y).some((b) => near(x, y, b.outer, 0.35)) ||
      barriers(x, y).some((b) => segsOf(b.pts).some((q) => segmentDistance(q, x, y) < 0.05))
    return on(s.ax, s.ay) && on(s.bx, s.by)
  }
  for (const r of MAP.roads) {
    if (r.tunnel === true) continue
    for (const { x, y } of samples(r.pts, 2)) {
      if (nearEdge(x, y, 10)) continue // road-exit caps
      const where = `${r.cls} ${r.id} at ${x.toFixed(1)},${y.toFixed(1)}`
      assert.ok(clear("walk", x, y, Math.min(0.6, r.w / 2)), `walk wall on ${where}`)
      if (isDrivable(r.cls)) assert.ok(clear("drive", x, y, 1), `drive wall within 1 m of ${where}`)
      const h = r.w / 2 - 0.05
      for (const kind of isDrivable(r.cls) ? (["walk", "drive"] as const) : (["walk"] as const))
        for (const s of wallsNear(kind, x - h, y - h, x + h, y + h))
          if (segmentDistance(s, x, y) < h)
            assert.ok(fixed(s), `terrain/trunk ${kind} wall inside w/2 of ${where}`)
    }
  }
})

test("building interiors are closed: walking or driving in from the nearest road stops at the outline", () => {
  const roads = bucketed(
    MAP.roads.flatMap((r) => segsOf(r.pts)),
    (s) => [s.ax, s.ay, s.bx, s.by],
    40,
  )
  for (const b of MAP.buildings) {
    const xs = b.outer.filter((_, i) => i % 2 === 0),
      ys = b.outer.filter((_, i) => i % 2 === 1)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    // Only roads within the 40 m search radius of the footprint can matter (same order, same ties).
    const centrelines = roads(x0, y0, x1, y1).filter(
      (s) =>
        Math.max(s.ax, s.bx) >= x0 - 40 &&
        Math.min(s.ax, s.bx) <= x1 + 40 &&
        Math.max(s.ay, s.by) >= y0 - 40 &&
        Math.min(s.ay, s.by) <= y1 + 40,
    )
    // Interior target: the grid point deepest inside the footprint, away from any lane through it.
    let tx = 0,
      ty = 0,
      depth = 0
    for (let x = x0; x <= x1; x += 0.5)
      for (let y = y0; y <= y1; y += 0.5) {
        if (
          !inRing(x, y, b.outer) ||
          (b.holes ?? []).some((h) => inRing(x, y, h)) ||
          centrelines.some((s) => segmentDistance(s, x, y) < 2)
        )
          continue
        const d = Math.min(...segsOf(b.outer, true).map((s) => segmentDistance(s, x, y)))
        if (d > depth) [tx, ty, depth] = [x, y, d]
      }
    if (depth < 0.8) continue
    let sx = 0,
      sy = 0,
      best = 40
    for (const s of centrelines)
      for (let t = 0; t <= 1; t += 0.05) {
        const x = s.ax + (s.bx - s.ax) * t,
          y = s.ay + (s.by - s.ay) * t,
          d = hypot(x - tx, y - ty)
        if (d < best && !inRing(x, y, b.outer)) [sx, sy, best] = [x, y, d]
      }
    if (best >= 40) continue
    for (const [kind, r] of [
      ["walk", 0.35],
      ["drive", 0.9],
    ] as const) {
      let p = { x: sx, y: sy }
      for (let step = 0; step < 400; step++) {
        const dx = tx - p.x,
          dy = ty - p.y,
          d = hypot(dx, dy)
        if (d < 0.05) break
        const k = Math.min(1, 0.25 / d),
          q = moveCircles(
            p,
            [{ x: 0, y: 0 }],
            { x: dx * k, y: dy * k },
            r,
            wallsNear(kind, p.x - 2, p.y - 2, p.x + 2, p.y + 2),
          )
        if (hypot(q.position.x - p.x, q.position.y - p.y) < 1e-3) break
        p = q.position
      }
      assert.ok(
        hypot(p.x - tx, p.y - ty) > 0.5,
        `${kind} gets inside building ${b.id} at ${tx},${ty}`,
      )
    }
  }
})

test("traffic graph: one component reaching the station, Monzone Alto and the villages, edges clear of walls, exits inside the caps", () => {
  const chord = (e: number): Segment => {
    const { a, b } = graph.edges[e]!
    return {
      ax: graph.nodes[a]!.x,
      ay: graph.nodes[a]!.y,
      bx: graph.nodes[b]!.x,
      by: graph.nodes[b]!.y,
    }
  }
  const near = (p: { x: number; y: number }, r: number) =>
    graph.trafficEdges.some((e) => segmentDistance(chord(e), p.x, p.y) < r)
  assert.ok(near(STATION, 30) && near(ALTO, 60))
  for (const [name, p] of Object.entries(VILLAGES))
    assert.ok(near(p, 80), `no traffic near ${name}`)
  const traffic = new Set(graph.trafficEdges)
  const seen = new Set([graph.edges[graph.trafficEdges[0]!]!.a])
  for (const stack = [...seen]; stack.length > 0;)
    for (const e of graph.adjacency[stack.pop()!]!) {
      if (!traffic.has(e)) continue
      for (const n of [graph.edges[e]!.a, graph.edges[e]!.b])
        if (!seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
    }
  assert.ok(
    graph.trafficEdges.every((e) => seen.has(graph.edges[e]!.a) && seen.has(graph.edges[e]!.b)),
    "traffic is connected",
  )
  assert.ok(graph.edges.every((e) => e.length > 0 && e.length <= 25.5 && e.road < MAP.roads.length))
  assert.ok(graph.walkEdges.length > graph.trafficEdges.length)
  for (const e of graph.trafficEdges)
    for (const { x, y } of samples([chord(e).ax, chord(e).ay, chord(e).bx, chord(e).by], 1))
      assert.ok(
        clear("drive", x, y, 1),
        `traffic edge ${e} within 1 m of a drive wall at ${x.toFixed(1)},${y.toFixed(1)}`,
      )
  graph.nodes.forEach((n, i) => {
    const degree = graph.adjacency[i]!.filter((e) => traffic.has(e)).length
    assert.ok(
      degree !== 1 || clear("drive", n.x, n.y, 2.3),
      `a car at traffic dead end ${i} (${n.x},${n.y}) touches a wall`,
    )
  })
})

test("profiles: class grades (1.5x relaxed at most), deck and underpass clearances, no perched water", () => {
  // 1.5 x the class limit, plus slack where two junction pins conflict (a straight line between them).
  const limit: Record<string, number> = {
    tertiary: 0.16,
    unclassified: 0.24,
    residential: 0.24,
    service: 0.31,
    track: 0.31,
    rail: 0.0425,
  }
  const ends = bucketed(MAP.roads, (r) => r.pts, 0.1)
  /** Both ends on another road: a link whose two junctions were set by roads profiled before it. */
  const pinned = (pts: ReadonlyArray<number>) =>
    [0, pts.length - 2].every((i) => {
      const x = pts[i]!,
        y = pts[i + 1]!
      return ends(x, y).some(
        (q) => q.pts !== pts && segsOf(q.pts).some((sg) => segmentDistance(sg, x, y) < 0.1),
      )
    })
  for (const r of [...MAP.roads, ...MAP.rail.map((q) => ({ ...q, cls: "rail" }))]) {
    const max = limit[r.cls]
    if (max === undefined) continue
    const s = [0]
    for (let i = 1; i < r.z.length; i++)
      s.push(
        s[i - 1]! + hypot(r.pts[2 * i]! - r.pts[2 * i - 2]!, r.pts[2 * i + 1]! - r.pts[2 * i - 1]!),
      )
    // A track shortcut between two bends of one quarry road (Carrara side of the Sagro) can only be the straight line between them.
    const straight = r.z.every(
      (z, i) => Math.abs(z - r.z[0]! - ((r.z.at(-1)! - r.z[0]!) * s[i]!) / s.at(-1)!) < 0.15,
    )
    if (r.cls === "track" && straight && pinned(r.pts)) continue
    for (let i = 0; i < r.z.length; i++)
      for (let j = i + 1; j < r.z.length; j++)
        if (s[j]! - s[i]! >= 8) {
          const g = Math.abs(r.z[j]! - r.z[i]!) / (s[j]! - s[i]!)
          assert.ok(
            g <= max,
            `${r.cls} ${r.id} grade ${(g * 100).toFixed(1)}% at ${r.pts[2 * i]},${r.pts[2 * i + 1]}`,
          )
          break
        }
  }
  const decks = [
    ...MAP.roads.filter((r) => r.bridge === true),
    ...MAP.rail.filter((r) => r.bridge === true),
  ]
  for (const w of MAP.water)
    for (const d of decks)
      for (const c of crossings(w.pts, d.pts)) {
        const gap = zAt(d.z, c.j, c.u) - zAt(w.z, c.i, c.t)
        assert.ok(gap >= 2.4, `bridge ${d.id} only ${gap.toFixed(1)} m over water ${w.id}`)
      }
  for (const rl of MAP.rail)
    for (const rd of MAP.roads)
      if (rl.bridge === true || rd.tunnel === true)
        for (const c of crossings(rl.pts, rd.pts)) {
          const gap = zAt(rl.z, c.i, c.t) - zAt(rd.z, c.j, c.u)
          assert.ok(gap >= 4.6, `rail ${rl.id} only ${gap.toFixed(1)} m over road ${rd.id}`)
        }
  // A road bridge over the rail clears the ATR 220 (4.185 m over the rail head, 0.12 m over the
  // bed) under its 0.9 m deck, with 0.3 m to spare (rail-levels.ts; the Equi Terme overpass left
  // the roof 0.46 m in the deck).
  for (const rl of MAP.rail)
    for (const rd of MAP.roads)
      if (rd.bridge === true && rl.tunnel !== true && rl.bridge !== true)
        for (const c of crossings(rl.pts, rd.pts)) {
          const gap = zAt(rd.z, c.j, c.u) - zAt(rl.z, c.i, c.t)
          assert.ok(gap >= 5.4, `road ${rd.id} only ${gap.toFixed(2)} m over rail ${rl.id}`)
        }
  const channels = bucketed(
    MAP.water.flatMap((o) => segsOf(o.pts).map((s) => ({ ...s, w: o.w }))),
    (s) => [s.ax, s.ay, s.bx, s.by],
    Math.max(...MAP.water.map((o) => o.w / 2 + 1)),
  )
  for (const w of MAP.water)
    for (let i = 0; i < w.z.length; i++) {
      const x = w.pts[2 * i]!,
        y = w.pts[2 * i + 1]!
      const joins = channels(x, y).some((s) => s.w > w.w && segmentDistance(s, x, y) < s.w / 2 + 1)
      if (!joins)
        assert.ok(
          w.z[i]! - heightAt(x, y) <= 2.5,
          `water ${w.id} perched ${(w.z[i]! - heightAt(x, y)).toFixed(1)} m at ${x},${y}`,
        )
    }
})

test("road names, classes, styles, area kinds and districts", () => {
  const labels = new Set(MAP.roads.flatMap((r) => [r.name, r.ref]))
  for (const name of [
    "SP59",
    "SP10",
    "SR445",
    "Via Riolo",
    "Via delle Cave",
    "Via Cesare Battisti",
  ])
    assert.ok(labels.has(name), name)
  assert.ok(
    MAP.roads.every(
      (r) =>
        (ROAD_CLASSES as ReadonlyArray<string>).includes(r.cls) && r.z.length * 2 === r.pts.length,
    ),
  )
  assert.ok(
    MAP.buildings.every(
      (b) =>
        (BUILDING_STYLES as ReadonlyArray<string>).includes(b.style) &&
        b.tint >= 0 &&
        b.tint <= 3 &&
        b.h >= 1.5 &&
        b.h <= 45,
    ),
  )
  assert.ok(
    MAP.areas.every((a) => isAreaKind(a.kind)),
    "every area kind is one of AREA_KINDS",
  )
  // The Regione Toscana land cover: the sparse vegetation of the high slopes (it alone has it) and the bare rock of Pizzo d'Uccello.
  assert.ok(
    MAP.areas.some((a) => a.kind === "sparse"),
    "UCS sparse vegetation",
  )
  const uccello = MAP.pois.find((p) => p.kind === "natural=peak" && p.name === "Pizzo d'Uccello")!
  assert.ok(
    MAP.areas.some((a) => a.kind === "rock" && inRing(uccello.x, uccello.y, a.rings[0]!)),
    "Pizzo d'Uccello is bare rock",
  )
  // Regression: running on into the unmapped mountains, the road from Casciana lost the CTR name of its Ugliancaldo stretch.
  assert.ok(
    MAP.roads.some((r) => r.name === "Via di Ugliancaldo"),
    "Via di Ugliancaldo",
  )
  const names = new Set(MAP.districts.map((d) => d.name))
  for (const name of [
    "Monzone (Stazione)",
    "Monzone Alto",
    "Santa Lucia",
    "Torrignana",
    "Aiola",
    "Castello di Aiola",
    "Novicchia",
    "Acquanera",
  ])
    assert.ok(names.has(name), name)
  const centres = MAP.buildings.map((b) => {
    const n = b.outer.length / 2
    return {
      x: b.outer.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / n,
      y: b.outer.filter((_, i) => i % 2 === 1).reduce((a, v) => a + v, 0) / n,
    }
  })
  const covered = centres.filter((c) =>
    MAP.districts.some((d) => hypot(c.x - d.x, c.y - d.y) <= d.r),
  ).length
  // Most buildings are in a village; the rest are farmhouses, mountain huts and quarry sheds.
  assert.ok(
    covered >= 0.8 * centres.length,
    `${covered}/${centres.length} buildings inside a district disc`,
  )
  assert.equal(districtAt(STATION.x, STATION.y).name, "Monzone (Stazione)")
  assert.equal(districtAt(ALTO.x, ALTO.y).name, "Monzone Alto")
  for (const [name, p] of Object.entries(VILLAGES)) assert.equal(districtAt(p.x, p.y).name, name)
  assert.ok(MAP.districts.includes(districtAt(MAP.bounds.maxX, MAP.bounds.minY))) // far corner: nearest rim
  // Regression: by the nearest rim, the HUD named Vinca on the summits above it; a wide Balzone disc then took Vinca's hairpins.
  for (const name of ["Monte Sagro", "Pizzo d'Uccello"]) {
    const peak = MAP.pois.find((p) => p.kind === "natural=peak" && p.name === name)!
    assert.equal(districtAt(peak.x, peak.y).name, name)
  }
  assert.equal(districtAt(1379, -2603).name, "Vinca", "the SP59 hairpins below Vinca")
  // Regression: the I Pianelli locality (a hillside above the railway) took Equi Terme's station and spa.
  for (const p of MAP.pois.filter(
    (q) => q.kind === "railway=station" || q.name === "Terme di Equi",
  )) {
    if (p.name?.includes("Equi") === true)
      assert.equal(districtAt(p.x, p.y).name, "Equi Terme", `${p.kind} ${p.name}`)
  }
  // Regression: CTR names came out as "Via Xx Settembre" and "Via Castel Dell'aquila" (OSM spells it "Via Castel dell'Aquila").
  assert.ok(labels.has("Via Castel dell'Aquila") && labels.has("Via XX Settembre"))
  assert.ok(
    MAP.roads.every((r) => !/\b(Xx|Ii|Xxiv)\b|\b(Dell|Dall|Sull|Nell)'/.test(r.name ?? "")),
    "mis-cased street name",
  )
  // Regression: its stone-core disc sat 54 m off the castle, which came out plaster.
  assert.equal(MAP.buildings.find((b) => b.name === "Castello dell'Aquila")?.style, "stone")
})

// Regression: every way named Torrente Lucido was 8 m wide, up the Vinca valley to its source under the Garnerone.
test("water: the Lucido is 8 m on the valley floor and 4 m above Vinca", () => {
  const w = (id: number) => MAP.water.find((o) => o.id === id)?.w
  assert.deepEqual([w(254825035), w(140780317), w(696231807), w(687230881)], [8, 4, 8, 14])
})

test("water: catchments grow downstream; the Lucido drains 47 km² where it meets the Aulella, which leaves the map with Soliera's 208", () => {
  for (const w of MAP.water)
    w.area.forEach((a, k) =>
      assert.ok(k === 0 || a >= w.area[k - 1]!, `water ${w.id} shrinks at ${k}`),
    )
  // Regression: a tributary's mouth read the receiving river's node, so a trickle's last vertex took the river's 45 km².
  for (const w of MAP.water) {
    const [before, mouth] = w.area.slice(-2)
    if (before !== undefined)
      assert.ok(
        mouth! <= 1.5 * before + 1,
        `water ${w.id}: ${before} km² jumps to ${mouth} at its mouth`,
      )
  }
  const lucido = MAP.water.filter((w) => w.name === "Torrente Lucido" && w.kind === "river")
  const mouth = Math.max(...lucido.map((w) => w.area.at(-1)!))
  assert.ok(Math.abs(mouth - 47) < 2, `the Lucido drains ${mouth} km²`)
  const aulella = Math.max(
    ...MAP.water.filter((w) => w.name === "Torrente Aulella").map((w) => w.area.at(-1)!),
  )
  assert.ok(Math.abs(aulella - 208) < 3, `the Aulella leaves with ${aulella} km²`)
})

test("walls: water stops neither feet nor wheels; the shore walls ring it, and people and animals keep to them", () => {
  // The middle of every wide river's reach away from the roads and the map's edge: no walk or drive wall within 2 m, a shore wall
  // within its bed.
  const { minX, minY, maxX, maxY } = MAP.bounds
  let checked = 0
  for (const w of MAP.water.filter((o) => o.w >= 12))
    for (let k = 0; k < w.pts.length / 2; k += 5) {
      const x = w.pts[2 * k]!,
        y = w.pts[2 * k + 1]!
      if (
        Math.min(x - minX, maxX - x, y - minY, maxY - y) < 30 ||
        MAP.roads.some((r) =>
          r.pts.some((v, i) => i % 2 === 0 && Ops.hypot(v - x, r.pts[i + 1]! - y) < 30),
        )
      )
        continue
      checked++
      const near = (kind: "walk" | "land" | "drive", r: number) =>
        wallsNear(kind, x - r, y - r, x + r, y + r).some((s) => segmentDistance(s, x, y) < r)
      assert.ok(!near("walk", 2) && !near("drive", 2), `a wall in the water at ${x}, ${y}`)
      assert.ok(near("land", w.bed + 5), `no shore wall by the water at ${x}, ${y}`)
    }
  assert.ok(checked > 20, `${checked} river points checked`)
})

// Regression: OSM centrelines ran up to 3.5 m inside CTR houses; the walls opened a corridor the house drawn did not show.
test("drivable roads never run inside a footprint: where OSM and the CTR disagree, the house gives way", () => {
  const buildings = bucketed(MAP.buildings, (b) => b.outer, 0)
  for (const r of MAP.roads) {
    if (!isDrivable(r.cls) || r.tunnel === true) continue
    for (const { x, y } of samples(r.pts, 0.5)) {
      const hit = buildings(x, y).find(
        (b) => inRing(x, y, b.outer) && !(b.holes ?? []).some((h) => inRing(x, y, h)),
      )
      assert.equal(
        hit,
        undefined,
        `${r.cls} ${r.id} inside building ${hit?.id} at ${x.toFixed(1)},${y.toFixed(1)}`,
      )
    }
  }
})

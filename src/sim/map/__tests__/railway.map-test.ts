import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { wholeMap } from "../../../tools/map-file.ts"
import { PARTS } from "../../../tools/region.ts"
import { pointInRing, segDist2 } from "../../collide.ts"
import { groundZ, platformTop, terrainZ } from "../ground.ts"
import { graph, isDrivable, MAP, outlineDistance, type RailLine } from "../index.ts"
import { RAIL_LIFT } from "../kinds.ts"

const { hypot } = Ops
const { railway } = MAP
/** The roads and areas live in the tiles: these checks read them all, joined in the whole map's order. */
const WHOLE = wholeMap()
const running = MAP.rail.flatMap((r, i) => (r.kind === undefined ? [i] : []))

/** A line's vertices in order (flat x, y), their bed z and their arc lengths. */
const chained = (line: RailLine) => {
  const pts: Array<number> = [],
    z: Array<number> = []
  for (const { rail, rev } of line.pieces) {
    const p = MAP.rail[rail]!.pts,
      n = p.length / 2
    for (let k = pts.length === 0 ? 0 : 1; k < n; k++) {
      const j = rev ? n - 1 - k : k
      pts.push(p[2 * j]!, p[2 * j + 1]!)
      z.push(MAP.rail[rail]!.z[j]!)
    }
  }
  const s = [0]
  for (let k = 2; k < pts.length; k += 2)
    s.push(s.at(-1)! + hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!))
  return { pts, z, s }
}
const lines = railway.lines.map(chained)
/** The bed's z at arc length `at` along a chained line. */
const zAt = ({ z, s }: ReturnType<typeof chained>, at: number) => {
  let k = 1
  while (k < s.length - 1 && s[k]! < at) k++
  return z[k - 1]! + ((z[k]! - z[k - 1]!) * (at - s[k - 1]!)) / (s[k]! - s[k - 1]! || 1)
}
/** Where `line` runs in a tunnel, consecutive tunnel pieces merged: from s to s along its chained vertices. */
const tunnelsOf = (line: RailLine): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  let walked = 0
  for (const { rail } of line.pieces) {
    const { pts, tunnel } = MAP.rail[rail]!
    let length = 0
    for (let k = 2; k < pts.length; k += 2)
      length += hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!)
    const last = out.at(-1)
    if (tunnel === true && last !== undefined && Math.abs(last[1] - walked) < 1e-6)
      last[1] = walked + length
    else if (tunnel === true) out.push([walked, walked + length])
    walked += length
  }
  return out
}
/** The point at arc length `at` along a chained line and its unit direction. */
const pointAt = ({ pts, s }: ReturnType<typeof chained>, at: number) => {
  let k = 1
  while (k < s.length - 1 && s[k]! < at) k++
  const t = (at - s[k - 1]!) / (s[k]! - s[k - 1]! || 1),
    len = s[k]! - s[k - 1]! || 1
  const dx = pts[2 * k]! - pts[2 * k - 2]!,
    dy = pts[2 * k + 1]! - pts[2 * k - 1]!
  return { x: pts[2 * k - 2]! + dx * t, y: pts[2 * k - 1]! + dy * t, dx: dx / len, dy: dy / len }
}
/** The arc length along a chained line of the point of it nearest (x, y), and how far that is. */
const sOf = ({ pts, s }: ReturnType<typeof chained>, x: number, y: number) => {
  let best = { d2: Number.MAX_VALUE, s: 0 }
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const { d2, t } = segDist2(x, y, pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!)
    if (d2 < best.d2) best = { d2, s: s[k / 2]! + (s[k / 2 + 1]! - s[k / 2]!) * t }
  }
  return { s: best.s, d: Math.sqrt(best.d2) }
}
const inside = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number) =>
  pointInRing(x, y, rings[0]!) && !rings.slice(1).some((h) => pointInRing(x, y, h))
const vertexOf = (pts: ReadonlyArray<number>, x: number, y: number) => {
  for (let k = 0; k < pts.length; k += 2) if (pts[k] === x && pts[k + 1] === y) return k / 2
  return -1
}
const ends = (i: number) => {
  const p = MAP.rail[i]!.pts
  return [`${p[0]},${p[1]}`, `${p.at(-2)},${p.at(-1)}`] as const
}

test("railway: each line runs terminal to terminal, its pieces sharing their end vertices bit-identically", () => {
  const degree = new Map<string, number>()
  for (const i of running) for (const k of ends(i)) degree.set(k, (degree.get(k) ?? 0) + 1)
  const covered = new Map<number, number>()
  for (const line of railway.lines) {
    const tip = (k: number, last: boolean) => {
      const { rail, rev } = line.pieces[k]!
      return ends(rail)[rev === last ? 0 : 1]
    }
    for (let k = 0; k + 1 < line.pieces.length; k++)
      assert.equal(tip(k, true), tip(k + 1, false), `pieces ${k} and ${k + 1} meet`)
    assert.equal(degree.get(tip(0, false)), 1, "the first piece starts at a terminal")
    assert.equal(degree.get(tip(line.pieces.length - 1, true)), 1, "the last ends at one")
    for (const { rail } of line.pieces) covered.set(rail, (covered.get(rail) ?? 0) + 1)
  }
  assert.deepEqual(
    running.filter((i) => covered.get(i) !== 1),
    [],
    "every running piece is on one line",
  )
  // Today one line: the Lucca–Aulla line from the play area's outline at Pieve San Lorenzo (in the Galleria del Lupacino,
  // towards Piazza al Serchio) to its outline by Rometta (towards Aulla), where the build cuts it (to 0.1 m).
  assert.equal(railway.lines.length, 1)
  const { pts } = lines[0]!
  assert.ok(outlineDistance(pts[0]!, pts[1]!) < 0.08, "it starts on the outline")
  assert.ok(outlineDistance(pts.at(-2)!, pts.at(-1)!) < 0.08, "and ends on it")
})

test("railway: OSM's speed limits run along the line, 80 km/h from Equi Terme's stop to Gragnola's", () => {
  const line = railway.lines[0]!,
    { s } = lines[0]!
  const tunnels = tunnelsOf(line)
  let at = 0
  for (const [from, to, kmh] of line.maxspeed) {
    assert.ok(Math.abs(from - at) < 0.11 && to > from, `span ${from}–${to} follows on from ${at}`)
    // 80 or 85 km/h; OSM tags the Galleria del Lupacino, in from the line's start, 140.
    const bored = tunnels.some(([a, b]) => from > a - 0.11 && to < b + 0.11)
    assert.ok(kmh === 80 || kmh === 85 || (kmh === 140 && bored), `${kmh} km/h at ${from}–${to}`)
    at = to
  }
  assert.ok(Math.abs(at - s.at(-1)!) < 0.11, "the spans cover the line")
  // OSM tags the line 85 up to Equi Terme's stop, 80 to Gragnola's track-2 stop, 85 beyond.
  const stopS = (name: string) =>
    MAP.pois
      .filter((p) => p.kind === "railway=stop" && p.name === name)
      .map((p) => sOf(lines[0]!, p.x, p.y))
      .filter((f) => f.d < 0.1)
      .map((f) => f.s)
  const slow = line.maxspeed.find(([, , kmh]) => kmh === 80)!
  assert.ok(
    stopS("Equi Terme").some((x) => Math.abs(x - slow[0]) < 0.11),
    "the 80 km/h stretch starts at Equi Terme's stop",
  )
  assert.ok(
    stopS("Gragnola").some((x) => Math.abs(x - slow[1]) < 0.11),
    "and ends at Gragnola's",
  )
})

test("railway: the line calls at each station along its platforms, on their side", () => {
  // OSM's five from Pieve San Lorenzo to Gassano: Fivizzano-Gassano a halt.
  assert.deepEqual(
    railway.stations.map((st) => [st.name, st.line]),
    [
      ["Minucciano-Pieve-Casola", 0],
      ["Equi Terme", 0],
      ["Monzone-Monte dei Bianchi-Isolano", 0],
      ["Gragnola", 0],
      ["Fivizzano-Gassano", 0],
    ],
  )
  for (const st of railway.stations) {
    const line = lines[st.line]!
    assert.ok(st.s1 - st.s0 > 60 && st.s1 - st.s0 < 200, `${st.name}: ${st.s0}–${st.s1}`)
    // The station or halt node (on the building) lies beside the extent.
    const node = MAP.pois.find(
      (p) => (p.kind === "railway=station" || p.kind === "railway=halt") && p.name === st.name,
    )!
    const f = sOf(line, node.x, node.y)
    assert.ok(f.s > st.s0 - 20 && f.s < st.s1 + 20 && f.d < 20, `${st.name}'s station node`)
    // Its platforms beside the line project inside the extent, and the side 2.1 m off its middle is on one.
    const own = railway.platforms.filter((p) => p.name === st.name)
    for (const p of own) {
      const ring = WHOLE.areas[p.area]!.rings[0]!
      const fs = Array.from({ length: ring.length / 2 }, (_, k) =>
        sOf(line, ring[2 * k]!, ring[2 * k + 1]!),
      )
      if (Math.min(...fs.map((q) => q.d)) > 2.5) continue
      for (const q of fs) assert.ok(q.s >= st.s0 - 0.11 && q.s <= st.s1 + 0.11, st.name)
    }
    // Across the line from its middle, on its side, within 4 m: one of its platforms.
    const mid = pointAt(line, (st.s0 + st.s1) / 2)
    const across = Array.from({ length: 24 }, (_, k) => 1.6 + 0.1 * k).map((d) => ({
      x: mid.x + mid.dy * st.side * d,
      y: mid.y - mid.dx * st.side * d,
    }))
    assert.ok(
      across.some(({ x, y }) => own.some((p) => inside(WHOLE.areas[p.area]!.rings, x, y))),
      `${st.name}: a platform on side ${st.side} of (${mid.x.toFixed(1)}, ${mid.y.toFixed(1)})`,
    )
  }
})

test("railway: each level-crossing box holds the vertices its road shares with the rail, the line's s at one", () => {
  const roadNames: Array<string> = []
  for (const c of railway.crossings) {
    const road = WHOLE.roads[c.road]!
    roadNames.push(road.name ?? road.cls)
    for (const n of c.nodes) {
      const { x, y } = graph.nodes[n]!
      assert.ok(vertexOf(road.pts, x, y) >= 0, `node ${n} is a vertex of road ${road.id}`)
      assert.ok(
        MAP.rail.some((r) => r.bridge !== true && r.tunnel !== true && vertexOf(r.pts, x, y) >= 0),
        `node ${n} is a rail vertex`,
      )
      for (const m of c.nodes)
        assert.ok(hypot(graph.nodes[m]!.x - x, graph.nodes[m]!.y - y) <= 10, "nodes within 10 m")
    }
    const mx = c.nodes.reduce((a, n) => a + graph.nodes[n]!.x, 0) / c.nodes.length,
      my = c.nodes.reduce((a, n) => a + graph.nodes[n]!.y, 0) / c.nodes.length
    assert.ok(hypot(c.x - mx, c.y - my) < 0.08, "x, y is the nodes' mean")
    // A box over a loop or siding alone names no line (−1): Pieve San Lorenzo's foot crossing of its loop.
    if (c.line < 0) {
      assert.equal(c.s, -1)
      continue
    }
    assert.equal(c.line, 0)
    const p = pointAt(lines[0]!, c.s)
    assert.ok(
      c.nodes.some((n) => hypot(graph.nodes[n]!.x - p.x, graph.nodes[n]!.y - p.y) < 0.1),
      `${road.name}: the line at s ${c.s} is on a node`,
    )
  }
  // OSM's six road crossings (Via Castel dell'Aquila over both Gragnola tracks, one box; an unnamed road by Gassano) and two
  // foot crossings, Equi Terme's and Pieve San Lorenzo's.
  assert.deepEqual(roadNames.sort(), [
    "Via Castel dell'Aquila",
    "Via Nuova",
    "Via Riolo",
    "Viale 20 Settembre",
    "path",
    "path",
    "unclassified",
  ])
  assert.equal(
    railway.crossings.find((c) => WHOLE.roads[c.road]!.name === "Via Castel dell'Aquila")!.nodes
      .length,
    2,
  )
  // Every vertex an at-grade road shares with at-grade rail is in a box.
  const boxed = new Set(railway.crossings.flatMap((c) => c.nodes))
  for (const r of MAP.rail) {
    if (r.bridge === true || r.tunnel === true) continue
    for (const road of WHOLE.roads) {
      if (road.bridge === true || road.tunnel === true) continue
      for (let k = 0; k < road.pts.length; k += 2) {
        if (vertexOf(r.pts, road.pts[k]!, road.pts[k + 1]!) < 0) continue
        const n = graph.nodes.findIndex((g) => g.x === road.pts[k] && g.y === road.pts[k + 1])
        assert.ok(boxed.has(n), `rail ${r.id} × road ${road.id} at node ${n} is in a box`)
      }
    }
  }
})

test("railway: platforms stand 1.55 m clear of every track and 0.5 m off the carriageways, their top over the rail head", () => {
  const tracks = MAP.rail.filter((r) => r.tunnel !== true)
  const roads = WHOLE.roads.filter(
    (r) => isDrivable(r.cls) && r.bridge !== true && r.tunnel !== true,
  )
  const dist = (pts: ReadonlyArray<number>, x: number, y: number) => {
    let d2 = Number.MAX_VALUE
    for (let k = 0; k + 3 < pts.length; k += 2)
      d2 = Math.min(d2, segDist2(x, y, pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!).d2)
    return Math.sqrt(d2)
  }
  const boxOf = (pts: ReadonlyArray<number>) => {
    const xs = pts.filter((_, k) => k % 2 === 0),
      ys = pts.filter((_, k) => k % 2 === 1)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const
  }
  const near = <T extends { readonly pts: ReadonlyArray<number> }>(
    list: ReadonlyArray<T>,
    [x0, y0, x1, y1]: readonly [number, number, number, number],
  ) =>
    list.filter((l) => {
      const [a0, b0, a1, b1] = boxOf(l.pts)
      return a0 < x1 + 20 && a1 > x0 - 20 && b0 < y1 + 20 && b1 > y0 - 20
    })
  for (const p of railway.platforms) {
    const area = WHOLE.areas[p.area]!
    assert.equal(area.kind, p.walkway === true ? "paved" : "platform")
    const box = boxOf(area.rings[0]!),
      byTracks = near(tracks, box),
      byRoads = near(roads, box)
    for (const ring of area.rings)
      for (let k = 0; k < ring.length; k += 2) {
        const j = (k + 2) % ring.length,
          n = Math.ceil(hypot(ring[j]! - ring[k]!, ring[j + 1]! - ring[k + 1]!) / 0.1)
        for (let q = 0; q <= n; q++) {
          const x = ring[k]! + ((ring[j]! - ring[k]!) * q) / n,
            y = ring[k + 1]! + ((ring[j + 1]! - ring[k + 1]!) * q) / n
          for (const t of byTracks)
            assert.ok(dist(t.pts, x, y) >= 1.55, `${p.name} (${x}, ${y}) by rail ${t.id}`)
          for (const r of byRoads)
            // 0.5 m off the carriageway (platforms.ts), less the 0.06 m the rings are simplified by.
            assert.ok(dist(r.pts, x, y) >= r.w / 2 + 0.44, `${p.name} (${x}, ${y}) on road ${r.id}`)
        }
      }
    // The top is the rail head of the line beside it plus 0.25 m (a walkway's plus 0.02 m).
    const rise = RAIL_LIFT + (p.walkway === true ? 0.02 : 0.25)
    for (let k = 0; k < p.top.length; k++) {
      const x = p.axis[2 * k]!,
        y = p.axis[2 * k + 1]!
      const bed = running
        .map((i) => MAP.rail[i]!)
        .flatMap((r) =>
          Array.from({ length: r.z.length - 1 }, (_, v) => {
            const f = segDist2(
              x,
              y,
              r.pts[2 * v]!,
              r.pts[2 * v + 1]!,
              r.pts[2 * v + 2]!,
              r.pts[2 * v + 3]!,
            )
            return { d2: f.d2, z: r.z[v]! + (r.z[v + 1]! - r.z[v]!) * f.t }
          }),
        )
        .reduce((a, b) => (b.d2 < a.d2 ? b : a))
      assert.ok(bed.d2 < 0.01, "the axis follows the running track")
      assert.ok(
        Math.abs(p.top[k]! - bed.z - rise) < 0.011,
        `${p.name}: top ${p.top[k]} over ${bed.z}`,
      )
    }
    // People stand on it: inside (every 1 m), the ground is its top, or the terrain where that is higher; outside, no top.
    let probes = 0
    for (let x = Math.floor(box[0]); x <= box[2]; x++)
      for (let y = Math.floor(box[1]); y <= box[3]; y++) {
        const top = platformTop(x, y)
        if (!inside(area.rings, x, y)) {
          if (!railway.platforms.some((q) => inside(WHOLE.areas[q.area]!.rings, x, y)))
            assert.equal(top, undefined, `(${x}, ${y}) off every platform`)
          continue
        }
        probes++
        assert.ok(top !== undefined, `(${x}, ${y}) on ${p.name}`)
        // Or a footway OSM draws along it, as at Fivizzano-Gassano: a path follows the terrain, 0.06 m over it, so it lies
        // up to 0.09 m over the top there.
        const ground = groundZ(x, y),
          top0 = Math.max(top, terrainZ(x, y))
        assert.ok(ground >= top0 && ground - top0 < 0.1, `(${x}, ${y}) on ${p.name}: ${ground}`)
      }
    assert.ok(probes > 100, `${p.name}: ${probes} probes`)
  }
  // Gragnola's strip between its two tracks is a walkway at the rails' level, and so is the strip the
  // CTR maps north of Pieve San Lorenzo's line, 2.45 m off it (bare ground in 2010, the line's
  // equipment in 2023: no train's step reaches it); the other seven are platforms.
  assert.deepEqual(
    railway.platforms.map((p) => [p.name, p.walkway === true]),
    [
      ["Fivizzano-Gassano", false],
      ["Gragnola", true],
      ["Gragnola", false],
      ["Minucciano-Pieve-Casola", false],
      ["Minucciano-Pieve-Casola", false],
      ["Minucciano-Pieve-Casola", true],
      ["Equi Terme", false],
      ["Monzone-Monte dei Bianchi-Isolano", false],
      ["Monzone-Monte dei Bianchi-Isolano", false],
    ],
  )
})

// Regression: the rail was pinned to each crossing road's natural level, a V of
// 3.8–5.1% within ±5 m (an 82 m vertical curve at Via Nuova, 6.8 m/s² at 85 km/h).
test("railway: the line's grade changes by under 4% over 20 m, under 2% through a level crossing", () => {
  const L = 20
  railway.lines.forEach((_, l) => {
    const chain = lines[l]!,
      { s } = chain
    const change = (at: number) =>
      Math.abs(
        (zAt(chain, at + L) - zAt(chain, at)) / L - (zAt(chain, at) - zAt(chain, at - L)) / L,
      )
    for (let at = L; at <= s.at(-1)! - L; at += 1)
      assert.ok(change(at) < 0.04, `grade changes ${(change(at) * 100).toFixed(1)}% at s ${at}`)
    for (const c of railway.crossings.filter((x) => x.line === l))
      assert.ok(
        change(c.s) < 0.02,
        `grade changes ${(change(c.s) * 100).toFixed(1)}% at the crossing at s ${c.s}`,
      )
  })
})

// Issue #17: the rail stays within 2.5% through its tunnels, the rail's grade limit (`RAIL_PASS`). Each stretch of 100 m or
// more (the whole of a shorter tunnel) climbs or falls 2.5% of its length at most, and 0.1 m more, the bed's rounding: lucido's
// tunnels average 2.51–2.54% over 67–271 m, and the Galleria del Lupacino, which the outline cuts, runs level from its portal.
test("railway: the line climbs or falls 2.5% at most through its tunnels, over 100 m or more", () => {
  railway.lines.forEach((line, l) => {
    const chain = lines[l]!
    for (const [from, to] of tunnelsOf(line)) {
      const n = Math.floor(to - from),
        zs = Array.from({ length: n + 1 }, (_, m) => zAt(chain, from + m))
      const shortest = Math.min(100, n),
        widths = [
          ...Array.from(
            { length: Math.floor((n - shortest) / 10) + 1 },
            (_, k) => shortest + 10 * k,
          ),
          n,
        ]
      for (const w of widths)
        for (let a = 0; a + w <= n; a++) {
          const rise = Math.abs(zs[a + w]! - zs[a]!)
          assert.ok(
            rise <= 0.025 * w + 0.1,
            `${((100 * rise) / w).toFixed(2)}% over ${w} m from s ${(from + a).toFixed(0)}`,
          )
        }
    }
  })
})

// Issue #17: the rail is continuous through Gragnola, over lucido's seam with fivizzano (lucido's north edge): one line runs on
// across it, between stations on either side, its grade there within the line's 2.5% over 100 m either way.
test("railway: the line runs on through Gragnola over lucido's seam with fivizzano, its grade there within 2.5%", () => {
  const [x0, , x1, y1] = PARTS.find((p) => p.key === "lucido")!.rects[0]!
  const chain = lines[0]!,
    { pts, s } = chain
  const over: Array<number> = []
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const [ax, ay, bx, by] = [pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!]
    if (ay < y1 === by < y1) continue
    const t = (y1 - ay) / (by - ay),
      x = ax + (bx - ax) * t
    if (x >= x0 && x <= x1) over.push(s[k / 2]! + (s[k / 2 + 1]! - s[k / 2]!) * t)
  }
  assert.equal(over.length, 1, `the line crosses the seam ${over.length} times`)
  const at = over[0]!
  assert.ok(
    railway.stations.some((st) => st.s1 < at) && railway.stations.some((st) => st.s0 > at),
    "a station on either side",
  )
  for (const way of [-1, 1]) {
    const rise = Math.abs(zAt(chain, at + 100 * way) - zAt(chain, at))
    assert.ok(rise <= 2.5 + 0.1, `${rise.toFixed(2)} m over 100 m ${way > 0 ? "on" : "back"}`)
  }
})

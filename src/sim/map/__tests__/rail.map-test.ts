import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { terrainZ } from "../ground.ts"
import { heightAt, MAP, RAIL_KINDS, type Rail } from "../index.ts"
import { isDrivable } from "../kinds.ts"

const { hypot } = Ops
/** A flat polyline's vertices as "x,y" keys: shared vertices are bit-identical (both rounded to 0.1 m). */
const keyAt = (pts: ReadonlyArray<number>, i: number) => `${pts[2 * i]},${pts[2 * i + 1]}`
const ends = (r: Rail) => [keyAt(r.pts, 0), keyAt(r.pts, r.pts.length / 2 - 1)] as const
const lengthOf = (pts: ReadonlyArray<number>) => {
  let s = 0
  for (let i = 2; i < pts.length; i += 2)
    s += hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!)
  return s
}
const running = MAP.rail.filter((r) => r.kind === undefined)
const atGrade = MAP.rail.filter((r) => r.bridge !== true && r.tunnel !== true)

/** The running pieces walked end to end from the end that has no neighbour: one polyline. */
const line = (): Array<number> => {
  const at = new Map<string, Array<Rail>>()
  for (const r of running) for (const k of ends(r)) at.set(k, [...(at.get(k) ?? []), r])
  const free = [...at].filter(([, rs]) => rs.length === 1)
  assert.equal(free.length, 2, `the running track has ${free.length} free ends`)
  const pts: Array<number> = []
  const seen = new Set<Rail>()
  for (let key = free[0]![0]; ;) {
    const r = at.get(key)!.find((q) => !seen.has(q))
    if (r === undefined) break
    seen.add(r)
    const fwd = ends(r)[0] === key
    const p: Array<number> = []
    for (let i = 0; i < r.pts.length / 2; i++) {
      const j = fwd ? i : r.pts.length / 2 - 1 - i
      p.push(r.pts[2 * j]!, r.pts[2 * j + 1]!)
    }
    pts.push(...(pts.length === 0 ? p : p.slice(2)))
    key = keyAt(p, p.length / 2 - 1)
  }
  assert.equal(seen.size, running.length, "every running piece is on the one chain")
  return pts
}

/** Where segment a of polyline `p` (from vertex i) crosses segment b of `q` (from vertex j): t and u along them. */
const crossingsOf = (p: ReadonlyArray<number>, q: ReadonlyArray<number>) => {
  const out: Array<{ x: number; y: number; i: number; t: number; j: number; u: number }> = []
  for (let i = 0; i + 3 < p.length; i += 2)
    for (let j = 0; j + 3 < q.length; j += 2) {
      const ex = p[i + 2]! - p[i]!,
        ey = p[i + 3]! - p[i + 1]!,
        fx = q[j + 2]! - q[j]!,
        fy = q[j + 3]! - q[j + 1]!,
        den = ex * fy - ey * fx
      if (den === 0) continue
      const t = ((q[j]! - p[i]!) * fy - (q[j + 1]! - p[i + 1]!) * fx) / den,
        u = ((q[j]! - p[i]!) * ey - (q[j + 1]! - p[i + 1]!) * ex) / den
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
        out.push({ x: p[i]! + ex * t, y: p[i + 1]! + ey * t, i: i / 2, t, j: j / 2, u })
    }
  return out
}
const box = (pts: ReadonlyArray<number>) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (let i = 0; i < pts.length; i += 2)
    [x0, y0, x1, y1] = [
      Math.min(x0, pts[i]!),
      Math.min(y0, pts[i + 1]!),
      Math.max(x1, pts[i]!),
      Math.max(y1, pts[i + 1]!),
    ]
  return [x0, y0, x1, y1] as const
}
const meet = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const [ax0, ay0, ax1, ay1] = box(a),
    [bx0, by0, bx1, by1] = box(b)
  return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1
}
/** The vertices where at-grade rail and an at-grade road share a point: the level crossings. */
const levelCrossings = (() => {
  const out: Array<{ x: number; y: number; rail: Rail; road: (typeof MAP.roads)[number] }> = []
  for (const rail of atGrade) {
    const vs = new Set(rail.pts.map((_, i) => (i % 2 === 0 ? keyAt(rail.pts, i / 2) : "")))
    for (const road of MAP.roads)
      if (road.bridge !== true && road.tunnel !== true && meet(rail.pts, road.pts))
        for (let i = 0; i < road.pts.length / 2; i++)
          if (vs.has(keyAt(road.pts, i)))
            out.push({ x: road.pts[2 * i]!, y: road.pts[2 * i + 1]!, rail, road })
  }
  return out
})()

test("rail: the running track runs unbroken from the north edge to the east edge, its loop's ends on it", () => {
  const pts = line()
  const first = [pts[0]!, pts[1]!],
    last = [pts.at(-2)!, pts.at(-1)!]
  const onEdge = ([x, y]: Array<number>) => y === MAP.bounds.maxY || x === MAP.bounds.maxX
  assert.ok(onEdge(first) && onEdge(last), `ends at (${first.join(", ")}) and (${last.join(", ")})`)
  // 10 910.9 m in this build; OSM's chain was 10 901 m (the Lucca–Aulla line from Minucciano's side to Gragnola's).
  const length = lengthOf(pts)
  assert.ok(length > 10_850 && length < 10_950, `${length.toFixed(0)} m`)
  const vertices = new Set(pts.map((_, i) => (i % 2 === 0 ? keyAt(pts, i / 2) : "")))
  const loops = MAP.rail.filter((r) => r.kind === "loop")
  assert.ok(loops.length > 0, "a loop (Gragnola's track 1)")
  // Its pieces (cut where the stub leaves it) chain end to end; the chain's two ends are on the line.
  const loopEnds = new Map<string, number>()
  for (const r of loops) for (const k of ends(r)) loopEnds.set(k, (loopEnds.get(k) ?? 0) + 1)
  const free = [...loopEnds].filter(([, n]) => n === 1).map(([k]) => k)
  assert.equal(free.length, 2, `the loop has ${free.length} ends`)
  for (const k of free) assert.ok(vertices.has(k), `the loop ends at ${k}, off the running track`)
  for (const r of MAP.rail)
    assert.ok(r.kind === undefined || RAIL_KINDS.includes(r.kind), `rail ${r.id} kind ${r.kind}`)
  // Gragnola: the loop is the west track by the station building, the through track the east one.
  const station = MAP.buildings.find((b) => b.style === "station" && b.name === "Gragnola")!
  const sx =
    station.outer.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) /
    (station.outer.length / 2)
  const sy =
    station.outer.filter((_, i) => i % 2 === 1).reduce((a, v) => a + v, 0) /
    (station.outer.length / 2)
  const xAt = (p: ReadonlyArray<number>, y: number) => {
    for (let i = 0; i + 3 < p.length; i += 2)
      if ((p[i + 1]! - y) * (p[i + 3]! - y) <= 0 && p[i + 1] !== p[i + 3])
        return p[i]! + ((p[i + 2]! - p[i]!) * (y - p[i + 1]!)) / (p[i + 3]! - p[i + 1]!)
    return Number.NaN
  }
  const loop = loops.find((r) => Math.abs(xAt(r.pts, sy) - sx) < 30)
  assert.ok(loop !== undefined, "a loop passes the Gragnola station building")
  assert.ok(
    xAt(loop.pts, sy) < xAt(pts, sy),
    "the loop is the track nearer the building, west of the line",
  )
})

test("rail: at grade, the rail meets roads and water only at vertices they share, level with the road", () => {
  for (const rail of atGrade) {
    for (const other of [
      ...MAP.roads.filter((r) => r.bridge !== true && r.tunnel !== true),
      ...MAP.water,
    ]) {
      if (!meet(rail.pts, other.pts)) continue
      for (const c of crossingsOf(rail.pts, other.pts)) {
        const atVertex = (t: number) => Math.min(t, 1 - t) < 1e-6
        assert.ok(
          atVertex(c.t) && atVertex(c.u),
          `rail ${rail.id} crosses ${"cls" in other ? "road" : "water"} ${other.id} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) between vertices`,
        )
      }
    }
  }
  for (const c of levelCrossings) {
    const i =
      c.rail.pts.findIndex((v, k) => k % 2 === 0 && v === c.x && c.rail.pts[k + 1] === c.y) / 2
    const j =
      c.road.pts.findIndex((v, k) => k % 2 === 0 && v === c.x && c.road.pts[k + 1] === c.y) / 2
    assert.ok(
      Math.abs(c.rail.z[i]! - c.road.z[j]!) < 0.11,
      `rail ${c.rail.id} and road ${c.road.id} at (${c.x}, ${c.y})`,
    )
  }
  // OSM's five road crossings (Via Castel dell'Aquila over both Gragnola tracks) and the Equi Terme foot crossing.
  const named = (name: string) => levelCrossings.filter((c) => c.road.name === name).length
  assert.deepEqual(
    ["Via Riolo", "Viale 20 Settembre", "Via Castel dell'Aquila", "Via Nuova"].map(named),
    [1, 1, 2, 1],
  )
  assert.ok(
    levelCrossings.some((c) => c.road.cls === "path"),
    "the foot crossing at Equi Terme",
  )
})

// Regression: a switch vertex inserted beside the CTR's own
// one drew Gragnola's loop at double width there, and vertices inserted beside the CTR's turned the
// heading 6–9° over 0.5–1.1 m segments on the 0.1 m grid.
test("rail: no polyline repeats a vertex, and a rail segment under 1.85 m joins two shared vertices", () => {
  for (const [what, ls] of [
    ["rail", MAP.rail],
    ["road", MAP.roads],
    ["water", MAP.water],
  ] as const)
    for (const l of ls)
      for (let i = 2; i < l.pts.length; i += 2)
        assert.ok(
          l.pts[i] !== l.pts[i - 2] || l.pts[i + 1] !== l.pts[i - 1],
          `${what} ${l.id} repeats (${l.pts[i]}, ${l.pts[i + 1]})`,
        )
  // A vertex is shared when another line has it too (a switch, a joint, a level crossing, a culvert).
  const uses = new Map<string, number>()
  for (const l of [...MAP.rail, ...MAP.roads, ...MAP.water])
    for (const k of new Set(l.pts.flatMap((_, i) => (i % 2 === 0 ? [keyAt(l.pts, i / 2)] : []))))
      uses.set(k, (uses.get(k) ?? 0) + 1)
  const shared = (pts: ReadonlyArray<number>, i: number) => uses.get(keyAt(pts, i))! > 1
  for (const r of MAP.rail)
    for (let i = 1; i < r.pts.length / 2; i++) {
      const d = hypot(r.pts[2 * i]! - r.pts[2 * i - 2]!, r.pts[2 * i + 1]! - r.pts[2 * i - 1]!)
      assert.ok(
        d >= 1.85 || (shared(r.pts, i - 1) && shared(r.pts, i)),
        `rail ${r.id}: a ${d.toFixed(2)} m segment at (${r.pts[2 * i]}, ${r.pts[2 * i + 1]})`,
      )
    }
})

test("rail: no terrain stands over at-grade track more than 6 m from a level crossing", () => {
  let worst = { d: -Number.MAX_VALUE, x: 0, y: 0, id: 0 }
  for (const r of atGrade)
    for (let k = 0; k + 1 < r.z.length; k++) {
      const ax = r.pts[2 * k]!,
        ay = r.pts[2 * k + 1]!,
        bx = r.pts[2 * k + 2]!,
        by = r.pts[2 * k + 3]!
      const n = Math.max(1, Math.ceil(hypot(bx - ax, by - ay) / 0.5))
      for (let q = 0; q <= n; q++) {
        const t = q / n,
          x = ax + (bx - ax) * t,
          y = ay + (by - ay) * t
        if (levelCrossings.some((c) => hypot(c.x - x, c.y - y) <= 6)) continue
        const d = Math.max(terrainZ(x, y), heightAt(x, y)) - (r.z[k]! + (r.z[k + 1]! - r.z[k]!) * t)
        if (d > worst.d) worst = { d, x, y, id: r.id }
      }
    }
  assert.ok(
    worst.d <= 0.05 + 1e-9,
    `terrain ${worst.d.toFixed(2)} m over rail ${worst.id} at (${worst.x.toFixed(1)}, ${worst.y.toFixed(1)})`,
  )
})

// Regression: where the CTR maps a bridge OSM drew the track at grade, 12 m of it
// hung 12 m over the Fosso di Rubiana; bridge ends short of a river or a tertiary road's core left
// track over the carved cells. A lower road running along the line keeps its cells, its core
// (w/2 + 2.3 m) reaching a corner of a cell the line runs through (up to 5.7 m off it): the 4 m
// grid holds one level (by the Aiola tunnel's west portal the tertiary 542115787 runs 5.4 m beside
// the line, 6 m below; south of Gragnola the Via Provinciale 9.6 m off, 6.7 m below).
test("rail: at-grade track stands on the ground, but beside a lower road running along it", () => {
  const roads = MAP.roads.filter((r) => r.bridge !== true && r.tunnel !== true)
  const alongside = (x: number, y: number, z: number, dx: number, dy: number) =>
    roads.some((road) => {
      for (let k = 0; k + 1 < road.z.length; k++) {
        const ax = road.pts[2 * k]!,
          ay = road.pts[2 * k + 1]!,
          bx = road.pts[2 * k + 2]!,
          by = road.pts[2 * k + 3]!
        const reach = road.w / 2 + 8
        if (Math.min(ax, bx) > x + reach || Math.max(ax, bx) < x - reach) continue
        if (Math.min(ay, by) > y + reach || Math.max(ay, by) < y - reach) continue
        const l = hypot(bx - ax, by - ay) || 1,
          cos = Math.abs(((bx - ax) * dx + (by - ay) * dy) / l)
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (l * l)))
        const d = hypot(x - ax - (bx - ax) * t, y - ay - (by - ay) * t)
        const rz = road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t
        if (d <= reach && cos >= Ops.cos(Math.PI / 6) && rz < z - 1) return true
      }
      return false
    })
  for (const r of atGrade)
    for (let k = 0; k + 1 < r.z.length; k++) {
      const ax = r.pts[2 * k]!,
        ay = r.pts[2 * k + 1]!,
        bx = r.pts[2 * k + 2]!,
        by = r.pts[2 * k + 3]!,
        l = hypot(bx - ax, by - ay)
      const n = Math.max(1, Math.ceil(l / 0.5))
      for (let q = 0; q <= n; q++) {
        const t = q / n,
          x = ax + (bx - ax) * t,
          y = ay + (by - ay) * t,
          z = r.z[k]! + (r.z[k + 1]! - r.z[k]!) * t
        if (z - terrainZ(x, y) <= 1 || levelCrossings.some((c) => hypot(c.x - x, c.y - y) <= 6))
          continue
        assert.ok(
          alongside(x, y, z, (bx - ax) / l, (by - ay) / l),
          `rail ${r.id} ${(z - terrainZ(x, y)).toFixed(1)} m over the ground at (${x.toFixed(1)}, ${y.toFixed(1)})`,
        )
      }
    }
})

// The line's tightest curves are 300 m (RFI, "nei tratti più difficili"). The CTR draws curves with
// a vertex every 12–21 m turning 2–5.5°, so chords shorter than 40 m see its own drawing (191 m at
// 20 m chords); over 40 m it is 252 m at the least.
test("rail: the running track curves no tighter than 250 m over 40 m chords", () => {
  const pts = line()
  const s = [0]
  for (let i = 2; i < pts.length; i += 2)
    s.push(s.at(-1)! + hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!))
  const at = (d: number) => {
    let i = 1
    while (i < s.length - 1 && s[i]! < d) i++
    const t = (d - s[i - 1]!) / (s[i]! - s[i - 1]! || 1)
    return [
      pts[2 * i - 2]! + (pts[2 * i]! - pts[2 * i - 2]!) * t,
      pts[2 * i - 1]! + (pts[2 * i + 1]! - pts[2 * i - 1]!) * t,
    ] as const
  }
  const L = 40
  for (let d = L; d <= s.at(-1)! - L; d += 2) {
    const [ax, ay] = at(d - L),
      [bx, by] = at(d),
      [cx, cy] = at(d + L)
    const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
    if (area2 < 1e-9) continue
    const r =
      (hypot(bx - ax, by - ay) * hypot(cx - bx, cy - by) * hypot(cx - ax, cy - ay)) / (2 * area2)
    assert.ok(r >= 250, `radius ${r.toFixed(0)} m at (${bx.toFixed(1)}, ${by.toFixed(1)})`)
  }
})

// Regression: parked spot 408 stood 2.2 m from OSM's Gragnola loop, its car in a train's way; on
// the CTR's tracks its box stood 2.02 m from the through track.
test("rail: a parked car's box keeps 2.8 m from at-grade running track, 1.94 m from a siding", () => {
  // The clearance rule (rail-clear.ts) by running track; the ATR 220's half-width plus 0.5 m by a siding.
  const clear = (r: Rail) => (r.kind === undefined ? 2.8 : 1.44 + 0.5)
  const HL = 3.7 / 2,
    HW = 1.7 / 2 // spawns.ts parks a 3.7 x 1.7 m car box
  for (const p of MAP.spawns.parked) {
    const c = Ops.cos(p.angle),
      s = Ops.sin(p.angle)
    const corners = [
      [HL, HW],
      [HL, -HW],
      [-HL, -HW],
      [-HL, HW],
    ].map(([u, v]) => ({ x: p.x + c * u! - s * v!, y: p.y + s * u! + c * v! }))
    const edges = corners.map((a, i) => [a, corners[(i + 1) % 4]!] as const)
    for (const r of atGrade) {
      for (let k = 0; k + 3 < r.pts.length; k += 2) {
        const a = { x: r.pts[k]!, y: r.pts[k + 1]! },
          b = { x: r.pts[k + 2]!, y: r.pts[k + 3]! }
        if (Math.min(a.x, b.x) > p.x + 6 || Math.max(a.x, b.x) < p.x - 6) continue
        if (Math.min(a.y, b.y) > p.y + 6 || Math.max(a.y, b.y) < p.y - 6) continue
        const toSeg = (
          q: { x: number; y: number },
          e: readonly [{ x: number; y: number }, { x: number; y: number }],
        ) => {
          const dx = e[1].x - e[0].x,
            dy = e[1].y - e[0].y,
            t = Math.max(
              0,
              Math.min(1, ((q.x - e[0].x) * dx + (q.y - e[0].y) * dy) / (dx * dx + dy * dy || 1)),
            )
          return hypot(q.x - e[0].x - dx * t, q.y - e[0].y - dy * t)
        }
        const cut = edges.some(
          ([e0, e1]) => crossingsOf([a.x, a.y, b.x, b.y], [e0.x, e0.y, e1.x, e1.y]).length > 0,
        )
        const d = cut
          ? 0
          : Math.min(
              ...edges.flatMap((e) => [toSeg(a, e), toSeg(b, e)]),
              ...corners.map((q) => toSeg(q, [a, b])),
            )
        assert.ok(
          d >= clear(r) - 1e-9,
          `parked car at (${p.x}, ${p.y}) ${d.toFixed(2)} m from rail ${r.id}`,
        )
      }
    }
  }
})

// Regression: the track at grade buried the south mouth of the underpass at s 6324.6 under its bank, 5.4 m over
// the floor; a car that drove in at the open north mouth met it and was thrown 80 m up.
test("rail: a drivable road tunnel under the track opens at both mouths, the terrain there within 1.5 m of its floor", () => {
  const cross = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
    for (let i = 0; i + 3 < a.length; i += 2)
      for (let j = 0; j + 3 < b.length; j += 2) {
        const [ax, ay, bx, by] = [a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!],
          [cx, cy, dx, dy] = [b[j]!, b[j + 1]!, b[j + 2]!, b[j + 3]!]
        const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
        if (d === 0) continue
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d,
          u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true
      }
    return false
  }
  const under = MAP.roads.filter(
    (r) =>
      r.tunnel === true &&
      isDrivable(r.cls) &&
      MAP.rail.some((rail) => rail.tunnel !== true && cross(r.pts, rail.pts)),
  )
  assert.ok(under.length >= 3, `${under.length} tunnels under the track`)
  for (const road of under)
    for (const k of [0, road.z.length - 1]) {
      const bank = heightAt(road.pts[2 * k]!, road.pts[2 * k + 1]!) - road.z[k]!
      // Gragnola's 52 m tunnel keeps the 1.2 m bank at its mouth that main's map has, and traffic drives it.
      assert.ok(bank < 1.5, `road ${road.id}: its mouth ${bank.toFixed(1)} m under the terrain`)
    }
})

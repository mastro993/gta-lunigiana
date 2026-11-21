// The paths and steps at grade that lead onto a path's or steps' bridge or into its tunnel, their
// approaches (src/tools/path-approaches.ts), on every built region (regions.ts: Lunigiana, Cesena,
// the L and the coast): each meets the deck at its level, so a walker comes onto the deck or into
// the bore from it (under-decks.ts walks onto the bridges), and so does every other path at grade
// meeting it; and a building an approach runs on keeps its floor on the ground beside it. Fitted at
// the terrain's level, Aulla Lunigiana station's steps stood 4.1–5.8 m over its underpass at their
// joints, the sidewalk and the footway off two footbridges standing on the SS62's deck 7.7 and 9.9 m
// under them, and paths off footbridges over streams 2.5–3.6 m under them, in the bank's carve.
import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import type { JoinedMap } from "../../../tools/map-file.ts"
import { pointInRing, segDist2 } from "../../collide.ts"
import { REGIONS } from "./regions.ts"

/** How far apart two levels of one node may ship, m: the profiles' 0.1 m rounding of one level. */
const ROUNDING = 0.05

/** A joint whose two ways ship apart: the OSM ids of the way at grade and the other, and a line saying where. */
interface Step {
  readonly path: number
  readonly other: number
  readonly line: string
}

type Road = JoinedMap["roads"][number]

/** The heightmap of `map` at (x, y), bilinear between its nodes, m. */
const groundAt = ({ heightmap: h }: JoinedMap, x: number, y: number): number => {
  const fx = (x - h.x0) / h.cell,
    fy = (y - h.y0) / h.cell,
    i = Math.floor(fx),
    j = Math.floor(fy),
    tx = fx - i,
    ty = fy - j,
    at = (a: number, b: number) => h.data[b * h.cols + a]! / 10
  const south = at(i, j) + (at(i + 1, j) - at(i, j)) * tx,
    north = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx
  return south + (north - south) * ty
}

const isPath = (r: Road) => r.cls === "path" || r.cls === "steps"
const lifted = (r: Road) => r.bridge === true || r.tunnel === true

/**
 * Every vertex a path or steps at grade of `map` shares with a path's or steps' deck (`decks`) or
 * with another path or steps at grade (`paths`), where the two stand more than ROUNDING apart.
 */
const steps = (
  map: JoinedMap,
): {
  readonly decks: { readonly joints: number; readonly steps: Array<Step> }
  readonly paths: { readonly joints: number; readonly steps: Array<Step> }
} => {
  const at = new Map<string, Array<{ readonly r: Road; readonly z: number }>>()
  for (const r of map.roads)
    if (isPath(r))
      for (let k = 0; k < r.z.length; k++) {
        const key = `${r.pts[2 * k]},${r.pts[2 * k + 1]}`
        at.set(key, [...(at.get(key) ?? []), { r, z: r.z[k]! }])
      }
  const out = {
    decks: { joints: 0, steps: [] as Array<Step> },
    paths: { joints: 0, steps: [] as Array<Step> },
  }
  for (const [key, ways] of at)
    ways.forEach((a, i) => {
      if (lifted(a.r)) return
      ways.forEach((b, j) => {
        // Each pair of ways at grade once; a deck with each way at grade.
        if (j === i || (!lifted(b.r) && j < i)) return
        const kind = lifted(b.r) ? out.decks : out.paths
        kind.joints++
        if (Math.abs(a.z - b.z) > ROUNDING)
          kind.steps.push({
            path: a.r.id,
            other: b.r.id,
            line: `${a.r.cls} ${a.r.id} at ${a.z} m meets ${b.r.id} at ${b.z} m at (${key})`,
          })
      })
    })
  return out
}

/**
 * Joints a region's build keeps apart, by the OSM ids of the way at grade and the deck: Cesena's
 * Sottopasso del Mare (23605012) ends under the rail at its clearance under it, 5.2 m under the
 * unclassified road 201119224 meeting it there, and the path 587877842 meets the road's level.
 * Each must still stand apart, so a fix drops it from here.
 */
const KNOWN: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  cesena: [[587877842, 23605012]],
}

for (const [region, read, skip] of REGIONS)
  test(
    `approaches: on ${region}, every path or steps at grade meets a path's or steps' bridge or tunnel, and every other path or steps at grade, at its level`,
    { skip },
    () => {
      const { decks, paths } = steps(read()),
        known = KNOWN[region] ?? []
      assert.ok(decks.joints > 0, "no joint with a deck to check")
      assert.ok(paths.joints > 0, "no joint between paths at grade to check")
      const isKnown = (s: Step) => known.some(([path, deck]) => s.path === path && s.other === deck)
      assert.deepEqual(
        decks.steps.filter((s) => !isKnown(s)).map((s) => s.line),
        [],
      )
      for (const [path, deck] of known)
        assert.ok(
          decks.steps.some((s) => s.path === path && s.other === deck),
          `${path} meets ${deck} at its level now: drop it from KNOWN`,
        )
      assert.deepEqual(
        paths.steps.map((s) => s.line),
        [],
      )
    },
  )

/**
 * How far an approach's claim moves the ground round it, m: its core (at least 3 m) and its blend
 * (8 m, grid-claims.ts) on from it, and a 4 m cell.
 */
const REACH = 15

/**
 * How far a building's floor may stand under the flat ground round the rest of it, m: a building on
 * a gentle slope stands up to 1.0 m under its corners beyond an approach's reach on the ground as it
 * stood before any approach (Cesena's apartments 153198967, by its footway tunnels), and the station
 * the approaches sank stood 4.8 m under them.
 */
const SUNK = 1.5

/** The steepest ground round a building's corners beyond REACH that counts as flat, as a grade. */
const FLAT = 0.05

/**
 * Every building of `map` a path or steps at grade within two ways of a path's or steps' bridge or
 * tunnel (an approach, or the way on from it) runs on, a vertex of it inside it or a segment of it
 * within 1 m of a corner, whose corners beyond REACH of those ways stand on flat ground (two or more,
 * within 0.5 m of each other, the ground round each within FLAT), but whose floor stands more than
 * SUNK under them, and under the ground past REACH of the ways out from its lowest corner: a house
 * on Aulla's hillside by the footway tunnel 699457438, its two far corners on one contour, stands
 * 3.1 m under them.
 */
const sunk = (map: JoinedMap): Array<string> => {
  let reached = new Set<string>()
  const key = (r: Road, k: number) => `${r.pts[2 * k]},${r.pts[2 * k + 1]}`
  for (const r of map.roads)
    if (isPath(r) && lifted(r)) for (let k = 0; k < r.z.length; k++) reached.add(key(r, k))
  const atGrade = map.roads.filter((r) => isPath(r) && !lifted(r)),
    near = new Set<Road>()
  for (let hop = 0; hop < 2; hop++) {
    const next = new Set(reached)
    for (const r of atGrade)
      if (!near.has(r) && r.z.some((_, k) => reached.has(key(r, k)))) {
        near.add(r)
        for (let k = 0; k < r.z.length; k++) next.add(key(r, k))
      }
    reached = next
  }
  const segs = [...near].flatMap((r) =>
    Array.from({ length: r.z.length - 1 }, (_, k) => Array.from(r.pts.slice(2 * k, 2 * k + 4))),
  )
  const out: Array<string> = []
  for (const b of map.buildings) {
    const o = b.outer
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (let i = 0; i < o.length; i += 2) {
      minX = Math.min(minX, o[i]!)
      maxX = Math.max(maxX, o[i]!)
      minY = Math.min(minY, o[i + 1]!)
      maxY = Math.max(maxY, o[i + 1]!)
    }
    const by = segs.filter(
      ([ax, ay, bx, by]) =>
        Math.max(ax!, bx!) >= minX - REACH &&
        Math.min(ax!, bx!) <= maxX + REACH &&
        Math.max(ay!, by!) >= minY - REACH &&
        Math.min(ay!, by!) <= maxY + REACH,
    )
    const within = (x: number, y: number, r: number) =>
      by.some(([ax, ay, bx, by]) => segDist2(x, y, ax!, ay!, bx!, by!).d2 <= r * r)
    const runs = by.some(([ax, ay, bx, by]) => pointInRing(ax!, ay!, o) || pointInRing(bx!, by!, o))
    const corners = Array.from({ length: o.length / 2 }, (_, i) => [o[2 * i]!, o[2 * i + 1]!])
    if (!runs && !corners.some(([x, y]) => within(x!, y!, 1))) continue
    const far = corners.filter(([x, y]) => !within(x!, y!, REACH)),
      ground = far.map(([x, y]) => groundAt(map, x!, y!))
    if (ground.length < 2 || Math.max(...ground) - Math.min(...ground) > 0.5) continue
    // Flat round them too: two corners on one contour of a hillside are no plaza.
    const slope = (x: number, y: number) =>
      Ops.hypot(
        groundAt(map, x + 4, y) - groundAt(map, x - 4, y),
        groundAt(map, x, y + 4) - groundAt(map, x, y - 4),
      ) / 8
    if (far.some(([x, y]) => slope(x!, y!) > FLAT)) continue
    if (b.z0 >= Math.min(...ground) - SUNK) continue
    // Nor where the ground falls on past the ways' reach out from its lowest corner: a house on a
    // hilltop's edge steps down its natural slope, which no approach carved. The Fortezza di
    // Sarzanello's footprint (−1475604735736255) reaches 1.6 m down the hill's south face from its
    // flat top, to a corner the footway 139720096 passes 2.3 m off; 20 m on out from it, past the
    // footway's reach, the hill stands at 275.1 m.
    const cx = corners.reduce((sum, [x]) => sum + x!, 0) / corners.length,
      cy = corners.reduce((sum, [, y]) => sum + y!, 0) / corners.length,
      [lx, ly] = corners.reduce((low, c) =>
        groundAt(map, c[0]!, c[1]!) < groundAt(map, low[0]!, low[1]!) ? c : low,
      ),
      d = Ops.hypot(lx! - cx, ly! - cy)
    let past: number | undefined
    for (let s = 0; s <= (d > 0 ? 4 * REACH : -1); s += 1) {
      const x = lx! + ((lx! - cx) / d) * s,
        y = ly! + ((ly! - cy) / d) * s
      if (!within(x, y, REACH)) {
        past = groundAt(map, x, y)
        break
      }
    }
    if (past !== undefined && past <= b.z0) continue
    out.push(`${b.kind} ${b.id} at ${b.z0} m on ground at ${Math.min(...ground).toFixed(1)} m`)
  }
  return out
}

// Regression: a building's floor was read off the grid the approaches carved: Cesena's station
// (185180766) sank 4.8 m into its plaza, 1.0 m of its 6 m showing, the footways down to the
// underpass 43076054 running on its wall.
for (const [region, read, skip] of REGIONS)
  test(
    `approaches: on ${region}, a building a path's approach runs on stands on the ground round it`,
    { skip },
    () => {
      assert.deepEqual(sunk(read()), [])
    },
  )

/** How far a path's or steps' bridge may dip between two higher points of it, m: past the rounding, a sag. */
const SAG = 1

// Regression: fitted sample by sample, the coast's 153 m cycle footbridge 522153380 fell from 7.7 m
// over a driveway to 1.8 m and climbed back to 6.1 m over a footway, at 25–30% (profiles.ts spans a
// bridge's deck between its humps).
for (const [region, read, skip] of REGIONS)
  test(
    `approaches: on ${region}, no path's or steps' bridge dips between two higher points of it`,
    { skip },
    () => {
      const sags: Array<string> = []
      for (const r of read().roads) {
        if (!isPath(r) || r.bridge !== true) continue
        const z = Array.from(r.z)
        for (let k = 1; k + 1 < z.length; k++) {
          const span = Math.min(Math.max(...z.slice(0, k)), Math.max(...z.slice(k + 1)))
          if (span - z[k]! > SAG) {
            sags.push(`${r.cls} ${r.id} at ${z[k]} m between points at ${span} m`)
            break
          }
        }
      }
      assert.deepEqual(sags, [])
    },
  )

// The check left out a house whose ground falls on past the ways' reach (the Fortezza di
// Sarzanello), and must still catch the plaza an approach carved: Cesena's station, sunk the 4.8 m
// it stood under its plaza before the floors were read off the uncarved ground.
test("approaches: the hillside rule still finds a station an approach sank 4.8 m into its plaza", () => {
  const map = REGIONS.find(([name]) => name === "cesena")![1]()
  const station = map.buildings.find((b) => b.id === 185180766)
  assert.ok(station !== undefined, "Cesena's station 185180766")
  const sunken = {
    ...map,
    buildings: map.buildings.map((b) => (b === station ? { ...b, z0: b.z0 - 4.8 } : b)),
  }
  assert.ok(
    sunk(sunken).some((line) => line.includes("185180766")),
    `the station ${station.z0 - 4.8} m: ${sunk(sunken).join("; ")}`,
  )
})

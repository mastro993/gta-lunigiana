// Every crossing of two ways on two levels on every built region (Lunigiana, Cesena and the test
// regions): a road, path or rail bridge over a road, a path, steps or the rail, and a road, a path or
// the rail over a tunnel. Within reach of the crossing the two stand more than the level rule's 2 m
// apart (`onOneLevel`, src/sim/one-level.ts), with a margin, so the rule tells what is on the deck
// from what runs under it: which car a person gets into (`vehicleInReach`), what a driver brakes for
// (`TrafficAI`), what a vehicle hits and who steps apart from whom (`Contacts`), what people and
// animals run from (`Perceive`, `Animals`), and what a train meets. The rule is code, so a new map
// can break it only through its data: a deck too low over what it crosses. Where both are the rail,
// nothing meets across them and they are left out. A way at grade is read where the game stands on
// it, never under the terrain's mesh (`roadZ` in ground-model.ts). The test regions' builds (the L, the coast) live
// in test-maps/ (`pnpm maps`): without one its check is skipped, but in CI, which builds them, a
// missing build fails.
import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { latticeGround } from "../../../tools/build-ground.ts"
import { APPROACH_GRADE } from "../../../tools/path-approaches.ts"
import { PATH_PASS } from "../../../tools/profiles.ts"
import { passesOver } from "../../../tools/road-levels.ts"
import { RELAX } from "../../../tools/terrain.ts"
import { ENTER_GAP } from "../../tuning.ts"
import { VEHICLE_MODELS, VEHICLES } from "../../vehicles.ts"
import { ONE_LEVEL } from "../kinds.ts"
import { boxOf, crossings } from "./overpass-checks.ts"
import { REGIONS } from "./regions.ts"

/**
 * How far from a crossing (m, in plan) two things on its two ways can meet: a person within
 * ENTER_GAP of the widest vehicle's side (the truck's 1.225 m half-width) gets into it (3.225 m),
 * and a driver judges a vehicle ahead by the ground its way comes to where that vehicle reaches
 * into its path, up to its half-diagonal from its middle (the truck's 3.99 m). Two bodies touching
 * are judged where they touch, each under its own axis or middle there: two trucks' half-widths
 * apart at most (2.45 m); what a person or an animal runs from, where it stands. A train's car is
 * judged by the rail head under its middle: the line climbs 2.83% at most, so within 0.28 m of the
 * rail head where the car reaches the path, half an ATR 220's 19.5 m end car along.
 */
const REACH = Math.max(
  ENTER_GAP + Math.max(...VEHICLE_MODELS.map((m) => VEHICLES[m].width)) / 2,
  ...VEHICLE_MODELS.map((m) => Ops.hypot(VEHICLES[m].length, VEHICLES[m].width) / 2),
)
/**
 * Past ONE_LEVEL, m: the spread of the surfaces over their profiles (a path's 0.06 m to a motorway's
 * 0.24, `ROAD_LIFT`), the profiles' 0.1 m rounding, and a wheel's ground under a truck rolled 25°
 * (its 1.7 m centre of mass × (1 − cos 25°), 0.16 m), 0.44 m in all.
 */
const MARGIN = 0.5
/** Profile samples along a way near a crossing, m apart. */
const STEP = 0.5

/** A road, or a rail piece as `rail`: who uses it, its levels and its line. */
interface Way {
  readonly id: number
  readonly cls: string
  readonly bridge?: boolean
  readonly tunnel?: boolean
  readonly layer?: number
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}
const rail = (w: Way) => w.cls === "rail"

/** The terrain's mesh at (x, y), m, as the game draws it; none, where a check reads profiles alone. */
type Terrain = (x: number, y: number) => number

/** Whether `w` lies on the ground: a road at grade, which the game never stands under the terrain's mesh. */
const onGround = (w: Way) => !rail(w) && w.bridge !== true && w.tunnel !== true

/**
 * Points of `w` every STEP m within REACH of (x, y): x, y and z, its profile's, but a way at grade's
 * never under the terrain's mesh (`terrain`), where the game stands on it: under the A15's deck at
 * Santo Stefano di Magra the steps 374756566's profile dipped 4.00 m under it and the ground the
 * game reads 2.35 m, a slab's grid node 2.3 m off their line held at 46.9 m.
 */
const near = (w: Way, x: number, y: number, terrain?: Terrain) => {
  const out: Array<readonly [number, number, number]> = []
  const ground = terrain !== undefined && onGround(w) ? terrain : undefined
  for (let k = 0; k + 1 < w.z.length; k++) {
    const ax = w.pts[2 * k]!,
      ay = w.pts[2 * k + 1]!,
      dx = w.pts[2 * k + 2]! - ax,
      dy = w.pts[2 * k + 3]! - ay,
      n = Math.max(1, Math.ceil(Ops.hypot(dx, dy) / STEP))
    for (let i = 0; i <= n; i++) {
      const px = ax + (dx * i) / n,
        py = ay + (dy * i) / n
      if (Ops.hypot(px - x, py - y) > REACH) continue
      const z = w.z[k]! + ((w.z[k + 1]! - w.z[k]!) * i) / n
      out.push([px, py, ground === undefined ? z : Math.max(z, ground(px, py))])
    }
  }
  return out
}

/**
 * The least height of `up` over `down` (`near`) between points of the two within REACH of each
 * other and of their crossing at (x, y): a deck's slope toward its end (a ramp) counts.
 */
const gapOver = (up: Way, down: Way, x: number, y: number, terrain?: Terrain) => {
  const below = near(down, x, y, terrain)
  let gap = Infinity
  for (const [ax, ay, az] of near(up, x, y, terrain))
    for (const [bx, by, bz] of below)
      if (Ops.hypot(ax - bx, ay - by) <= REACH) gap = Math.min(gap, az - bz)
  return gap
}

/**
 * The steepest a path's or steps' bridge or tunnel climbs or dips from a pinned end: the path pass's
 * grade limit as far as its fit relaxes it (PATH_PASS, RELAX).
 */
const PATH_GRADE = RELAX * PATH_PASS.grade

/** Whether `w` is a path or steps. */
const isPath = (w: { readonly cls: string }) => w.cls === "path" || w.cls === "steps"

/** Whether the path pass fits `w` over or under what it crosses: a path's or steps' bridge or tunnel. */
const fitted = (w: Way) => isPath(w) && (w.bridge === true || w.tunnel === true)

/** Each vertex's arc length along `w`, m. */
const arcOf = (w: Way) => {
  const s = [0]
  for (let k = 1; k < w.pts.length / 2; k++)
    s.push(
      s[k - 1]! +
        Ops.hypot(w.pts[2 * k]! - w.pts[2 * k - 2]!, w.pts[2 * k + 1]! - w.pts[2 * k - 1]!),
    )
  return s
}

/**
 * The bounds a fit can put on `w`'s level where it crosses (arc length `s`, built level `z`): `hi`
 * the highest and `lo` the lowest, each `off` m along it from the crossing toward the nearest level
 * pinned, where it climbs or dips at most its grade from that level. A path's or steps' bridge or
 * tunnel is pinned at its ends the path pass pins (`pinned`: at a road's level or the ground's,
 * where no path or steps at grade alone leads on, its approach) and climbs PATH_GRADE; a path or
 * steps at grade, which the pass fits from its clearance under a deck or over a bore
 * (path-approaches.ts), at each vertex it shares with another way (`fixed`: a road's junction, a
 * deck's or a bore's end, the rail, and another path's or steps' junction, which an approach may
 * have set), and climbs its class's APPROACH_GRADE. Any other way keeps its built level; one with
 * no level pinned is free.
 */
const fitBounds = (
  w: Way,
  s: number,
  z: number,
  pinned: (x: number, y: number) => boolean,
  fixed: (x: number, y: number) => boolean,
) => {
  const deck = fitted(w)
  if (!deck && !(isPath(w) && onGround(w))) return { hi: () => z, lo: () => z }
  const arc = arcOf(w),
    grade = deck ? PATH_GRADE : APPROACH_GRADE[w.cls as "path" | "steps"]
  const pins = (deck ? [0, arc.length - 1] : arc.map((_, k) => k))
    .filter((k) => (deck ? pinned : fixed)(w.pts[2 * k]!, w.pts[2 * k + 1]!))
    .map((k) => ({ s: arc[k]!, z: w.z[k]! }))
  const rise = (off: number, e: { s: number }) => Math.max(0, Math.abs(s - e.s) - off) * grade
  return {
    hi: (off: number) => Math.min(Infinity, ...pins.map((e) => e.z + rise(off, e))),
    lo: (off: number) => Math.max(-Infinity, ...pins.map((e) => e.z - rise(off, e))),
  }
}

/**
 * The most a fit could put `up` over `down` across the check's reach of their crossing: the least,
 * over a point of one at the crossing and a point of the other REACH − STEP along it toward its
 * pinned end (two points the check pairs: a sample lies within STEP of the second), of the highest
 * `up` and the lowest `down` the fit reaches there. A path's or steps' bridge or tunnel micro-mapped
 * too short from a pinned end to reach the clearance at the path pass's grade limit falls short
 * whatever the pass does, and the check leaves it out (Lunigiana's 1.4 m footway tunnel 717088463
 * under the footway 717088457, 0.7 m from its dead end); every crossing a fit could clear it still
 * fails.
 */
const fitReach = (
  up: Way,
  down: Way,
  c: { readonly k: number; readonly t: number; readonly m: number; readonly u: number },
  pinned: (x: number, y: number) => boolean,
  fixed: (x: number, y: number) => boolean,
) => {
  if (!fitted(up) && !fitted(down)) return Infinity
  const along = (w: Way, k: number, t: number) => {
    const arc = arcOf(w)
    return {
      s: arc[k]! + (arc[k + 1]! - arc[k]!) * t,
      z: w.z[k]! + (w.z[k + 1]! - w.z[k]!) * t,
    }
  }
  const a = along(up, c.k, c.t),
    b = along(down, c.m, c.u)
  const hi = fitBounds(up, a.s, a.z, pinned, fixed).hi,
    lo = fitBounds(down, b.s, b.z, pinned, fixed).lo,
    off = REACH - STEP
  return Math.min(hi(0) - lo(off), hi(off) - lo(0))
}

/** A crossing whose ways stand ONE_LEVEL + MARGIN apart or less within REACH of it: the OSM ids of the way above and below, where, and the gap. */
interface Shortfall {
  readonly up: number
  readonly down: number
  readonly line: string
}

/**
 * Every crossing on two levels among `roads` and the rail's `tracks` whose ways stand ONE_LEVEL +
 * MARGIN apart or less within REACH of it (`gapOver` on `terrain`), but those no fit of the path
 * pass could clear (`fitReach`).
 */
const shortfalls = (
  roads: ReadonlyArray<Way>,
  tracks: ReadonlyArray<Omit<Way, "cls">>,
  terrain?: Terrain,
): Array<Shortfall> => {
  const ways: Array<Way> = [...roads, ...tracks.map((r) => ({ ...r, cls: "rail" }))]
  const boxes = ways.map((w) => boxOf(w.pts))
  // The vertices of the paths and steps at grade, and of the other roads at grade.
  const atGrade = (paths: boolean) =>
    new Set(
      roads
        .filter((r) => r.bridge !== true && r.tunnel !== true && isPath(r) === paths)
        .flatMap((r) => r.pts.flatMap((v, i) => (i % 2 === 0 ? [`${v},${r.pts[i + 1]}`] : []))),
    )
  const approaches = atGrade(true),
    roadsAt = atGrade(false),
    seen = new Map<string, number>()
  for (const w of ways)
    for (const key of new Set(
      w.pts.flatMap((v, i) => (i % 2 === 0 ? [`${v},${w.pts[i + 1]}`] : [])),
    ))
      seen.set(key, (seen.get(key) ?? 0) + 1)
  const pinned = (x: number, y: number) => roadsAt.has(`${x},${y}`) || !approaches.has(`${x},${y}`)
  const fixed = (x: number, y: number) => (seen.get(`${x},${y}`) ?? 0) > 1
  const out: Array<Shortfall> = []
  ways.forEach((up, i) => {
    const [ax0, ay0, ax1, ay1] = boxes[i]!
    ways.forEach((down, j) => {
      if (i === j || (rail(up) && rail(down)) || !passesOver(up, down)) return
      const [bx0, by0, bx1, by1] = boxes[j]!
      if (ax0 > bx1 || bx0 > ax1 || ay0 > by1 || by0 > ay1) return
      for (const c of crossings(up.pts, down.pts)) {
        const gap = gapOver(up, down, c.x, c.y, terrain)
        if (gap <= ONE_LEVEL + MARGIN && fitReach(up, down, c, pinned, fixed) > ONE_LEVEL + MARGIN)
          out.push({
            up: up.id,
            down: down.id,
            line: `${up.cls} ${up.id} only ${gap.toFixed(2)} m over ${down.cls} ${down.id} at ${c.x.toFixed(0)},${c.y.toFixed(0)}`,
          })
      }
    })
  })
  return out
}

/**
 * Crossings a region's build keeps too low, by the OSM ids of the way above and the one below
 * (docs/map.md, "Known data limitations"): the coast test region's Via Bassagrande's bridge over
 * the Fossa Maestra, 1.93 m over the path along its bank, which the canal beside it keeps from
 * dipping under the deck (path-pass.ts). Each must still fall short, so a fix drops it from here:
 * Lunigiana's micro-mapped knot of approaches by Via Cospedo at Aulla, the footway 1311831119 0.4 m
 * over the footway tunnel 1311831121 it leads out of 0.7 m on, clears it by 4.0 m since a path or
 * steps at grade crossing a deck or a bore is fitted from its clearance there, before the
 * approaches (path-approaches.ts, issue #20). Cesena's car park ramp 68296970, which its square's
 * pass left at the square's level,
 * dips under it since a tunnel takes its bound from a road at grade of its own pass (issue #20).
 * Cesena's footbridges over Viale Europa, Via Riccione, the paths beside them and the Ippodromo's, and its
 * pedestrian underpass under Via Giuseppe Di Vittorio, and the coast's foot and cycle bridge over
 * the A12 at Luni and its footway under Via Palmiro Togliatti, ran straight between their ends at
 * the terrain's level until the paths' and steps' decks were fitted (PATH_PASS); Cesena's 5.5 m
 * path bridge 683510421 now stands 4.5 m over the path 22776463 under it, which ran 3.5 m under it
 * on the ground its ramps' claims held at the deck's level until the approach's crossing shipped its
 * fitted level (path-approaches.ts).
 */
const KNOWN: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  cesena: [],
  // The crossings no rule of the passes clears since Sarzana's part, all in it but the knot by
  // Aulla (issue #20; the user's choice, after three rounds of fixes, to list them as known limits:
  // docs/map.md, Known data limitations): the A15's piece 1514016673, mapped at grade between its
  // viaducts, holds the cell 2.3 m from its steps, which drop 5.4 m in the 2.9 m past the
  // carriageway's edge, more than the 4 m grid holds; three ends pinned at the ground by a road
  // fitted first, before the deck's or bore's clearance; the Canale Lunense's bank path under a
  // bridge level with the bank, which would dip into the canal; two micro-mapped knots of paths,
  // stubs and bores no fit can part, by Vezzano Ligure's station and, in Aulla's part, at (−16497,
  // 5329); and the footbridge 93746169 leaving Via Aurelia at its level over the path inside the
  // primary's carriageway.
  lunigiana: [
    [374756512, 374756566],
    [99473194, 300940651],
    [311538487, 99473496],
    [238380861, 378473973],
    [647881621, 159053025],
    [1419380935, 1419380923],
    [717088457, 717088463],
    [93746169, 1423036800],
  ],
  "the coast": [[463589363, 326011444]],
}

for (const [region, read, skip] of REGIONS)
  test(
    `levels: on ${region}, every way over another stands more than ${ONE_LEVEL + MARGIN} m over it within ${REACH.toFixed(2)} m of where they cross`,
    {
      skip,
    },
    () => {
      const map = read()
      assert.ok(
        map.roads.some((r) => r.bridge === true),
        "no bridge to check",
      )
      const hm = map.heightmap,
        found = shortfalls(map.roads, map.rail, latticeGround(hm, (n) => hm.data[n]!).terrainZ),
        known = KNOWN[region] ?? []
      const isKnown = (s: Shortfall) => known.some(([up, down]) => s.up === up && s.down === down)
      assert.deepEqual(
        found.filter((s) => !isKnown(s)).map((s) => s.line),
        [],
      )
      for (const [up, down] of known)
        assert.ok(
          found.some((s) => s.up === up && s.down === down),
          `${up} over ${down} keeps its levels apart now: drop it from KNOWN`,
        )
    },
  )

test("levels: a path's or steps' bridge or tunnel too short from a pinned end to reach the clearance at the path pass's grade is left out; a crossing a fit could clear still fails", () => {
  // A footway tunnel 30 m long, all at 100 m, its west end meeting `west` (a service road at grade,
  // which pins it, a footway at grade, its approach, which leaves it to the fit, or nothing, where
  // the pass pins it at the ground) and its east end a service road, under a footway at grade
  // crossing it `at` m from its west end, between two service roads 3 m either side of the tunnel
  // that pin it (`pin`), or free.
  const ways = (at: number, west?: string, cls = "path", pin = true): Array<Way> => [
    ...(west === undefined ? [] : [{ id: 1, cls: west, pts: [-10, 0, 0, 0], z: [100, 100] }]),
    { id: 2, cls, tunnel: true, layer: -1, pts: [0, 0, 30, 0], z: [100, 100] },
    { id: 3, cls: "service", pts: [30, 0, 40, 0], z: [100, 100] },
    { id: 4, cls: "path", pts: [at, -3, at, 3], z: [100, 100] },
    ...(pin
      ? [
          { id: 5, cls: "service", pts: [at - 10, -3, at, -3], z: [100, 100] },
          { id: 6, cls: "service", pts: [at, 3, at + 10, 3], z: [100, 100] },
        ]
      : []),
  ]
  const found = (w: Array<Way>) => shortfalls(w, []).map((s) => [s.up, s.down])
  // 2 m in from a pinned end, it dips 0.6 m at most at the crossing, and not at all REACH back
  // toward it; the footway over it, pinned 3 m off, rises 0.9 m at most.
  assert.deepEqual(found(ways(2, "service")), [])
  assert.deepEqual(found(ways(2)), [])
  // 15 m in, it could dip 3.45 m 11.5 m in and 4.5 m at the crossing: the fit's to make.
  assert.deepEqual(found(ways(15, "service")), [[4, 2]])
  // A west end a footway at grade leads on from is free, its approach taking the rest: from its east
  // end it could dip 8.4 m.
  assert.deepEqual(found(ways(2, "path")), [[4, 2]])
  // A service road's tunnel is the road passes' to fit, never left out.
  assert.deepEqual(found(ways(2, "service", "service")), [[4, 2]])
  // A footway at grade pinned nowhere near rises over the bore from its clearance there
  // (path-approaches.ts), so it is the fit's to clear.
  assert.deepEqual(found(ways(2, "service", "path", false)), [[4, 2]])
})

// Regression: the check read each way's profile, which the game stands on only where it is over
// the terrain's mesh: the steps 374756566 read 4.00 m under the A15's deck at Santo Stefano di
// Magra, where someone on them stood 2.35 m under it on the mesh a slab's node held.
test("levels: a way at grade is read where the game stands on it, never under the terrain's mesh", () => {
  // A road's deck at 104 m over a footway at grade whose profile runs at 99.5 m under it, through
  // ground at 100 m: 4.5 m on the profile, 4 m on the ground; lowered to 102.1 m, 2.6 and 2.1 m.
  const ways: Array<Way> = [
    { id: 1, cls: "residential", bridge: true, layer: 1, pts: [-20, 0, 20, 0], z: [104, 104] },
    { id: 2, cls: "path", pts: [0, -20, 0, 20], z: [99.5, 99.5] },
  ]
  const lowered = ways.map((w) => (w.id === 1 ? { ...w, z: [102.1, 102.1] } : w))
  assert.deepEqual(shortfalls(lowered, []), [], "2.6 m on the profile")
  assert.deepEqual(
    shortfalls(lowered, [], () => 100).map((s) => [s.up, s.down]),
    [[1, 2]],
    "2 m on the ground",
  )
  assert.deepEqual(
    shortfalls(ways, [], () => 100),
    [],
  )
})

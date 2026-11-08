// Every crossing of two ways on two levels on every built region (Lunigiana, Cesena and the L): a
// road, path or rail bridge over a road, a path, steps or the rail, and a road, a path or the rail
// over a tunnel. Within reach of the crossing the two stand more than the level rule's 2 m apart
// (`onOneLevel`, src/sim/one-level.ts), with a margin, so the rule tells what is on the deck from
// what runs under it: which car a person gets into (`vehicleInReach`), what a driver brakes for
// (`TrafficAI`), what a vehicle hits and who steps apart from whom (`Contacts`), what people and
// animals run from (`Perceive`, `Animals`), and what a train meets. The rule is code, so a new map
// can break it only through its data: a deck too low over what it crosses. Where both are the rail,
// nothing meets across them and they are left out. The L's build lives in test-maps/ (`pnpm maps`):
// without it its check is skipped, but in CI, which builds it, a missing build fails.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../../../tools/map-file.ts"
import { regionFromArgs } from "../../../tools/region.ts"
import { passesOver } from "../../../tools/road-levels.ts"
import { ENTER_GAP } from "../../tuning.ts"
import { VEHICLE_MODELS, VEHICLES } from "../../vehicles.ts"
import { ONE_LEVEL } from "../kinds.ts"
import { boxOf, crossings } from "./overpass-checks.ts"

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

/** Points of `w`'s profile every STEP m within REACH of (x, y): x, y and z. */
const near = (w: Way, x: number, y: number) => {
  const out: Array<readonly [number, number, number]> = []
  for (let k = 0; k + 1 < w.z.length; k++) {
    const ax = w.pts[2 * k]!,
      ay = w.pts[2 * k + 1]!,
      dx = w.pts[2 * k + 2]! - ax,
      dy = w.pts[2 * k + 3]! - ay,
      n = Math.max(1, Math.ceil(Ops.hypot(dx, dy) / STEP))
    for (let i = 0; i <= n; i++) {
      const px = ax + (dx * i) / n,
        py = ay + (dy * i) / n
      if (Ops.hypot(px - x, py - y) <= REACH)
        out.push([px, py, w.z[k]! + ((w.z[k + 1]! - w.z[k]!) * i) / n])
    }
  }
  return out
}

/**
 * Where `up` crosses over `down` (no vertex both have: that is a junction), the least height of
 * `up`'s profile over `down`'s between points of the two within REACH of each other and of the
 * crossing: a deck's slope toward its end (a ramp) counts.
 */
const gapsOver = (up: Way, down: Way) => {
  const out: Array<{ readonly x: number; readonly y: number; readonly gap: number }> = []
  for (const { x, y } of crossings(up.pts, down.pts)) {
    const below = near(down, x, y)
    let gap = Infinity
    for (const [ax, ay, az] of near(up, x, y))
      for (const [bx, by, bz] of below)
        if (Ops.hypot(ax - bx, ay - by) <= REACH) gap = Math.min(gap, az - bz)
    out.push({ x, y, gap })
  }
  return out
}

/** A crossing whose ways stand ONE_LEVEL + MARGIN apart or less within REACH of it: the OSM ids of the way above and below, where, and the gap. */
interface Shortfall {
  readonly up: number
  readonly down: number
  readonly line: string
}

/** Every crossing on two levels in `map` whose ways stand ONE_LEVEL + MARGIN apart or less within REACH of it. */
const shortfalls = (map: JoinedMap): Array<Shortfall> => {
  const ways: Array<Way> = [...map.roads, ...map.rail.map((r) => ({ ...r, cls: "rail" }))]
  const boxes = ways.map((w) => boxOf(w.pts))
  const out: Array<Shortfall> = []
  ways.forEach((up, i) => {
    const [ax0, ay0, ax1, ay1] = boxes[i]!
    ways.forEach((down, j) => {
      if (i === j || (rail(up) && rail(down)) || !passesOver(up, down)) return
      const [bx0, by0, bx1, by1] = boxes[j]!
      if (ax0 > bx1 || bx0 > ax1 || ay0 > by1 || by0 > ay1) return
      for (const { x, y, gap } of gapsOver(up, down))
        if (gap <= ONE_LEVEL + MARGIN)
          out.push({
            up: up.id,
            down: down.id,
            line: `${up.cls} ${up.id} only ${gap.toFixed(2)} m over ${down.cls} ${down.id} at ${x.toFixed(0)},${y.toFixed(0)}`,
          })
    })
  })
  return out
}

/**
 * Crossings a region's build keeps too low, by the OSM ids of the way above and the one below
 * (docs/map.md, "Known data limitations"): Cesena's footbridges over Viale Europa, Via Riccione,
 * the paths beside them and the Ippodromo's, and the path bridge over the Sottopasso Cervese, each
 * straight between its ends at the terrain's level as every path's bridge, its pedestrian underpass
 * under Via Giuseppe Di Vittorio, and the car park ramp its square's pass leaves at the square's
 * level. Each must still fall short, so a fix drops it from here.
 */
const KNOWN: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  cesena: [
    [57046028, 23775230],
    [57046028, 23775264],
    [57046028, 24064921],
    [57046028, 1504871870],
    [137735218, 23918932],
    [137735218, 24920865],
    [137735218, 136347032],
    [137735231, 23918932],
    [137735231, 136347032],
    [23775268, 807711296],
    [683510421, 22776463],
    [1148557052, 69488617],
    [1148557053, 69488617],
    [55016697, 68296970],
  ],
}

const L = regionFromArgs(["--region", "lunigiana-l"])
const URL_L = builtMapUrl(L)
const noL = existsSync(URL_L)
  ? false
  : `no ${L.key} build in test-maps: run node src/tools/build-map.ts --region ${L.key}`
// GitHub Actions sets CI=true.
if (noL !== false && process.env.CI === "true") throw new Error(noL)

const REGIONS: ReadonlyArray<readonly [string, () => JoinedMap, string | false]> = [
  ["lunigiana", () => wholeMap(), false],
  ["cesena", () => wholeMap("cesena"), false],
  ["lunigiana-l", () => readWholeMap(URL_L), noL],
]

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
      const found = shortfalls(map),
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

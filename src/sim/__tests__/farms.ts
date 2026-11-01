/**
 * The farm, meadow, village and rural-road spots the animal tests stand at, and their readers, shared by `animals.test.ts` and `animals.long-test.ts`.
 *
 * @module sim/__tests__/farms
 */
import assert from "node:assert/strict"

import { Ops, Random } from "@typeonce/ritmo-math"

import { clearOf } from "../body.ts"
import { distanceToEdge, edgeIndex } from "../edges.ts"
import { FAUNA, randomAnimal } from "../fauna.ts"
import { Cry, type Feeling, Game, Roam, type Species, update } from "../index.ts"
import { graph, MAP, wallsNear } from "../map/index.ts"
import { eachTile } from "../map/tiles.ts"
import { residentsNear } from "../population/density.ts"
import { farmsNear, openGround, pasture, RURAL, RURAL_REACH } from "../population/farms.ts"
import { roadOf } from "../route.ts"
import { animal } from "../spawning.ts"
import { start, type Timeline } from "../testing.ts"

/** Gragnola's centre, Fivizzano's busiest village street (the density calibration's spot). */
export const GRAGNOLA = { x: -1751, y: 3360, angle: 0 }

/** The SR445 between villages, with no house within 140 m (the density calibration's rural spot). */
export const RURAL_ROAD = { x: -279, y: 3736, angle: 0 }

/**
 * A farm out in the country within 1.5 km of Monzone station, found by geometry: a rural farm with a pen (a barn, shed or
 * farmyard) and no village or hamlet within 300 m, the one with the most rural farms around it (where herds and pigs are
 * likeliest; on 2026-10-30 also the whole map's).
 */
export const FARM = (() => {
  const places = MAP.pois.filter((p) => p.kind === "place=village" || p.kind === "place=hamlet")
  const all = farmsNear(-493.8, 436.9, 1500)
  const lonely = all.filter(
    (f) =>
      f.rural &&
      f.pen &&
      residentsNear(f.x, f.y, RURAL_REACH) < RURAL &&
      places.every((p) => (p.x - f.x) ** 2 + (p.y - f.y) ** 2 > 300 ** 2),
  )
  const around = (f: { readonly x: number; readonly y: number }) =>
    farmsNear(f.x, f.y, 250).filter((g) => g.rural).length
  const best = lonely.reduce((a, b) => (around(b) > around(a) ? b : a))
  return { x: best.x, y: best.y, angle: 0 }
})()

/** Whether a vertex of a stream or river lies within `r` m of (x, y): any there is in a tile over the box round it. */
const waterWithin = (x: number, y: number, r: number) => {
  let near = false
  eachTile(x - r, y - r, x + r, y + r, ({ vectors }) => {
    near ||= vectors.water.items.some((w) =>
      w.pts.some((v, k) => k % 2 === 0 && Ops.hypot(v - x, w.pts[k + 1]! - y) < r),
    )
  })
  return near
}

/** Every metre of the herd test's ground east of the meadow, m. */
const HERD = Array.from({ length: 13 }, (_, k) => 15 + k)

/**
 * A pasture by the farm at least 60 m from any traffic road, where a passing car scares nothing, with no stream within a cow's
 * home range (wading slows a walk past its time), and the ground the herd test puts its animals on, 15–27 m east of it, open and
 * 3 m clear of walk walls (a pig penned in a passage between two walls is blocked on every walk and never rests; one off open
 * ground finds nowhere to walk): found by geometry.
 */
export const MEADOW = (() => {
  const roads = edgeIndex(graph.trafficEdges)
  for (let r = 20; r < 400; r += 10)
    for (let a = 0; a < 32; a++) {
      const x = FARM.x + r * Ops.cos((a / 32) * 2 * Math.PI),
        y = FARM.y + r * Ops.sin((a / 32) * 2 * Math.PI)
      const road = roads.nearest(x, y)
      if (
        pasture(x, y) &&
        distanceToEdge(road, x, y) - roadOf(road).w / 2 > 60 &&
        !waterWithin(x, y, FAUNA.cow.home + 10) &&
        HERD.every(
          (dx) =>
            openGround(x + dx, y) &&
            clearOf(wallsNear("walk", x + dx - 3, y - 3, x + dx + 3, y + 3), x + dx, y, 3),
        )
      )
        return { x, y, angle: 0 }
    }
  throw new Error("no meadow by the farm")
})()

/** An animal of `species` at `at` plus (dx, dy), resting until step `until`. */
export const beast = (
  species: Species,
  at: { readonly x: number; readonly y: number },
  dx: number,
  dy: number,
  until = 0,
) => {
  const pose = { x: at.x + dx, y: at.y + dy, angle: 0 }
  return Game.Command.extend(animal(randomAnimal(species, Random.make(3)), pose), [
    Roam,
    { mood: "idle", until, hx: pose.x, hy: pose.y, tx: pose.x, ty: pose.y },
  ])
}

/** `start`, plus the cries heard each frame (`cries`). */
export const listening = (timeline: Timeline = [], staging?: Parameters<typeof start>[1]) => {
  const game = start(timeline, staging)
  const cries = new Array<{
    readonly who: number
    readonly feeling: Feeling
    readonly frame: number
  }>()
  let frame = 0
  const listen = Game.Schedule(
    Game.System("Test/Cries", { events: { cries: Game.System.readEvent(Cry) } }, ({ events }) => {
      for (const c of events.cries.all()) cries.push({ who: c.who, feeling: c.feeling, frame })
    }),
  )
  const run = (frames: number, each: (frame: number) => void = () => {}) => {
    for (let i = 0; i < frames; i++, frame++) {
      assert.ok(game.runtime.tick(update, listen).ok)
      each(i)
    }
  }
  return { ...game, run, cries }
}

export const count = (animals: ReadonlyArray<{ readonly species: Species }>) => {
  const by: Record<Species, number> = { cat: 0, dog: 0, cow: 0, pig: 0 }
  for (const a of animals) by[a.species]++
  return by
}

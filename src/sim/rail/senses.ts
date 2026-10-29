/**
 * What people on foot make of the railway (Perceive's train senses): each car of a moving train is a vehicle
 * to keep out of the way of, at its line's pace, and only on their level; a train's whistle makes those
 * within `WHISTLE_RANGE` look, and its alarm (`urgent`) sends whoever stands in its path off the track in
 * fright; and a walker whose way leads onto the track at a level crossing closing to them holds short of
 * it, watching, until it opens (CdS art. 147 c.3: not while the light shows or the arms move), at a foot
 * crossing while a train demands it: patiently as a driver does (`patientAt`), then walking on, and
 * turning back where a train stands in the way.
 *
 * @module rail/senses
 */
import { Ops, type Vec2 } from "@typeonce/ritmo-math"

import { alongLane, laneOf, lanePoint } from "../route.ts"
import type { RouteValue } from "../schema.ts"
import { type Car, DANGER } from "../systems/senses.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { type CrossingState, OPEN } from "./barriers.ts"
import { foulsAt, type SeenTrain, trainCars } from "./bodies.ts"
import { CROSSINGS } from "./crossings.ts"
import { LINES, linesNear, pointAt } from "./lines.ts"
import { MOVING, spanOf, TRAINS, trainLength } from "./models.ts"
import { busyBoxes, patientAt } from "./roads.ts"

/** A train's whistle draws a look from everyone within this, m (TUNED: a horn 20 dB over a car's, kept to the street around). */
export const WHISTLE_RANGE = 60
/** Its alarm is meant for whoever stands within this of its body's edge, across the track, on its way ahead (m). */
const PATH_WIDE = 1
/** And no farther ahead along the track than this, m: the farthest the driver looks out (from its top speed). */
const PATH_REACH = 700
/** A walker holds at a closing level crossing while its next HOLD_LOOK m would take it within HOLD_CLEAR m of a track's centreline (m). */
const HOLD_LOOK = 1
const HOLD_CLEAR = 3
/** It thinks of a crossing this near, m. */
const HOLD_NEAR = 30
/** How far along the track from where it crosses the road a walker's way counts as onto that crossing's track, m. */
const HOLD_SPAN = 20

/** A whistle as Perceive hears it: the train, where, and whether it is the alarm. */
export interface Heard {
  readonly train: number
  readonly x: number
  readonly y: number
  readonly urgent: boolean
}

/** What a whistle calls for in one person: a look toward it, or a flight in fright off the path of the train sounding it. */
export interface Whistled {
  readonly mood: "look" | "flee"
  readonly x: number
  readonly y: number
  readonly path?: Vec2.Vec2
}

/** The way `train` comes at someone at `at`, on the ground `ground` gives, standing in its path ahead of its leading end (a unit vector); undefined when they are out of it. */
const inPath = (train: SeenTrain, at: Vec2.Vec2, ground: () => number): Vec2.Vec2 | undefined => {
  const { motion, model } = train,
    { lo, hi } = spanOf(motion.s, motion.facing, trainLength(model))
  const way = Math.abs(motion.v) > MOVING ? (Math.sign(motion.v) as 1 | -1) : motion.facing
  const lead = way > 0 ? hi : lo
  const s = foulsAt(
    motion.line,
    { ...at, angle: 0, long: PERSON_RADIUS, wide: PERSON_RADIUS, ground },
    TRAINS[model].width / 2 + PATH_WIDE,
  )
  if (s === undefined) return undefined
  const ahead = (s - lead) * way
  if (ahead < -PERSON_RADIUS || ahead > PATH_REACH) return undefined
  const { angle } = pointAt(LINES[motion.line]!, s)
  return { x: Ops.cos(angle) * way, y: Ops.sin(angle) * way }
}

/**
 * The railway as the people around it sense it this step, from the `trains`, their `whistles` and the level crossings' `states`
 * at step `now`: the trains' moving cars (as vehicles, `z` their rail head), what the whistles call for in someone, and where
 * someone holding short of a crossing looks.
 */
export const railSense = (
  trains: ReadonlyArray<SeenTrain>,
  whistles: ReadonlyArray<Heard>,
  states: ReadonlyArray<CrossingState>,
  now: number,
) => {
  const cars: ReadonlyArray<Car & { readonly z: number }> = trainCars(trains).flatMap((car) =>
    car.speed > DANGER.slowest
      ? [
          {
            id: car.train,
            length: car.length,
            width: car.width,
            decel: TRAINS[car.model].emergency,
            x: car.x,
            y: car.y,
            angle: car.angle,
            vx: car.vx,
            vy: car.vy,
            speed: car.speed,
            usual: car.usual,
            z: car.z,
          },
        ]
      : [],
  )
  const byId = new Map(trains.map((train) => [train.id, train])),
    busy = busyBoxes(trains)
  // The boxes a walker holds at, while they wait patiently: a road box in every phase but open, a foot crossing while a train
  // demands it.
  const closing = CROSSINGS.flatMap((box, i) => {
    const state = states[i] ?? OPEN
    return patientAt(state, now, busy[i] === true) && (!box.walk || state.demanded === now)
      ? [box]
      : []
  })
  return {
    cars,
    /** What this step's whistles call for in someone at `at` on the ground `ground` gives (asked only when it matters). */
    whistled: (at: Vec2.Vec2, ground: () => number): ReadonlyArray<Whistled> =>
      whistles.flatMap((whistle): Array<Whistled> => {
        const heard = (whistle.x - at.x) ** 2 + (whistle.y - at.y) ** 2 <= WHISTLE_RANGE ** 2
        const train = whistle.urgent ? byId.get(whistle.train) : undefined,
          path = train === undefined ? undefined : inPath(train, at, ground)
        if (path !== undefined) return [{ mood: "flee", x: whistle.x, y: whistle.y, path }]
        return heard ? [{ mood: "look", x: whistle.x, y: whistle.y }] : []
      }),
    /** Where someone at `at` walking `route` looks while holding short of a crossing closing to them; undefined: they walk on. */
    holding: (at: Vec2.Vec2, route: RouteValue): Vec2.Vec2 | undefined => {
      if (closing.length === 0) return undefined
      const lane = laneOf(route.edge, route.forward),
        next = lanePoint(lane, alongLane(lane, at.x, at.y) + HOLD_LOOK, route.side)
      for (const box of closing) {
        if ((box.x - at.x) ** 2 + (box.y - at.y) ** 2 > HOLD_NEAR ** 2) continue
        const onTrack = (p: Vec2.Vec2) =>
          linesNear(p.x, p.y, HOLD_CLEAR).some((near) =>
            box.on.some((on) => on.line === near.line && Math.abs(near.s - on.s) < HOLD_SPAN),
          )
        if (onTrack(next) && !onTrack(at)) return { x: box.x, y: box.y }
      }
      return undefined
    },
  }
}

/**
 * The railway as the audio schedule hears it: each train's cars from its active cab back (`carsOf`
 * at its s, each with its s and whether it stands in a tunnel), its power packs' revs and load from
 * its power (`trainRevs`), its brakes and where its driver sits (`cabOf`); each road's level
 * crossing and whether its bell rings (`crossingAt`); and the hits with trains, rewritten as bodies
 * the director knows: a vehicle and a train meeting is the vehicle's own hit on a steel wall, the
 * train its `other` (so the player driving it hears the hit as their own), and a train's own hits
 * (two trains meeting, a buffer stop) are a heavy steel body's on steel. A person
 * or an animal a train strikes is heard with no vehicle body. Pure functions of the sim's data.
 *
 * @module audio/rail
 */
import type { Descriptor } from "@typeonce/ritmo"

import { crossingAt, OPEN } from "../sim/rail/barriers.ts"
import { cabOf } from "../sim/rail/boarding.ts"
import { carsOf } from "../sim/rail/consist.ts"
import { CROSSINGS } from "../sim/rail/crossings.ts"
import { LINES, pointAt } from "../sim/rail/lines.ts"
import { TRAINS, type TrainModel } from "../sim/rail/models.ts"
import type { Impact, LevelCrossings, TrainMotionValue } from "../sim/schema.ts"
import type { EngineSpec, VehicleModel } from "../sim/vehicles.ts"
import type { HeardCrossing, HeardTrain } from "./rail-types.ts"
import type { Body, Happening, Material } from "./types.ts"

type ImpactValue = Descriptor.Descriptor.Value<typeof Impact>

/** What a train struck sounds like to the vehicle that met it, and what it meets itself: steel (TUNED: the metal-clad wall's ring, until a train's own is judged by ear). */
const STEEL: Material = "sheet"
/** A train's body in its own crashes: the heaviest steel body there is, the truck's (TUNED, as `STEEL`). */
const TRAIN_BODY: VehicleModel = "truck"

/**
 * A train's power packs' revs and load from its eased `power` (−1…1): through a hydrodynamic transmission the engine is not
 * tied to the speed, so it idles with the power off and runs up to its rated revs (`redline`) at full power, its load the
 * power's share, whichever way the train goes.
 */
export const trainRevs = (
  engine: EngineSpec,
  power: number,
): { readonly rpm: number; readonly load: number } => {
  const load = Math.min(1, Math.abs(power)) || 0
  return { rpm: engine.idle + (engine.redline - engine.idle) * load, load }
}

/** Train `id` of `model` as it is heard, moving as `motion` says, the player's when `mine`; none off every line. */
export const heardTrain = (
  id: number,
  model: TrainModel,
  motion: TrainMotionValue,
  mine: boolean,
): HeardTrain | undefined => {
  const line = LINES[motion.line]
  if (line === undefined) return undefined
  let back = 0
  const cars = carsOf(line, motion.s, motion.facing, model).map((car) => {
    const s = motion.s - motion.facing * (back + car.length / 2)
    back += car.length
    return {
      x: car.x,
      y: car.y,
      z: car.z,
      angle: car.angle,
      length: car.length,
      s,
      tunnel: pointAt(line, s).tunnel,
    }
  })
  return {
    id,
    model,
    line: motion.line,
    s: motion.s,
    v: motion.v,
    facing: motion.facing,
    cars,
    ...trainRevs(TRAINS[model].engine, motion.power),
    brake: motion.brake,
    cab: cabOf(line, motion, model).z,
    mine,
  }
}

/** How far each level crossing's nearest arm's post is from its centre, m (`CROSSINGS` order; Infinity for a foot crossing). */
const POSTS = CROSSINGS.map((box) =>
  Math.min(...box.approaches.map(({ pivot }) => Math.hypot(pivot.x - box.x, pivot.y - box.y))),
)

/** Every road's level crossing from the `LevelCrossings` states at step `now`: whether its bell rings (foot crossings have none). */
export const heardCrossings = (
  states: ReadonlyArray<Descriptor.Descriptor.Value<typeof LevelCrossings>[number]>,
  now: number,
): ReadonlyArray<HeardCrossing> =>
  CROSSINGS.flatMap((box, id) =>
    box.walk
      ? []
      : [
          {
            id,
            x: box.x,
            y: box.y,
            posts: POSTS[id]!,
            ringing: crossingAt(box, states[id] ?? OPEN, now).ringing,
          },
        ],
  )

/** The zone of `train` a hit at (x, y) lands on: the front by its active cab's nose, else the rear. */
const trainZone = (train: HeardTrain, x: number, y: number): Body["zone"] => {
  const end = (car: HeardTrain["cars"][number] | undefined, sign: number) =>
    car === undefined
      ? Infinity
      : Math.hypot(
          car.x + (sign * Math.cos(car.angle) * car.length) / 2 - x,
          car.y + (sign * Math.sin(car.angle) * car.length) / 2 - y,
        )
  return end(train.cars[0], 1) <= end(train.cars.at(-1), -1) ? "front" : "rear"
}

/**
 * The happenings an `Impact` with a train in it makes, or undefined when none is in it: a vehicle and a train meeting (`train`,
 * the vehicle `car`) is the vehicle's hit on a steel wall, the train its `other`; two trains meeting, a hit for each; a train against its buffer stop
 * (`wall`, the train `car`) a steel body's on steel; a person or an animal it strikes, a hit with no body. `bodyAt` finds a
 * vehicle's body (undefined for none), `trains` the trains heard this frame.
 */
export const railImpact = (
  hit: ImpactValue,
  bodyAt: (id: number, x: number, y: number) => Body | undefined,
  trains: ReadonlyMap<number, HeardTrain>,
): ReadonlyArray<Happening> | undefined => {
  const train = trains.get(hit.car)
  const steel = (id: number): ReadonlyArray<Happening> => {
    const it = trains.get(id)
    return it === undefined
      ? []
      : [
          {
            kind: "impact",
            hit: "wall",
            x: hit.x,
            y: hit.y,
            speed: hit.speed,
            mass: hit.mass,
            car: id,
            material: STEEL,
            body: { model: TRAIN_BODY, zone: trainZone(it, hit.x, hit.y) },
          },
        ]
  }
  if (hit.hit === "train") {
    if (train !== undefined) return [...steel(hit.car), ...steel(hit.other ?? -1)]
    const body = bodyAt(hit.car, hit.x, hit.y)
    if (body === undefined) return []
    const { x, y, speed, mass, car, other } = hit
    return [{ kind: "impact", hit: "wall", x, y, speed, mass, car, other, material: STEEL, body }]
  }
  if (train === undefined) return undefined
  if (hit.hit === "person" || hit.hit === "animal") {
    const { x, y, speed, mass, car, other, fatal } = hit
    return [{ kind: "impact", hit: hit.hit, x, y, speed, mass, car, other, fatal }]
  }
  return steel(hit.car)
}

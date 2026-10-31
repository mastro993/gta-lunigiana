/**
 * Which of the map's parked spots hold a car, and which car: a hash of the spot's place and the
 * game's seed (`Parking`) decides both, so within one game a street looks the same each time the
 * player comes back to it, `?seed=N` parks another set, and a spot keeps its car when a build adds or
 * drops others (its index, which they move, plays no part). Only the spots round the player hold
 * their cars: `SpawnWorld` parks those round the start, `PopulateParked` those the player nears.
 *
 * @module population/parked
 */
import { Random, Vec2 } from "@typeonce/ritmo-math"

import { wrapAngle } from "../body.ts"
import { resting } from "../chassis.ts"
import { staticGrid } from "../collide.ts"
import { mix } from "../hash.ts"
import { MAP, type ParkedSpot, roadClassOf } from "../map/index.ts"
import { roadOf, trafficIndex } from "../route.ts"
import { type DamageValue, Game, Parked, type PoseValue } from "../schema.ts"
import { parkedCar, randomColor } from "../spawning.ts"
import type { VehicleModel } from "../vehicles.ts"
import { VIEW_REACH } from "../view.ts"

/**
 * At most this many vehicles that are not traffic stand at once, the Carabinieri's, the stolen and the wrecked included: what a
 * game parked over the whole map before parking followed the player. `TRAFFIC.max` more drive.
 */
export const PARKED = 200
/**
 * Parked cars round the player: spots `fill` m away fill out of view (at setup, every spot within `fill[1]` m of the start), and
 * a car still as it was parked goes beyond `despawn` m, so its spot fills again when the player comes back.
 */
export const PARKING = { fill: [VIEW_REACH, 300], despawn: 400 } as const
/**
 * Share of a map's civilian spots (where a Panda stands level, the Carabinieri's two left out) that hold a car: what `PARKED` cars
 * made of them when every car was parked at setup, 198 of the 733 Lunigiana had then and 198 of Cesena's 1223, by the map's file
 * name (any other map takes Lunigiana's). Kept as the maps grow.
 */
const LUNIGIANA = 198 / 733
const SHARE: Readonly<Record<string, number>> = { monzone: LUNIGIANA, cesena: 198 / 1223 }
const share = SHARE[MAP.name] ?? LUNIGIANA
/**
 * A spot's car is a marble truck when its roll is under this, on a tertiary road's spot where a truck fits; an Ape when it is at
 * least `APE`, where an Ape stands level; else a Panda.
 */
const TRUCK = 0.1
const APE = 0.8
/** A parked car still stands as it was parked within this of its spot: m, and rad of heading. */
const ON_SPOT = { off: 0.5, turned: 0.1 } as const
const CARABINIERI_BLUE = 0x1d2b4f

const SPOTS = MAP.spawns.parked
/** Whether `model` stands level enough on `spot` to park there (the build baked its rest: src/sim/parking.ts). */
const level = (model: VehicleModel, spot: ParkedSpot): boolean => spot.rest[model] !== undefined
const onTertiary = (s: Vec2.Vec2) =>
  roadClassOf(roadOf(trafficIndex.nearest(s.x, s.y))) === "tertiary"

const police = MAP.spawns.police
/** The two spots nearest the Carabinieri station the build chose where a Carabinieri car stands level: theirs, never a civilian's. */
export const CARABINIERI: ReadonlyArray<number> =
  police === undefined
    ? []
    : SPOTS.flatMap((s, i) => (level("panda", s) && level("carabinieri", s) ? [i] : []))
        .sort(
          (a, b) =>
            Vec2.distanceSquared(SPOTS[a]!, police) - Vec2.distanceSquared(SPOTS[b]!, police),
        )
        .slice(0, 2)

/** A car to park: its model and paint. */
interface ParkedLook {
  readonly model: VehicleModel
  readonly color: number
}

/** A spot's place as one number: its x and y in whole decimetres (the build rounds spots to 0.1 m), hashed. */
const placeOf = (spot: ParkedSpot): number =>
  mix(Math.round(spot.x * 10) ^ mix(Math.round(spot.y * 10)))

/**
 * The car the game of `seed` parks on spot `index`, or undefined when the spot stays empty (or is the Carabinieri's, or too steep
 * for a Panda): a random stream seeded by the hash of the seed and the spot's place decides whether it holds one, then the model,
 * then the paint.
 */
export const carOn = (seed: number, index: number): ParkedLook | undefined => {
  const spot = SPOTS[index]
  if (spot === undefined || !level("panda", spot) || CARABINIERI.includes(index)) return undefined
  const random = Random.make(mix(seed ^ placeOf(spot)))
  if (random.next() >= share) return undefined
  const roll = random.next()
  const model =
    roll < TRUCK && spot.truck === true && onTertiary(spot)
      ? "truck"
      : roll >= APE && level("ape", spot)
        ? "ape"
        : "panda"
  return { model, color: randomColor(random) }
}

const grid = staticGrid(
  SPOTS.length,
  (i) => [SPOTS[i]!.x, SPOTS[i]!.y, SPOTS[i]!.x, SPOTS[i]!.y],
  100,
)
/** The indices of the spots within `r` m of `at`, in a fixed order: by the grid's cells, south to north and west to east, then by index. */
export const spotsWithin = (at: Vec2.Vec2, r: number): Array<number> => {
  const found: Array<number> = []
  grid(at.x - r, at.y - r, at.x + r, at.y + r, (i) => {
    if (Vec2.distanceSquared(SPOTS[i]!, at) <= r * r) found.push(i)
  })
  return found
}

/** `model` in `color` at rest on `spot`, as the build settled it: its Pose the spot's alone, not the bakes beside it. */
const atRest = (model: VehicleModel, color: number, spot: ParkedSpot) => {
  const [z, pitch, roll] = spot.rest[model]!
  return parkedCar(
    model,
    color,
    { x: spot.x, y: spot.y, angle: spot.angle },
    resting(z, pitch, roll),
  )
}
/** A Carabinieri car at rest on spot `index`: no `Parked`, so it stays wherever the player goes. */
export const carabinieriOn = (index: number) =>
  atRest("carabinieri", CARABINIERI_BLUE, SPOTS[index]!)
/** `car` at rest on spot `index`, the spot's (`Parked`). */
export const parkedOn = (index: number, car: ParkedLook) =>
  Game.Command.extend(atRest(car.model, car.color, SPOTS[index]!), [Parked, { spot: index }])

/** Whether a car parked on spot `index` is still as it was parked: undamaged, and at `pose` on its spot. */
export const pristine = (index: number, pose: PoseValue, damage: DamageValue): boolean => {
  const spot = SPOTS[index]
  return (
    spot !== undefined &&
    damage.amount === 0 &&
    Vec2.distanceSquared(pose, spot) <= ON_SPOT.off ** 2 &&
    Math.abs(wrapAngle(pose.angle - spot.angle)) <= ON_SPOT.turned
  )
}

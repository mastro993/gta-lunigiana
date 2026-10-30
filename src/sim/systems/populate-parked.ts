import { Clock } from "@typeonce/ritmo"
import { Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius, offBody } from "../body.ts"
import { MAP } from "../map/index.ts"
import { carOn, PARKED, PARKING, parkedOn, pristine, spotsWithin } from "../population/parked.ts"
import {
  CarInput,
  Damage,
  Game,
  Motion,
  Parked,
  Parking,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  STEP,
  Time,
  Traffic,
  Vehicle,
} from "../schema.ts"
import type { VehicleModel } from "../vehicles.ts"

const PERIOD = Clock.duration(STEP, 0.5)
/** A car is not brought out within this of a person or an animal, m: the largest, a cow, is 0.86 m round. */
const ROOM = 1

/** A vehicle standing about: its model and pose. */
interface Standing {
  readonly model: VehicleModel
  readonly pose: PoseValue
}
/** Whether `model` parked at `pose` would touch none of `vehicles` (their bodies) and come within `ROOM` of none of `bodies`. */
const roomOn = (
  model: VehicleModel,
  pose: PoseValue,
  vehicles: ReadonlyArray<Standing>,
  bodies: ReadonlyArray<Vec2.Vec2>,
): boolean => {
  const r = carRadius(model),
    circles = carCircles(model, pose.angle).map((o) => ({ x: pose.x + o.x, y: pose.y + o.y }))
  return (
    vehicles.every((v) => circles.every((c) => offBody(v.model, v.pose, c.x, c.y) >= r)) &&
    bodies.every((b) => offBody(model, pose, b.x, b.y) >= ROOM)
  )
}

/**
 * Every half second, keeps the parked cars round the player: each spot `PARKING.fill` m away (out of view) that the hash gives a
 * car and no car holds gets it, unless a vehicle, a person or an animal stands there; a car still as it was parked goes beyond
 * `PARKING.despawn` m. A stolen, moved or damaged car stays where it is, as the Carabinieri's do; no more spawn while `PARKED`
 * vehicles that are not traffic stand.
 */
export const PopulateParked = Game.System(
  "Lunigiana/PopulateParked",
  {
    queries: {
      player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }),
      parked: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          parked: Game.Query.read(Parked),
          damage: Game.Query.read(Damage),
        },
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          vehicle: Game.Query.read(Vehicle),
          traffic: Game.Query.optional(Traffic),
        },
      }),
      bodies: Game.Query({ selection: { pose: Game.Query.read(Pose) }, without: [Vehicle] }),
    },
    resources: {
      parking: Game.System.readResource(Parking),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    commands: Game.System.commands(
      Game.System.spawns(Vehicle, Pose, PrevPose, Motion, CarInput, Parked),
      Game.System.despawns(Parked),
    ),
  },
  ({ queries, resources, commands }) => {
    if (!Clock.every(resources.time.get(), PERIOD)) return
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const at = found.value.data.pose.get()
    const far = (p: Vec2.Vec2, range: number) => Vec2.distanceSquared(p, at) > range * range

    const held = new Set<number>()
    let gone = 0
    for (const { entity, data } of queries.parked.each()) {
      const { spot } = data.parked.get(),
        pose = data.pose.get()
      if (pristine(spot, pose, data.damage.get()) && far(pose, PARKING.despawn)) {
        commands.despawn(entity)
        gone++
      } else held.add(spot)
    }
    const vehicles: Array<Standing> = [],
      bodies = queries.bodies.each().map(({ data }) => data.pose.get())
    let standing = -gone
    for (const { data } of queries.vehicles.each()) {
      vehicles.push({ model: data.vehicle.get().model, pose: data.pose.get() })
      if (!data.traffic.present) standing++
    }
    const { seed } = resources.parking.get()
    for (const index of spotsWithin(at, PARKING.fill[1])) {
      if (standing >= PARKED) break
      const spot = MAP.spawns.parked[index]!
      if (held.has(index) || !far(spot, PARKING.fill[0])) continue
      const car = carOn(seed, index)
      const pose = { x: spot.x, y: spot.y, angle: spot.angle }
      if (car === undefined || !roomOn(car.model, pose, vehicles, bodies)) continue
      commands.spawn(parkedOn(index, car))
      vehicles.push({ model: car.model, pose })
      standing++
    }
  },
)

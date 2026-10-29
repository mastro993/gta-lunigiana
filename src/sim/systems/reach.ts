/**
 * What the sim steps: what lies within the player's reach. The host keeps in memory only the map
 * tiles over [player ± `STEP_REACH`]² (map/tiles.ts), so nothing the sim steps may read the map
 * farther out. A vehicle more than `FROZEN_BEYOND` m from the player along either axis stands frozen
 * (`inReach`): no physics, contacts, blasts or AI driving, its state kept exactly, until the player
 * comes back within reach. People and animals never get that far in play (`Populate` takes them
 * within 320 m, every half second); when the player jumps away from them (coming back at the start,
 * a dev `SetPlayer`), those left beyond reach go at once (`LeaveBehind`).
 *
 * @module systems/reach
 */
import type { Vec2 } from "@typeonce/ritmo-math"

import { settle } from "../chassis.ts"
import { atGrade } from "../map/ground.ts"
import { MAP } from "../map/index.ts"
import { FROZEN_BEYOND } from "../map/tiles.ts"
import {
  Animal,
  CarInput,
  Chassis,
  Driving,
  Footing,
  Game,
  Motion,
  Pedestrian,
  Player,
  Pose,
  PrevPose,
  SetPlayer,
  Vehicle,
} from "../schema.ts"

/** Whether `at` lies within `FROZEN_BEYOND` m of the player at `player` along both axes (everywhere, with no player): only there does a vehicle step. */
export const inReach = (at: Vec2.Vec2, player: Vec2.Vec2 | undefined): boolean =>
  player === undefined ||
  (Math.abs(at.x - player.x) <= FROZEN_BEYOND && Math.abs(at.y - player.y) <= FROZEN_BEYOND)

/** The player's Pose, read by every system that freezes what lies beyond its reach. */
export const playerPose = () =>
  Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] })

/**
 * At the end of each step, once the player has moved: the people (the dead too) and animals beyond the player's reach go, so the
 * next step reads no map where the host keeps it no longer. Only a jump of the player leaves anyone there.
 */
export const LeaveBehind = Game.System(
  "Lunigiana/LeaveBehind",
  {
    queries: {
      player: playerPose(),
      bodies: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Pedestrian] }),
      animals: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Animal] }),
    },
    commands: Game.System.commands(Game.System.despawns(Pedestrian, Animal)),
  },
  ({ queries, commands }) => {
    const player = queries.player.each()[0]?.data.pose.get()
    if (player === undefined) return
    for (const { entity, data } of queries.bodies.each())
      if (!inReach(data.pose.get(), player)) commands.despawn(entity)
    for (const { entity, data } of queries.animals.each())
      if (!inReach(data.pose.get(), player)) commands.despawn(entity)
  },
)

/** A `SetPlayer` request's pose, or undefined when a number in it is not finite or it lies off the map. */
const target = (request: { readonly x: number; readonly y: number; readonly angle: number }) => {
  const { x, y, angle } = request,
    { minX, minY, maxX, maxY } = MAP.bounds
  return Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(angle) &&
    x >= minX &&
    x <= maxX &&
    y >= minY &&
    y <= maxY
    ? { x, y, angle }
    : undefined
}

const STILL = { vx: 0, vy: 0, spin: 0 }

/**
 * Each `SetPlayer` request puts the player at its pose, standing still: on foot on the ground there at the terrain's level
 * (`Footing`), or in the vehicle they drive, settled on its springs there (`settle`); in a train, which keeps to its line, or off
 * the map, it is dropped. The pose and the previous pose both jump, so nothing is drawn sliding from the old place.
 */
export const ApplyPlayer = Game.System(
  "Lunigiana/ApplyPlayer",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          prev: Game.Query.write(PrevPose),
          motion: Game.Query.write(Motion),
          driving: Game.Query.optional(Driving),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          prev: Game.Query.write(PrevPose),
          motion: Game.Query.write(Motion),
          chassis: Game.Query.write(Chassis),
          vehicle: Game.Query.read(Vehicle),
        },
        with: [CarInput],
      }),
    },
    events: { requests: Game.System.readEvent(SetPlayer) },
    commands: Game.System.commands(Game.System.inserts(Footing)),
  },
  ({ queries, events, commands }) => {
    for (const request of events.requests.all()) {
      const at = target(request)
      if (at === undefined) continue
      for (const { entity, data } of queries.player.each()) {
        const driving = data.driving.value()
        if (driving === undefined) commands.insert(entity, [Footing, { z: atGrade(at.x, at.y) }])
        else {
          const car = queries.vehicles.getHandle(driving.vehicle)
          if (!car.ok) continue
          const { model } = car.value.data.vehicle.get()
          car.value.data.pose.set(at)
          car.value.data.prev.set(at)
          car.value.data.motion.set(STILL)
          car.value.data.chassis.set(settle(model, at))
        }
        data.pose.set(at)
        data.prev.set(at)
        data.motion.set(STILL)
      }
    }
  },
)

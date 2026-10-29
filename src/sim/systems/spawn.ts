import { Random, Vec2 } from "@typeonce/ritmo-math"

import { resting } from "../chassis.ts"
import { MAP, type ParkedSpot, roadClassOf } from "../map/index.ts"
import { roadOf, trafficIndex } from "../route.ts"
import { CarInput, Game, Motion, Person, Player, Pose, PrevPose, Rng, Vehicle } from "../schema.ts"
import { parkedCar, randomColor } from "../spawning.ts"
import type { VehicleModel } from "../vehicles.ts"

/**
 * Parked cars at setup, Carabinieri included: this many of the map's parked spots, picked at random so they
 * spread over the villages as the spots do (every vehicle costs a little in Contacts and TrafficAI each step).
 */
export const PARKED = 200
const TRUCKS = 2
const CARABINIERI_BLUE = 0x1d2b4f

/** Whether `model` stands level enough on `spot` to park there (the build baked its rest: src/sim/parking.ts). */
const level = (model: VehicleModel, spot: ParkedSpot): boolean => spot.rest[model] !== undefined
/** `model` at rest on `spot`, as the build settled it: its Pose the spot's alone, not the bakes beside it. */
const parked = (model: VehicleModel, color: number, spot: ParkedSpot) => {
  const [z, pitch, roll] = spot.rest[model]!
  return parkedCar(
    model,
    color,
    { x: spot.x, y: spot.y, angle: spot.angle },
    resting(z, pitch, roll),
  )
}
const spots = MAP.spawns.parked.filter((s) => level("panda", s))
const police = MAP.pois.find((p) => p.kind === "amenity=police")
const byPolice =
  police === undefined
    ? []
    : spots
        .filter((s) => level("carabinieri", s))
        .sort((a, b) => Vec2.distanceSquared(a, police) - Vec2.distanceSquared(b, police))
        .slice(0, 2)
const civilian = spots.filter((s) => !byPolice.includes(s))
const parkedCount = Math.min(PARKED, spots.length)
const onTertiary = (s: Vec2.Vec2) =>
  roadClassOf(roadOf(trafficIndex.nearest(s.x, s.y))) === "tertiary"

/** Setup: the player at the map spawn, the Carabinieri at their station, and parked cars picked with the world's Rng. */
export const SpawnWorld = Game.System(
  "Lunigiana/SpawnWorld",
  {
    resources: { rng: Game.System.writeResource(Rng) },
    commands: Game.System.commands(
      Game.System.spawns(Player, Person, Pose, PrevPose, Motion, Vehicle, CarInput),
    ),
  },
  ({ resources, commands }) => {
    const random = Random.draw(resources.rng)
    const start = MAP.spawns.player
    commands.spawn(
      Game.Command.spawn(
        [Player, {}],
        [Pose, start],
        [PrevPose, start],
        [Motion, { vx: 0, vy: 0, spin: 0 }],
        [
          Person,
          {
            skin: 0xe7b896,
            hair: 0x2b1d14,
            shirt: 0xf0c93c,
            pants: 0x1d2b4f,
            age: "adult",
            female: false,
            outfit: "trousers",
            hairdo: "short",
            height: 1.78,
          },
        ],
      ),
    )
    for (const spot of byPolice) commands.spawn(parked("carabinieri", CARABINIERI_BLUE, spot))
    let trucks = 0
    for (const spot of random.shuffle(civilian).slice(0, parkedCount - byPolice.length)) {
      const roll = random.next()
      const truck = trucks < TRUCKS && roll < 0.1 && onTertiary(spot) && spot.truck === true
      if (truck) trucks++
      const model = truck ? "truck" : roll >= 0.8 && level("ape", spot) ? "ape" : "panda"
      commands.spawn(parked(model, randomColor(random), spot))
    }
  },
)

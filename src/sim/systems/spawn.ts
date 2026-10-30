import { MAP } from "../map/index.ts"
import {
  CARABINIERI,
  carabinieriOn,
  carOn,
  PARKING,
  parkedOn,
  spotsWithin,
} from "../population/parked.ts"
import {
  CarInput,
  Game,
  Motion,
  Parked,
  Parking,
  Person,
  Player,
  Pose,
  PrevPose,
  Vehicle,
} from "../schema.ts"

/**
 * Setup: the player at the map spawn, the Carabinieri at their station, and the cars the spots' hash parks within
 * `PARKING.fill[1]` m of the start (`PopulateParked` keeps them round the player from then on); the title card hides them coming.
 */
export const SpawnWorld = Game.System(
  "Lunigiana/SpawnWorld",
  {
    resources: { parking: Game.System.readResource(Parking) },
    commands: Game.System.commands(
      Game.System.spawns(Player, Person, Pose, PrevPose, Motion, Vehicle, CarInput, Parked),
    ),
  },
  ({ resources, commands }) => {
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
    for (const index of CARABINIERI) commands.spawn(carabinieriOn(index))
    const { seed } = resources.parking.get()
    for (const index of spotsWithin(start, PARKING.fill[1])) {
      const car = carOn(seed, index)
      if (car !== undefined) commands.spawn(parkedOn(index, car))
    }
  },
)

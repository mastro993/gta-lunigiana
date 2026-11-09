/**
 * Settles each body's footing once a step, after the last move (`RideAlong`), so the hosts always read it where the body is: every
 * body on foot keeps to the level it was on (`settleFooting`), and the player driving stands on the ground under the car on its
 * wheels' ground, or on the rail head under the train's active cab (`carFooting`, `trainFooting`). See ../footing.ts.
 *
 * @module systems/footing
 */
import { carFooting, settleFooting, trainFooting } from "../footing.ts"
import { LINES } from "../rail/lines.ts"
import {
  CarInput,
  Chassis,
  Driving,
  Footing,
  Game,
  Player,
  Pose,
  Train,
  TrainMotion,
  Vehicle,
} from "../schema.ts"

/** Each step, once everything has moved: every footing settled where its body now is (see the module). */
export const FindFooting = Game.System(
  "Lunigiana/FindFooting",
  {
    queries: {
      standing: Game.Query({
        selection: { pose: Game.Query.read(Pose), footing: Game.Query.write(Footing) },
        without: [Driving],
      }),
      driving: Game.Query({
        selection: { driving: Game.Query.read(Driving), footing: Game.Query.write(Footing) },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          vehicle: Game.Query.read(Vehicle),
          chassis: Game.Query.read(Chassis),
        },
        with: [CarInput],
      }),
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
        with: [CarInput],
      }),
    },
  },
  ({ queries }) => {
    for (const { data } of queries.standing.each()) {
      const { x, y } = data.pose.get(),
        was = data.footing.get().z,
        z = settleFooting(x, y, was)
      if (z !== was) data.footing.set({ z })
    }
    for (const { data } of queries.driving.each()) {
      const { vehicle } = data.driving.get(),
        car = queries.vehicles.getHandle(vehicle),
        train = car.ok ? undefined : queries.trains.getHandle(vehicle)
      const line = train?.ok === true ? LINES[train.value.data.motion.get().line] : undefined
      const z = car.ok
        ? carFooting(
            car.value.data.pose.get(),
            car.value.data.vehicle.get().model,
            car.value.data.chassis.get(),
          )
        : train?.ok === true && line !== undefined
          ? trainFooting(line, train.value.data.motion.get(), train.value.data.train.get().model)
          : undefined
      if (z !== undefined && z !== data.footing.get().z) data.footing.set({ z })
    }
  },
)

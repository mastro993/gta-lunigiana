import { InputAxis, Ops } from "@typeonce/ritmo-math"

import { cabOf } from "../rail/boarding.ts"
import { LINES } from "../rail/lines.ts"
import {
  CarInput,
  Driving,
  Game,
  Input,
  Motion,
  Player,
  Pose,
  Train,
  TrainMotion,
  Vehicle,
} from "../schema.ts"

/**
 * The player's keys drive their vehicle or train: throttle up − down, steer left − right (left turns CCW; a train ignores it),
 * handbrake (a train's emergency brake).
 */
export const PlayerDrive = Game.System(
  "Lunigiana/PlayerDrive",
  {
    queries: {
      player: Game.System.thisTick(
        Game.Query({ selection: { driving: Game.Query.read(Driving) }, with: [Player] }),
      ),
      controls: Game.Query({ selection: { input: Game.Query.write(CarInput) } }),
    },
    resources: { input: Game.System.readResource(Input) },
  },
  ({ queries, resources }) => {
    const keys = resources.input.get()
    for (const { data } of queries.player.each()) {
      const driven = queries.controls.getHandle(data.driving.get().vehicle)
      if (!driven.ok) continue
      driven.value.data.input.set({
        throttle: InputAxis.axis(keys.actions.down.held, keys.actions.up.held),
        steer: InputAxis.axis(keys.actions.right.held, keys.actions.left.held),
        handbrake: keys.actions.handbrake.held,
      })
    }
  },
)

/**
 * After physics, the driving player rides along: their Pose and Motion are the vehicle's, or in a train its active cab's (`cabOf`:
 * at its driver's place, facing the cab's way, moving with the train), so the camera follows it.
 */
export const RideAlong = Game.System(
  "Lunigiana/RideAlong",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          driving: Game.Query.read(Driving),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: { pose: Game.Query.read(Pose), motion: Game.Query.read(Motion) },
        with: [Vehicle, CarInput],
      }),
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
        with: [CarInput],
      }),
    },
  },
  ({ queries }) => {
    for (const { data } of queries.player.each()) {
      const { vehicle } = data.driving.get()
      const car = queries.vehicles.getHandle(vehicle)
      if (car.ok) {
        data.pose.set(car.value.data.pose.get())
        data.motion.set(car.value.data.motion.get())
        continue
      }
      const train = queries.trains.getHandle(vehicle)
      if (!train.ok) continue
      const motion = train.value.data.motion.get(),
        line = LINES[motion.line]
      if (line === undefined) continue
      const cab = cabOf(line, motion, train.value.data.train.get().model)
      data.pose.set({ x: cab.x, y: cab.y, angle: cab.angle })
      data.motion.set({
        vx: Ops.cos(cab.track) * motion.v,
        vy: Ops.sin(cab.track) * motion.v,
        spin: 0,
      })
    }
  },
)

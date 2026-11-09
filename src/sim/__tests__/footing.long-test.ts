import assert from "node:assert/strict"
import { test } from "node:test"

import { carFooting, settleFooting } from "../footing.ts"
import {
  CarInput,
  Chassis,
  Driving,
  Footing,
  Game,
  Player,
  Pose,
  SetClock,
  Vehicle,
} from "../index.ts"
import { start } from "../testing.ts"
import { joyride, joyrideCast } from "./joyride.ts"

/** Each person's and animal's `Footing` and what the step's resolve gives it where it now is: settled on foot, under the car driven. */
const Footings = Game.Inspector(
  "Test/Footings",
  {
    queries: {
      bodies: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          footing: Game.Query.read(Footing),
          driving: Game.Query.optional(Driving),
          player: Game.Query.optional(Player),
        },
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          vehicle: Game.Query.read(Vehicle),
          chassis: Game.Query.read(Chassis),
        },
        with: [CarInput],
      }),
    },
  },
  ({ queries }) =>
    queries.bodies.each().map(({ entity, data }) => {
      const { x, y } = data.pose.get(),
        { z } = data.footing.get(),
        driving = data.driving.value()
      const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
      return {
        id: entity.id,
        player: data.player.present,
        driving: driving !== undefined,
        z,
        settled:
          car?.ok === true
            ? carFooting(
                car.value.data.pose.get(),
                car.value.data.vehicle.get().model,
                car.value.data.chassis.get(),
              )
            : settleFooting(x, y, z),
      }
    }),
)

// Regression: the footing was found before anything moved, so the hosts read each one where its body stood a step before, and
// every reader that needed it where the body is found it again its own way.
test("footing: after every step of the joyride each person's and animal's footing is settled where its body now is, the player's under the car they drive, and the view stands on it", () => {
  const game = start(joyride, joyrideCast)
  game.runtime.send(SetClock, { rate: 600 })
  let driven = 0
  game.run(1620, (frame) => {
    const footings = game.runtime.inspect(Footings)
    for (const f of footings)
      assert.equal(f.z, f.settled, `step ${frame}: body ${f.id}${f.driving ? ", driving" : ""}`)
    const player = footings.find((f) => f.player)!
    if (player.driving) driven++
    assert.equal(game.view()!.z, player.z, `step ${frame}: the view on the player's footing`)
  })
  assert.ok(driven > 100, `the player drove for ${driven} steps`)
})

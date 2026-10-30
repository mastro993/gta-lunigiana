// The sim on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`): teleports
// and herds keep to the play area, the L.
import assert from "node:assert/strict"
import { test } from "node:test"

import { notchMap } from "../map/__tests__/edit-map.ts"

notchMap()
const { inPlay } = await import("../map/index.ts")
const { SetPlayer } = await import("../index.ts")
const { door, ON_BATTISTI, start } = await import("../testing.ts")
const { pasture, RURAL, RURAL_REACH } = await import("../population/farms.ts")
const { residentsNear } = await import("../population/density.ts")

test("an L: a teleport into the notch is dropped, one just inside its corner is not", () => {
  const game = start([], [door(ON_BATTISTI)])
  const at = (x: number, y: number) => {
    game.runtime.send(SetPlayer, { x, y, angle: 0 })
    game.run(1)
    const { pose } = game.view()!
    return [pose.x, pose.y]
  }
  assert.deepEqual(at(1990, -10), [1990, -10])
  assert.deepEqual(at(2500, 500), [1990, -10])
  assert.deepEqual(at(2000.5, 1000), [1990, -10])
  assert.deepEqual(at(1999.5, 1000), [1999.5, 1000])
})

test("an L: herds graze only the play area, a pasture by the notch included", () => {
  // The first rural pasture 20 m inside the notch's west side, from its south end: herds drawn 90-140 m off
  // fall in the notch about half the time.
  let y = 100
  while (!(pasture(1980, y) && residentsNear(1980, y, RURAL_REACH) < RURAL)) y += 40
  const game = start([], [{ x: 1980, y, angle: 0 }])
  let cows = 0
  game.run(900, (frame) => {
    if (frame % 60 !== 0) return
    for (const a of game.world().animals) {
      if (a.species !== "cow") continue
      cows++
      assert.ok(inPlay(a.x, a.y), `a cow at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`)
    }
  })
  assert.ok(cows > 0, `${cows} cows by (1980, ${y})`)
})

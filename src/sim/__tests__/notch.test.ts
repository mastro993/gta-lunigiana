// The sim on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`): teleports,
// herds and pigs keep to the play area, the L.
import "../map/__tests__/use-notch.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { SetPlayer } from "../index.ts"
import { inPlay } from "../map/index.ts"
import { residentsNear } from "../population/density.ts"
import { farmsNear, pasture, RURAL, RURAL_REACH } from "../population/farms.ts"
import { ANIMALS } from "../systems/populate-animals.ts"
import { door, ON_BATTISTI, start } from "../testing.ts"

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

/** The first y from `from` up the notch's west side, `step` m apart, where `ok` holds; fails past the notch's north edge (y 3900). */
const firstAlong = (what: string, from: number, step: number, ok: (y: number) => boolean) => {
  for (let y = from; y <= 3900; y += step) if (ok(y)) return y
  return assert.fail(`no ${what} along the notch's west side`)
}

test("an L: herds graze only the play area, a pasture by the notch included", () => {
  // The first rural pasture 20 m inside the notch's west side, from its south end: herds drawn 90-140 m off
  // fall in the notch about half the time.
  const y = firstAlong(
    "rural pasture",
    100,
    40,
    (y) => pasture(1980, y) && residentsNear(1980, y, RURAL_REACH) < RURAL,
  )
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

test("an L: pigs root only by pens in the play area, pens in the notch in reach", () => {
  // The first rural spot 18 m inside the notch's west side whose pig reach holds 4 or more rural
  // pens (enough to want a pig), all of them in the notch: a litter drawn by one would read a
  // building on an unlisted tile and throw.
  const pens = (y: number) => farmsNear(1982, y, ANIMALS.pig.reach).filter((f) => f.rural && f.pen)
  const y = firstAlong(
    "rural spot with only the notch's pens in reach",
    0,
    20,
    (y) =>
      residentsNear(1982, y, RURAL_REACH) < RURAL &&
      pens(y).length >= 4 &&
      pens(y).every((f) => !inPlay(f.x, f.y)),
  )
  const game = start([], [{ x: 1982, y, angle: 0 }])
  game.run(60)
  for (const a of game.world().animals)
    if (a.species === "pig")
      assert.ok(inPlay(a.x, a.y), `a pig at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`)
})

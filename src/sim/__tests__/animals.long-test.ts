import assert from "node:assert/strict"
import { test } from "node:test"

import { Vec2 } from "@typeonce/ritmo-math"

import { FAUNA } from "../fauna.ts"
import { residentsNear } from "../population/density.ts"
import { grazing, indoors } from "../population/farms.ts"
import { ANIMALS } from "../systems/populate-animals.ts"
import { beast, count, FARM, GRAGNOLA, listening, MEADOW, RURAL_ROAD } from "./farms.ts"

test("a village: cats on Gragnola's streets, never indoors; no cows or pigs", () => {
  const game = listening([], [GRAGNOLA])
  let most = 0
  game.run(1800, (frame) => {
    if (frame % 30 !== 0) return
    const { animals } = game.world()
    most = Math.max(most, animals.length)
    for (const a of animals)
      assert.ok(
        !indoors(a.x, a.y),
        `a ${a.species} indoors at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`,
      )
  })
  const by = count(game.world().animals)
  const cats = Math.round(
    residentsNear(GRAGNOLA.x, GRAGNOLA.y, ANIMALS.cat.reach) * ANIMALS.cat.perResident,
  )
  assert.equal(by.cat, Math.min(cats, ANIMALS.cat.max), JSON.stringify(by))
  assert.ok(by.cat >= 3, `${by.cat} cats`)
  assert.equal(by.cow + by.pig, 0, JSON.stringify(by))
})

test("a farm in the country: herds of cows on pasture and pigs by their pens, never indoors, within their caps", () => {
  const game = listening([], [FARM])
  game.run(1800, (frame) => {
    if (frame % 30 !== 0) return
    for (const a of game.world().animals)
      assert.ok(
        !indoors(a.x, a.y),
        `a ${a.species} indoors at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`,
      )
  })
  const { animals } = game.world()
  const by = count(animals)
  assert.ok(by.cow >= ANIMALS.cow.herd[0] && by.cow <= ANIMALS.cow.max, JSON.stringify(by))
  assert.ok(by.pig >= 1 && by.pig <= ANIMALS.pig.max, JSON.stringify(by))
  assert.ok(by.dog >= 1, JSON.stringify(by))
  for (const cow of animals.filter((a) => a.species === "cow"))
    assert.ok(
      grazing(cow.x, cow.y),
      `a cow off the grass at ${cow.x.toFixed(1)}, ${cow.y.toFixed(1)}`,
    )
})

test("a rural road with no house near: no animals over a minute", () => {
  const game = listening([], [RURAL_ROAD])
  game.run(3600, (frame) => {
    if (frame % 60 === 0) assert.deepEqual(game.world().animals, [])
  })
})

test("animals stay near home: each species idles and walks within its home range", () => {
  const cast = (["cat", "dog", "cow", "pig"] as const).map((s, i) =>
    beast(s, MEADOW, 15 + 4 * i, 0),
  )
  const game = listening([], [MEADOW, { animals: cast }])
  const homes = new Map(game.world().animals.map((a) => [a.id, a]))
  const moods = new Set<string>()
  game.run(3600, (frame) => {
    if (frame % 10 !== 0) return
    for (const a of game.world().animals) {
      const home = homes.get(a.id)
      if (home === undefined) continue
      moods.add(`${a.species} ${a.mood}`)
      assert.notEqual(a.mood, "flee", `nothing scares the ${a.species}`)
      assert.ok(
        Vec2.distance(a, { x: home.hx, y: home.hy }) <= FAUNA[a.species].home + 1,
        `the ${a.species} strayed to ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`,
      )
    }
  })
  for (const s of ["cat", "dog", "cow", "pig"]) {
    assert.ok(
      moods.has(`${s} idle`) && moods.has(`${s} walk`),
      `the ${s} rests and walks: ${[...moods]}`,
    )
  }
})

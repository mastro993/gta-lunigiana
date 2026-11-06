import assert from "node:assert/strict"
import { test } from "node:test"

import { Animal, type PoseValue } from "../index.ts"
import { LEVEL } from "../rail/bodies.ts"
import { pedestrian } from "../spawning.ts"
import { LOOK, rolling, start } from "../testing.ts"
import { VEHICLES } from "../vehicles.ts"
import { beast } from "./farms.ts"
import {
  AWAY,
  BELOW,
  DECK_LANE,
  DECK_Z,
  footing,
  OVER,
  overDeck,
  staged,
  STEEP,
} from "./viaduct.ts"

/** Right under the deck's lane at OVER, or over it on the deck. */
const HERE: PoseValue = { ...OVER, angle: 0 }

/** The Panda rolling over the deck (`overDeck`) for 4 s, `cast` round it, the player aside; the game and `each` step's reading. */
const passing = <T>(
  cast: Parameters<typeof staged>[2],
  each: (game: ReturnType<typeof staged>) => T,
  level?: number,
) => {
  const game = staged(AWAY.pose, AWAY.z, { ...cast, cars: [overDeck()] }, [])
  if (level !== undefined) assert.ok(game.runtime.tick(footing(level, Animal)).ok)
  const seen: Array<T> = []
  game.run(240, () => seen.push(each(game)))
  return { seen, game }
}

// Regression (#86): people and animals under a bridge ran from a car passing over them on its deck.
test("perceive: a passer-by standing on the road under the SR445's viaduct stays as a Panda rolls over them on its deck, crying out at nothing; standing in its way on the deck, they run", () => {
  for (const [where, route, runs] of [
    ["under the deck", { edge: BELOW, forward: true, side: 0 }, false],
    ["on the deck", DECK_LANE, true],
  ] as const) {
    const { seen, game } = passing(
      {
        peds: [
          pedestrian(LOOK, HERE, route, {
            mood: "look",
            until: 100_000,
            fx: HERE.x + 20,
            fy: HERE.y,
          }),
        ],
      },
      (g) => g.world().peds[0]!.mood,
    )
    assert.equal(seen.includes("flee"), runs, `${where}: ${[...new Set(seen)].join(", ")}`)
    if (!runs) assert.deepEqual(game.heard.cries, [], `${where}: no cry`)
  }
})

test("animals: a cat under the SR445's viaduct stays as a Panda rolls over it on the deck; on the deck it runs", () => {
  for (const [where, level, runs] of [
    ["under the deck", undefined, false],
    ["on the deck", DECK_Z, true],
  ] as const) {
    const { seen, game } = passing(
      { animals: [beast("cat", HERE, 0, 0, 100_000)] },
      (g) => g.world().animals[0]!.mood,
      level,
    )
    assert.equal(seen.includes("flee"), runs, `${where}: ${[...new Set(seen)].join(", ")}`)
    if (!runs) assert.deepEqual(game.heard.cries, [], `${where}: no cry`)
  }
})

// Read under the car's middle, its level would lose the walker it comes down a hill at: on this 30% lane the passer-by then ran
// only 6.4 m short of the Panda, and was struck, and the cat 6.2 m short of it.
test("perceive and animals: at the foot of a 30% lane a passer-by and a cat run from a Panda coming down at them while its wheels stand more than 2 m over their ground", () => {
  const foot = STEEP.at(15.5, "panda"),
    up = { x: foot.x - STEEP.lane.dx * 20, y: foot.y - STEEP.lane.dy * 20 }
  for (const [who, cast] of [
    [
      "a passer-by",
      {
        peds: [
          pedestrian(
            LOOK,
            foot,
            { ...STEEP.step, side: 0 },
            { mood: "look", until: 100_000, fx: up.x, fy: up.y },
          ),
        ],
      },
    ],
    ["a cat", { animals: [beast("cat", foot, 0, 0, 100_000)] }],
  ] as const) {
    const game = start(
      [],
      [
        { x: foot.x + 40, y: foot.y + 40, angle: 0 },
        { ...cast, cars: [rolling("panda", STEEP.at(1, "panda"), 8, 0)] },
      ],
      { alone: true },
    )
    let over: number | undefined
    game.run(150, () => {
      const w = game.world(),
        car = w.vehicles[0]!,
        them = w.peds[0] ?? w.animals[0]!
      if (over === undefined && them.mood === "flee")
        over = car.chassis.z - VEHICLES.panda.cg - STEEP.z(them)
    })
    assert.ok(
      over !== undefined && over > LEVEL,
      `${who} ran with the car's wheels ${over?.toFixed(2)} m over them`,
    )
    assert.deepEqual(
      game.heard.impacts.filter((i) => i.hit === "person" || i.hit === "animal"),
      [],
      `${who} not struck`,
    )
  }
})

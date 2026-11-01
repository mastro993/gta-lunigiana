import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, Vector3 } from "three"

import { QUARTER } from "../../sim/view.ts"
import { defaultRoute } from "../../tools/playtest-drive.ts"
import { terrainY } from "../ground.ts"
import { World } from "../world.ts"

// Regression (review of #5): chunks wholly behind the camera's near plane still asked for their tiles, so on mountain roads
// the follow camera swung tiles 1.5–2.5 km behind it in and out of the stream again and again.
test("world streaming: the tiles only chunks behind the camera's near plane read are not wanted, and what builds stays the same", () => {
  const route = defaultRoute()
  const ruled = new World(new Group()),
    every = new World(new Group())
  // The same World with the near-plane rule off: every chunk in reach on the screen asks for its tiles.
  ;(every as unknown as { behind: () => boolean }).behind = () => false
  let trimmed = 0,
    samples = 0
  for (let k = 0; k < route.length; k += 80) {
    const x = route[k]!,
      y = route[k + 1]!,
      focus = new Vector3(x, terrainY(x, y), -y)
    for (let q = 0; q < 4; q++, samples++) {
      const yaw = q * QUARTER
      for (const world of [ruled, every]) world.update(focus, yaw, 210, 0)
      const wanted = new Set(ruled.wanted())
      assert.ok(
        [...wanted].every((t) => every.wanted().has(t)),
        "the rule only leaves tiles out",
      )
      if (every.wanted().size > wanted.size) trimmed++
      // With the same tiles in, both build the same chunks: the rule changes what is fetched, never what is drawn.
      for (const t of every.wanted()) for (const world of [ruled, every]) world.tileProvided(t)
      for (const world of [ruled, every]) world.update(focus, yaw, 210, Infinity)
      assert.deepEqual(
        [...ruled.loaded.keys()].sort((a, b) => a - b),
        [...every.loaded.keys()].sort((a, b) => a - b),
      )
    }
  }
  assert.ok(trimmed >= samples / 4, `${trimmed} of ${samples} views left a tile out`)
})

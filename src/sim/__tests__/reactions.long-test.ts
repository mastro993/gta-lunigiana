import assert from "node:assert/strict"
import { test } from "node:test"

import { seeded } from "../scene.ts"

test("reactions: a quiet village stays quiet: in Gragnola's centre, traffic and its horns draw under 1 cry of fright and 2 of anger a minute", () => {
  // The density calibration's spot, the busiest village street; the player stands still for 3 minutes, on two seeds.
  const GRAGNOLA = { x: -1751, y: 3360, angle: 0 },
    minutes = 3,
    seeds = [1, 2]
  const felt = { fright: 0, anger: 0 }
  for (const seed of seeds) {
    const { run, world, heard } = seeded(seed, [GRAGNOLA])
    const people = new Set<number>()
    run(minutes * 3600, (frame) => {
      if (frame % 30 === 0) for (const p of world().peds) people.add(p.id)
    })
    for (const c of heard.cries)
      if (people.has(c.who) && (c.feeling === "fright" || c.feeling === "anger")) felt[c.feeling]++
  }
  const perMinute = (n: number) => n / (minutes * seeds.length)
  const said = `fright ${perMinute(felt.fright).toFixed(2)}, anger ${perMinute(felt.anger).toFixed(2)} a minute`
  assert.ok(perMinute(felt.fright) < 1 && perMinute(felt.anger) < 2, said)
})

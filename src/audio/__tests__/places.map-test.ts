import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { ambienceAt, dogsNear, owlsNear } from "../places.ts"
import { residentAround } from "../testing.ts"

// Map checks (pnpm test:map): the places all over the map, every tile in memory; places.test.ts checks those round a few
// spots.
const { minX, minY, maxX, maxY } = MAP.bounds
residentAround([{ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }], Math.max(maxX - minX, maxY - minY))

test("ambience shares stay within 1 all over the map", () => {
  for (let x = minX; x <= maxX; x += 97)
    for (let y = minY; y <= maxY; y += 89) {
      const { forest, open, built } = ambienceAt(x, y)
      assert.ok(
        Math.min(forest, open, built) >= 0 && forest + open + built <= 1 + 1e-6,
        `${x}, ${y}`,
      )
    }
})

test("dogs and owls are stable picks all over the map, near ones those of the whole map in its order", () => {
  const within = (r: number) => (p: { readonly x: number; readonly y: number }) =>
    Math.hypot(p.x + 400, p.y - 400) <= r
  const dogs = dogsNear(0, 0, 1e6),
    owls = owlsNear(0, 0, 1e6)
  assert.ok(dogs.length > 50 && owls.length > 100, `${dogs.length} dogs, ${owls.length} owls`)
  assert.deepEqual(dogsNear(0, 0, 1e6), dogs)
  assert.deepEqual(dogsNear(-400, 400, 300), dogs.filter(within(300)))
  assert.deepEqual(owlsNear(-400, 400, 600), owls.filter(within(600)))
})

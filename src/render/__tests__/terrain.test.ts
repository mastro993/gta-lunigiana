import assert from "node:assert/strict"
import { test } from "node:test"

import { coverAt } from "../../sim/map/cover.ts"
import { facingAt, terrainZ } from "../../sim/map/ground.ts"
import { LEVEL } from "../../sim/sky/local.ts"
import { chunkOf } from "../chunks.ts"
import { linear } from "../geometry.ts"
import { PALETTE } from "../palette.ts"
import { terrainChunk } from "../terrain.ts"
import { residentAround } from "../testing.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }

test("each face of the terrain mesh faces as the sim's facingAt says over it, so the snow it draws on north faces is where the tyres lose grip", () => {
  residentAround([STATION], 300)
  const g = terrainChunk(chunkOf(STATION.x, STATION.y)),
    position = g.getAttribute("position"),
    normal = g.getAttribute("normal")
  let checked = 0,
    worst = 0
  for (let v = 0; v < position.count; v += 3) {
    // The triangle's centroid, in map (x east, y north), and its face normal in three space (z is south).
    const x = (position.getX(v) + position.getX(v + 1) + position.getX(v + 2)) / 3,
      y = -(position.getZ(v) + position.getZ(v + 1) + position.getZ(v + 2)) / 3
    const face = facingAt(x, y, terrainZ(x, y))
    if (face === LEVEL) continue // a road or a platform covers it there
    worst = Math.max(
      worst,
      Math.abs(face.north + normal.getZ(v)),
      Math.abs(face.up - normal.getY(v)),
    )
    checked++
  }
  assert.ok(checked > 1500, `${checked} faces of bare terrain`)
  assert.ok(worst < 1e-6, `a face normal ${worst} off the sim's (float32)`)
})

test("out of leaf a broadleaf wood's floor shows its leaf litter: only the woods change colour, and only to the litter or their dark shade", () => {
  // The wood nearest Monzone station, along a line east of it.
  residentAround([STATION], 600)
  let x = STATION.x
  while (coverAt(x, STATION.y) !== "forest") x += 8
  const key = chunkOf(x, STATION.y),
    leafy = terrainChunk(key).getAttribute("color"),
    heights: Array<number> = [],
    bare = terrainChunk(key, (_kind, z) => {
      heights.push(z)
      return "bare"
    }).getAttribute("color")
  const allowed = new Set(
    [PALETTE.litter, PALETTE.forestDark].map((hex) => linear(hex).map(Math.fround).join()),
  )
  let changed = 0
  for (let v = 0; v < leafy.count; v += 3) {
    const before = [leafy.getX(v), leafy.getY(v), leafy.getZ(v)].join(),
      after = [bare.getX(v), bare.getY(v), bare.getZ(v)].join()
    if (before === after) continue
    assert.ok(allowed.has(after), `a face out of leaf in ${after}`)
    changed++
  }
  assert.ok(changed > 500, `${changed} faces of woods`)
  // The woods' floor is judged at its height above the sea, not at its render y (200 m lower).
  assert.ok(
    heights.length > 0 && heights.every((z) => Math.abs(z - terrainZ(x, STATION.y)) < 100),
    "the cells' heights a.s.l.",
  )
  // In leaf it is the chunk the world always drew.
  assert.deepEqual(
    Array.from(terrainChunk(key, () => "leafy").getAttribute("color").array),
    Array.from(leafy.array),
  )
})

import assert from "node:assert/strict"
import { test } from "node:test"

import { Vector3 } from "three"

import { MAP } from "../../sim/map/index.ts"
import { tileKey } from "../../sim/map/kinds.ts"
import { tilesOver } from "../../sim/map/tiles.ts"
import { DRAWN_RUN } from "../../sim/rail/lines.ts"
import {
  APRON,
  boundBox,
  CHUNKS,
  chunkOf,
  chunkRect,
  exactBox,
  plan,
  radiiFor,
  screenDistance,
  screenDistances,
  screenRects,
} from "../chunks.ts"
import { terrainY } from "../ground.ts"
import { viewAxes } from "../pipeline.ts"

const { right, up, back } = viewAxes(0)
const count = CHUNKS.x * CHUNKS.y
const boxes = new Float32Array(count * 6)
for (let key = 0; key < count; key++) exactBox(boxes, key)
const rects = screenRects(boxes, right, up, new Float32Array(count * 4))
const distancesFrom = (focus: Vector3) =>
  screenDistances(rects, focus.dot(right), focus.dot(up), new Float32Array(count))
const ground = (x: number, y: number) => new Vector3(x, terrainY(x, y), -y)

test("chunks: the apron past the map's edge is the railway's drawn run, the track a driven train runs to its buffer stop", () => {
  assert.equal(APRON * MAP.heightmap.cell, DRAWN_RUN)
})

/** Distances by key, as `plan` takes them. */
const byKey = (distances: ReadonlyArray<number>) => new Map(distances.entries())

test("plan: builds the missing chunks within the load radius nearest first, drops loaded ones past the unload radius", () => {
  const distances = byKey([5, 50, 150, 300, 20, 90, 250, 20])
  const { build, drop } = plan(distances, new Set([2, 3, 5]), { load: 100, unload: 200 })
  assert.deepEqual(build, [0, 4, 7, 1], "nearest first, equals in key order; 5 is already loaded")
  assert.deepEqual(drop, [3], "2 sits between the radii: kept, but 6 there is not built either")
})

test("plan: a chunk at the rim does not flicker as the focus jitters across the load radius", () => {
  const radii = radiiFor(50),
    loaded = new Set<number>()
  for (const d of [radii.load - 1, radii.load + 1, radii.load + 20, radii.load - 1]) {
    const { build, drop } = plan(byKey([d]), loaded, radii)
    for (const key of build) loaded.add(key)
    for (const key of drop) loaded.delete(key)
    assert.ok(loaded.has(0), `distance ${d}`)
  }
  assert.deepEqual(plan(byKey([radii.unload + 1]), loaded, radii).drop, [0])
})

test("screen distances: zero under the focus, growing with ground distance", () => {
  const { x, y } = MAP.spawns.player
  const d = distancesFrom(ground(x, y))
  assert.equal(d[chunkOf(x, y)], 0)
  assert.ok(d[chunkOf(x + 1500, y)]! > 1000)
  assert.ok(
    d[chunkOf(x, y - 1500)]! > 500,
    "screen-up foreshortens ground depth, but not to nothing",
  )
})

test("screen distances: a valley the camera shows beside the focus counts as near, however far on the ground", () => {
  // Focus 400 m up the view axis from a valley point: the same screen position, ≈ 350 m away on the ground.
  const x = MAP.spawns.player.x,
    y = MAP.spawns.player.y
  const focus = ground(x, y).addScaledVector(back, 400)
  const fx = focus.x,
    fy = -focus.z
  assert.ok(Math.hypot(fx - x, fy - y) > 300)
  assert.notEqual(chunkOf(fx, fy), chunkOf(x, y))
  assert.equal(distancesFrom(focus)[chunkOf(x, y)], 0)
})

test("screen distance: one box's is screenRects' and screenDistances'", () => {
  const { x, y } = MAP.spawns.player
  const focus = ground(x + 300, y - 200),
    d = distancesFrom(focus)
  for (const key of [chunkOf(x, y), chunkOf(x + 1500, y), chunkOf(x, y - 1500), 0, count - 1])
    // `d` holds 32-bit floats.
    assert.equal(
      Math.fround(screenDistance(boxes, key, right, up, focus.dot(right), focus.dot(up))),
      d[key],
    )
})

test("chunk boxes: the one from the tiles' lowest and highest nodes holds the exact one, for every chunk", () => {
  const tiles = new Map(MAP.tiles.map((tile) => [tileKey(tile.i, tile.j), tile]))
  const bound = new Float32Array(count * 6)
  for (let key = 0; key < count; key++) {
    const { minX, minY, maxX, maxY } = chunkRect(key)
    boundBox(
      bound,
      key,
      tilesOver(minX, minY, maxX, maxY).map((k) => tiles.get(k)!),
    )
    for (let k = 0; k < 4; k++) assert.equal(bound[key * 6 + k], boxes[key * 6 + k])
    assert.ok(bound[key * 6 + 4]! <= boxes[key * 6 + 4]!, `chunk ${key} low`)
    assert.ok(bound[key * 6 + 5]! >= boxes[key * 6 + 5]!, `chunk ${key} high`)
  }
})

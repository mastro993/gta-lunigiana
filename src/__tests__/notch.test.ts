// Lunigiana's map with its tiles north-east of (2000, 0) left out of the list and its outline an L
// round the rest: a map whose listed tiles do not fill the box round them, as a region of parts in
// an L gives (issue #7). Every runtime user of the map's tiles and play area must answer there,
// reading only listed tiles. The global file is rewritten before any module decodes it, so every
// map module is imported after `provideMap`.
import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP_URL, provideMap, readMapFile } from "../sim/map/packed.ts"

/** The tiles left out: x 2000 … 6000, y 0 … 4000 (the bounds stop at 4900, 3900). */
const inNotch = (i: number, j: number) => i >= 1 && j >= 0
/** The L the listed tiles leave: counter-clockwise from the south-west corner. */
const L = [-2900, -6100, 4900, -6100, 4900, 0, 2000, 0, 2000, 3900, -2900, 3900]

{
  const file = readMapFile(MAP_URL),
    end = file.indexOf(10)
  const json = JSON.parse(new TextDecoder().decode(file.subarray(0, end))) as {
    tiles: Array<{ readonly i: number; readonly j: number }>
    outline: Array<Array<number>>
  }
  json.tiles = json.tiles.filter(({ i, j }) => !inNotch(i, j))
  json.outline = [L]
  const line = new TextEncoder().encode(JSON.stringify(json))
  const notched = new Uint8Array(line.length + file.length - end)
  notched.set(line)
  notched.set(file.subarray(end), line.length)
  provideMap(notched)
}

const { heightAt, MAP } = await import("../sim/map/index.ts")
const { coverAt } = await import("../sim/map/cover.ts")
const { terrainZ } = await import("../sim/map/ground.ts")
const tiles = await import("../sim/map/tiles.ts")
const { chunkTiles } = await import("../render/chunk-tiles.ts")
const { CHUNKS, chunkRect, exactBox } = await import("../render/chunks.ts")

const { maxX, maxY } = MAP.bounds
/** The listed tiles round the notch: those a lookup in its corner tiles reads. */
const AROUND = ["0_-1", "1_-1", "2_-1", "0_0", "0_1"]
/** Calls `visit` on points `step` m apart over the notch, its listed neighbours' near halves and 300 m past the bounds. */
const sweep = (step: number, visit: (x: number, y: number) => void) => {
  for (let x = 1000; x <= maxX + 300; x += step)
    for (let y = -1000; y <= maxY + 300; y += step) visit(x, y)
}

test("an L: the notch's tiles are off the list, and a lookup there reads the listed tiles round it", () => {
  assert.equal(MAP.tiles.length, 26)
  assert.ok(!tiles.isListed(1, 0) && !tiles.isListed(2, 1) && tiles.isListed(0, 0))
  assert.deepEqual(tiles.tilesOver(2500, 500, 2600, 600), AROUND)
  // the far corner of the notch has no listed neighbour: the next ring's
  assert.deepEqual(tiles.tilesOver(4800, 3800, 4800, 3800), AROUND)
  assert.deepEqual(tiles.tilesOver(1500, -500, 2500, 500), ["0_-1", "1_-1", "2_-1", "0_0", "0_1"])
  sweep(250, (x, y) => {
    for (const key of tiles.tilesOver(x, y, x + 400, y + 400)) {
      const [i, j] = key.split("_").map(Number)
      assert.ok(tiles.isListed(i!, j!), `${key} read at ${x}, ${y}`)
    }
  })
})

test("an L: the notch's ground and cover extend the nearest listed tile's edge, and nothing throws", () => {
  sweep(97, (x, y) => {
    assert.ok(Number.isFinite(heightAt(x, y)) && Number.isFinite(terrainZ(x, y)), `${x}, ${y}`)
    assert.equal(typeof coverAt(x, y), "string")
  })
  // 300 m east of the notch's west side (its south side lies 1500 m off), 300 m north of its south side
  assert.equal(heightAt(2301.7, 1500.3), heightAt(2000, 1500.3))
  assert.equal(heightAt(4000.2, 300), heightAt(4000.2, 0))
  assert.equal(terrainZ(2301.7, 1500.3), terrainZ(2000, 1500.3))
  assert.equal(coverAt(2301.7, 1500.3), coverAt(1999, 1500.3))
  assert.equal(coverAt(4000.2, 300), coverAt(4000.2, -1))
  // past the bounds' north-east corner, the notch's: its nearest listed node
  assert.equal(heightAt(6000, 5000), heightAt(2000, 3900))
})

test("an L: a lookup in the notch is resident once the listed tiles round it are", () => {
  for (const { i, j } of MAP.tiles) tiles.dropTile(`${i}_${j}`)
  assert.ok(!tiles.isResidentAt(3000, 1000))
  for (const key of AROUND) {
    assert.ok(!tiles.isResidentAt(3000, 1000))
    tiles.provideTile(readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL)))
  }
  assert.ok(tiles.isResidentAt(3000, 1000) && tiles.isResidentAt(1999, 1000))
  tiles.setTileSource(undefined)
  try {
    assert.ok(Number.isFinite(heightAt(3000, 1000)))
    assert.equal(typeof coverAt(4800, 3800), "string")
  } finally {
    tiles.setTileSource((key) => readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL)))
  }
})

test("an L: the render plans every chunk once, the notch's on the listed tiles round it, its box round the exact one", () => {
  const count = CHUNKS.x * CHUNKS.y
  const plan = chunkTiles(
    [],
    Array.from({ length: count }, () => []),
  )
  assert.deepEqual(
    plan.keys,
    MAP.tiles.map(({ i, j }) => `${i}_${j}`),
  )
  assert.equal(new Set(plan.owned.flat()).size, count)
  assert.equal(plan.owned.flat().length, count)
  const exact = new Float32Array(count * 6)
  let notch = 0
  for (let key = 0; key < count; key++) {
    assert.ok(plan.terrain[key]!.length > 0, `chunk ${key}`)
    const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = chunkRect(key)
    if (x0 < 2000 + 50 || y0 < 50 || x1 > maxX || y1 > maxY) continue
    notch++
    const read = plan.terrain[key]!.map((t) => plan.keys[t]!)
    assert.ok(
      read.every((k) => AROUND.includes(k)),
      `chunk ${key} reads ${read.join(" ")}`,
    )
    if (notch % 37 !== 0) continue
    exactBox(exact, key)
    assert.ok(plan.boxes[key * 6 + 4]! <= exact[key * 6 + 4]!, `chunk ${key}'s low`)
    assert.ok(plan.boxes[key * 6 + 5]! >= exact[key * 6 + 5]!, `chunk ${key}'s high`)
  }
  assert.ok(notch > 400, `${notch} chunks in the notch`)
})

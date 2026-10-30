// Lunigiana's map with its tiles north-east of (2000, 0) left out of the list and its outline an L
// round the rest: a map whose listed tiles do not fill the box round them, as a region of parts in
// an L gives (issue #7). Every runtime user of the map's tiles and play area must answer there,
// reading only listed tiles. The global file is rewritten before any module decodes it, so every
// map module is imported after `provideMap`.
import assert from "node:assert/strict"
import { test } from "node:test"

import { Random } from "@typeonce/ritmo-math"

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

const { heightAt, inPlay, MAP, outlineDistance } = await import("../sim/map/index.ts")
const { coverAt } = await import("../sim/map/cover.ts")
const { terrainZ } = await import("../sim/map/ground.ts")
const tiles = await import("../sim/map/tiles.ts")
const { chunkTiles } = await import("../render/chunk-tiles.ts")
const { CHUNKS, chunkRect, exactBox } = await import("../render/chunks.ts")
const { SetPlayer } = await import("../sim/index.ts")
const { door, ON_BATTISTI, start } = await import("../sim/testing.ts")
const { initialWeather, setWeather, stormStep } = await import("../sim/sky/weather.ts")
const { screenAxes } = await import("../sim/view.ts")
const { pasture, RURAL, RURAL_REACH } = await import("../sim/population/farms.ts")
const { residentsNear } = await import("../sim/population/density.ts")
const { paintMap, tilesNear } = await import("../hud/minimap.ts")
const { owlsNear } = await import("../audio/places/animals.ts")

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

test("an L: the play area is the outline's, its edge in it", () => {
  assert.ok(inPlay(1500, 500) && inPlay(2000, 1000) && inPlay(3000, 0) && inPlay(4900, -6100))
  assert.ok(!inPlay(2500, 500) && !inPlay(2000.1, 1000) && !inPlay(4800, 3800))
  assert.ok(!inPlay(1995, 1000, 6) && inPlay(1995, 1000, 5))
  assert.equal(outlineDistance(1990, 1000), 10)
  assert.equal(outlineDistance(2300, 400), 300)
})

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

test("an L: by the notch, bolts strike only the play area", () => {
  const t = 1792648800 // 2026-10-22, 10:00 in Rome
  for (const [x, y] of [
    [1700, 800],
    [3000, -300],
  ] as const) {
    const witness = { x, y, ...screenAxes(0) }
    let bolts = 0
    for (const seed of [1, 2, 3, 4]) {
      const random = Random.make(seed)
      let w = setWeather(initialWeather(t, 1), { regime: "storm", settle: true }, t)!
      for (let step = 0; step < 60 * 180; step++) {
        const out = stormStep(w, witness, 1 / 60, step, random)
        w = out.weather
        if (out.lightning?.bolt !== true) continue
        bolts++
        assert.ok(
          inPlay(out.lightning.x, out.lightning.y),
          `a bolt at ${out.lightning.x}, ${out.lightning.y}`,
        )
      }
    }
    assert.ok(bolts > 20, `(${x}, ${y}): ${bolts} bolts`)
  }
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

test("an L: the minimap paints only listed tiles, and the maps lay their grass on the L and clip to it", () => {
  // 500 m off the notch's south and west sides: the notch's own two tiles in reach are left out
  assert.deepEqual(
    tilesNear(2500, 500, 1500).map((t) => t.key),
    ["1_-1", "0_0", "0_-1"],
  )
  /** A stand-in for the browser's Path2D: it keeps the points it is given. */
  class Points {
    readonly pts: Array<number> = []
    moveTo(x: number, y: number) {
      this.pts.push(x, y)
    }
    lineTo(x: number, y: number) {
      this.pts.push(x, y)
    }
    closePath() {}
  }
  const clips: Array<Points> = [],
    fills: Array<Points> = []
  const ctx = new Proxy(
    {
      save: () => {},
      restore: () => {},
      clip: (p: Points) => clips.push(p),
      fill: (p: Points) => fills.push(p),
      stroke: () => {},
    },
    { set: () => true },
  )
  Object.assign(globalThis, { Path2D: Points })
  // the full map's fit, painting only what reaches a box in the notch
  paintMap(
    ctx as unknown as CanvasRenderingContext2D,
    0.1,
    { minX: -2900, maxY: 3900 },
    {
      overview: true,
      within: [2500, 500, 2600, 600],
    },
  )
  const px = L.map((v, k) => (k % 2 === 0 ? (v + 2900) * 0.1 : (3900 - v) * 0.1))
  assert.deepEqual(
    clips.map((p) => p.pts),
    [px],
  )
  assert.deepEqual(fills[0]!.pts, px)
})

test("an L: owls perch only on listed tiles, none in the notch's borrowed woods", () => {
  for (const key of AROUND)
    if (!tiles.isResident(key))
      tiles.provideTile(readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL)))
  const owls = owlsNear(3400, 1950, 2500)
  assert.ok(owls.length > 10, `${owls.length} owls`)
  for (const owl of owls)
    assert.ok(
      tiles.isListed(Math.floor(owl.x / 2000), Math.floor(owl.y / 2000)),
      `${owl.key} at ${owl.x.toFixed(0)}, ${owl.y.toFixed(0)}`,
    )
})

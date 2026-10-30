import assert from "node:assert/strict"
import { test } from "node:test"

import {
  PARTS,
  type Part,
  type Rect,
  checkMask,
  inRects,
  mapDir,
  partOf,
  rectRing,
  rectsBox,
  regionFromArgs,
} from "../region.ts"

test("the default build keeps the pinned Lunigiana map", () => {
  const region = regionFromArgs([])
  assert.equal(region.id, "lunigiana")
  assert.equal(region.file, "monzone")
  assert.deepEqual(region.origin, { lat: 44.16175, lon: 10.13 })
})

test("Cesena is a separate city-centre map", () => {
  const region = regionFromArgs(["--region", "cesena"])
  assert.equal(region.file, "cesena")
  assert.ok(region.origin.lat > 44.13 && region.origin.lat < 44.15)
  assert.ok(region.origin.lon > 12.23 && region.origin.lon < 12.26)
  assert.equal(region.bounds.maxX - region.bounds.minX, 4000)
  assert.equal(region.bounds.maxY - region.bounds.minY, 4000)
  // One part, its 4 km square, played whole.
  assert.deepEqual(
    region.parts.map((p) => [p.rects, p.mask]),
    [[[[-2000, -2000, 2000, 2000]], undefined]],
  )
})

test("a region's bounds, its built terrain, are the box round its parts' rectangles", () => {
  for (const id of ["lunigiana", "cesena"]) {
    const region = regionFromArgs(["--region", id])
    const [minX, minY, maxX, maxY] = rectsBox(region.parts.flatMap((p) => p.rects))
    assert.deepEqual(region.bounds, { minX, minY, maxX, maxY }, id)
  }
  const lunigiana = regionFromArgs([])
  assert.equal(lunigiana.parts, PARTS)
  assert.deepEqual(lunigiana.bounds, { minX: -2900, minY: -6100, maxX: 4900, maxY: 3900 })
})

test("a region's tiles are those its parts' rectangles meet, and its tree anchor is its first part's south-west corner", () => {
  const keys = (id: string) => regionFromArgs(["--region", id]).tiles.map(({ i, j }) => `${i}_${j}`)
  // Lunigiana's 30: i −2…2, j −4…1, south to north, then west to east.
  const lunigiana = keys("lunigiana")
  assert.equal(lunigiana.length, 30)
  assert.deepEqual(lunigiana.slice(0, 6), ["-2_-4", "-1_-4", "0_-4", "1_-4", "2_-4", "-2_-3"])
  assert.equal(lunigiana.at(-1), "2_1")
  assert.deepEqual(keys("cesena"), ["-1_-1", "0_-1", "-1_0", "0_0"])
  assert.deepEqual(regionFromArgs([]).anchor, { x: -2900, y: -6100 })
  assert.deepEqual(regionFromArgs(["--region", "cesena"]).anchor, { x: -2000, y: -2000 })
})

test("unknown regions and incomplete arguments fail before a fetch or build, naming the known keys", () => {
  assert.throws(() => regionFromArgs(["--region", "unknown"]), /region.*lunigiana-l/)
  assert.throws(() => regionFromArgs(["--region"]), /region/)
})

const TESTS = ["lunigiana-l", "lunigiana-3x"] as const
const lucido = partOf("lucido").rects[0]!
const area = ([x0, y0, x1, y1]: Rect) => (x1 - x0) * (y1 - y0)

test("the test regions build from Lunigiana's inputs, origin and tree anchor into test-maps; the shipped maps into src/sim/map", () => {
  const lunigiana = regionFromArgs([])
  for (const key of TESTS) {
    const region = regionFromArgs(["--region", key])
    assert.equal(region.key, key)
    assert.equal(region.file, key)
    assert.ok(region.test)
    assert.equal(mapDir(region), "test-maps")
    assert.equal(region.id, "lunigiana")
    assert.deepEqual(region.origin, lunigiana.origin)
    assert.deepEqual(region.anchor, lunigiana.anchor)
  }
  for (const key of ["lunigiana", "cesena"]) {
    const region = regionFromArgs(["--region", key])
    assert.equal(region.key, key)
    assert.ok(!region.test)
    assert.equal(mapDir(region), "src/sim/map")
  }
})

test("lunigiana-l: two rectangles of lucido in an L, its notch's two tiles left off the list", () => {
  const l = regionFromArgs(["--region", "lunigiana-l"])
  const rects = l.parts.flatMap((p) => p.rects)
  assert.equal(rects.length, 2)
  for (const [x0, y0, x1, y1] of rects)
    assert.ok(inRects([lucido], x0, y0) && inRects([lucido], x1, y1))
  assert.ok(l.parts.every((p) => p.mask === undefined))
  // the box less the two arms is the notch: a rectangle of its own, in neither
  const box = rectsBox(rects)
  assert.equal(area(box) - area(rects[0]!) - area(rects[1]!), 2400 * 2500)
  assert.ok(!inRects(rects, 1200, 2650))
  assert.deepEqual(
    l.tiles.map(({ i, j }) => `${i}_${j}`),
    ["-2_0", "-1_0", "0_0", "1_0", "-2_1", "-1_1"],
  )
})

test("lunigiana-3x: lucido between terrain-only rectangles, 3 times its built terrain, its play area lucido's rectangle", () => {
  const x3 = regionFromArgs(["--region", "lunigiana-3x"])
  const [part] = x3.parts
  assert.equal(x3.parts.length, 1)
  assert.deepEqual(part!.mask, rectRing(lucido))
  assert.ok(part!.rects.some((r) => r.every((v, k) => v === lucido[k])))
  const { minX, minY, maxX, maxY } = x3.bounds
  assert.equal(area([minX, minY, maxX, maxY]), 3 * area(lucido))
  assert.equal(x3.tiles.length, 78)
})

/** An L: a 200 by 100 m foot and a 100 by 200 m leg on its west half, the notch at its north-east. */
const L: ReadonlyArray<Rect> = [
  [0, 0, 200, 100],
  [0, 100, 100, 300],
]

test("partOf gives the part with the key: lucido is today's map", () => {
  const lucido = partOf("lucido")
  assert.equal(lucido.title, "Valle del Lucido")
  assert.deepEqual(lucido.rects, [[-2900, -6100, 4900, 3900]])
})

test("partOf without a known key throws naming every key", () => {
  const keys = PARTS.map((p) => p.key)
  for (const key of [undefined, "nope"]) {
    assert.throws(
      () => partOf(key),
      (error: Error) =>
        error.message.startsWith(`unknown part ${key}: use one of `) &&
        keys.every((k) => error.message.includes(k)),
    )
  }
})

test("every part has a unique key and rectangles on 100 m multiples", () => {
  assert.equal(new Set(PARTS.map((p) => p.key)).size, PARTS.length)
  for (const { key, rects } of PARTS) {
    assert.ok(rects.length > 0, key)
    for (const [x0, y0, x1, y1] of rects) {
      assert.ok(x0 < x1 && y0 < y1, key)
      assert.ok(
        [x0, y0, x1, y1].every((v) => v % 100 === 0),
        key,
      )
    }
  }
})

test("inRects holds inside either rectangle and on their edges, not in the notch or outside", () => {
  assert.ok(inRects(L, 150, 50))
  assert.ok(inRects(L, 50, 250))
  assert.ok(inRects(L, 200, 100))
  assert.ok(inRects(L, 0, 300))
  assert.ok(!inRects(L, 150, 200))
  assert.ok(!inRects(L, 101, 101))
  assert.ok(!inRects(L, -1, 50))
  assert.ok(!inRects(L, 50, 301))
})

test("rectsBox is the box round every rectangle", () => {
  assert.deepEqual(rectsBox(L), [0, 0, 200, 300])
  assert.deepEqual(rectsBox(partOf("lucido").rects), [-2900, -6100, 4900, 3900])
})

/** A part over the L with `mask`. */
const masked = (mask: ReadonlyArray<number>): Part => ({ key: "l", title: "L", rects: L, mask })

test("every region's masks are simple counter-clockwise rings on 0.1 m inside their rectangles", () => {
  for (const id of ["lunigiana", "cesena", ...TESTS])
    for (const part of regionFromArgs(["--region", id]).parts) checkMask(part)
})

test("checkMask passes a diagonal mask in the L, touching its sides and its inner corner", () => {
  checkMask(masked([0, 0, 200, 0, 200, 50, 100, 100, 50, 300, 0, 300]))
  checkMask(masked([10.5, 10.1, 150.3, 20, 100, 100, 99.9, 250.7]))
  checkMask({ key: "none", title: "No mask", rects: L })
})

test("checkMask throws, naming the part and the fault, for any other mask", () => {
  for (const [mask, fault] of [
    [[0, 0, 200, 0], /needs three or more/],
    [[0, 0, 200, 0, 100, 50.05], /off the 0\.1 m lattice/],
    [[0, 0, 100, 250, 200, 0], /not counter-clockwise/],
    [[0, 0, 200, 0, 200, 0, 100, 50], /repeats vertex 1/],
    [[0, 0, 200, 0, 100, 0, 100, 50], /folds back at vertex 1/],
    // the edge from the leg back down crosses the foot's south side
    [[0, 0, 200, 0, 200, 100, 0, 100, 100, -20], /crosses itself: edges 0 and 3/],
    [[0, 0, 200, 0, 200, 100, 150, 200, 0, 100], /vertex 3 outside/],
    // every vertex in the L, the edge from the foot's far corner to the leg's top across the notch
    [[0, 0, 200, 0, 200, 100, 100, 300, 0, 300], /leaves its rectangles on edge 2/],
  ] as const)
    assert.throws(
      () => checkMask(masked(mask)),
      (error: Error) => error.message.startsWith("part l's mask ") && fault.test(error.message),
    )
})

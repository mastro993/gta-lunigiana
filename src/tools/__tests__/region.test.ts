import assert from "node:assert/strict"
import { test } from "node:test"

import { tileRange } from "../../sim/map/kinds.ts"
import {
  PARTS,
  type Part,
  type Rect,
  checkMask,
  dtmDir,
  surveyDir,
  inRects,
  ligDir,
  mapDir,
  osmFile,
  osmFiles,
  partOf,
  rectRing,
  rectsBox,
  regionFromArgs,
  regionOfPart,
  ucsParts,
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
  // Sarzana's rectangle to the west and south, its and Fivizzano's to the north, Magliano's to the
  // east
  assert.deepEqual(lunigiana.bounds, { minX: -23100, minY: -8500, maxX: 10600, maxY: 13000 })
  // One notch: ground in the box no part's rectangle holds, south of lucido and Fosdinovo and east
  // of lucido (Sarzana's part filled the one west of Fosdinovo)
  const rects = PARTS.flatMap((p) => p.rects)
  assert.ok(!inRects(rects, 8000, 0) && !inRects(rects, 0, -8000) && !inRects(rects, -8000, -8000))
  assert.ok(inRects(rects, 0, 0) && inRects(rects, -15000, 0) && inRects(rects, -8000, 8000))
})

test("a region's tiles are those its parts' rectangles meet, and its tree anchor is its first part's south-west corner", () => {
  const keys = (id: string) => regionFromArgs(["--region", id]).tiles.map(({ i, j }) => `${i}_${j}`)
  // Lunigiana's 190 of the box's 216 (i −12…5, j −5…6), south to north, then west to east:
  // Sarzana's i −12…−6 from j −5, then Fosdinovo's i −6…−3 and lucido's i −2…2 from j −4, then the
  // whole rows j 1…6, Aulla's rectangle's i −12…−3 and Fivizzano's i −3…5 from y 3900, where they
  // meet Sarzana's, Fosdinovo's and lucido's. Its notch, the 26 tiles no rectangle meets: i −5…5 for
  // j −5, south of Fosdinovo and lucido, and i 3…5 for j −4…0, east of lucido.
  const lunigiana = keys("lunigiana")
  const { i0, i1, j0, j1 } = tileRange(regionFromArgs([]).bounds)
  assert.deepEqual([i0, i1, j0, j1], [-12, 5, -5, 6])
  assert.equal(lunigiana.length, 190)
  assert.deepEqual(lunigiana.slice(0, 8), [
    "-12_-5",
    "-11_-5",
    "-10_-5",
    "-9_-5",
    "-8_-5",
    "-7_-5",
    "-6_-5",
    "-12_-4",
  ])
  assert.deepEqual(lunigiana.slice(81, 84), ["2_0", "-12_1", "-11_1"])
  assert.equal(lunigiana.at(-1), "5_6")
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      assert.equal(
        lunigiana.includes(`${i}_${j}`),
        j >= 1 || (j >= -4 && i <= 2) || i <= -6,
        `${i}_${j}`,
      )
  assert.deepEqual(keys("cesena"), ["-1_-1", "0_-1", "-1_0", "0_0"])
  assert.deepEqual(regionFromArgs([]).anchor, { x: -2900, y: -6100 })
  assert.deepEqual(regionFromArgs(["--region", "cesena"]).anchor, { x: -2000, y: -2000 })
})

test("--region=<key> selects a region as --region <key> does", () => {
  assert.equal(regionFromArgs(["--region=bagnone-ridge"]).key, "bagnone-ridge")
  assert.equal(regionFromArgs(["ctr", "--region=cesena"]).key, "cesena")
  assert.throws(() => regionFromArgs(["--region="]), /Unknown or missing region/)
})

test("unknown regions and incomplete arguments fail before a fetch or build, naming the known keys", () => {
  assert.throws(() => regionFromArgs(["--region", "unknown"]), /region.*lunigiana-l/)
  assert.throws(() => regionFromArgs(["--region"]), /region/)
})

const TESTS = ["lunigiana-l", "lunigiana-3x", "bagnone-ridge", "magra-coast"] as const
const lucido = partOf("lucido").rects[0]!
const area = ([x0, y0, x1, y1]: Rect) => (x1 - x0) * (y1 - y0)

test("the test regions take Lunigiana's origin and tree anchor and their files' place in test-maps (bagnone-ridge its terrain alone); the shipped maps go into src/sim/map", () => {
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

test("bagnone-ridge: one part, sillara, 4 × 4 km round Monte Sillara on 4 tiles, with terrain of its own", () => {
  const ridge = regionFromArgs(["--region", "bagnone-ridge"])
  assert.ok(ridge.ownTerrain)
  assert.deepEqual(
    ridge.parts.map((p) => [p.key, p.rects, p.mask]),
    [["sillara", [[-8000, 20000, -4000, 24000]], undefined]],
  )
  assert.deepEqual(
    ridge.tiles.map(({ i, j }) => `${i}_${j}`),
    ["-4_10", "-3_10", "-4_11", "-3_11"],
  )
  for (const key of ["lunigiana", "cesena", "lunigiana-l", "lunigiana-3x"])
    assert.ok(!regionFromArgs(["--region", key]).ownTerrain, key)
})

test("ligDir is a part's folder under data/raw/lig: Sarzana's, the part with most of its ground in Liguria", () => {
  assert.equal(ligDir(partOf("sarzana")), "data/raw/lig/sarzana")
  assert.equal(ligDir(partOf("lucido")), "data/raw/lig/lucido")
})

test("pontremoli-town: one part, 1.6 × 1.6 km round Pontremoli's town, the one region with buildings of its own", () => {
  const town = regionFromArgs(["--region", "pontremoli-town"])
  assert.ok(town.ownBuildings && !town.ownTerrain && town.test)
  assert.deepEqual(
    town.parts.map((p) => [p.key, p.rects, p.mask]),
    [["pontremoli-town", [[-20700, 23100, -19100, 24700]], undefined]],
  )
  for (const key of [
    "lunigiana",
    "cesena",
    "lunigiana-l",
    "lunigiana-3x",
    "bagnone-ridge",
    "magra-coast",
  ])
    assert.ok(!regionFromArgs(["--region", key]).ownBuildings, key)
})

test("magra-coast: one part, 6 × 4 km of the coast on 9 tiles, with terrain, OSM and Liguria's sources of its own, and no Tuscan land cover", () => {
  const coast = regionFromArgs(["--region", "magra-coast"])
  assert.ok(coast.ownTerrain && coast.ownOsm && !coast.ownBuildings && coast.test)
  assert.deepEqual(
    coast.parts.map((p) => [p.key, p.rects, p.mask]),
    [["magra-coast", [[-14000, -15000, -8000, -11000]], undefined]],
  )
  assert.deepEqual(
    coast.tiles.map(({ i, j }) => `${i}_${j}`),
    ["-7_-8", "-6_-8", "-5_-8", "-7_-7", "-6_-7", "-5_-7", "-7_-6", "-6_-6", "-5_-6"],
  )
  assert.equal(mapDir(coast), "test-maps")
  assert.equal(dtmDir(coast), "data/raw/rt/magra-coast")
  assert.equal(ligDir(coast.parts[0]!), "data/raw/lig/magra-coast")
  assert.deepEqual(osmFiles(coast), ["data/raw/osm/magra-coast.osm.gz"])
  assert.deepEqual(ucsParts(coast), [])
  for (const key of ["lunigiana", "cesena", "lunigiana-l", "pontremoli-town"])
    assert.ok(!regionFromArgs(["--region", key]).ownOsm, key)
})

test("ucsParts: the parts whose Tuscan land cover a build reads, none for a region with terrain of its own", () => {
  assert.deepEqual(ucsParts(regionFromArgs([])), PARTS)
  assert.deepEqual(ucsParts(regionFromArgs(["--region", "lunigiana-l"])), PARTS)
  for (const key of ["bagnone-ridge", "magra-coast"])
    assert.deepEqual(ucsParts(regionFromArgs(["--region", key])), [], key)
})

test("surveyDir is a region's own folder when it has buildings of its own, else Lunigiana's", () => {
  assert.equal(
    surveyDir(regionFromArgs(["--region", "pontremoli-town"])),
    "data/raw/rt/pontremoli-town",
  )
  for (const key of ["lunigiana", "lunigiana-l", "bagnone-ridge"])
    assert.equal(surveyDir(regionFromArgs(["--region", key])), "data/raw/rt", key)
})

test("dtmDir is a region's own folder when it has terrain of its own, else Lunigiana's", () => {
  assert.equal(dtmDir(regionFromArgs(["--region", "bagnone-ridge"])), "data/raw/rt/bagnone-ridge")
  for (const key of ["lunigiana", "lunigiana-l"])
    assert.equal(dtmDir(regionFromArgs(["--region", key])), "data/raw/rt", key)
})

test("osmFile is a part's OSM extract under data/raw/osm, and osmFiles every extract a region's build merges, in build order", () => {
  assert.equal(osmFile(partOf("lucido")), "data/raw/osm/lucido.osm.gz")
  const lunigiana = PARTS.map((p) => `data/raw/osm/${p.key}.osm.gz`)
  assert.deepEqual(lunigiana, [
    "data/raw/osm/lucido.osm.gz",
    "data/raw/osm/fivizzano.osm.gz",
    "data/raw/osm/fosdinovo.osm.gz",
    "data/raw/osm/aulla.osm.gz",
    "data/raw/osm/sarzana.osm.gz",
  ])
  // A test region is built from Lunigiana's inputs, its OSM included, but for its own buildings or OSM.
  for (const key of ["lunigiana", "lunigiana-l", "lunigiana-3x", "bagnone-ridge"])
    assert.deepEqual(osmFiles(regionFromArgs(["--region", key])), lunigiana, key)
  assert.deepEqual(osmFiles(regionFromArgs(["--region", "pontremoli-town"])), [
    "data/raw/osm/pontremoli-town.osm.gz",
  ])
  assert.deepEqual(osmFiles(regionFromArgs(["--region", "cesena"])), ["data/raw/osm/cesena.osm.gz"])
})

test("partOf finds a test region's part too, and regionOfPart gives the region it belongs to", () => {
  assert.equal(partOf("sillara"), regionFromArgs(["--region", "bagnone-ridge"]).parts[0])
  assert.equal(partOf("lucido-l"), regionFromArgs(["--region", "lunigiana-l"]).parts[0])
  assert.equal(regionOfPart(partOf("sillara")).key, "bagnone-ridge")
  assert.equal(regionOfPart(partOf("lucido-l")).key, "lunigiana-l")
  assert.equal(regionOfPart(partOf("lucido")).key, "lunigiana")
})

/** An L: a 200 by 100 m foot and a 100 by 200 m leg on its west half, the notch at its north-east. */
const L: ReadonlyArray<Rect> = [
  [0, 0, 200, 100],
  [0, 100, 100, 300],
]

test("partOf gives the part with the key: lucido, the region's first part", () => {
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

test("checkMask throws for a mask round a gap in its rectangles, though no edge leaves them", () => {
  // Four rectangles in a donut; the mask's edges all lie in them, but it encloses the 100 m hole.
  const donut: ReadonlyArray<Rect> = [
    [0, 0, 300, 100],
    [0, 200, 300, 300],
    [0, 100, 100, 200],
    [200, 100, 300, 200],
  ]
  assert.throws(
    () =>
      checkMask({
        key: "donut",
        title: "Donut",
        rects: donut,
        mask: [50, 50, 250, 50, 250, 250, 50, 250],
      }),
    /part donut's mask encloses ground outside its rectangles/,
  )
  // A mask that keeps to one side of the hole passes.
  checkMask({ key: "donut", title: "Donut", rects: donut, mask: [0, 0, 300, 0, 300, 100, 0, 100] })
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

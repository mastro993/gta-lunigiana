import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { FLAT_GROUND } from "../../sky/local.ts"
import { groundBuckets } from "../ground-model.ts"
import { ON_DECK, ROAD_LIFT } from "../kinds.ts"
import { LIFT, road, scene } from "./ground-scenes.ts"

// The ground model's rules on hand-made scenes, with no map loaded: ground.test.ts and
// ground.map-test.ts check that the game's tiled data answers as the whole map's does.

/** A deck 6 m wide along y = 0 from x = −50 to 50, its top at `top` m a.s.l., over ground at 100 m. */
const deckAt = (top: number) =>
  road({ from: [-50, 0], to: [50, 0], z: [top - LIFT, top - LIFT], bridge: true })

test("the terrain is the drawn mesh: each cell split along its south-west to north-east diagonal, not blended across it", () => {
  // One cell from (0, 0) to (4, 4) with only its south-east node raised a metre.
  const { terrainZ } = scene({ terrain: (x, y) => (x === 4 && y === 0 ? 101 : 100) })
  assert.equal(terrainZ(3, 1), 100.5, "south-east of the diagonal: the triangle holding that node")
  assert.equal(
    terrainZ(1, 3),
    100,
    "north-west of it: a triangle without it (bilinear gives 100.0625)",
  )
})

test("a deck within ON_DECK of the last level holds an actor over nearer ground, as on a ramp climbing over a gully; farther off the ground nearest wins", () => {
  const top = 100.6 - LIFT + LIFT,
    { groundZ, atGrade } = scene({ roads: [deckAt(100.6)] })
  assert.equal(ON_DECK, 0.5)
  assert.equal(groundZ(0, 0, 100.25), top, "the ground 0.25 m off, the deck 0.35 m off: the deck")
  assert.equal(groundZ(0, 0, 99.95), 100, "the deck 0.65 m off: the ground")
  assert.equal(groundZ(0, 0), top, "with no level to go by, the highest")
  assert.equal(atGrade(0, 0), 100, "at grade: the deck 0.6 m over the terrain is another level")
  // A deck's end lying within ON_DECK of the terrain is the ground at grade there.
  assert.equal(scene({ roads: [deckAt(100.3)] }).atGrade(0, 0), 100.3 - LIFT + LIFT)
})

test("someone on foot is on a deck out to its walkers' verge, past its carriageway, and past its ends only a wheel's reach along it", () => {
  const top = 104 - LIFT + LIFT,
    { groundZ, footZ } = scene({ roads: [deckAt(104)] })
  // The carriageway reaches 3.3 m off the line, the verge 4.3 m.
  assert.equal(groundZ(0, 4), 100, "a wheel 4 m off the line is off the deck")
  assert.equal(groundZ(0, 4, top, true), top, "on foot, on the deck's level")
  assert.equal(footZ(0, 4), top, "on foot with no level to go by: on the deck")
  assert.equal(footZ(52, 0), top, "2 m past its end: within a wheel's reach")
  assert.equal(footZ(54, 0), 100, "4 m past it: on the ground, not over the next span")
})

test("a tunnel's floor is where people walk through it, never a deck, and the terrain over it is the highest ground", () => {
  const floor = 90 - LIFT + LIFT,
    tunnel = road({ from: [-50, 0], to: [50, 0], z: [90 - LIFT, 90 - LIFT], tunnel: true })
  const { groundZ, footZ, deckNear, facingAt } = scene({ roads: [tunnel] })
  assert.equal(footZ(0, 0), floor)
  assert.equal(groundZ(0, 0), 100)
  assert.equal(groundZ(0, 0, 90.2), floor)
  assert.deepEqual(facingAt(0, 0, floor), FLAT_GROUND)
  assert.equal(deckNear(0, 0, 1), undefined, "a tunnel's floor under the hill is no deck")
  assert.equal(scene({ roads: [deckAt(104)] }).deckNear(0, 4, 1), 104 - LIFT + LIFT)
})

test("where two roads at grade cross at different profiles the ground blends them, continuous, and shows the higher ribbon on top", () => {
  const { groundZ, atGrade, drawnZ } = scene({
    terrain: () => 99,
    roads: [
      road({ from: [-30, 0], to: [30, 0], z: [100, 100] }),
      road({ from: [0, -30], to: [0, 30], z: [101, 101] }),
    ],
  })
  const mid = groundZ(0, 0)
  assert.ok(Math.abs(mid - (100.5 + LIFT)) < 1e-9, `${mid} at the crossing: the two halfway`)
  assert.ok(
    Math.abs(groundZ(10, 0) - (100 + LIFT)) < 1e-9,
    "past the other road's carriageway: its own",
  )
  assert.equal(atGrade(0, 0), mid)
  assert.equal(drawnZ(0, 0, mid), 101 + LIFT, "the higher ribbon shows over the blend")
  let step = 0
  for (let x = -10; x < 10; x += 0.01)
    step = Math.max(step, Math.abs(groundZ(x + 0.01, 1) - groundZ(x, 1)))
  assert.ok(step < 0.02, `steps of ${step} m a centimetre across the junction`)
})

test("a road at grade meeting a deck's end reaches no farther under the deck: past its end the ground there is the terrain, and a road passing under it its own; beside the deck it keeps its round end", () => {
  // An approach 6 m over the terrain along y = 0 to x = 0, a deck on from there, and a road at
  // grade 2 m wide under the deck along x = 3: both within the approach's half-width of its end.
  const approach = road({ from: [-50, 0], to: [0, 0], z: [106, 106] }),
    deck = road({ from: [0, 0], to: [50, 0], z: [106, 106], bridge: true }),
    under = road({ w: 2, from: [3, -30], to: [3, 30], z: [100, 100] })
  const { atGrade, groundZ, drawnZ } = scene({ roads: [approach, deck, under] })
  assert.equal(atGrade(-1, 2), 106 + LIFT, "on the approach behind the end")
  assert.equal(atGrade(1, 2), 100, "past the end, under the deck: the terrain")
  assert.equal(atGrade(2.5, 1), 100 + LIFT, "on the road under the deck, its own surface")
  assert.equal(groundZ(1, 0, 106), 106 + LIFT, "on the deck's level, the deck")
  assert.equal(drawnZ(1, 2, 100), 100, "no ribbon of the approach drawn past the end")
  // A road at grade ending where no deck does keeps its round end.
  assert.equal(scene({ roads: [approach] }).atGrade(1, 2), 106 + LIFT)
  // One turning 90° onto the deck at its end: past its end, under the deck the terrain, beside it
  // its round end, the outside of the bend.
  const side = road({ from: [0, -30], to: [0, 0], z: [106, 106] }),
    turn = scene({ roads: [side, deck] })
  assert.equal(turn.atGrade(2, 1), 100, "under the deck")
  assert.equal(turn.atGrade(-2, 1), 106 + LIFT, "beside the deck's end")
})

// Regression (#20): the A15's toll plaza 520616095 (lanes=6, 24 m) starts where the two-lane
// 287552094 (10 m) ends, and its round end reached 12.3 m back round that joint, over the ramp of the
// service road 100468086 climbing beside it to its bridge over the plaza at (−18205, −1690): the
// ground there blended the ramp with the plaza 2.4 m under it, and a car on the ramp drove under its
// own bridge.
test("past a joint with another road at grade, a road's surface reaches no farther than the narrower one's: a widening starts at its joint", () => {
  // A road 10 m wide along y = 0 to x = 0, and on from there one 24 m wide, over terrain at 99 m.
  const narrow = road({ w: 10, from: [-50, 0], to: [0, 0], z: [100, 100] }),
    wide = road({ w: 24, from: [0, 0], to: [50, 0], z: [100, 100] })
  const { atGrade, drawnZ } = scene({ terrain: () => 99, roads: [narrow, wide] })
  const road100 = (z: number) => Math.abs(z - (100 + LIFT)) < 1e-9
  assert.equal(atGrade(-2, 10), 99, "behind the joint beside the narrow road: the terrain")
  assert.equal(drawnZ(-2, 10, 99), 99, "and no ribbon drawn there")
  assert.ok(road100(atGrade(2, 10)), "ahead of it, the wide road's carriageway")
  assert.ok(road100(atGrade(-2, 4)), "within the narrow road's: both")
  // Where a third road meets them it is a junction, and the wide road keeps its round end there.
  const side = road({ w: 4, from: [0, 0], to: [0, -40], z: [100, 100] })
  assert.ok(road100(scene({ terrain: () => 99, roads: [narrow, wide, side] }).atGrade(-2, 10)))
})

// Regression (#20): the SS1's viaduct forks at (−15552, −6175) into its own deck 86257908, climbing
// 8.3%, and the flat tertiary 23277539, their carriageways overlapping for 11 m: a car's wheels and
// a walker on the SS1 kept to the flatter deck, the one nearer the level they had, 0.4–0.6 m under
// the SS1's.
test("decks within ON_DECK of the last level blend where they overlap, by how deep inside each the point is: at a fork each keeps to its own", () => {
  // Coming in along y = 0 on a deck at 100 m to x = 0, the SS1 on from there climbing 8%, 12 m
  // wide, and a deck 6.5 m wide forking off it flat, 18° off its line.
  const lift = ROAD_LIFT.primary
  const { rolledTo, groundZ } = scene({
    terrain: () => 90,
    roads: [
      road({ cls: "primary", w: 12, from: [-50, 0], to: [0, 0], z: [100, 100], bridge: true }),
      road({ cls: "primary", w: 12, from: [0, 0], to: [100, 0], z: [100, 108], bridge: true }),
      road({ cls: "primary", w: 6.5, from: [0, 0], to: [95, -31], z: [100, 100], bridge: true }),
    ],
  })
  for (const x of [2, 4, 6, 8, 10]) {
    const wheel = rolledTo(-10, 0, 100 + lift, x, 0),
      foot = rolledTo(-10, 0, 100 + lift, x, 0, (px, py, near) => groundZ(px, py, near, true))
    for (const [who, z] of [
      ["the wheel", wheel],
      ["the walker", foot],
    ] as const)
      assert.ok(
        Math.abs(z - (100 + 0.08 * x + lift)) < 0.25,
        `${who} at x ${x}: ${z.toFixed(2)} on the SS1's ${(100 + 0.08 * x + lift).toFixed(2)}`,
      )
  }
})

test("a platform's top along its axis is the ground on it, unless the terrain stands higher", () => {
  const platforms = [
    { rings: [[10, 10, 20, 10, 20, 20, 10, 20]], axis: [10, 15, 20, 15], top: [101, 102] },
  ]
  const { platformTop, groundZ } = scene({ platforms })
  assert.equal(platformTop(15, 15), 101.5)
  assert.equal(platformTop(25, 15), undefined)
  assert.equal(groundZ(15, 15), 101.5)
  assert.equal(scene({ terrain: () => 103, platforms }).groundZ(15, 15), 103)
})

test("a road's level is its surface at its nearest point within the halo of it, at grade never under the terrain, and none farther off", () => {
  const { roadLevel } = scene({
    roads: [
      road({ from: [-30, 0], to: [30, 0], z: [99, 99] }),
      road({ from: [-30, 50], to: [30, 50], z: [99, 99], bridge: true }),
    ],
  })
  assert.equal(roadLevel(0, 0, 10), 100 + LIFT, "at grade, over the terrain where it stands higher")
  assert.equal(roadLevel(0, 0, 31.9), 100 + LIFT)
  assert.equal(roadLevel(0, 0, 40), undefined, "40 m off: past the halo")
  assert.equal(roadLevel(1, 0, 50), 99 + LIFT, "a deck: its profile, whatever the terrain")
})

test("facingAt: the terrain triangle's unit normal where the ground is the terrain, level on a road", () => {
  // The terrain falling 10% to the north.
  const { facingAt, terrainZ } = scene({
    terrain: (_, y) => 100 - 0.1 * y,
    roads: [road({ from: [40, -30], to: [40, 30], z: [110, 110] })],
  })
  const face = facingAt(2, 1, terrainZ(2, 1)),
    length = Math.sqrt(1.01)
  assert.ok(
    face !== FLAT_GROUND &&
      Math.abs(face.north - 0.1 / length) < 1e-12 &&
      Math.abs(face.up - 1 / length) < 1e-12,
  )
  assert.deepEqual(facingAt(40, 0, 110 + LIFT), FLAT_GROUND)
})

test("rolledTo: a wheel keeps to the deck it rolls onto through a sag, where the surface nearest its ground reads the ground under the deck, and drops off the deck's side", () => {
  const { rolledTo } = scene({ roads: [deckAt(104)] })
  // An approach falling 9% east to a deck starting at x = 0 at 100 m and rising 7% from there, 8 m wide, over ground 2.6 m under it.
  const deck = (x: number) => 100 + 0.07 * x,
    sag = (x: number, y: number, near: number) =>
      x < 0
        ? 100 - 0.09 * x
        : Math.abs(y) <= 4 && Math.abs(near - deck(x)) <= Math.abs(near - deck(x) + 2.6)
          ? deck(x)
          : deck(x) - 2.6
  // From 5 m up the approach to 30 m along the deck: there the ground (99.5 m) lies nearer its start (100.45) than the deck (102.1).
  assert.equal(sag(30, 0, 100.45), deck(30) - 2.6)
  assert.equal(rolledTo(-5, 0, 100.45, 30, 0, sag), deck(30))
  // Off the deck's side the ground; back under the deck, it stays on the ground.
  assert.equal(rolledTo(10, 0, deck(10), 10, 8, sag), deck(10) - 2.6)
  assert.equal(rolledTo(10, 0, deck(10), 30, 8, sag), deck(30) - 2.6)
  assert.equal(rolledTo(10, 8, deck(10) - 2.6, 10, 0, sag), deck(10) - 2.6)
  // On the ground model's own surface: along the deck it stays on it; off its verge, down.
  assert.equal(rolledTo(-20, 0, 104, 20, 0), 104 - LIFT + LIFT)
  assert.equal(rolledTo(0, 0, 104, 0, 10), 100)
})

test("the buckets take the roads in ascending index only: another order would change the blend's bits", () => {
  const { pts, z, cls, w } = road({ from: [0, 0], to: [10, 0], z: [100, 100] })
  assert.throws(
    () => groundBuckets([1, 0].map((index) => ({ index, pts, z, cls, w }))),
    /ground: road 0 after 1/,
  )
})

test("the ground model reads no map: nothing it imports, but for types, decodes one", () => {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(file, "utf8")
    // Each import statement up to its first `from`: a type-only one loads nothing.
    for (const [, kind, path] of source.matchAll(/^import (type )?[^]*?from "([^"]+)"/gm))
      if (kind === undefined && path!.startsWith(".")) visit(resolve(dirname(file), path!))
  }
  visit(fileURLToPath(new URL("../ground-model.ts", import.meta.url)))
  const map = resolve(fileURLToPath(new URL("..", import.meta.url)))
  for (const reads of [
    "global.ts",
    "index.ts",
    "source.ts",
    "tiles.ts",
    "vectors.ts",
    "format/global-file.ts",
    "format/sections.ts",
    "format/tile-file.ts",
  ])
    assert.ok(!seen.has(resolve(map, reads)), `the model imports ${reads}`)
})

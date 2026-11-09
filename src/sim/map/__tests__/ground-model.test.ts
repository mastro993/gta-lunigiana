import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { FLAT_GROUND } from "../../sky/local.ts"
import { groundBuckets } from "../ground-model.ts"
import { ON_DECK } from "../kinds.ts"
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

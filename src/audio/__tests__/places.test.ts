import assert from "node:assert/strict"
import { test } from "node:test"

import { pointInRing } from "../../sim/collide.ts"
import { buildingsIn, heightAt, MAP, treesIn } from "../../sim/map/index.ts"
import { tileKey } from "../../sim/map/kinds.ts"
import { decodeTile } from "../../sim/map/packed.ts"
import { surfaceAt } from "../../sim/map/surface.ts"
import { SPEED_OF_SOUND } from "../acoustics.ts"
import {
  ambienceAt,
  bells,
  birdSpot,
  dogsNear,
  echoesAt,
  forestAlong,
  streetAt,
  owlsNear,
  wallAt,
} from "../places.ts"
import { fromDisk, residentMap } from "../testing.ts"

// The whole map in memory, as around the player in the game: every place is worked out from the exact map.
residentMap()

/** A small deterministic random source, so the checks never flake. */
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
const FOREST = { x: 500, y: -400 },
  MEADOW = { x: -329, y: 1078 },
  GRAGNOLA = { x: -1751.2, y: 3360.4 },
  EQUI = { x: 1804.9, y: 721 }
/** 0.15 m off a drive wall in a quarry, with no trunk or building within 3 m and no barrier within 20 m: a cut face. */
const QUARRY_FACE = { x: -2480, y: -5923.85 }

test("walls: a tree trunk, buildings by kind and style, the guard rail, the stone wall and a cliff, each 0.3 m off; bare ground is earth, a quarry's bank rock", () => {
  /** 0.3 m off the middle of the longest edge of `pts`, on its right (outside a counter-clockwise ring). */
  const beside = (pts: ReadonlyArray<number>, closed: boolean) => {
    let best = { x: 0, y: 0, length: 0 }
    for (let i = closed ? 0 : 2, n = pts.length, j = closed ? n - 2 : 0; i < n; j = i, i += 2) {
      const ex = pts[i]! - pts[j]!,
        ey = pts[i + 1]! - pts[j + 1]!,
        length = Math.hypot(ex, ey)
      if (length > best.length)
        best = {
          x: (pts[i]! + pts[j]!) / 2 + (0.3 * ey) / length,
          y: (pts[i + 1]! + pts[j + 1]!) / 2 - (0.3 * ex) / length,
          length,
        }
    }
    return best
  }
  const buildings = [
    ["house", "stone", "stone"],
    ["house", "plaster", "masonry"],
    ["church", "church", "stone"],
    ["ruins", "ruin", "stone"],
    ["greenhouse", "industrial", "glass"],
    ["industrial", "industrial", "sheet"],
    ["substation", "industrial", "sheet"],
  ] as const
  for (const [kind, style, expected] of buildings) {
    const at = beside(MAP.buildings.find((b) => b.kind === kind && b.style === style)!.outer, true)
    assert.equal(wallAt(at.x, at.y), expected, `${kind}/${style}`)
  }
  for (const [kind, expected] of [
    ["guard_rail", "rail"],
    ["wall", "stone"],
    ["cliff", "rock"],
  ] as const) {
    const at = beside(MAP.barriers.find((b) => b.kind === kind)!.pts, false)
    assert.equal(wallAt(at.x, at.y), expected, kind)
  }
  let trunk: { readonly x: number; readonly y: number } | undefined
  treesIn(
    FOREST.x - 5,
    FOREST.y - 5,
    FOREST.x + 5,
    FOREST.y + 5,
    (x, y) => void (trunk ??= { x, y }),
  )
  assert.ok(trunk !== undefined, "a tree in the forest")
  assert.equal(wallAt(trunk.x + 0.55, trunk.y), "tree")
  assert.equal(wallAt(MEADOW.x, MEADOW.y), "earth")
  assert.equal(wallAt(QUARRY_FACE.x, QUARRY_FACE.y), "rock")
})

test("walls: the nearest source wins, a trunk by a house wall is the trunk; a bank is earth though trees stand 1.5–3 m off it", () => {
  const outside = (x: number, y: number) => {
    let free = true
    buildingsIn(x, y, x, y, (i) => void (free &&= !pointInRing(x, y, MAP.buildings[i]!.outer)))
    return free
  }
  // A trunk 1–2.5 m from a rendered house's wall: 0.3 m off the trunk on its far side is the tree, 0.3 m off the wall the house.
  let pair:
    | {
        readonly tree: { readonly x: number; readonly y: number }
        readonly wall: {
          readonly x: number
          readonly y: number
          readonly nx: number
          readonly ny: number
        }
      }
    | undefined
  for (const b of MAP.buildings) {
    if (pair !== undefined || b.kind !== "house" || b.style !== "plaster") continue
    const pts = b.outer
    // oxlint-disable-next-line no-unmodified-loop-condition -- the treesIn callback sets pair
    for (let i = 0, j = pts.length - 2; i < pts.length && pair === undefined; j = i, i += 2) {
      const ex = pts[i]! - pts[j]!,
        ey = pts[i + 1]! - pts[j + 1]!,
        length = Math.hypot(ex, ey)
      if (length < 4) continue
      const x = (pts[i]! + pts[j]!) / 2,
        y = (pts[i + 1]! + pts[j + 1]!) / 2,
        nx = ey / length,
        ny = -ex / length
      treesIn(x - 3, y - 3, x + 3, y + 3, (tx, ty) => {
        const d = (tx - x) * nx + (ty - y) * ny,
          off = Math.abs((tx - x) * ny - (ty - y) * nx)
        if (
          pair === undefined &&
          d > 1.2 &&
          d < 2.5 &&
          off < 0.5 &&
          outside(tx + 0.6 * nx, ty + 0.6 * ny)
        )
          pair = { tree: { x: tx, y: ty }, wall: { x, y, nx, ny } }
      })
    }
  }
  assert.ok(pair !== undefined, "a trunk by a house wall")
  const { tree, wall } = pair
  assert.equal(wallAt(wall.x + 0.3 * wall.nx, wall.y + 0.3 * wall.ny), "masonry")
  assert.equal(wallAt(tree.x + 0.55 * wall.nx, tree.y + 0.55 * wall.ny), "tree")
  // A steep bank (a drive wall that is no building and no barrier) with a trunk 1.5–3 m from the contact point and nothing else within 3 m.
  let bank: { readonly x: number; readonly y: number } | undefined
  for (let tile = 0; tile < MAP.tiles.length && bank === undefined; tile++) {
    const { i, j } = MAP.tiles[tile]!
    bank = wildBank(decodeTile(fromDisk(tileKey(i, j))).walls.drive)
  }
  assert.ok(bank !== undefined, "a wooded bank")
  assert.equal(wallAt(bank.x, bank.y), "earth")
})

/** 0.15 m off a drive wall of `walls` (flat segments) that is no building and no barrier, with a trunk 1.5–3 m off and nothing else within 3 m. */
const wildBank = (walls: ArrayLike<number>) => {
  let bank: { readonly x: number; readonly y: number } | undefined
  for (let s = 0; s + 3 < walls.length && bank === undefined; s += 4) {
    const ax = walls[s]!,
      ay = walls[s + 1]!,
      bx = walls[s + 2]!,
      by = walls[s + 3]!,
      length = Math.hypot(bx - ax, by - ay)
    if (length < 2) continue
    for (const side of [1, -1]) {
      const x = (ax + bx) / 2 + (side * 0.15 * (by - ay)) / length,
        y = (ay + by) / 2 - (side * 0.15 * (bx - ax)) / length
      let nearest = Infinity,
        built = false
      treesIn(x - 3, y - 3, x + 3, y + 3, (tx, ty) => {
        nearest = Math.min(nearest, Math.hypot(tx - x, ty - y))
      })
      buildingsIn(x - 3, y - 3, x + 3, y + 3, () => void (built = true))
      if (
        nearest > 1.5 &&
        nearest < 3 &&
        !built &&
        MAP.barriers.every((b) =>
          b.pts.every((_, k) => k % 2 === 1 || Math.hypot(b.pts[k]! - x, b.pts[k + 1]! - y) > 20),
        )
      )
        bank ??= { x, y }
    }
  }
  return bank
}

test("ambience shares stay within 1 and tell the forest, the meadow and the village apart", () => {
  for (let x = MAP.bounds.minX; x <= MAP.bounds.maxX; x += 97)
    for (let y = MAP.bounds.minY; y <= MAP.bounds.maxY; y += 89) {
      const { forest, open, built } = ambienceAt(x, y)
      assert.ok(
        Math.min(forest, open, built) >= 0 && forest + open + built <= 1 + 1e-6,
        `${x}, ${y}`,
      )
    }
  assert.ok(ambienceAt(FOREST.x, FOREST.y).forest > 0.9)
  assert.ok(ambienceAt(MEADOW.x, MEADOW.y).open > 0.9)
  assert.ok(ambienceAt(GRAGNOLA.x, GRAGNOLA.y).built > 0.9)
})

test("streets: Gragnola's centre is enclosed, a meadow is open; the forest lines a path through it", () => {
  assert.ok(streetAt(GRAGNOLA.x, GRAGNOLA.y) > 0.5)
  assert.equal(streetAt(MEADOW.x, MEADOW.y), 0)
  assert.ok(Math.abs(forestAlong(FOREST.x, FOREST.y, FOREST.x + 40, FOREST.y) - 40) < 1e-9)
  assert.equal(forestAlong(MEADOW.x, MEADOW.y, MEADOW.x + 40, MEADOW.y), 0)
})

test("echoes at Equi Terme come off the rock faces around it, finite and in range, 10 dB lost on the rock; none on the open meadow or off slopes short of rock", () => {
  const echoes = echoesAt(EQUI.x, EQUI.y)
  assert.ok(echoes.length > 0 && echoes.length <= 2)
  for (const { delay, loss, dx, dy } of echoes) {
    assert.ok(delay >= 80 / SPEED_OF_SOUND && delay <= 800 / SPEED_OF_SOUND, `${delay} s`)
    assert.ok(
      Number.isFinite(loss) && loss >= 20 * Math.log10(SPEED_OF_SOUND * delay) + 10,
      `${loss} dB`,
    )
    // The way out to the face and back.
    assert.ok(Math.abs(2 * Math.hypot(dx, dy) - SPEED_OF_SOUND * delay) < 1e-6, `${dx}, ${dy}`)
  }
  assert.deepEqual(echoesAt(MEADOW.x, MEADOW.y), [])
  // Monzone's streets, every 12.5 m: where no slope in sight climbs as steeply as bare rock (50°), nothing echoes, steep or not.
  let checked = 0
  for (let x = -700; x <= -200; x += 12.5)
    for (let y = 300; y <= 600; y += 12.5) {
      if (surfaceAt(x, y) !== "asphalt") continue
      let steepest = 0
      for (let k = 0; k < 16; k++) {
        const ux = Math.cos((k * Math.PI) / 8),
          uy = Math.sin((k * Math.PI) / 8)
        for (let d = 8, before = heightAt(x, y); d <= 400; d += 8) {
          const z = heightAt(x + ux * d, y + uy * d)
          steepest = Math.max(steepest, (z - before) / 8)
          before = z
        }
      }
      if (steepest >= 1.19) continue
      checked++
      assert.deepEqual(echoesAt(x, y), [], `${x}, ${y}`)
    }
  assert.ok(checked >= 3, `${checked} streets short of rock`)
})

test("one bell per settlement, lower in taller towers", () => {
  assert.ok(bells.length >= 8)
  assert.equal(new Set(bells.map((b) => b.key)).size, bells.length)
  for (const b of bells) assert.ok(b.pitch >= 400 && b.pitch <= 800, b.key)
  // Monzone Alto's 30 m church tower hangs the deepest bell.
  const alto = bells.find((b) => Math.hypot(b.x - 6, b.y + 326) < 5)
  assert.ok(alto?.pitch === 400 && alto.z > 325)
})

test("dogs and owls are stable picks out in the farms and the woods, near ones those of the whole map in its order; birds sing from a nearby tree, never on a treeless meadow", () => {
  const within = (r: number) => (p: { readonly x: number; readonly y: number }) =>
    Math.hypot(p.x + 400, p.y - 400) <= r
  const dogs = dogsNear(0, 0, 1e6),
    owls = owlsNear(0, 0, 1e6)
  assert.ok(dogs.length > 50 && owls.length > 100, `${dogs.length} dogs, ${owls.length} owls`)
  assert.deepEqual(dogsNear(0, 0, 1e6), dogs)
  assert.deepEqual(dogsNear(-400, 400, 300), dogs.filter(within(300)))
  assert.deepEqual(owlsNear(-400, 400, 600), owls.filter(within(600)))
  const random = seeded(3)
  for (let k = 0; k < 20; k++) {
    const spot = birdSpot(FOREST.x, FOREST.y, random)
    assert.ok(spot !== undefined)
    const d = Math.hypot(spot.x - FOREST.x, spot.y - FOREST.y)
    assert.ok(d >= 15 && d <= 70, `${d} m`)
  }
  assert.equal(birdSpot(MEADOW.x, MEADOW.y, random), undefined)
})

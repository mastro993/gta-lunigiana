import assert from "node:assert/strict"
import { test } from "node:test"

import { coarseCoverAt, coarseHeightAt } from "../../sim/map/coarse.ts"
import { coverAt } from "../../sim/map/cover.ts"
import { groundZ } from "../../sim/map/ground.ts"
import { heightAt, MAP } from "../../sim/map/index.ts"
import { tileKey } from "../../sim/map/kinds.ts"
import { dropTile, setTileSource, tilesOver } from "../../sim/map/tiles.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { EAR_HEIGHT } from "../acoustics.ts"
import { at as clock, rig, SPAWN, world } from "../director/testing.ts"
import { groundAt, landAt, terrainAt } from "../ground.ts"
import { skyAt } from "../index.ts"
import { pathDifference } from "../occlusion.ts"
import {
  ambienceAt,
  bells,
  dogsNear,
  echoesAt,
  forestAlong,
  owlsNear,
  streetAt,
} from "../places.ts"
import { fromDisk, residentMap } from "../testing.ts"

/** What the game holds around the listener at `SPAWN`: the tiles within 1.2 km (past every owl square in earshot); the rest are let go. */
const HELD = new Set(tilesOver(SPAWN.x - 1200, SPAWN.y - 1200, SPAWN.x + 1200, SPAWN.y + 1200))
const LET_GO = MAP.tiles.map(({ i, j }) => tileKey(i, j)).filter((key) => !HELD.has(key))
const gone = (p: { readonly x: number; readonly y: number }) =>
  !tilesOver(p.x, p.y, p.x, p.y).some((key) => HELD.has(key))
/** Bell towers on the tiles let go (the first 5.3 km off), a level crossing 3.1 km off and a strike 4.8 km off. */
const TOWERS = bells.filter(gone),
  CROSSING = CROSSINGS.findIndex(gone),
  STRIKE = { x: 3000, y: -3000 }
const EARS = { ...SPAWN, z: groundZ(SPAWN.x, SPAWN.y) + EAR_HEIGHT },
  /** A source 300 m along the valley, on a held tile. */
  NEAR = { x: SPAWN.x + 300, y: SPAWN.y - 120, z: heightAt(SPAWN.x + 300, SPAWN.y - 120) + 1 }

/** What the listener hears of the map that is measured afresh on every ask. */
const measured = () => ({
  street: streetAt(SPAWN.x, SPAWN.y),
  echoes: echoesAt(SPAWN.x, SPAWN.y),
  delta: pathDifference(EARS, NEAR),
  forest: forestAlong(EARS.x, EARS.y, NEAR.x, NEAR.y),
  ground: [terrainAt(SPAWN.x, SPAWN.y), groundAt(SPAWN.x, SPAWN.y), landAt(SPAWN.x, SPAWN.y)],
})

/** The loudest bell strokes (the nearest tower's) heard at `SPAWN` over the 09:00 ring: when each arrives, how loud, how pitched. */
const ring = () => {
  const director = rig()
  director.hear(world(SPAWN, { sky: skyAt(clock(9)) }), 15 * 60)
  const strokes = director.take("bell"),
    loudest = Math.max(...strokes.map((p) => p.at.gain))
  return strokes
    .filter((p) => p.at.gain === loudest)
    .map((p) => ({ t: p.t + p.delay, gain: p.at.gain, sound: p.sound }))
}

/**
 * A 32 m ambience block near (x, y) on the woods' edge (some of its cells forest, not all): its centre,
 * where its own shares are heard unblended, and its forest share counted cell by cell.
 */
const edgeBlock = (x: number, y: number) => {
  const { cell, x0, y0 } = MAP.heightmap,
    side = 8 * cell,
    bi = Math.floor((x - x0) / side),
    bj = Math.floor((y - y0) / side)
  for (let j = bj - 20; j <= bj + 20; j++)
    for (let i = bi - 20; i <= bi + 20; i++) {
      let forest = 0
      for (let k = 0; k < 64; k++) {
        const cover = coverAt(
          x0 + (8 * i + (k % 8) + 0.5) * cell,
          y0 + (8 * j + Math.floor(k / 8) + 0.5) * cell,
        )
        if (cover === "forest") forest++
      }
      if (forest > 0 && forest < 64)
        return {
          x: x0 + (i + 0.5) * side,
          y: y0 + (j + 0.5) * side,
          forest: Math.fround(forest / 64),
        }
    }
  throw new Error(`no woods' edge near ${x}, ${y}`)
}

test("far sources (bells km off, a crossing, a strike) read no tile out of memory, and the listener's surroundings are the whole map's", () => {
  assert.ok(TOWERS.length >= 10 && CROSSING >= 0, `${TOWERS.length} towers, crossing ${CROSSING}`)
  const tower = TOWERS[0]!,
    before = measured(),
    village = edgeBlock(SPAWN.x, SPAWN.y),
    far = edgeBlock(tower.x, tower.y)
  setTileSource(undefined)
  for (const key of LET_GO) dropTile(key)
  let held
  try {
    const [key] = tilesOver(tower.x, tower.y, tower.x, tower.y)
    assert.throws(() => heightAt(tower.x, tower.y), new RegExp(`map tile ${key} not loaded`))
    assert.equal(terrainAt(tower.x, tower.y), coarseHeightAt(tower.x, tower.y))
    assert.equal(groundAt(tower.x, tower.y), coarseHeightAt(tower.x, tower.y))
    assert.equal(landAt(tower.x, tower.y), coarseCoverAt(tower.x, tower.y))
    for (const bell of TOWERS) {
      const delta = pathDifference(EARS, bell),
        forest = forestAlong(EARS.x, EARS.y, bell.x, bell.y)
      assert.ok(Number.isFinite(delta) && delta >= 0 && forest >= 0, `${bell.key}: ${delta} m`)
    }
    // Off the tiles in memory an ambience block is the coarse cover's at its centre: all one kind, or none.
    const stand = ambienceAt(far.x, far.y)
    assert.ok(
      [stand.forest, stand.open, stand.built].every((share) => share === 0 || share === 1),
      JSON.stringify(stand),
    )
    // The director's far reads: the ground under a strike and a ringing crossing, the ways to every tower at the hour.
    const storm = rig()
    const crossing = { id: CROSSING, x: CROSSINGS[CROSSING]!.x, y: CROSSINGS[CROSSING]!.y }
    storm.hear(
      world(SPAWN, {
        happenings: [{ kind: "lightning", ...STRIKE, bolt: true, power: 1, seed: 3 }],
        crossings: [{ ...crossing, posts: 5, ringing: true }],
      }),
    )
    storm.hear(world(SPAWN), 20 * 60)
    assert.ok(storm.take("thunder").length > 0, "the thunder arrives")
    held = {
      ...measured(),
      dogs: dogsNear(SPAWN.x, SPAWN.y, 200),
      owls: owlsNear(SPAWN.x, SPAWN.y, 600),
      village: ambienceAt(village.x, village.y).forest,
      ring: ring(),
    }
  } finally {
    setTileSource(fromDisk)
  }
  residentMap()
  const { dogs, owls, ring: rung, village: woods, ...rest } = held
  assert.deepEqual(rest, before)
  const within = (r: number) => (p: { readonly x: number; readonly y: number }) =>
    Math.hypot(p.x - SPAWN.x, p.y - SPAWN.y) <= r
  assert.ok(dogs.length > 0 && owls.length > 0 && rung.length > 0)
  assert.deepEqual(dogs, dogsNear(0, 0, 1e6).filter(within(200)))
  assert.deepEqual(owls, owlsNear(0, 0, 1e6).filter(within(600)))
  assert.deepEqual(rung, ring())
  assert.equal(woods, village.forest)
  // Back in memory, the far block is its own cells': the coarse stand-in was not kept.
  assert.equal(ambienceAt(far.x, far.y).forest, far.forest)
})

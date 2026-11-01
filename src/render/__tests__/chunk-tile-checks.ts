// The checks chunk-tiles.test.ts (the tiles and spots round Monzone) and chunk-tiles.map-test.ts
// (every tile and chunk, every spot on the map where a build reads past its square) share: the
// streaming plan's tiles and chunks, and with only some of the tiles a world wants in memory,
// every chunk that builds reading only those, its vectors too.
import assert from "node:assert/strict"

import { Group, InstancedMesh, type Mesh, Vector3 } from "three"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, isResident, provideTile, setTileSource } from "../../sim/map/tiles.ts"
import type { chunkTiles } from "../chunk-tiles.ts"
import { terrainY } from "../ground.ts"
import { streamAround } from "../testing.ts"
import { World } from "../world.ts"

/**
 * Checks `plan` over `tiles` (indices into `MAP.tiles`) and `chunks` (keys, the chunks whose
 * middle the tiles hold): the tiles plan those chunks, each once and in a box round its own; each
 * lies on the tiles, and its base holds its terrain's tiles, each of which lists it.
 */
export const checkPlan = (
  plan: ReturnType<typeof chunkTiles>,
  tiles: ReadonlyArray<number>,
  chunks: ReadonlyArray<number>,
): void => {
  const planned = new Map<number, number>()
  for (const t of tiles)
    for (const key of plan.owned[t]!) {
      assert.equal(planned.get(key), undefined, `chunk ${key} planned twice`)
      planned.set(key, t)
      for (let k = 0; k < 6; k++)
        assert.ok(
          k % 2 === 0
            ? plan.tileBoxes[t * 6 + k]! <= plan.boxes[key * 6 + k]!
            : plan.tileBoxes[t * 6 + k]! >= plan.boxes[key * 6 + k]!,
          `tile ${plan.keys[t]} holds chunk ${key}`,
        )
    }
  assert.equal(planned.size, chunks.length, "the tiles plan as many chunks as they hold")
  for (const key of chunks) {
    assert.ok(planned.has(key), `chunk ${key} planned`)
    assert.ok(plan.terrain[key]!.length > 0, `chunk ${key} lies on the tiles`)
    for (const t of plan.terrain[key]!) assert.ok(plan.base[key]!.includes(t))
    for (const t of plan.base[key]!) assert.ok(plan.bases[t]!.includes(key))
  }
}

/** A built chunk's meshes as their vertices (a tree mesh's instances). */
const shapeOf = (meshes: ReadonlyArray<Mesh> | undefined) =>
  meshes?.map((m) =>
    m instanceof InstancedMesh ? m.instanceMatrix.array : m.geometry.getAttribute("position").array,
  )

/**
 * Builds a world round each spot that wants two tiles or more (with no tile in, then once every
 * tile it asks for is in) with each of those tiles alone, then with all but each one, the tile
 * source off (a read of any other tile throws): every chunk that builds is the one a world with
 * every tile in builds, so its pieces too came whole from the tiles in. Returns how many chunks
 * built.
 */
export const buildsWithSomeTiles = (spots: ReadonlyArray<readonly [number, number]>): number => {
  const disk = (key: string) => readMapFile(tileUrl(MAP.name, key))
  let built = 0
  try {
    for (const [x, y] of spots) {
      const focus = new Vector3(x, terrainY(x, y), -y),
        probe = new World(new Group())
      probe.update(focus, 0, 60, Infinity)
      const first = [...probe.wanted()]
      streamAround(probe, focus)
      const wanted = [...new Set([...first, ...probe.wanted()])]
      if (wanted.length < 2) continue
      for (const some of [
        ...wanted.map((key) => [key]),
        ...wanted.map((out) => wanted.filter((key) => key !== out)),
      ]) {
        setTileSource(undefined)
        for (const { i, j } of MAP.tiles) dropTile(`${i}_${j}`)
        for (const key of some) provideTile(disk(key))
        const world = new World(new Group())
        for (const key of some) world.tileProvided(key)
        world.update(focus, 0, 60, Infinity)
        built += world.loaded.size
        for (const [key, meshes] of world.loaded)
          assert.deepEqual(shapeOf(meshes), shapeOf(probe.loaded.get(key)), `chunk ${key}`)
        assert.ok(wanted.every((key) => some.includes(key) === isResident(key)))
        setTileSource(disk)
      }
    }
  } finally {
    setTileSource(disk)
  }
  return built
}

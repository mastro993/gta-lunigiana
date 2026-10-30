// The check chunk-tiles.test.ts (a few spots near Monzone) and chunk-tiles.map-test.ts (every
// spot on the map where a build reads past its square) share: with only some of the tiles a world
// wants in memory, every chunk that builds reads only those.
import assert from "node:assert/strict"

import { Group, Vector3 } from "three"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, isResident, provideTile, setTileSource } from "../../sim/map/tiles.ts"
import { terrainY } from "../ground.ts"
import { World } from "../world.ts"

/**
 * Builds a world round each spot that wants two tiles or more with each of its tiles alone, then
 * with all but each one, the tile source off (a read of any other tile throws); returns how many
 * chunks built.
 */
export const buildsWithSomeTiles = (spots: ReadonlyArray<readonly [number, number]>): number => {
  const disk = (key: string) => readMapFile(tileUrl(MAP.name, key))
  let built = 0
  try {
    for (const [x, y] of spots) {
      const focus = new Vector3(x, terrainY(x, y), -y),
        probe = new World(new Group())
      probe.update(focus, 0, 60, Infinity)
      const wanted = [...probe.wanted()]
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
        assert.ok(wanted.every((key) => some.includes(key) === isResident(key)))
        setTileSource(disk)
      }
    }
  } finally {
    setTileSource(disk)
  }
  return built
}

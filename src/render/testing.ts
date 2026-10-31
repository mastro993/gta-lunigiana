/**
 * Test helpers for the render tests.
 *
 * @module render/testing
 */
import { Mesh, type Object3D, type Vector3 } from "three"

import { MAP } from "../sim/map/index.ts"
import { readMapFile, tileUrl } from "../sim/map/packed.ts"
import { isResident, provideTile, tilesOver } from "../sim/map/tiles.ts"
import { DRAW_ORDER } from "./order.ts"
import type { World } from "./world.ts"

/** The x-ray proxy an actor shows now, if any: its one visible child drawn after the world (`DRAW_ORDER.xray`). */
export const shownProxy = (node: Object3D): Mesh | undefined =>
  node.children.find(
    (c): c is Mesh => c instanceof Mesh && c.visible && c.renderOrder === DRAW_ORDER.xray,
  )

/**
 * Streams `world` round `focus` as the host does once every tile it asks for is in: hands it the
 * tiles its chunks in reach read (`wanted`; in Node a lookup reads them from disk) and builds every
 * chunk in reach.
 */
export const streamAround = (world: World, focus: Vector3, yaw = 0, reach = 60): void => {
  world.update(focus, yaw, reach, Infinity)
  for (const key of world.wanted()) world.tileProvided(key)
  world.update(focus, yaw, reach, Infinity)
}

/**
 * Takes into memory, from disk, every listed tile within `reach` m (along either axis) of any of
 * `spots`. In Node a lookup reads a missing tile itself, but the host reads that fall back to the
 * coarse grid where a tile is out (`farTerrainY`) and the level crossings' placing ask first, so a
 * test of them names the spots it reads round; never the whole map, so its cost does not grow with
 * the map.
 */
export const residentAround = (
  spots: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  reach: number,
): void => {
  for (const { x, y } of spots)
    for (const key of tilesOver(x - reach, y - reach, x + reach, y + reach))
      if (!isResident(key)) provideTile(readMapFile(tileUrl(MAP.name, key)))
}

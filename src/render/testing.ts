/**
 * Test helpers for the render tests.
 *
 * @module render/testing
 */
import { Mesh, type Object3D, type Vector3 } from "three"

import { MAP } from "../sim/map/index.ts"
import { tileKey } from "../sim/map/kinds.ts"
import { readMapFile, tileUrl } from "../sim/map/packed.ts"
import { isResident, provideTile } from "../sim/map/tiles.ts"
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
 * Takes every tile of the map into memory from disk. In Node a lookup reads a missing tile itself,
 * but the host reads that fall back to the coarse grid where a tile is out (`farTerrainY`) and the
 * level crossings' placing ask first, so a test of them takes the tiles in.
 */
export const everyTileIn = (): void => {
  for (const { i, j } of MAP.tiles)
    if (!isResident(tileKey(i, j))) provideTile(readMapFile(tileUrl(MAP.name, tileKey(i, j))))
}

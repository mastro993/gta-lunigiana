/**
 * Test helpers for the render tests.
 *
 * @module render/testing
 */
import { Mesh, type Object3D, type Vector3 } from "three"

import { type Building, MAP, type Road, type Water } from "../sim/map/index.ts"
import { type Layer, readMapFile, tileUrl } from "../sim/map/packed.ts"
import { isResident, provideTile, tilesOver, tileVectors } from "../sim/map/tiles.ts"
import { DRAW_ORDER } from "./order.ts"
import type { World } from "./world.ts"

/** The x-ray proxy an actor shows now, if any: its one visible child drawn after the world (`DRAW_ORDER.xray`). */
export const shownProxy = (node: Object3D): Mesh | undefined =>
  node.children.find(
    (c): c is Mesh => c instanceof Mesh && c.visible && c.renderOrder === DRAW_ORDER.xray,
  )

/**
 * Streams `world` round `focus` as the host does once every tile it asks for is in: hands it the
 * tiles its chunks in reach read (`wanted`; in Node a lookup reads them from disk) until it asks
 * for no other (once a chunk's base is in, it wants what its pieces read too), and builds every
 * chunk in reach.
 */
export const streamAround = (world: World, focus: Vector3, yaw = 0, reach = 60): void => {
  const given = new Set<string>()
  for (;;) {
    world.update(focus, yaw, reach, Infinity)
    const more = [...world.wanted()].filter((key) => !given.has(key))
    if (more.length === 0) return
    for (const key of more) {
      world.tileProvided(key)
      given.add(key)
    }
  }
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

/** Some of the whole map's roads (their attributes and lines), buildings and rivers: each by its index in the whole map's list, ascending. */
export interface Vectors {
  readonly roads: Layer<Road>
  readonly buildings: Layer<Building>
  readonly water: Layer<Water>
}

/** The features of `layers`, each once, by index (`ids`) ascending. */
const merged = <T>(layers: ReadonlyArray<Layer<T>>): Layer<T> => {
  const byId = new Map<number, T>()
  for (const { ids, items } of layers) ids.forEach((id, k) => byId.set(id, items[k]!))
  const ids = [...byId.keys()].sort((a, b) => a - b)
  return { ids, items: ids.map((id) => byId.get(id)!) }
}

/**
 * The roads, buildings and rivers the tiles within `reach` m (along either axis) of any of `spots`
 * hold (in Node read from disk), each once, in the whole map's order: among them every one with a
 * segment, or a building's box, that near, so a search of them for the first that fits there finds
 * the whole map's first. Never the whole map, so a test's cost does not grow with it.
 */
export const vectorsAround = (
  spots: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  reach: number,
): Vectors => {
  const keys = new Set(
    spots.flatMap(({ x, y }) => tilesOver(x - reach, y - reach, x + reach, y + reach)),
  )
  const tiles = [...keys].map(tileVectors),
    roads = merged(tiles.map((v) => v.roads))
  return {
    roads: {
      ids: roads.ids,
      items: roads.items.map((line, k) => ({ ...MAP.roads[roads.ids[k]!]!, ...line })),
    },
    buildings: merged(tiles.map((v) => v.buildings)),
    water: merged(tiles.map((v) => v.water)),
  }
}

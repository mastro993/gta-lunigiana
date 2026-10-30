/**
 * Test kit for the audio's map reads: the tiles round the spots a test listens at in memory, as the
 * game holds the tiles around the player, so a test hears the exact map there (`./ground.ts` and
 * the lazy places fall back or wait only off the tiles in memory). A test names its spots, never
 * the whole map, so its cost does not grow with the map.
 *
 * @module audio/testing
 */
import { MAP } from "../sim/map/index.ts"
import { readMapFile, tileUrl } from "../sim/map/packed.ts"
import { isResident, provideTile, tilesOver } from "../sim/map/tiles.ts"

/** Tile `key`'s file read from disk, as Node's tile source reads it. */
export const fromDisk = (key: string): Uint8Array => readMapFile(tileUrl(MAP.name, key))

/** How far round a listener a test holds the tiles, m: past every owl square in earshot. */
export const HELD = 1200

/** Puts in memory every listed tile within `reach` m (along either axis) of any of `spots`. */
export const residentAround = (
  spots: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  reach: number,
): void => {
  for (const { x, y } of spots)
    for (const key of tilesOver(x - reach, y - reach, x + reach, y + reach))
      if (!isResident(key)) provideTile(fromDisk(key))
}

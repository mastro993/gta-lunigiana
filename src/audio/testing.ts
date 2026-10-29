/**
 * Test kit for the audio's map reads: the whole map in memory, as the game holds the tiles around the
 * player, so a test hears the exact map wherever it listens (`./ground.ts` and the lazy places fall
 * back or wait only off the tiles in memory).
 *
 * @module audio/testing
 */
import { MAP } from "../sim/map/index.ts"
import { tileKey } from "../sim/map/kinds.ts"
import { readMapFile, tileUrl } from "../sim/map/packed.ts"
import { isResident, provideTile } from "../sim/map/tiles.ts"

/** Tile `key`'s file read from disk, as Node's tile source reads it. */
export const fromDisk = (key: string): Uint8Array => readMapFile(tileUrl(MAP.name, key))

/** Puts every tile of the map in memory (≈ 100 ms in Node). */
export const residentMap = (): void => {
  for (const { i, j } of MAP.tiles)
    if (!isResident(tileKey(i, j))) provideTile(fromDisk(tileKey(i, j)))
}

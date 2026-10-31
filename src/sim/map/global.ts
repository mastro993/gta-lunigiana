/**
 * The global map file, decoded once when this module loads: everything sparse and topological (the
 * roads' attributes, the graph, the railway, the tile list, the baked tables; the vectors are in the
 * tiles). `./tiles.ts` and `./index.ts` both read it, so it lives apart from either. Game code
 * imports `MAP` through `./index.ts`.
 *
 * @module map/global
 */
import { providePlace } from "../sky/place.ts"
import type { MonzoneMap } from "./index.ts"
import { HALO } from "./kinds.ts"
import { decodeMap, mapFile } from "./packed.ts"

/** The global map, as generated (`pnpm map`). */
export const MAP: MonzoneMap = decodeMap(mapFile())
// The tiles hold the vectors within the halo of their squares: cut with another halo, a lookup at a
// point could miss a road or a river beside it, and answer wrongly rather than fail.
if (MAP.vectors.halo !== HALO)
  throw new Error(
    `map: the map's tiles were cut with a ${MAP.vectors.halo} m halo, the game reads ${HALO} m; run pnpm maps`,
  )
// The sky reads the map's place (its origin, low ground and slope) without decoding the map.
providePlace({ ...MAP.origin, ...MAP.place })

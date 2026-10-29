/**
 * The global map file, decoded once when this module loads: everything sparse and topological (the
 * vectors, the graph, the railway, the tile list, the baked tables). `./tiles.ts` and `./index.ts`
 * both read it, so it lives apart from either. Game code imports `MAP` through `./index.ts`.
 *
 * @module map/global
 */
import { providePlace } from "../sky/place.ts"
import type { MonzoneMap } from "./index.ts"
import { decodeMap, mapFile } from "./packed.ts"

/** The global map, as generated (`pnpm map`). */
export const MAP: MonzoneMap = decodeMap(mapFile())
// The sky reads the map's place (its origin, low ground and slope) without decoding the map.
providePlace({ ...MAP.origin, ...MAP.place })

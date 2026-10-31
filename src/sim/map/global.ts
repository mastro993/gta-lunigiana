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
// A file built before the play area's outline (issue #7) is still version 3 and decodes, but the
// game reads its outline (and its Carabinieri's spawn) everywhere: name the fix rather than fail on
// the first teleport, bolt or herd.
if (!("outline" in MAP))
  throw new Error(
    "map: the global map file was built before its play area's outline; run pnpm maps",
  )
// The sky reads the map's place (its origin, low ground and slope) without decoding the map.
providePlace({ ...MAP.origin, ...MAP.place })

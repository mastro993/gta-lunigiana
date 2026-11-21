// Reads a build of the format version before today's as one of today's, so `pnpm map-diff`
// compares the build before a format change with one after it (docs/standards/map.md). It reads
// version 6, whose global file's line held the parked spots, the farms, their centres and the lamps,
// and whose tiles' lines held their vectors' coordinates. The change to version 8 replaces it with a
// reader of version 7. It is the one place outside src/sim/map/format/ that writes a line's counts
// (`relined`): it lives for one version, and the codec's own decoder checks what it reads.
import { decodeMap, type MonzoneMapJson } from "../sim/map/format/global-file.ts"
import { MAP_VERSION, relined } from "../sim/map/format/sections.ts"
import { decodeTile, type TileData } from "../sim/map/format/tile-file.ts"
import type { MonzoneMap } from "../sim/map/index.ts"
import { NO_VECTORS } from "./tile-vectors.ts"

/** The version before today's, which `decodeUpgraded` reads too. */
const BEFORE = 6

/** A file's JSON line, of any version. */
const rawLine = (file: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(file.subarray(0, file.indexOf(10))))

/** The JSON line of a version-6 global file: what reading it as today's needs. */
type OldLine = { readonly version?: unknown } & Pick<MonzoneMap, "spawns" | "farms" | "lamps"> & {
    readonly derived: Omit<MonzoneMapJson["derived"], "farms"> & {
      readonly farms: MonzoneMap["derived"]["farms"]
    }
  }

/**
 * The global map of a global file of today's version or the one before, and the decoder of that
 * build's tiles: a version-6 file decodes as one whose parked spots, farms, farm centres and lamps
 * are none, and they come from its line; a version-6 tile decodes as one with no vectors, and they
 * come from its line.
 */
export const decodeUpgraded = (
  file: Uint8Array,
): { readonly global: MonzoneMap; readonly decodeTile: (file: Uint8Array) => TileData } => {
  const line = rawLine(file) as OldLine
  if (line.version !== BEFORE) return { global: decodeMap(file), decodeTile }
  const { spawns, farms, lamps, derived } = line
  const global = decodeMap(
    relined(file, {
      version: MAP_VERSION,
      spawns: { ...spawns, parked: { spots: 0, rests: 0, models: [] } },
      farms: 0,
      lamps: 0,
      derived: { ...derived, farms: 0 },
    }),
  )
  return {
    global: {
      ...global,
      spawns: { ...global.spawns, parked: spawns.parked },
      farms,
      lamps,
      derived: { ...global.derived, farms: derived.farms },
    },
    decodeTile: (tile) => {
      const { vectors } = rawLine(tile) as Pick<TileData, "vectors">
      return {
        ...decodeTile(relined(tile, { version: MAP_VERSION, coordinates: 0, vectors: NO_VECTORS })),
        vectors,
      }
    },
  }
}

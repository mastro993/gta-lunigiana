// Reads a build of the format version before today's as one of today's, so `pnpm map-diff`
// compares the build before a format change with one after it (docs/standards/map.md). It reads
// version 5, whose global file's line held the graph, the lanes and the residents and whose lines
// had no run-outs; its tiles are today's but for their version. The change to version 7 replaces it
// with a reader of version 6. It is the one place outside src/sim/map/format/ that writes a line's
// counts (`relined`): it lives for one version, and the codec's own decoder checks what it reads.
import { decodeMap } from "../sim/map/format/global-file.ts"
import { MAP_VERSION, relined } from "../sim/map/format/sections.ts"
import { decodeTile, type TileData } from "../sim/map/format/tile-file.ts"
import type { MonzoneMap } from "../sim/map/index.ts"

/** The version before today's, which `decodeUpgraded` reads too. */
const BEFORE = 5

/** The JSON line of a version-5 global file: what reading it as today's needs. */
type OldLine = { readonly version?: unknown } & Pick<MonzoneMap, "graph" | "lanes" | "derived"> & {
    readonly railway: { readonly lines: ReadonlyArray<object> }
  }

/**
 * The global map of a global file of today's version or the one before, and the decoder of that
 * build's tiles: a version-5 file decodes as one whose tables are empty, its lines run on with no
 * run-outs, and the tables come from its line.
 */
export const decodeUpgraded = (
  file: Uint8Array,
): { readonly global: MonzoneMap; readonly decodeTile: (file: Uint8Array) => TileData } => {
  const line = JSON.parse(new TextDecoder().decode(file.subarray(0, file.indexOf(10)))) as OldLine
  if (line.version !== BEFORE) return { global: decodeMap(file), decodeTile }
  const { graph, lanes, derived, railway } = line
  const global = decodeMap(
    relined(file, {
      version: MAP_VERSION,
      graph: { xy: 0, edges: 0, traffic: 0, walk: 0 },
      lanes: { table: [], counts: {} },
      derived: { ...derived, residents: 0 },
      railway: { ...railway, lines: railway.lines.map((l) => ({ runOuts: [[], []], ...l })) },
    }),
  )
  return {
    global: {
      ...global,
      graph,
      lanes,
      derived: { ...global.derived, residents: derived.residents },
    },
    decodeTile: (tile) => decodeTile(relined(tile, { version: MAP_VERSION })),
  }
}

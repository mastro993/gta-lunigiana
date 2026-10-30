// Reads a map from disk whole (Node only): its global file and every tile it lists, joined back
// into one heightmap, wall list, tree list and land-cover raster (tile-map.ts `joinTiles`). The
// tools that draw or compare a whole map and the map tests read it this way. A region's map as
// built, a test region's too, is handed to the sim with `loadBuiltMap`.
import { tileKey } from "../sim/map/kinds.ts"
import { decodeMap, decodeTile, MAP_URL, provideMap, readMapFile } from "../sim/map/packed.ts"
import { mapDir, type Region } from "./region.ts"
import { type JoinedMap, joinTiles } from "./tile-map.ts"

/** The map whose global file is at `url` (its tiles in the directory named after it beside it), whole. */
export const readWholeMap = (url: URL): JoinedMap => {
  const global = decodeMap(readMapFile(url))
  return joinTiles(
    global,
    global.tiles.map(({ i, j }) =>
      decodeTile(readMapFile(new URL(`${global.name}/${tileKey(i, j)}.bin`, url))),
    ),
  )
}

const read = new Map<string, JoinedMap>()
/** The shipped map `name` (`monzone`, `cesena`) whole, read once per process. */
export const wholeMap = (name = "monzone"): JoinedMap => {
  let map = read.get(name)
  if (map === undefined) {
    map = readWholeMap(new URL(`${name}.bin`, MAP_URL))
    read.set(name, map)
  }
  return map
}

/** Where `region`'s global file is built: in src/sim/map, or a test region's in test-maps (its tiles in the directory named after it beside it). */
export const builtMapUrl = (region: Region): URL =>
  new URL(`../../${mapDir(region)}/${region.file}.bin`, import.meta.url)

/**
 * Hands the sim `region`'s map as built: its global file, and its tiles as a lookup finds them
 * missing. Call it before anything imports src/sim/map/index.ts.
 */
export const loadBuiltMap = async (region: Region): Promise<void> => {
  const url = builtMapUrl(region)
  provideMap(readMapFile(url))
  const { setTileSource } = await import("../sim/map/tiles.ts")
  setTileSource((key) => readMapFile(new URL(`${region.file}/${key}.bin`, url)))
}

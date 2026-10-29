// Reads a map from disk whole (Node only): its global file and every tile it lists, joined back
// into one heightmap, wall list, tree list and land-cover raster (tile-map.ts `joinTiles`). The
// tools that draw or compare a whole map and the map tests read it this way.
import { tileKey } from "../sim/map/kinds.ts"
import { decodeMap, decodeTile, MAP_URL, readMapFile } from "../sim/map/packed.ts"
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

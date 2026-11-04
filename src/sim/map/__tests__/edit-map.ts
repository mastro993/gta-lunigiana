/**
 * Lunigiana's global file edited before anything decodes it: maps the build does not make from
 * Lunigiana's parts, such as lucido alone cut into an L (`notchMap`, issue #7). A test calls one of
 * these first and imports every map module after it (`await import`).
 */

import { partOf } from "../../../tools/region.ts"
import type { MonzoneMapJson } from "../index.ts"
import { tileRange } from "../kinds.ts"
import { MAP_URL, provideMap, readMapFile } from "../packed.ts"

/** Hands over Lunigiana's global file with its JSON line made `edit` of it, before any module decodes the map. */
export const editMap = (edit: (json: MonzoneMapJson) => MonzoneMapJson): void => {
  const file = readMapFile(MAP_URL),
    end = file.indexOf(10)
  const json = JSON.parse(new TextDecoder().decode(file.subarray(0, end))) as MonzoneMapJson
  const line = new TextEncoder().encode(JSON.stringify(edit(json)))
  const edited = new Uint8Array(line.length + file.length - end)
  edited.set(line)
  edited.set(file.subarray(end), line.length)
  provideMap(edited)
}

/** Lucido's rectangle, the region's first part: the box `notchMap` cuts the map to. */
const [MIN_X, MIN_Y, MAX_X, MAX_Y] = partOf("lucido").rects[0]!

/** The L the notch leaves in lucido's rectangle: counter-clockwise from its south-west corner. */
export const L: ReadonlyArray<number> = [
  MIN_X,
  MIN_Y,
  MAX_X,
  MIN_Y,
  MAX_X,
  0,
  2000,
  0,
  2000,
  MAX_Y,
  MIN_X,
  MAX_Y,
]

/** The listed tiles round the notch: those a lookup in its corner tiles reads. */
export const AROUND: ReadonlyArray<string> = ["0_-1", "1_-1", "2_-1", "0_0", "0_1"]

/**
 * Lunigiana cut to lucido's rectangle (its bounds, heightmap and tiles, the anchor kept), with its
 * tiles north-east of (2000, 0) off the list (x 2000 … 6000, y 0 … 4000; the bounds stop at 4900,
 * 3900) and the `L` round the rest its outline: a map whose listed tiles do not fill the box round
 * them, as a region of parts in an L gives, with its notch in the same place however the region
 * grows. Every runtime user of the map's tiles and play area must answer there, reading only
 * listed tiles.
 */
export const notchMap = (): void =>
  editMap((json) => {
    const { ax, ay, ...hm } = json.heightmap,
      anchor = { ax: ax ?? hm.x0, ay: ay ?? hm.y0 },
      { i0, i1, j0, j1 } = tileRange({ minX: MIN_X, minY: MIN_Y, maxX: MAX_X, maxY: MAX_Y })
    return {
      ...json,
      bounds: { minX: MIN_X, minY: MIN_Y, maxX: MAX_X, maxY: MAX_Y },
      heightmap: {
        ...hm,
        x0: MIN_X,
        y0: MIN_Y,
        cols: (MAX_X - MIN_X) / hm.cell + 1,
        rows: (MAX_Y - MIN_Y) / hm.cell + 1,
        // named only where it is not the first node, as the build writes it
        ...(anchor.ax === MIN_X && anchor.ay === MIN_Y ? {} : anchor),
      },
      tiles: json.tiles.filter(
        ({ i, j }) => i >= i0 && i <= i1 && j >= j0 && j <= j1 && !(i >= 1 && j >= 0),
      ),
      outline: [L],
    }
  })

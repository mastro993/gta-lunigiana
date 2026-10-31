/**
 * Lunigiana's global file edited before anything decodes it: maps the build does not make from
 * Lunigiana's one rectangle, such as a region of parts in an L (`notchMap`, issue #7). A test calls
 * one of these first and imports every map module after it (`await import`).
 */
import type { MonzoneMapJson } from "../index.ts"
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

/** The L the notch leaves: counter-clockwise from the south-west corner. */
export const L: ReadonlyArray<number> = [
  -2900, -6100, 4900, -6100, 4900, 0, 2000, 0, 2000, 3900, -2900, 3900,
]

/** The listed tiles round the notch: those a lookup in its corner tiles reads. */
export const AROUND: ReadonlyArray<string> = ["0_-1", "1_-1", "2_-1", "0_0", "0_1"]

/**
 * Lunigiana with its tiles north-east of (2000, 0) off the list (x 2000 … 6000, y 0 … 4000; the
 * bounds stop at 4900, 3900) and the `L` round the rest its outline: a map whose listed tiles do
 * not fill the box round them, as a region of parts in an L gives. Every runtime user of the map's
 * tiles and play area must answer there, reading only listed tiles.
 */
export const notchMap = (): void =>
  editMap((json) => ({
    ...json,
    tiles: json.tiles.filter(({ i, j }) => !(i >= 1 && j >= 0)),
    outline: [L],
  }))

/**
 * The map file `monzone.bin` and its decoder (encoder: `packMap` in `src/tools/pack.ts`). The
 * file is gzip of one JSON line (`MonzoneMapJson`: the map with its three big numeric parts
 * replaced by counts), a newline, then those parts as packed sections in file order: heightmap,
 * walk walls, shore walls, drive walls, trees. A section holds n integers as the zigzag-coded difference from
 * the value `stride` places back (from 0 for the first `stride`), split into byte planes: the
 * low byte of every value, then the next byte of every value. Neighbours differ little and like
 * bytes sit together, so the gzipped file is less than half the base64 JSON it replaced.
 *
 * | Section | Integers | Bytes | Stride |
 * |---|---|---|---|
 * | heightmap | decimetres, each row delta-coded from its first node | 2 | `cols` (the node to the south) |
 * | walls | (ax, ay, bx, by) decimetres from `packOrigin` (100 m south-west of the map's corner: bounds walls stick out a little) | 4 | 2 (the previous x or y) |
 * | trees | (x, y) whole metres from `treeOrigin` (they are planted on whole metres), scale in hundredths | 2 | 3 (the previous tree) |
 *
 * Decoding is exact: every coordinate is an integer number of decimetres divided by 10, the same
 * double JSON would give for a one-decimal number. The sim never fetches it: the browser host
 * downloads and gunzips the file and hands it to `provideMap` before anything imports
 * `./index.ts`, and under Node (tests, tools, the Ritmo lint) `mapFile` reads it from disk.
 *
 * @module map/packed
 */
import type { MonzoneMap, MonzoneMapJson } from "./index.ts"

interface Corner {
  readonly minX: number
  readonly minY: number
}

/** The map file's format version (`MonzoneMap.version`): 2 added `railway` (lines, stations, level crossings, platforms) and `Road.verge`. */
export const MAP_VERSION = 2

/** Where wall coordinates count from, decimetres: 100 m south-west of the bounds' corner. */
export const packOrigin = (bounds: Corner): { readonly x: number; readonly y: number } => ({
  x: Math.round(bounds.minX * 10) - 1000,
  y: Math.round(bounds.minY * 10) - 1000,
})

/** Where tree coordinates count from, whole metres: `packOrigin` rounded down to the metre. */
export const treeOrigin = (bounds: Corner): { readonly x: number; readonly y: number } => {
  const o = packOrigin(bounds)
  return { x: Math.floor(o.x / 10), y: Math.floor(o.y / 10) }
}

/** The map file's URL: beside this module in Node, a hashed asset in the Vite build. */
export const MAP_URL: URL = new URL("./monzone.bin", import.meta.url)

/** The gunzipped map file the host handed over, until `./index.ts` decodes it. */
let provided: Uint8Array | undefined

/** Hands over the gunzipped `MAP_URL` bytes; the browser host calls it once, before importing `./index.ts`. */
export const provideMap = (bytes: Uint8Array): void => {
  provided = bytes
}

/**
 * The gunzipped map file, for `./index.ts` to decode once: the bytes given to `provideMap`
 * (released here, so the 28.5 MB file does not outlive the decoded map), else, in Node, read and
 * gunzipped from `MAP_URL`. Node modules load through `process.getBuiltinModule`, so no `node:`
 * import reaches the browser bundle.
 */
export const mapFile = (): Uint8Array => {
  const file = provided
  provided = undefined
  if (file !== undefined) return file
  if (globalThis.process?.getBuiltinModule === undefined)
    throw new Error(
      "map: monzone.bin not loaded; the host must call provideMap(bytes) before importing src/sim/map/index.ts",
    )
  return process
    .getBuiltinModule("node:zlib")
    .gunzipSync(process.getBuiltinModule("node:fs").readFileSync(MAP_URL))
}

/** The `n` integers of the section at byte `at`: `size` byte planes of zigzag deltas from the value `stride` back. */
const unpack = (
  file: Uint8Array,
  at: number,
  n: number,
  size: number,
  stride: number,
): Int32Array => {
  const out = new Int32Array(n)
  for (let p = 0; p < size; p++)
    for (let k = 0; k < n; k++) out[k] = out[k]! | (file[at + p * n + k]! << (8 * p)) // plane by plane: a third faster
  for (let k = 0; k < n; k++) {
    const z = out[k]!
    out[k] = ((z >>> 1) ^ -(z & 1)) + (k >= stride ? out[k - stride]! : 0)
  }
  return out
}

/** Heightmap nodes in decimetres from rows of `cols` deltas (each row starts absolute). */
const unpackRows = (deltas: Int32Array, cols: number): Int16Array => {
  const out = new Int16Array(deltas.length)
  for (let k = 0; k < out.length; k++)
    out[k] = k % cols === 0 ? deltas[k]! : out[k - 1]! + deltas[k]!
  return out
}

/** Wall segments (ax, ay, bx, by) in metres from decimetres from `packOrigin(bounds)`. */
const unpackWalls = (dm: Int32Array, bounds: Corner): Float64Array => {
  const out = new Float64Array(dm.length),
    o = packOrigin(bounds)
  for (let k = 0; k < dm.length; k++) out[k] = (dm[k]! + (k % 2 === 0 ? o.x : o.y)) / 10
  return out
}

/** Trees (x, y, scale): whole metres from `treeOrigin(bounds)`, the scale in hundredths. */
const unpackTrees = (w: Int32Array, bounds: Corner): Float64Array => {
  const out = new Float64Array(w.length),
    o = treeOrigin(bounds)
  for (let k = 0; k < w.length; k++) {
    const c = k % 3
    out[k] = c === 2 ? w[k]! / 100 : w[k]! + (c === 0 ? o.x : o.y)
  }
  return out
}

/** The map from its gunzipped file: the JSON line, then the sections, read in file order. */
export const decodeMap = (file: Uint8Array): MonzoneMap => {
  const line = file.indexOf(10) // JSON.stringify escapes every newline inside strings
  const json = JSON.parse(new TextDecoder().decode(file.subarray(0, line))) as MonzoneMapJson
  if (json.version !== MAP_VERSION)
    throw new Error(
      `map: monzone.bin is version ${json.version}, this decoder reads ${MAP_VERSION}; run pnpm map`,
    )
  const { heightmap, walls, trees, bounds } = json
  let at = line + 1
  const section = (n: number, size: number, stride: number): Int32Array => {
    const values = unpack(file, at, n, size, stride)
    at += n * size
    return values
  }
  const data = unpackRows(
    section(heightmap.cols * heightmap.rows, 2, heightmap.cols),
    heightmap.cols,
  )
  const walk = unpackWalls(section(4 * walls.walk, 4, 2), bounds)
  const shore = unpackWalls(section(4 * walls.shore, 4, 2), bounds)
  const drive = unpackWalls(section(4 * walls.drive, 4, 2), bounds)
  const treeData = unpackTrees(section(3 * trees, 2, 3), bounds)
  if (at !== file.length)
    throw new Error(
      `map: the sections end at byte ${at} of ${file.length}; monzone.bin and this decoder disagree`,
    )
  return {
    ...json,
    heightmap: { ...heightmap, data },
    walls: { walk, shore, drive },
    trees: treeData,
  }
}

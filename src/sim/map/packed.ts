/**
 * Where the map files come from (their format and codecs: `./format/`). A map is a global file,
 * `<name>.bin`, and one file per 2 km tile, `<name>/<i>_<j>.bin` (`TILE` in `./kinds.ts`). The sim
 * never fetches: the browser host downloads and gunzips the global file and hands it to `provideMap`
 * before anything imports `./index.ts`, then hands each tile to `provideTile` (`./tiles.ts`); under
 * Node (tests, tools, the Ritmo lint) `mapFile` and the tile store read them from disk.
 *
 * @module map/packed
 */

/** Nodes along a tile's side (its border nodes are its neighbours' too). */
export const TILE_NODES = 501
/** Land-cover cells along a tile's side. */
export const TILE_CELLS = 500

/** The global file's URL in Node: beside this module, named after the default map. */
export const MAP_URL: URL = new URL("./monzone.bin", import.meta.url)

/** A tile file's URL in Node, `<name>/<key>.bin` beside the global file (the browser host has its own, hashed by Vite: src/maps.ts). */
export const tileUrl = (name: string, key: string): URL => new URL(`${name}/${key}.bin`, MAP_URL)

/** The gunzipped global file the host handed over, until `./global.ts` decodes it. */
let provided: Uint8Array | undefined

/** Hands over the gunzipped global file; the browser host calls it once, before importing `./index.ts`. */
export const provideMap = (bytes: Uint8Array): void => {
  provided = bytes
}

/** Node's fs and zlib, through `process.getBuiltinModule`, so no `node:` import reaches the browser bundle; undefined in a browser. */
const node = () =>
  globalThis.process?.getBuiltinModule === undefined
    ? undefined
    : {
        fs: process.getBuiltinModule("node:fs"),
        zlib: process.getBuiltinModule("node:zlib"),
      }

/** A gzipped map file read from disk and gunzipped (Node only). */
export const readMapFile = (url: URL): Uint8Array => {
  const builtins = node()
  if (builtins === undefined) throw new Error(`map: ${url.pathname} cannot be read here`)
  return builtins.zlib.gunzipSync(builtins.fs.readFileSync(url))
}

/** Whether map files can be read from disk here (Node). */
export const onDisk = (): boolean => node() !== undefined

/**
 * The gunzipped global file, for `./global.ts` to decode once: the bytes given to `provideMap`
 * (released here, so they do not outlive the decoded map), else, in Node, read from `MAP_URL`.
 */
export const mapFile = (): Uint8Array => {
  const file = provided
  provided = undefined
  if (file !== undefined) return file
  if (!onDisk())
    throw new Error(
      "map: the global file is not loaded; the host must call provideMap(bytes) before importing src/sim/map/index.ts",
    )
  return readMapFile(MAP_URL)
}

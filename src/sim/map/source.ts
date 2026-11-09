/**
 * The map source: where one run of the game, a test or a tool gets its map files (their format and
 * codecs: `./format/`). A map is a global file, `<name>.bin`, and one file per 2 km tile,
 * `<name>/<i>_<j>.bin` (`TILE` in `./kinds.ts`). The global file is chosen once, before
 * `./global.ts` decodes it, and handing one over after that throws: one map per process
 * (docs/adr/0002-one-map-per-process.md). Where a listed tile missing from memory comes from can
 * change at any time (`setTileSource`). By default, in Node (tests, tools, the Ritmo lint), both
 * are Lunigiana's files on disk; `useDiskMap` picks another built map there. The sim never fetches:
 * the browser host downloads and gunzips the global file and hands it to `provideMap` before
 * anything imports `./index.ts`, then hands each tile to `provideTile` (`./tiles.ts`). Nothing here
 * decodes the map, so a module may import it before the map is chosen.
 *
 * @module map/source
 */

/** The global file's URL in Node: beside this module, named after the default map. */
export const MAP_URL: URL = new URL("./monzone.bin", import.meta.url)

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

/** Where a listed tile comes from when a lookup finds it missing: its gunzipped file, by key. */
type TileSource = (key: string) => Uint8Array

/** The chosen global file's URL on disk, its tiles in the directory named after it beside it; undefined when it is not on disk. */
let home: URL | undefined = node() === undefined ? undefined : MAP_URL
/** The gunzipped global file handed over, until `./global.ts` takes it to decode. */
let provided: Uint8Array | undefined
/** Whether `./global.ts` has taken the global file: the map is chosen for good. */
let decoded = false

/** Tile `key` of the chosen map, read from disk beside its global file (Node only). */
export const tileFromDisk: TileSource = (key) => {
  if (home === undefined) throw new Error(`map: tile ${key} of this map is not on disk`)
  const name = home.pathname.slice(home.pathname.lastIndexOf("/") + 1, -".bin".length)
  return readMapFile(new URL(`${name}/${key}.bin`, home))
}

let source: TileSource | undefined = home === undefined ? undefined : tileFromDisk

/**
 * Hands over the gunzipped global file, before anything imports `./index.ts`: the browser host's
 * download, or the map build's provisional map, whose tiles come from none until `setTileSource`
 * names one; or, with `at` (the file it was read from), an edited map whose tiles are read from
 * disk beside `at`. Throws once the map is decoded, which would leave the run on the map it had.
 */
export const provideMap = (bytes: Uint8Array, at?: URL): void => {
  if (decoded)
    throw new Error(
      "map: a map was handed over after the map was decoded; hand it over before anything imports src/sim/map/index.ts (a test: on its first line)",
    )
  provided = bytes
  home = at
  source = at === undefined ? undefined : tileFromDisk
}

/** Picks the built map whose global file is at `url` (Node only), its tiles read from disk beside it. */
export const useDiskMap = (url: URL): void => provideMap(readMapFile(url), url)

/** Sets (or, with undefined, removes) where a missing tile comes from; tests remove it to see a missing tile throw. */
export const setTileSource = (next: TileSource | undefined): void => {
  source = next
}

/** Listed tile `key`'s gunzipped file from the tile source, for `./tiles.ts` to decode; undefined with none. */
export const tileFile = (key: string): Uint8Array | undefined => source?.(key)

/**
 * The gunzipped global file, for `./global.ts` to decode once: the bytes handed over (released here,
 * so they do not outlive the decoded map), else, in Node, the default map's.
 */
export const mapFile = (): Uint8Array => {
  decoded = true
  const file = provided
  provided = undefined
  if (file !== undefined) return file
  if (home === undefined)
    throw new Error(
      "map: the global file is not loaded; the host must call provideMap(bytes) before importing src/sim/map/index.ts",
    )
  return readMapFile(home)
}

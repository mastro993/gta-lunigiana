// The map build's last phase: the built map put together and its land cover rasterised, then cut
// into its tiles once; the tables baked from it by the game's own code (bake.ts) reading the tiles
// through a store that keeps only a few decoded; then the files stamped with the build hash, and
// gzipped and written a few at a time on libuv's threads.
import { mkdirSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { gzip } from "node:zlib"

import { MAP_VERSION, provideMap } from "../sim/map/packed.ts"
import { coverBlocks } from "../sim/map/raster.ts"
import type { Sources } from "./build-sources.ts"
import type { Terrain } from "./build-terrain.ts"
import type { buildWorld } from "./build-world.ts"
import type { RoadF } from "./features.ts"
import { BOUNDS, M_PER_DEG, ORIGIN, r1 } from "./geometry.ts"
import { packMap } from "./pack.ts"
import { OUTLINE } from "./play-area.ts"
import { REGION } from "./region.ts"
import { sampleGrid, type Grid } from "./terrain.ts"
import { type BuiltMap, type MapCut, NO_BAKES, stampMap } from "./tile-map.ts"
import { treeCorner } from "./trees.ts"

/** Surveyed eave over a building's lowest ground, m, outside which the eave is a survey slip and the default height stands. */
const EAVE = { min: 1.5, max: 45 }

/** The map as built: every layer whole, but the land cover, which the cut rasterises tile by tile. */
export const assembleMap = (
  src: Sources,
  terrain: Terrain,
  world: ReturnType<typeof buildWorld>,
): BuiltMap => {
  const { roads, buildings, areas, barriers, pois, districts } = src
  const { grid, roadLines, railLines } = terrain
  const { verges, kinds } = world
  const roadOut = (r: RoadF, i: number) => ({
    id: r.id,
    cls: r.cls,
    ...(r.name === undefined ? {} : { name: r.name }),
    ...(r.ref === undefined ? {} : { ref: r.ref }),
    w: r.w,
    surface: r.surface,
    ...(r.oneway ? { oneway: true } : {}),
    ...(r.ramp ? { ramp: true } : {}),
    ...(r.bridge ? { bridge: true } : {}),
    ...(r.tunnel ? { tunnel: true } : {}),
    ...(r.layer === undefined ? {} : { layer: r.layer }),
    ...(r.maxheight === undefined ? {} : { maxheight: r.maxheight }),
    ...(verges.has(i) ? { verge: verges.get(i)! } : {}),
    ...roadLines[i]!,
  })
  const map: Omit<BuiltMap, "cover"> = {
    version: MAP_VERSION,
    origin: ORIGIN,
    mPerDeg: M_PER_DEG,
    bounds: BOUNDS,
    outline: OUTLINE,
    tiles: REGION.tiles,
    heightmap: {
      cell: grid.cell,
      cols: grid.cols,
      rows: grid.rows,
      x0: grid.x0,
      y0: grid.y0,
      // The lookups' anchor, named only where it is not the first node (`anchorOf`).
      ...(grid.ax === grid.x0 && grid.ay === grid.y0 ? {} : { ax: grid.ax, ay: grid.ay }),
      data: decimetres(grid),
    },
    roads: roads.map(roadOut),
    buildings: buildings.map((b) => {
      let z0 = Number.MAX_VALUE
      for (const ring of [b.outer, ...(b.holes ?? [])])
        for (let i = 0; i < ring.length; i += 2)
          z0 = Math.min(z0, sampleGrid(grid, ring[i]!, ring[i + 1]!))
      const { id, kind, name, eave, style, ruins, tint, outer, holes } = b
      const rise = eave === undefined ? Number.NaN : eave - z0
      const h = rise >= EAVE.min && rise <= EAVE.max ? rise : b.h
      return {
        id,
        kind,
        ...(name === undefined ? {} : { name }),
        h: r1(h),
        z0: r1(z0),
        style,
        ...(ruins ? { ruins } : {}),
        tint,
        outer,
        ...(holes ? { holes } : {}),
      }
    }),
    water: terrain.water,
    rail: railLines.map(({ r, pts, z }, i) => ({
      id: r.id,
      ...(kinds[i] === undefined ? {} : { kind: kinds[i] }),
      ...(r.bridge ? { bridge: true } : {}),
      ...(r.tunnel ? { tunnel: true } : {}),
      pts,
      z,
    })),
    railway: world.railway,
    areas,
    barriers,
    pois,
    districts,
    graph: world.graph,
    walls: world.walls,
    trees: world.trees.trees,
    treeIds: world.trees.ids,
    treeCorner: treeCorner(REGION),
    spawns: world.spawns,
  }
  // Rasterised a tile at a time, as the cut asks for it.
  return { ...map, cover: coverBlocks(map) }
}

/** The grid's nodes in whole decimetres, each checked to fit int16 (a NaN or a height past ±3276.7 m fails the build). */
export const decimetres = (grid: Grid): Int16Array => {
  const out = new Int16Array(grid.z.length)
  for (let k = 0; k < out.length; k++) {
    const v = Math.round(grid.z[k]! * 10)
    if (!(v >= -32768 && v <= 32767))
      throw new Error(
        `heightmap: ${v} at node (${k % grid.cols}, ${Math.floor(k / grid.cols)}) does not fit int16`,
      )
    out[k] = v
  }
  return out
}

/** Decoded tiles the bake keeps at once: past them the first read goes, and is read again if needed. */
const RESIDENT = 16

/**
 * Files gzipped at once: twice libuv's 4 threads, so each has the next file ready, and few enough
 * that the stamped copies in flight stay a handful of tiles.
 */
const IN_FLIGHT = 8

const gzipAsync = promisify(gzip)

/**
 * Gzips each of `files` at level 9 on libuv's threads, `IN_FLIGHT` at a time, pulling the next
 * from the iterable only when one is done, and writes it to its path; resolves to each one's
 * gzipped size, in order. The bytes are those gzipSync writes: only the wall clock changes.
 */
export const writeGzipped = async (
  files: Iterable<readonly [string, Uint8Array]>,
): Promise<Array<number>> => {
  const sizes: Array<number> = [],
    next = files[Symbol.iterator]()
  let count = 0
  const lane = async () => {
    for (let r = next.next(); r.done !== true; r = next.next()) {
      const k = count++,
        [file, data] = r.value
      const gz = await gzipAsync(data, { level: 9 })
      await writeFile(file, gz)
      sizes[k] = gz.length
    }
  }
  await Promise.all(Array.from({ length: IN_FLIGHT }, lane))
  return sizes
}

/**
 * Bakes the tables of `cut` (the game's own code on the map cut without them), then writes the
 * global file `out` and the tiles into `dir`, stamped and gzipped a few at a time. Returns the
 * stamped global map, the bytes written and the largest tile, and the bytes of each part before
 * gzip.
 */
export const writeMap = async (
  cut: MapCut,
  out: string,
  dir: string,
  lap: (label: string) => void,
) => {
  provideMap(packMap({ ...cut.global(NO_BAKES), hash: "" }).file)
  const { dropTile, setTileSource } = await import("../sim/map/tiles.ts")
  const resident: Array<string> = []
  // Each tile made as the bake asks for it, with no floors yet (the bake makes them)
  setTileSource((key) => {
    resident.push(key)
    if (resident.length > RESIDENT) dropTile(resident.shift()!)
    return cut.tile(key, NO_BAKES)
  })
  const { bake } = await import("./bake.ts")
  const bakes = bake(cut.whole)
  setTileSource(undefined)
  for (const key of resident) dropTile(key)
  lap("bake")
  const { files, sizes: vectorSizes } = cut.tiles(bakes)
  const stamped = stampMap(cut.global(bakes), files.values())
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let json = 0
  const [global, ...tiles] = await writeGzipped(
    (function* () {
      yield [out, stamped.file] as const
      for (const [key, file] of files) {
        const tile = stamped.tile(file)
        json += tile.indexOf(10) + 1
        yield [join(dir, `${key}.bin`), tile] as const
      }
    })(),
  )
  lap("write")
  const sizes: Record<string, number> = {}
  for (const [part, n] of Object.entries(stamped.sizes)) sizes[`global ${part}`] = n
  for (const [part, n] of Object.entries(cut.sizes))
    sizes[`tile ${part}`] = part === "json" ? json : n
  for (const [layer, n] of Object.entries(vectorSizes)) sizes[`tile ${layer}`] = n
  return {
    global: stamped.global,
    tiles: files.size,
    bytes: tiles.reduce((sum, n) => sum + n, global!),
    largest: Math.max(...tiles),
    sizes,
  }
}

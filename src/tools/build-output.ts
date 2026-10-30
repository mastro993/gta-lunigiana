// The map build's last phase: the built map put together and its land cover rasterised, then cut
// into its tiles once; the tables baked from it by the game's own code (bake.ts) reading the tiles
// through a store that keeps only a few decoded; then the files stamped with the build hash, gzipped
// and written one at a time.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

import { MAP_VERSION, provideMap } from "../sim/map/packed.ts"
import { rasterCover } from "../sim/map/raster.ts"
import type { Sources } from "./build-sources.ts"
import type { Terrain } from "./build-terrain.ts"
import type { buildWorld } from "./build-world.ts"
import type { RoadF } from "./features.ts"
import { BOUNDS, M_PER_DEG, ORIGIN, r1 } from "./geometry.ts"
import { packMap } from "./pack.ts"
import { OUTLINE } from "./play-area.ts"
import { sampleGrid, type Grid } from "./terrain.ts"
import { type BuiltMap, type MapCut, NO_BAKES, stampMap } from "./tile-map.ts"

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
    ...(r.bridge ? { bridge: true } : {}),
    ...(r.tunnel ? { tunnel: true } : {}),
    ...(r.layer === undefined ? {} : { layer: r.layer }),
    ...(verges.has(i) ? { verge: verges.get(i)! } : {}),
    ...roadLines[i]!,
  })
  const map: Omit<BuiltMap, "cover"> = {
    version: MAP_VERSION,
    origin: ORIGIN,
    mPerDeg: M_PER_DEG,
    bounds: BOUNDS,
    outline: OUTLINE,
    heightmap: {
      cell: grid.cell,
      cols: grid.cols,
      rows: grid.rows,
      x0: grid.x0,
      y0: grid.y0,
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
    trees: world.trees,
    spawns: world.spawns,
  }
  // Rasterised a tile at a time, as the cut asks for it.
  return { ...map, cover: (block) => rasterCover(map, block) }
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
 * Bakes the tables of `cut` (the game's own code on the map cut without them), then writes the
 * global file `out` and the tiles into `dir`, stamped and gzipped one at a time. Returns the stamped
 * global map, the bytes written and the largest tile, and the bytes of each part before gzip.
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
  setTileSource((key) => {
    resident.push(key)
    if (resident.length > RESIDENT) dropTile(resident.shift()!)
    return cut.tiles.get(key)!
  })
  const { bake } = await import("./bake.ts")
  const bakes = bake()
  setTileSource(undefined)
  for (const key of resident) dropTile(key)
  lap("bake")
  const stamped = stampMap(cut.global(bakes), cut.tiles.values())
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir)
  let bytes = 0,
    largest = 0,
    json = 0
  const write = (file: string, data: Uint8Array) => {
    const gz = gzipSync(data, { level: 9 })
    writeFileSync(file, gz)
    bytes += gz.length
    return gz.length
  }
  write(out, stamped.file)
  for (const [key, file] of cut.tiles) {
    const tile = stamped.tile(file)
    json += tile.indexOf(10) + 1
    largest = Math.max(largest, write(join(dir, `${key}.bin`), tile))
  }
  lap("write")
  const sizes: Record<string, number> = {}
  for (const [part, n] of Object.entries(stamped.sizes)) sizes[`global ${part}`] = n
  for (const [part, n] of Object.entries(cut.sizes))
    sizes[`tile ${part}`] = part === "json" ? json : n
  return { global: stamped.global, tiles: cut.tiles.size, bytes, largest, sizes }
}

/**
 * The static world's pieces (`Piece` in render/geometry) and the part of each every chunk draws.
 * The buildings, roads and rivers come with the map tiles (`provide`, as the host hands each tile
 * to the world), each whole in every tile it comes within the tiles' halo of: a piece is made once,
 * however many of the tiles in hold it, and goes with the last of them (`drop`). The railway, the
 * stations and the lamps come from the global map, made with the world, reading no tile. Every
 * piece has a key in the whole map's draw order (the buildings, each road's ribbons then its deck,
 * the rivers, then the track, the crossings, the portals, the platforms, the name boards, the
 * canopies and the lamps, each by its index), and a chunk draws its pieces in that order
 * (`entries`), so it gets the very triangles, in the very order, a whole-map build sends it.
 *
 * @module render/pieces
 */
import { MAP } from "../sim/map/index.ts"
import type { TileVectors } from "../sim/map/packed.ts"
import { tilesOver } from "../sim/map/tiles.ts"
import { buildingPiece } from "./buildings.ts"
import { CHUNKS, chunkOf } from "./chunks.ts"
import type { Piece } from "./geometry.ts"
import { roadPieces, waterPiece } from "./lines.ts"
import { railPieces, type RoadsNear } from "./rail.ts"
import { lampPieces } from "./sky/lamps.ts"
import { stationPieces } from "./stations.ts"

/**
 * The chunks the segments of the anchor polyline `pts` reach, flat (chunk, k0, k1), in the order
 * first reached: k0..k1 the first and last of its segments whose bounding box reaches the chunk (a
 * one-point piece has the one segment 0).
 */
const rangesOf = (pts: ReadonlyArray<number>): Array<number> => {
  const range = new Map<number, [number, number]>(),
    n = pts.length / 2
  for (let k = 0; k < Math.max(1, n - 1); k++) {
    const ax = pts[2 * k]!,
      ay = pts[2 * k + 1]!,
      b = Math.min(k + 1, n - 1),
      bx = pts[2 * b]!,
      by = pts[2 * b + 1]!
    const lo = chunkOf(Math.min(ax, bx), Math.min(ay, by)),
      hi = chunkOf(Math.max(ax, bx), Math.max(ay, by))
    for (let cy = Math.floor(lo / CHUNKS.x); cy <= Math.floor(hi / CHUNKS.x); cy++) {
      for (let cx = lo % CHUNKS.x; cx <= hi % CHUNKS.x; cx++) {
        const key = cy * CHUNKS.x + cx,
          seen = range.get(key)
        if (seen === undefined) range.set(key, [k, k])
        else seen[1] = k
      }
    }
  }
  return [...range].flatMap(([key, [k0, k1]]) => [key, k0, k1])
}

/** Pieces per chunk key: flat (piece, k0, k1) triples in the pieces' order, k0..k1 the piece's segments whose bounding box reaches the chunk (`rangesOf`). */
export const bucketPieces = (pieces: ReadonlyArray<Piece>): Array<Array<number>> => {
  const chunks = Array.from({ length: CHUNKS.x * CHUNKS.y }, (): Array<number> => [])
  pieces.forEach((piece, p) => {
    const ranges = rangesOf(piece.pts)
    for (let n = 0; n < ranges.length; n += 3)
      chunks[ranges[n]!]!.push(p, ranges[n + 1]!, ranges[n + 2]!)
  })
  return chunks
}

const { buildings: BUILDINGS, roads: ROADS, water: WATER } = MAP.vectors.counts
/** The key of road `r`'s ribbons (`part` 0) or its deck (1); building `i`'s is `i`. */
const roadKey = (r: number, part: 0 | 1): number => BUILDINGS + 2 * r + part
/** The key of river `w`. */
const waterKey = (w: number): number => BUILDINGS + 2 * ROADS + w
/** The key of the first global piece (`Pieces.global`): every tile's piece comes before it. */
const GLOBAL = BUILDINGS + 2 * ROADS + WATER

/** Every global piece of the map, in draw order: the railway (laid over the road ribbons `roads` gives), the stations and the lamps. */
const globalPieces = (roads: RoadsNear): Array<Piece> => [
  ...railPieces(roads),
  ...stationPieces(),
  ...lampPieces(),
]

/** A piece made from the tiles: what it draws, the chunks it reaches (`rangesOf`) and how many tiles in hold it. */
interface Made {
  readonly piece: Piece
  readonly ranges: ReadonlyArray<number>
  holders: number
}

/** What a tile in brings: the keys of its pieces, of its road and river pieces (ascending), and per chunk on it (its terrain lies in the tile) the parts it holds, flat (key, k0, k1) by key. */
interface Held {
  readonly keys: ReadonlyArray<number>
  readonly lines: ReadonlyArray<number>
  readonly chunks: ReadonlyMap<number, ReadonlyArray<number>>
}

/** The tiles in a chunk plan (`chunkTiles` in render/chunk-tiles): each tile's key and index, and per chunk the tiles under its square. */
interface Plan {
  readonly keys: ReadonlyArray<string>
  readonly index: ReadonlyMap<string, number>
  readonly terrain: ReadonlyArray<ReadonlyArray<number>>
}

/** The static world's pieces: the global ones, and those of the tiles in (`provide`, `drop`). */
export class Pieces {
  private readonly plan: Plan
  private readonly made = new Map<number, Made>()
  private readonly held: Array<Held | undefined>
  /** The road and river pieces of the tiles round map point (x, y) (which must be in): every one within the tiles' halo of it (`HALO`). */
  private readonly roadsNear: RoadsNear = (x, y) => {
    const found = new Set<number>()
    for (const key of tilesOver(x, y, x, y))
      for (const k of this.heldAt(this.plan.index.get(key)!).lines) found.add(k)
    return [...found].sort((a, b) => a - b).map((k) => this.piece(k))
  }
  private readonly global: ReadonlyArray<Piece> = globalPieces(this.roadsNear)
  private readonly globalChunks = bucketPieces(this.global)

  /** The pieces of the world planned as `plan`: the global ones are made now, reading no tile. */
  constructor(plan: Plan) {
    this.plan = plan
    this.held = plan.keys.map(() => undefined)
  }

  /** Tile `t`'s vectors are in: makes the pieces of its buildings, roads and rivers that are not made yet, and lists the chunks on it they reach. */
  provide(t: number, vectors: TileVectors): void {
    if (this.held[t] !== undefined) return
    const keys: Array<number> = [],
      lines: Array<number> = [],
      chunks = new Map<number, Array<number>>(),
      terrain = this.plan.terrain
    const hold = (key: number, make: () => Piece) => {
      let made = this.made.get(key)
      if (made === undefined) {
        const piece = make()
        this.made.set(key, (made = { piece, ranges: rangesOf(piece.pts), holders: 0 }))
      }
      made.holders++
      keys.push(key)
      const ranges = made.ranges
      for (let n = 0; n < ranges.length; n += 3) {
        const chunk = ranges[n]!
        if (!terrain[chunk]!.includes(t)) continue
        let list = chunks.get(chunk)
        if (list === undefined) chunks.set(chunk, (list = []))
        list.push(key, ranges[n + 1]!, ranges[n + 2]!)
      }
    }
    const { buildings, roads, water } = vectors
    buildings.ids.forEach((i, k) => hold(i, () => buildingPiece(buildings.items[k]!)))
    roads.ids.forEach((r, k) => {
      const info = MAP.roads[r]!
      if (info.tunnel === true) return
      let made: Array<Piece> | undefined
      const part = (n: 0 | 1) => () => (made ??= roadPieces({ ...info, ...roads.items[k]! }))[n]!
      hold(roadKey(r, 0), part(0))
      lines.push(roadKey(r, 0))
      if (info.bridge !== true) return
      hold(roadKey(r, 1), part(1))
      lines.push(roadKey(r, 1))
    })
    water.ids.forEach((w, k) => {
      hold(waterKey(w), () => waterPiece(water.items[k]!))
      lines.push(waterKey(w))
    })
    this.held[t] = { keys, lines, chunks }
  }

  /** Tile `t` goes: the pieces no other tile in holds go with it. */
  drop(t: number): void {
    for (const key of this.held[t]?.keys ?? []) {
      const made = this.made.get(key)!
      if (--made.holders === 0) this.made.delete(key)
    }
    this.held[t] = undefined
  }

  /**
   * What chunk `key` draws, flat (piece key, k0, k1) triples in draw order: the pieces of the tiles under its square
   * (which must be in), each once, then the global ones.
   */
  entries(key: number): Array<number> {
    const parts: Array<ReadonlyArray<number>> = []
    for (const t of this.plan.terrain[key]!) {
      const list = this.heldAt(t).chunks.get(key)
      if (list !== undefined) parts.push(list)
    }
    // Each tile's list is in key order; a piece several of them hold reaches the chunk over the same segments in each.
    const out: Array<number> = parts.length === 1 ? [...parts[0]!] : []
    if (parts.length > 1) {
      const order: Array<readonly [number, number, number]> = []
      for (const list of parts)
        for (let n = 0; n < list.length; n += 3) order.push([list[n]!, list[n + 1]!, list[n + 2]!])
      order.sort((a, b) => a[0] - b[0])
      for (const [k, k0, k1] of order) if (out.at(-3) !== k) out.push(k, k0, k1)
    }
    const global = this.globalChunks[key]!
    for (let n = 0; n < global.length; n += 3)
      out.push(GLOBAL + global[n]!, global[n + 1]!, global[n + 2]!)
    return out
  }

  /** The piece of key `key` (from `entries`), which a tile in holds or the map's global. */
  piece(key: number): Piece {
    if (key >= GLOBAL) return this.global[key - GLOBAL]!
    const made = this.made.get(key)
    if (made === undefined) throw new Error(`render: piece ${key} is in no tile in`)
    return made.piece
  }

  /** What tile `t` brought; throws when it is not in. */
  private heldAt(t: number): Held {
    const held = this.held[t]
    if (held === undefined) throw new Error(`map tile ${this.plan.keys[t]} not handed to the world`)
    return held
  }
}

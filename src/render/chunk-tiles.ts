/**
 * Which map tiles each chunk of the static world reads (`src/sim/map/tiles.ts`), and the tiles'
 * boxes for the first level of the streaming plan. A chunk's terrain reads the tiles under its
 * square (an apron chunk's, the edge tiles it clamps to); its build reads the tiles under its needs
 * box: the square, where its pieces draw (`Piece.reads`, or the segments it draws and their
 * neighbours) `REACH` m round, and an apron chunk's mirror image across the map edge, where its
 * mirrored trees stand. A pure function of the map and the pieces, worked out once with the world.
 *
 * @module render/chunk-tiles
 */
import { MAP } from "../sim/map/index.ts"
import { tileKey } from "../sim/map/kinds.ts"
import { tilesOver } from "../sim/map/tiles.ts"
import { boundBox, CHUNKS, chunkRect } from "./chunks.ts"
import { boxOver, type Piece } from "./geometry.ts"

/**
 * How far round a piece's segments (or its `reads` box) its draw reads the ground, m: a mitred
 * ribbon's edge (twice the 12 m widest road's half width at the sharpest mitre), the ballast bed's
 * foot, a lamp's pole, a name board's posts, a building's window sills (1 m out of its walls), a
 * crossing's housings and cabinet off its box, a portal's throat (at most 41 m into the hill).
 */
const REACH = 50

/** Every chunk's and every tile's part in the streaming plan (`chunkTiles`); tiles are indices into `MAP.tiles`. */
interface ChunkTiles {
  /** Each tile's key, by index. */
  readonly keys: ReadonlyArray<string>
  /** Each tile's index, by key. */
  readonly index: ReadonlyMap<string, number>
  /** Per chunk, the tiles its terrain reads. */
  readonly terrain: ReadonlyArray<ReadonlyArray<number>>
  /** Per chunk, the tiles its build reads (its terrain's among them). */
  readonly needs: ReadonlyArray<ReadonlyArray<number>>
  /** Per tile, the chunks whose build reads it. */
  readonly readers: ReadonlyArray<ReadonlyArray<number>>
  /** Per tile, the chunks it plans: those whose middle it holds. */
  readonly owned: ReadonlyArray<ReadonlyArray<number>>
  /** Every chunk's box from its terrain tiles' lowest and highest nodes (`boundBox`): never smaller than its exact box. */
  readonly boxes: Float32Array
  /** Every tile's box (the layout of `boxes`): round the boxes of the chunks it plans. */
  readonly tileBoxes: Float32Array
}

/**
 * The map box chunk `key` reads the ground and the trees in, besides its pieces: its square, and
 * where it lies past a map edge, the square mirrored across that edge too (the trees mirrored into
 * the apron stand in the tiles there).
 */
const squareReads = (key: number): [number, number, number, number] => {
  const { minX, minY, maxX, maxY } = chunkRect(key),
    bounds = MAP.bounds
  return [
    maxX > bounds.maxX ? Math.min(minX, 2 * bounds.maxX - maxX) : minX,
    maxY > bounds.maxY ? Math.min(minY, 2 * bounds.maxY - maxY) : minY,
    minX < bounds.minX ? Math.max(maxX, 2 * bounds.minX - minX) : maxX,
    minY < bounds.minY ? Math.max(maxY, 2 * bounds.minY - minY) : maxY,
  ]
}

/** Where chunk `key` reads the ground: `squareReads` and its `entries` of `pieces` ((piece, k0, k1) triples, `bucketPieces`). */
const needsBox = (
  key: number,
  pieces: ReadonlyArray<Piece>,
  entries: ReadonlyArray<number>,
): [number, number, number, number] => {
  const box = squareReads(key)
  for (let n = 0; n < entries.length; n += 3) {
    const piece = pieces[entries[n]!]!,
      last = piece.pts.length / 2 - 1
    const [minX, minY, maxX, maxY] =
      piece.reads ??
      boxOver(piece.pts, Math.max(0, entries[n + 1]! - 1), Math.min(last, entries[n + 2]! + 2))
    box[0] = Math.min(box[0], minX - REACH)
    box[1] = Math.min(box[1], minY - REACH)
    box[2] = Math.max(box[2], maxX + REACH)
    box[3] = Math.max(box[3], maxY + REACH)
  }
  return box
}

/** The part every chunk and tile plays in streaming `pieces`, bucketed per chunk as `byChunk` (`bucketPieces`). */
export const chunkTiles = (
  pieces: ReadonlyArray<Piece>,
  byChunk: ReadonlyArray<ReadonlyArray<number>>,
): ChunkTiles => {
  const keys = MAP.tiles.map(({ i, j }) => tileKey(i, j)),
    index = new Map(keys.map((key, t) => [key, t]))
  // Most chunks read the same few lists: one array per distinct list.
  const lists = new Map<string, ReadonlyArray<number>>()
  const over = (minX: number, minY: number, maxX: number, maxY: number): ReadonlyArray<number> => {
    const found = tilesOver(minX, minY, maxX, maxY)
    const name = found.join(" ")
    let list = lists.get(name)
    if (list === undefined) lists.set(name, (list = found.map((key) => index.get(key)!)))
    return list
  }
  const count = CHUNKS.x * CHUNKS.y,
    terrain: Array<ReadonlyArray<number>> = [],
    needs: Array<ReadonlyArray<number>> = [],
    readers = keys.map((): Array<number> => []),
    owned = keys.map((): Array<number> => []),
    boxes = new Float32Array(count * 6)
  for (let key = 0; key < count; key++) {
    const { minX, minY, maxX, maxY } = chunkRect(key)
    terrain.push(over(minX, minY, maxX, maxY))
    needs.push(over(...needsBox(key, pieces, byChunk[key]!)))
    for (const t of needs[key]!) readers[t]!.push(key)
    const x = (minX + maxX) / 2,
      y = (minY + maxY) / 2,
      owner = over(x, y, x, y)[0] ?? terrain[key]![0]
    if (owner !== undefined) owned[owner]!.push(key)
    boundBox(
      boxes,
      key,
      terrain[key]!.map((t) => MAP.tiles[t]!),
    )
  }
  const tileBoxes = new Float32Array(keys.length * 6)
  for (const [t, chunks] of owned.entries()) {
    const box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
    for (const key of chunks)
      for (let k = 0; k < 6; k++)
        box[k] = (k % 2 === 0 ? Math.min : Math.max)(box[k]!, boxes[key * 6 + k]!)
    tileBoxes.set(box, t * 6)
  }
  return { keys, index, terrain, needs, readers, owned, boxes, tileBoxes }
}

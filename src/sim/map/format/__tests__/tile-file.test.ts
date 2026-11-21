import assert from "node:assert/strict"
import { test } from "node:test"

import {
  decodeTile,
  decodeTileVectors,
  encodeTile,
  relineTile,
  TILE_CELLS,
  TILE_NODES,
} from "../tile-file.ts"
import { plain } from "./plain.ts"

/** A tile of tile (−1, 0): its corner is (−2000, 0) m, so walls count from (−21000, −1000) dm and trees from (−2100, −100) m. */
const tile = {
  hash: "0123456789abcdef",
  i: -1,
  j: 0,
  heights: Int16Array.from({ length: TILE_NODES * TILE_NODES }, (_, k) => ((k * 7) % 4001) - 2000),
  walls: {
    // x from the origin: 0 then 32767 dm, then back to 0: deltas +32767 and −32767, the widest 2-byte zigzag codes
    walk: Float64Array.from([-2100, -100, 1176.7, 3176.7, -2100, -99.9, -2000.5, 0.3]),
    shore: Float64Array.from([-1999.5, 2.5, -1990.5, 4.5]),
    drive: new Float64Array(),
  },
  wallIds: {
    walk: Int32Array.from([0, 7]),
    shore: Int32Array.from([3]),
    drive: new Int32Array(),
  },
  // a wall at every level, and one at the highest level that fits
  wallLevels: { walk: Float64Array.from([NaN, 3276.7]), drive: new Float64Array() },
  // tree x from the origin: 0 then 32767 m, the widest 2-byte delta; scales in hundredths
  trees: Float64Array.from([-2100, -100, 0.8, 30667, 1999, 1.3]),
  ids: Int32Array.from([5, 1_000_000]),
  cover: Uint8Array.from({ length: TILE_CELLS * TILE_CELLS }, (_, k) => (k * 13) % 22),
  // full-precision doubles (a baked floor) come back exact
  vectors: {
    roads: {
      ids: [4, 9],
      items: [
        { pts: [-1990.1, 3.4, -1980, 3.4], z: [301.2, 302.25] },
        { pts: [0, 0], z: [1] },
      ],
    },
    buildings: {
      ids: [2, 5],
      items: [
        {
          id: -7,
          kind: "house",
          h: 6.5,
          z0: 300.1,
          style: "stone",
          tint: 2,
          outer: [0, 0, 4, 0, 4, 3],
        },
        // a court: its holes after its outer ring, its last key; a survey's id past 2^32
        {
          id: 1_099_511_627_779,
          kind: "church",
          name: "San Giorgio",
          h: 12,
          z0: 301.4,
          style: "stone",
          ruins: true,
          tint: 0,
          outer: [-1999.9, 10, -1960, 10, -1960, 50, -1999.9, 50],
          holes: [
            [-1990, 20, -1990, 30, -1980, 30],
            [-1970, 20, -1970, 30, -1965, 30],
          ],
        },
      ],
    },
    water: {
      ids: [0],
      items: [
        {
          id: 11,
          kind: "stream",
          w: 2,
          bed: 3,
          depth: 1,
          pts: [5, 5, 9, 9],
          z: [299.4, 299.1],
          area: [1.25, 1.31],
          floor: [Math.PI * 95, 0.1 + 0.2],
        },
      ],
    },
    areas: {
      ids: [0, 879],
      items: [
        // a lake's level before its rings, as some build keys them; a ring kilometres past the
        // tile, the jump to it past 2 bytes of decimetres
        { kind: "water", level: 231.5, rings: [[-12000, 5000.3, 9000.5, 5000.3, 9000.5, 13000.1]] },
        {
          kind: "forest",
          rings: [
            [-2100, -100, -1900, -100, -1900, 100],
            [-2000, 0, -1950, 0, -1950, 50],
          ],
          waters: [0],
        },
      ],
    },
    barriers: { ids: [1], items: [{ kind: "guard_rail", pts: [1, 2, 3, 4] }] },
  },
}

/** A tile file's JSON line. */
const lineOf = (file: Uint8Array): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(file.subarray(0, file.indexOf(10)))) as Record<
    string,
    unknown
  >

test("encodeTile and decodeTile round-trip a tile (negative values, the widest deltas, an empty section, walls with and without a level); a value too far throws", () => {
  const decoded = decodeTile(encodeTile(tile).file)
  assert.deepEqual(plain(decoded), plain(tile))
  // the vectors to the bit, keys in their order, as JSON gave them
  assert.equal(JSON.stringify(decoded.vectors), JSON.stringify(tile.vectors))
  assert.throws(
    () =>
      encodeTile({
        ...tile,
        walls: { ...tile.walls, drive: Float64Array.from([-2100, -100, 1176.8, 0]) },
        wallIds: { ...tile.wallIds, drive: Int32Array.from([0]) },
        wallLevels: { ...tile.wallLevels, drive: [NaN] },
      }),
    /tile -1_0 drive walls: 32768 at 2 is 32768 from the value 2 back, too far for 2 bytes/,
  )
  assert.throws(
    () =>
      encodeTile({ ...tile, heights: Array.from(tile.heights, (h, k) => (k === 5 ? 40000 : h)) }),
    /tile -1_0 heightmap: 40000 at 5 does not fit int16/,
  )
  assert.throws(
    () => encodeTile({ ...tile, cover: new Uint8Array(3) }),
    /tile -1_0 cover: 3 values where the file holds 250000/,
  )
  assert.throws(
    () => encodeTile({ ...tile, wallLevels: { ...tile.wallLevels, walk: [NaN, 3276.8] } }),
    /tile -1_0 walk wall levels: 3276.8 at 1 does not fit int16/,
  )
  assert.throws(
    () => encodeTile({ ...tile, wallLevels: { ...tile.wallLevels, walk: [NaN] } }),
    /tile -1_0 walk wall levels: 1 values where the file holds 2/,
  )
})

test("encodeTile refuses sections that share a count but disagree, and decodeTile a file whose sections do not end with it", () => {
  // the walk walls' count is their segments' (2), which their ids share
  assert.throws(
    () => encodeTile({ ...tile, wallIds: { ...tile.wallIds, walk: Int32Array.from([0]) } }),
    /tile -1_0 walk wall ids: 1 values where the file holds 2/,
  )
  assert.throws(
    () => encodeTile({ ...tile, ids: Int32Array.from([5]) }),
    /tile -1_0 tree ids: 1 values where the file holds 2/,
  )
  const file = encodeTile(tile).file,
    longer = new Uint8Array(file.length + 1)
  longer.set(file)
  assert.throws(
    () => decodeTile(longer),
    new RegExp(
      `a tile file's sections end at byte ${file.length} of ${file.length + 1}; the file and this decoder disagree`,
    ),
  )
})

test("the vectors' coordinates travel as the first section after the JSON line, which holds each xy array's vertex count in its place", () => {
  const file = encodeTile(tile).file,
    line = lineOf(file) as {
      readonly coordinates: number
      readonly vectors: {
        readonly buildings: { readonly items: ReadonlyArray<unknown> }
        readonly areas: { readonly items: ReadonlyArray<unknown> }
      }
    }
  // roads 2 + 1, buildings 3 + 4 + 3 + 3, water 2, areas 3 + 3 + 3, barriers 2 vertices
  assert.equal(line.coordinates, 2 * 29)
  assert.deepEqual(line.vectors.buildings.items[1], {
    ...tile.vectors.buildings.items[1],
    outer: 4,
    holes: [3, 3],
  })
  assert.deepEqual(line.vectors.areas.items[0], { ...tile.vectors.areas.items[0], rings: [3] })
  // A coordinate −0 reads back 0, as JSON gave it.
  const zero = { ...tile.vectors, barriers: { ids: [1], items: [{ kind: "wall", pts: [-0, 1] }] } }
  const back = decodeTile(encodeTile({ ...tile, vectors: zero }).file).vectors.barriers.items[0]!
  assert.ok(Object.is(back.pts[0], 0))
})

test("encodeTile throws on a vector coordinate off the decimetre and an xy array of an odd length", () => {
  const roads = (pts: ReadonlyArray<number>) => ({
    ...tile,
    vectors: { ...tile.vectors, roads: { ids: [4], items: [{ pts, z: [1, 2] }] } },
  })
  assert.throws(
    () => encodeTile(roads([-1990.1, 3.4, -1980.05, 3.4])),
    /tile -1_0 coordinates: -1980.05 at 2 is not a whole number of decimetres/,
  )
  assert.throws(
    () => encodeTile(roads([-1990.1, 3.4, -1980])),
    /tile -1_0 coordinates: an xy array of 3 values/,
  )
})

test("decodeTileVectors reads the line and the coordinates alone: the vectors, with which tile and build they are", () => {
  // The full map's detail reads the vectors alone: the dense layers cut off, they decode the same.
  const file = encodeTile(tile).file,
    head = file.subarray(0, file.indexOf(10) + 1 + 4 * (lineOf(file).coordinates as number))
  const alone = decodeTileVectors(head)
  assert.deepEqual(
    [alone.hash, alone.i, alone.j, plain(alone.vectors)],
    [tile.hash, tile.i, tile.j, plain(tile.vectors)],
  )
  assert.equal(JSON.stringify(alone.vectors), JSON.stringify(tile.vectors))
})

test("relineTile sets a tile's vectors, its line and its coordinates written again, or its hash alone, as encodeTile packs them, its dense layers' sections unchanged", () => {
  const empty = { ids: [], items: [] },
    bare = encodeTile({
      ...tile,
      hash: "",
      vectors: { roads: empty, buildings: empty, water: empty, areas: empty, barriers: empty },
    }).file
  const vectors = relineTile(bare, { vectors: tile.vectors })
  assert.deepEqual(vectors, encodeTile({ ...tile, hash: "" }).file)
  assert.deepEqual(relineTile(vectors, { hash: tile.hash }), encodeTile(tile).file)
  // new vectors over old ones: the old coordinates go
  const fewer = { ...tile.vectors, areas: empty }
  assert.deepEqual(
    relineTile(encodeTile(tile).file, { vectors: fewer }),
    encodeTile({ ...tile, vectors: fewer }).file,
  )
})

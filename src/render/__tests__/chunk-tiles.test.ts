import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, Vector3 } from "three"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, isResident, provideTile, setTileSource } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS, chunkOf } from "../chunks.ts"
import { terrainY } from "../ground.ts"
import { linePieces } from "../lines.ts"
import { railPieces } from "../rail.ts"
import { stationPieces } from "../stations.ts"
import { bucketPieces, World } from "../world.ts"

const count = CHUNKS.x * CHUNKS.y
const empty = chunkTiles(
  [],
  Array.from({ length: count }, () => []),
)

test("chunk tiles: a chunk's build reads its terrain's tiles; one tile plans each chunk, its box round the chunk's", () => {
  const planned = new Map<number, number>()
  for (const [t, chunks] of empty.owned.entries())
    for (const key of chunks) {
      assert.equal(planned.get(key), undefined, `chunk ${key} planned twice`)
      planned.set(key, t)
      for (let k = 0; k < 6; k++)
        assert.ok(
          k % 2 === 0
            ? empty.tileBoxes[t * 6 + k]! <= empty.boxes[key * 6 + k]!
            : empty.tileBoxes[t * 6 + k]! >= empty.boxes[key * 6 + k]!,
          `tile ${empty.keys[t]} holds chunk ${key}`,
        )
    }
  assert.equal(planned.size, count, "every chunk planned")
  for (let key = 0; key < count; key++) {
    assert.ok(empty.terrain[key]!.length > 0, `chunk ${key} lies on the tiles`)
    for (const t of empty.terrain[key]!) assert.ok(empty.needs[key]!.includes(t))
    for (const t of empty.needs[key]!) assert.ok(empty.readers[t]!.includes(key))
  }
})

test("chunk tiles: a crossing's chunk reads the ground under the road ribbons it lies over", () => {
  const lines = linePieces(),
    pieces = [...lines, ...railPieces(lines), ...stationPieces()],
    tiles = chunkTiles(pieces, bucketPieces(pieces))
  for (let key = 0; key < count; key++)
    for (const t of empty.needs[key]!) assert.ok(tiles.needs[key]!.includes(t))
  assert.ok(
    tiles.needs.some((needs, key) => needs.length > empty.needs[key]!.length),
    "some chunk reads past its square",
  )
})

// Regression (review of #5): the crossing test above passed on road ribbons alone; a piece's own `reads` box must count.
test("chunk tiles: a piece that reads the ground across a seam far from what it draws makes its chunk read that tile", () => {
  // A 1 m piece mid-tile in 0_0, whose draw reads the ground up to 2100 m east: across the x = 2000 seam, in tile 1_0.
  const piece = {
    pts: [1000, 1000, 1001, 1000],
    draw: () => {},
    reads: [1000, 990, 2100, 1010] as const,
  }
  const tiles = chunkTiles([piece], bucketPieces([piece])),
    key = chunkOf(1000, 1000)
  assert.ok(
    !empty.needs[key]!.includes(tiles.index.get("1_0")!),
    "its square reaches no other tile",
  )
  assert.ok(tiles.needs[key]!.includes(tiles.index.get("1_0")!), "its reads box does")
})

/** Map points round which a chunk's build reads past its square or across a tile seam. */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...MAP.railway.crossings.map(({ x, y }) => [x, y] as const),
  ...MAP.railway.platforms.map(({ axis }) => [axis[0]!, axis[1]!] as const),
  ...MAP.rail.flatMap((rail) =>
    rail.tunnel === true ? [[rail.pts[0]!, rail.pts[1]!] as const] : [],
  ),
  [MAP.bounds.minX, MAP.bounds.minY],
  [MAP.bounds.maxX, MAP.bounds.maxY],
  [MAP.bounds.minX, 0],
  [0, MAP.bounds.maxY],
]

test("chunk tiles: with only some of the tiles in, every chunk that builds reads only those", () => {
  const disk = (key: string) => readMapFile(tileUrl(MAP.name, key))
  let built = 0
  try {
    for (const [x, y] of SPOTS) {
      const focus = new Vector3(x, terrainY(x, y), -y),
        probe = new World(new Group())
      probe.update(focus, 0, 60, Infinity)
      const wanted = [...probe.wanted()]
      if (wanted.length < 2) continue
      // Each tile alone, and all but each one: whatever builds must read nothing else, or the lookup throws.
      for (const some of [
        ...wanted.map((key) => [key]),
        ...wanted.map((out) => wanted.filter((key) => key !== out)),
      ]) {
        setTileSource(undefined)
        for (const { i, j } of MAP.tiles) dropTile(`${i}_${j}`)
        for (const key of some) provideTile(disk(key))
        const world = new World(new Group())
        for (const key of some) world.tileProvided(key)
        world.update(focus, 0, 60, Infinity)
        built += world.loaded.size
        assert.ok(wanted.every((key) => some.includes(key) === isResident(key)))
        setTileSource(disk)
      }
    }
  } finally {
    setTileSource(disk)
  }
  assert.ok(built > 100, `${built} chunks built with some tiles out`)
})

import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeMap } from "../../sim/map/format/global-file.ts"
import { relined } from "../../sim/map/format/sections.ts"
import { decodeTile } from "../../sim/map/format/tile-file.ts"
import { joinTiles } from "../map-file.ts"
import { decodeUpgraded } from "../map-upgrade.ts"
import { cutMap, stampMap } from "../tile-map.ts"
import { built, data, withVectors } from "./built-map.ts"

/** A file's JSON line. */
const lineOf = (file: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(file.subarray(0, file.indexOf(10)))) as {
    readonly coordinates: number
    readonly derived: object
  }

/** `file` without its `bytes` bytes from byte `from` on. */
const without = (file: Uint8Array, from: number, bytes: number): Uint8Array =>
  new Uint8Array([...file.subarray(0, from), ...file.subarray(from + bytes)])

test("decodeUpgraded reads a build of version 6, whose global file's line holds the parked spots, the farms, their centres and the lamps and whose tiles' lines hold their vectors' coordinates, as the same build of today's", () => {
  const map = withVectors(built(data))
  const bakes = {
    parked: {
      parked: [
        {
          x: 1.5,
          y: -2,
          angle: 0.785,
          rest: { panda: [301.20000000000005, 0.01, -0.02], truck: [301.9, 0, 0.1 + 0.2] },
          truck: true,
        },
        { x: -3, y: 4.1, angle: -1, rest: {} },
      ],
    },
    farms: {
      farms: [{ building: 1, rural: true, pen: false }],
      centres: [105, 103.33333333333333],
    },
    lamps: { lamps: [{ x: 1.0000000000000002, y: -2.5, nx: 0, ny: 1, kind: "wall", z: 304.53 }] },
    floors: [[279.31, 278.123456789]],
  } as const
  const cut = cutMap(map, "test"),
    tiles = [...cut.tiles(bakes).files.values()],
    { global, file, sizes, tile } = stampMap(cut.global(bakes), tiles)
  // version 6's global file: its line with the four tables, then its sections up to the residents
  const parts = Object.keys(sizes),
    after = parts.slice(parts.indexOf("residents") + 1)
  assert.equal(after.length, 9)
  const { spawns, farms, lamps, derived } = global
  const v6 = relined(
    file.subarray(0, file.length - after.reduce((sum, part) => sum + sizes[part]!, 0)),
    {
      version: 6,
      spawns,
      farms,
      lamps,
      derived: { ...lineOf(file).derived, farms: derived.farms },
    },
  )
  // a version-6 tile: its vectors on its line, its dense layers' sections after it
  const v6Tile = (stamped: Uint8Array): Uint8Array =>
    relined(without(stamped, stamped.indexOf(10) + 1, 4 * lineOf(stamped).coordinates), {
      version: 6,
      coordinates: undefined,
      vectors: decodeTile(stamped).vectors,
    })
  const old = decodeUpgraded(v6),
    today = decodeUpgraded(file)
  const oldMap = joinTiles(
      old.global,
      tiles.map((f) => old.decodeTile(v6Tile(tile(f)))),
    ),
    todayMap = joinTiles(
      today.global,
      tiles.map((f) => today.decodeTile(tile(f))),
    )
  assert.deepEqual([old.global, oldMap], [today.global, todayMap])
  // the keys in their order too
  assert.equal(JSON.stringify([old.global, oldMap]), JSON.stringify([today.global, todayMap]))
  assert.deepEqual(today.global, decodeMap(file))
  assert.deepEqual(today.decodeTile(tile(tiles[0]!)), decodeTile(tile(tiles[0]!)))
  assert.deepEqual(
    [old.global.spawns.parked, old.global.farms, old.global.derived.farms, old.global.lamps],
    [bakes.parked.parked, bakes.farms.farms, bakes.farms.centres, bakes.lamps.lamps],
  )
  assert.deepEqual([oldMap.buildings, oldMap.areas], [map.buildings, map.areas])
})

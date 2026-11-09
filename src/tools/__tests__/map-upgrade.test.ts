import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeMap } from "../../sim/map/format/global-file.ts"
import { relined } from "../../sim/map/format/sections.ts"
import { decodeTile } from "../../sim/map/format/tile-file.ts"
import { joinTiles } from "../map-file.ts"
import { decodeUpgraded } from "../map-upgrade.ts"
import { cutMap, stampMap } from "../tile-map.ts"
import { built, data } from "./built-map.ts"

test("decodeUpgraded reads a build of version 5, whose global file's line holds the graph, the lanes and the residents, as the same build of today's", () => {
  const map = {
    ...built(data),
    graph: { xy: [0, 0, 10.5, -3.2], edges: [0, 1, 0], traffic: [0], walk: [0] },
  }
  const bakes = {
    lanes: {
      lanes: {
        panda: [2.0500000000000003, -1],
        ape: [-1, -1],
        truck: [-1, -1],
        carabinieri: [1.8, 0],
      },
    },
    residents: { residents: [Math.fround(1.3)] },
  }
  const cut = cutMap(map, "test"),
    tiles = [...cut.tiles(bakes).files.values()],
    { global, file, tile } = stampMap(cut.global(bakes), tiles)
  // version 5's file: its line with the arrays, then the coarse grid's two sections alone
  const { cols, rows } = global.coarse,
    { graph, lanes, derived } = global
  const v5 = relined(file.subarray(0, file.indexOf(10) + 1 + 3 * cols * rows), {
    version: 5,
    graph,
    lanes,
    derived,
  })
  const old = decodeUpgraded(v5),
    today = decodeUpgraded(file)
  const oldMap = joinTiles(
      old.global,
      tiles.map((f) => old.decodeTile(relined(tile(f), { version: 5 }))),
    ),
    todayMap = joinTiles(
      today.global,
      tiles.map((f) => today.decodeTile(tile(f))),
    )
  assert.deepEqual(oldMap, todayMap)
  assert.deepEqual(today.global, decodeMap(file))
  assert.deepEqual(today.decodeTile(tile(tiles[0]!)), decodeTile(tile(tiles[0]!)))
  assert.deepEqual([oldMap.graph, oldMap.lanes], [map.graph, bakes.lanes.lanes])
  // a version-5 line has no run-outs: each line runs on with none
  const withLine = relined(v5, { railway: { ...global.railway, lines: [{ id: 3 }] } })
  assert.deepEqual(decodeUpgraded(withLine).global.railway.lines, [{ runOuts: [[], []], id: 3 }])
})

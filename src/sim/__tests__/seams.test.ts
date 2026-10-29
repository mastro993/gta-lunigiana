import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { graph, MAP } from "../map/index.ts"
import { tileKey } from "../map/kinds.ts"
import { readMapFile, tileUrl } from "../map/packed.ts"
import { dropTile, provideTile, residentTiles, setTileSource } from "../map/tiles.ts"
import { jsonSave, rolling, start } from "../testing.ts"

const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))

/** The traffic edge of Via Borgo Monzone whose chord crosses the seam `axis` = 0 nearest Monzone station, found by geometry. */
const across = (axis: "x" | "y") => {
  const other = axis === "x" ? "y" : "x"
  const edge = graph.trafficEdges.find((e) => {
    const { a, b, road } = graph.edges[e]!
    const p = graph.nodes[a]!,
      q = graph.nodes[b]!
    return (
      MAP.roads[road]!.name === "Via Borgo Monzone" &&
      Math.sign(p[axis]) !== Math.sign(q[axis]) &&
      Math.abs(p[other]) < 50
    )
  })!
  const { a, b } = graph.edges[edge]!
  const p = graph.nodes[a]!,
    q = graph.nodes[b]!
  const angle = Ops.atan2(q.y - p.y, q.x - p.x)
  // 6 m short of the seam along the edge, heading for it.
  const t = p[axis] / (p[axis] - q[axis]),
    back = 6 / Ops.hypot(q.x - p.x, q.y - p.y)
  return {
    x: p.x + (q.x - p.x) * (t - back),
    y: p.y + (q.y - p.y) * (t - back),
    angle,
  }
}

/**
 * Two cars rolling across the x = 0 and the y = 0 seams of Via Borgo Monzone (tiles −1_0, 0_0 and −1_−1), the player
 * watching from the street between them: every frame's world and the save at the end.
 */
const drive = (lazy: boolean) => {
  for (const key of KEYS) dropTile(key)
  setTileSource(fromDisk)
  // All loaded: every tile in memory before the first step, in reverse key order; lazy: each read in when a lookup
  // first needs it, and every tile let go again every 20 steps.
  if (!lazy) for (const key of [...KEYS].reverse()) provideTile(fromDisk(key))
  const east = across("x"),
    south = across("y")
  const s = start(
    [],
    [
      // The player in the street between them.
      { x: (east.x + south.x) / 2, y: (east.y + south.y) / 2, angle: 0 },
      { cars: [rolling("panda", east, 6, 0.3), rolling("panda", south, 6, 0.3)] },
    ],
    {
      alone: true,
    },
  )
  const frames: Array<unknown> = []
  let fewest = KEYS.length
  s.run(150, (frame) => {
    frames.push(s.world())
    if (lazy && frame % 20 === 19) {
      fewest = Math.min(fewest, residentTiles().length)
      for (const key of KEYS) dropTile(key)
    }
  })
  return { frames, save: jsonSave(s.runtime), fewest, cars: s.world().vehicles }
}

test("seams: cars driven across the x = 0 and y = 0 seams by Monzone station end the same with tiles read in lazily as with every tile in memory", () => {
  const lazy = drive(true),
    loaded = drive(false)
  assert.ok(lazy.fewest < 8, `${lazy.fewest} tiles in memory between drops`)
  assert.deepEqual(lazy.frames, loaded.frames)
  assert.deepEqual(lazy.save, loaded.save)
  const [a, b] = loaded.cars
  // Both crossed: the first car's x and the second's y changed sign.
  assert.ok(a !== undefined && b !== undefined)
  const east = across("x"),
    south = across("y")
  assert.ok(Math.sign(a.x) !== Math.sign(east.x), `car 1 at ${a.x},${a.y}`)
  assert.ok(Math.sign(b.y) !== Math.sign(south.y), `car 2 at ${b.x},${b.y}`)
})

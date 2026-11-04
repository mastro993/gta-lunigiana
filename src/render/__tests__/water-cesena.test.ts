import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP_URL, provideMap, readMapFile } from "../../sim/map/packed.ts"

// This process loads Cesena, whose Savio's river polygon reaches its map's north edge (Lunigiana's
// lakes and river polygons all stand inside its bounds): the global file goes in before anything
// decodes the map.
provideMap(readMapFile(new URL("cesena.bin", MAP_URL)))
const { MAP, TILE } = await import("../../sim/map/index.ts")
const { chunkCells, chunkOf, chunkRect } = await import("../chunks.ts")
const { vectorsAround } = await import("../testing.ts")
const { inPool } = await import("../water.ts")
const { boxOf, cellsOf, centreOf, chunksOf, drawn, LAST, poolAreas, wetCells } =
  await import("./pools.ts")

const hm = MAP.heightmap
/** The tiles along the north edge, and their lakes and river polygons: never the whole map's. */
const POOL_AREAS = (() => {
  const { minX, maxX, maxY } = MAP.bounds,
    spots: Array<{ readonly x: number; readonly y: number }> = []
  for (let x = minX; x <= maxX; x += TILE) spots.push({ x, y: maxY })
  return poolAreas(vectorsAround(spots, 0))
})()
const { wetCell, wetCellsOf } = wetCells(POOL_AREAS)

/** The Savio's river polygon at the north edge of the map, found by geometry: the one reaching the edge. */
const SAVIO = (() => {
  const area = POOL_AREAS.find((a) => a.waters !== undefined && boxOf(a)[3] >= MAP.bounds.maxY)
  assert.ok(area !== undefined, "a river polygon reaching the map's north edge")
  return { area, cells: cellsOf(area) }
})()

test("poolWater, Cesena: in the apron north of the Savio its edge cells' water carries on, its nodes the edge nodes'", () => {
  assert.equal(MAP.name, "cesena")
  const edgeCell = SAVIO.cells.find(({ j }) => j === LAST.j)
  assert.ok(edgeCell !== undefined, "the Savio's polygon holds an edge cell")
  const edge = chunksOf([edgeCell])[0]!,
    { x } = centreOf(edgeCell.i, edgeCell.j),
    apron = chunkOf(x, chunkRect(edge).maxY + hm.cell / 2)
  assert.ok(chunkCells(apron).j0 > LAST.j && apron !== edge, "a chunk all apron, north of the edge")
  const quads = drawn(apron)
  assert.ok(quads.length > 0, "water in the apron")
  assert.deepEqual(
    quads.map((q) => `${q.i},${q.j}`).sort(),
    wetCellsOf(apron),
    "a quad over each apron cell beyond a cell of a water area",
  )
  // The edge chunk's nodes on the edge, where the apron's take their water from.
  const onEdge = new Map<number, ReadonlyArray<number>>()
  for (const { corners } of drawn(edge))
    for (const c of corners)
      if (c.j === hm.rows - 1) onEdge.set(c.i, [c.h, c.stage, ...c.flow, c.still])
  for (const { corners } of quads)
    for (const c of corners)
      assert.deepEqual(
        [c.h, c.stage, ...c.flow, c.still],
        onEdge.get(c.i),
        `node ${c.i},${c.j}: the edge node's water`,
      )
  const { i0, j0, i1, j1 } = chunkCells(apron),
    y = hm.y0 + ((j0 + j1) / 2) * hm.cell
  const dry = Array.from({ length: i1 - i0 }, (_, k) => i0 + k).find((i) => !wetCell(i, LAST.j))
  assert.ok(dry !== undefined, "an apron column beyond dry ground")
  assert.equal(inPool(x, y), true, "inPool in the apron beyond a cell of the polygon")
  assert.equal(inPool(hm.x0 + (dry + 0.5) * hm.cell, y), false, "inPool beyond dry ground")
})

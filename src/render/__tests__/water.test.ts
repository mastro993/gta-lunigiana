import assert from "node:assert/strict"
import { test } from "node:test"

import { terrainNodeZ } from "../../sim/map/ground.ts"
import { MAP } from "../../sim/map/index.ts"
import { emptySink, type Triangles } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { waterPiece } from "../lines.ts"
import { strips } from "../ribbons.ts"
import { residentAround, vectorsAround } from "../testing.ts"
import { inPool } from "../water.ts"
import { boxOf, cellsOf, centreOf, chunksOf, drawn, holds, poolAreas, wetCells } from "./pools.ts"

// water-cesena.test.ts checks the apron's water on Cesena, whose Savio reaches its map's edge: since
// Fivizzano joined, every lake and river polygon of Lunigiana stands inside its bounds.

const hm = MAP.heightmap
/** A point in the box of the Aulella's river polygon, across lucido's north edge (y 3900). */
const ON_AULELLA = { x: 4350, y: 3870 }

/**
 * The vectors of the tiles round the Bozzetti pond by the Solco di Equi and the Aulella's river
 * polygon (found by geometry in them below), and their lakes and river polygons: never the whole
 * map's.
 */
const NEAR = vectorsAround([{ x: 2220, y: 880 }, ON_AULELLA], 300)
const POOL_AREAS = poolAreas(NEAR)
const { wetCell, wetCellsOf } = wetCells(POOL_AREAS)

/** The Bozzetti pond, a lake across two chunks: its cells, chunks, and the box round it whose tiles it reads. */
const POND = (() => {
  const area = NEAR.areas.items.find((a) => a.kind === "lake" && a.name === "Bozzetti")
  assert.ok(area?.level !== undefined, "the Bozzetti pond, a lake with its level")
  const cells = cellsOf(area),
    [x0, y0, x1, y1] = boxOf(area)
  return {
    area,
    level: area.level,
    cells,
    chunks: chunksOf(cells),
    centre: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    reach: Math.max(x1 - x0, y1 - y0) / 2 + 2 * hm.cell,
  }
})()

/** The Aulella's river polygon, found by geometry: the river polygon whose box holds `ON_AULELLA`. */
const AULELLA = (() => {
  const { x, y } = ON_AULELLA
  const area = POOL_AREAS.find((a) => {
    const [x0, y0, x1, y1] = boxOf(a)
    return a.waters !== undefined && x0 <= x && x1 >= x && y0 <= y && y1 >= y
  })
  assert.ok(area !== undefined, "the Aulella's river polygon")
  const cells = cellsOf(area)
  return { area, cells, chunks: chunksOf(cells) }
})()

/** The quads of `tris` (drawn by `quad`: a-b-c, a-c-d) as their four corners' map (x, y). */
const ribbonQuads = (tris: Triangles): Array<ReadonlyArray<readonly [number, number]>> => {
  const p = tris.position,
    at = (v: number) => [p[3 * v]!, -p[3 * v + 2]!] as const
  return Array.from({ length: p.length / 18 }, (_, q) => [
    at(6 * q),
    at(6 * q + 1),
    at(6 * q + 2),
    at(6 * q + 5),
  ])
}

test("poolWater: the Bozzetti pond is one quad over each cell whose centre it holds, flat at its level, with how deep it stands over each node", () => {
  residentAround([POND.centre], POND.reach)
  assert.ok(POND.cells.length > 4 && POND.chunks.length === 2, "a pond across two chunks")
  const quads = POND.chunks.flatMap((key) => {
    const own = drawn(key)
    assert.deepEqual(
      own.map((q) => `${q.i},${q.j}`).sort(),
      wetCellsOf(key),
      `chunk ${key}: a quad per cell a water area holds, none twice`,
    )
    return own
  })
  const pond = quads.filter((q) => POND.cells.some(({ i, j }) => i === q.i && j === q.j))
  assert.equal(pond.length, POND.cells.length, "every cell of the pond")
  for (const { corners } of pond)
    for (const c of corners) {
      const at = `node ${c.i},${c.j}`
      assert.equal(c.h, yOf(POND.level), `${at}: at the pond's level`)
      assert.equal(c.stage, 0, `${at}: no rise with the rivers`)
      assert.equal(c.flow[2], 0, `${at}: no current`)
      assert.ok(c.still >= 0, `${at}: ${c.still} m deep`)
      assert.ok(
        Math.abs(c.still - Math.max(0, POND.level - terrainNodeZ(c.i, c.j))) < 1e-9,
        `${at}: as deep as its level stands over the terrain`,
      )
    }
  assert.ok(
    pond.some((q) => q.corners.some((c) => c.still > 0)),
    "deeper than nothing somewhere",
  )
})

test("poolWater: neighbouring chunks draw the same water at the nodes they share, the pond's and the Aulella's", () => {
  residentAround([POND.centre], POND.reach)
  for (const { name, chunks } of [
    { name: "the pond", chunks: POND.chunks },
    { name: "the Aulella", chunks: AULELLA.chunks },
  ]) {
    assert.ok(chunks.length >= 2, `${name} across chunks`)
    const seen = new Map<string, { readonly key: number; readonly value: ReadonlyArray<number> }>()
    let shared = 0
    for (const key of chunks)
      for (const { corners } of drawn(key))
        for (const c of corners) {
          const node = `${c.i},${c.j}`,
            value = [c.h, c.stage, ...c.flow, c.still],
            first = seen.get(node)
          if (first === undefined) seen.set(node, { key, value })
          else {
            assert.deepEqual(
              value,
              first.value,
              `${name}: node ${node} in chunks ${first.key}, ${key}`,
            )
            if (first.key !== key) shared++
          }
        }
    assert.ok(shared > 0, `${name}: chunks sharing nodes`)
  }
})

test("inPool: a cell whose centre a water area holds is pool all over, a cell beside it whose centre none holds is none of it", () => {
  /** Points 0.1 m inside each corner of cell (i, j), and its centre. */
  const pointsOf = (i: number, j: number) => {
    const x = hm.x0 + i * hm.cell,
      y = hm.y0 + j * hm.cell,
      a = 0.1,
      b = hm.cell - 0.1
    return [
      centreOf(i, j),
      { x: x + a, y: y + a },
      { x: x + b, y: y + a },
      { x: x + b, y: y + b },
      { x: x + a, y: y + b },
    ]
  }
  let outside = 0,
    inside = 0,
    beside = 0
  for (const { i, j } of POND.cells) {
    for (const p of pointsOf(i, j)) {
      assert.equal(inPool(p.x, p.y), true, `(${p.x}, ${p.y}) in pond cell ${i},${j}`)
      if (!holds(POND.area.rings, p.x, p.y)) outside++
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (wetCell(i + di, j + dj)) continue
      beside++
      for (const p of pointsOf(i + di, j + dj)) {
        assert.equal(inPool(p.x, p.y), false, `(${p.x}, ${p.y}) beside the pond`)
        if (holds(POND.area.rings, p.x, p.y)) inside++
      }
    }
  }
  assert.ok(beside > 0, "cells beside the pond")
  assert.ok(outside > 0, "a pond cell's corner past the pond's outline is pool all the same")
  assert.ok(inside > 0, "a cell beside it the outline reaches into is no pool all the same")
})

test("ribbons: a quad all four corners of which cover holds is left out, one with a corner past it is drawn", () => {
  // A ribbon 2 m wide straight across the pond on the line between two rows of its cells.
  const rows = POND.cells.map(({ j }) => j),
    j = rows.find((r) => rows.includes(r - 1))!,
    y = hm.y0 + j * hm.cell,
    [x0, , x1] = boxOf(POND.area)
  const spec = {
    pts: [x0 - 2 * hm.cell, y, x1 + 2 * hm.cell, y],
    z: [POND.level, POND.level],
    width: 2,
    hex: 0x3a6f8f,
    y: (_x: number, _y: number, z: number) => yOf(z),
  }
  const draw = (cover?: (x: number, y: number) => boolean) => {
    const into = emptySink()
    strips(spec, [cover === undefined ? spec : { ...spec, cover }]).draw(() => into, 0, 0)
    return ribbonQuads(into.decal)
  }
  const bare = draw(),
    covered = draw(inPool)
  const under = (quad: ReadonlyArray<readonly [number, number]>) =>
    quad.filter(([x, y]) => inPool(x, y)).length
  assert.deepEqual(
    covered,
    bare.filter((quad) => under(quad) < 4),
    "the quads but those all over pool cells",
  )
  assert.ok(covered.length < bare.length, "some quads left out")
  assert.ok(
    covered.some((quad) => under(quad) > 0),
    "a quad partly over pool cells is drawn",
  )
  assert.ok(
    covered.some((quad) => under(quad) === 0),
    "a quad beyond them is drawn",
  )
})

test("rivers' ribbons: the Aulella's stop where its river polygon draws the water", () => {
  const [x0, y0, x1, y1] = boxOf(AULELLA.area)
  let over = 0,
    past = 0
  for (const w of AULELLA.area.waters!) {
    const water = NEAR.water.items[NEAR.water.ids.indexOf(w)]!,
      piece = waterPiece(water),
      { pts } = piece,
      line = water.pts
    // Its line, carried on across the apron where it leaves the map.
    const from = pts[0] === line[0] && pts[1] === line[1] ? 0 : 2
    assert.deepEqual(pts.slice(from, from + line.length), line, `piece ${w}: the river's line`)
    // The segments over the polygon's box, and a little beyond.
    let k0 = -1,
      k1 = -1
    for (let k = 0; 2 * k + 3 < pts.length; k++) {
      const xs = [pts[2 * k]!, pts[2 * k + 2]!],
        ys = [pts[2 * k + 1]!, pts[2 * k + 3]!]
      if (Math.max(...xs) < x0 - 20 || Math.min(...xs) > x1 + 20) continue
      if (Math.max(...ys) < y0 - 20 || Math.min(...ys) > y1 + 20) continue
      if (k0 < 0) k0 = k
      k1 = k
    }
    if (k0 < 0) continue
    const into = emptySink()
    piece.draw(() => into, k0, k1)
    for (const quad of ribbonQuads(into.water)) {
      const under = quad.filter(([x, y]) => inPool(x, y)).length
      assert.ok(under < 4, `a quad over the polygon's cells: ${JSON.stringify(quad)}`)
      if (under > 0) over++
      else past++
    }
  }
  assert.ok(over > 0, "the ribbons reach into the polygon's cells")
  assert.ok(past > 0, "and run on beyond them")
})

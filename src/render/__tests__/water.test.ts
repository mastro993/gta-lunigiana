import assert from "node:assert/strict"
import { test } from "node:test"

import { pointInRing } from "../../sim/collide.ts"
import { terrainNodeZ } from "../../sim/map/ground.ts"
import { type Area, isWaterArea, MAP } from "../../sim/map/index.ts"
import { chunkCells, chunkOf, chunkRect } from "../chunks.ts"
import { type Sink, Triangles, WaterTriangles } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { waterPiece } from "../lines.ts"
import { strips } from "../ribbons.ts"
import { residentAround, vectorsAround } from "../testing.ts"
import { inPool, poolWater } from "../water.ts"

const hm = MAP.heightmap
/** The grid's last cell along x and y: an apron cell continues the edge cell it lies beyond. */
const LAST = { i: hm.cols - 2, j: hm.rows - 2 } as const

/**
 * The vectors of the tiles round the Bozzetti pond by the Solco di Equi and the Aulella's river
 * polygon at the map's north edge (found by geometry in them below), and their lakes and river
 * polygons: never the whole map's.
 */
const NEAR = vectorsAround(
  [
    { x: 2220, y: 880 },
    { x: 4350, y: 3870 },
  ],
  300,
)
const POOL_AREAS = NEAR.areas.items.filter(
  (a) => isWaterArea(a.kind) && (a.level !== undefined || a.waters !== undefined),
)

/** Whether `rings` hold (x, y), even-odd over them all, as the land cover fills them. */
const holds = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number): boolean =>
  rings.reduce((inside, r) => inside !== pointInRing(x, y, r), false)

/** The box of an area's outer ring: minX, minY, maxX, maxY. */
const boxOf = (area: Area): readonly [number, number, number, number] => {
  const ring = area.rings[0]!,
    xs = ring.filter((_, k) => k % 2 === 0),
    ys = ring.filter((_, k) => k % 2 === 1)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** The centre of grid cell (i, j), or in the apron of the edge cell it continues. */
const centreOf = (i: number, j: number) => ({
  x: hm.x0 + (Math.min(LAST.i, Math.max(0, i)) + 0.5) * hm.cell,
  y: hm.y0 + (Math.min(LAST.j, Math.max(0, j)) + 0.5) * hm.cell,
})

/** Whether a water area holds the centre of cell (i, j) (in the apron, of the edge cell it continues). */
const wetCell = (i: number, j: number): boolean => {
  const { x, y } = centreOf(i, j)
  return POOL_AREAS.some((a) => holds(a.rings, x, y))
}

/** The cells of chunk `key` the water areas cover, as "i,j", sorted. */
const wetCellsOf = (key: number): Array<string> => {
  const { i0, j0, i1, j1 } = chunkCells(key),
    out: Array<string> = []
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) if (wetCell(i, j)) out.push(`${i},${j}`)
  return out.sort()
}

/** The grid cells of `area` (their centres inside its rings), as (i, j). */
const cellsOf = (area: Area): Array<{ readonly i: number; readonly j: number }> => {
  const [x0, y0, x1, y1] = boxOf(area),
    out: Array<{ i: number; j: number }> = []
  for (let j = Math.floor((y0 - hm.y0) / hm.cell); j <= Math.ceil((y1 - hm.y0) / hm.cell); j++)
    for (let i = Math.floor((x0 - hm.x0) / hm.cell); i <= Math.ceil((x1 - hm.x0) / hm.cell); i++) {
      const { x, y } = centreOf(i, j)
      if (holds(area.rings, x, y)) out.push({ i, j })
    }
  return out
}

/** A drawn water vertex: its node (i, j: the grid index of its map point, unclamped), render height and attributes. */
interface Corner {
  readonly i: number
  readonly j: number
  readonly h: number
  readonly stage: number
  readonly flow: ReadonlyArray<number>
  readonly still: number
}

/** A quad of water over cell (i, j): its corners south-west, south-east, north-east, north-west. */
interface Quad {
  readonly i: number
  readonly j: number
  readonly corners: readonly [Corner, Corner, Corner, Corner]
}

/** The quads `poolWater` drew into `w`, each checked to be two triangles over exactly one grid cell. */
const quadsOf = (w: WaterTriangles): Array<Quad> => {
  const vertex = (v: number) => ({
    x: w.position[3 * v]!,
    y: -w.position[3 * v + 2]!,
    h: w.position[3 * v + 1]!,
    stage: w.stage[v]!,
    flow: w.flow.slice(3 * v, 3 * v + 3),
    still: w.still[v]!,
  })
  const corner = ({ x, y, ...rest }: ReturnType<typeof vertex>): Corner => ({
    i: (x - hm.x0) / hm.cell,
    j: (y - hm.y0) / hm.cell,
    ...rest,
  })
  assert.equal(w.position.length % 18, 0, "whole quads")
  return Array.from({ length: w.position.length / 18 }, (_, q) => {
    const [sw, se, ne, sw2, ne2, nw] = [0, 1, 2, 3, 4, 5].map((k) => corner(vertex(6 * q + k)))
    assert.deepEqual([sw2, ne2], [sw, ne], "two triangles of one quad")
    const { i, j } = sw!
    assert.ok(Number.isInteger(i) && Number.isInteger(j), `on the grid's nodes: ${i}, ${j}`)
    assert.deepEqual(
      [se, ne, nw].map((c) => [c!.i, c!.j]),
      [
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ],
      "over one cell",
    )
    return { i, j, corners: [sw!, se!, ne!, nw!] }
  })
}

/** The quads `poolWater` draws for chunk `key`. */
const drawn = (key: number): Array<Quad> => {
  const w = new WaterTriangles()
  poolWater(key, w)
  return quadsOf(w)
}

/** The distinct chunks holding `cells`. */
const chunksOf = (cells: ReadonlyArray<{ readonly i: number; readonly j: number }>) => [
  ...new Set(
    cells.map(({ i, j }) => {
      const { x, y } = centreOf(i, j)
      return chunkOf(x, y)
    }),
  ),
]

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

/** The Aulella's river polygon at the north edge of the map, found by geometry: the one reaching the edge. */
const AULELLA = (() => {
  const area = POOL_AREAS.find((a) => a.waters !== undefined && boxOf(a)[3] >= MAP.bounds.maxY)
  assert.ok(area !== undefined, "a river polygon reaching the map's north edge")
  const cells = cellsOf(area)
  return { area, cells, chunks: chunksOf(cells) }
})()

/** A sink to draw ribbons into. */
const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})

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

test("poolWater: in the apron north of the Aulella its edge cells' water carries on, its nodes the edge nodes'", () => {
  const edgeCell = AULELLA.cells.find(({ j }) => j === LAST.j)
  assert.ok(edgeCell !== undefined, "the Aulella's polygon holds an edge cell")
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
    const into = sink()
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
    const into = sink()
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

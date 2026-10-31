// The lakes and river polygons of both built maps (water-areas.ts) read from their heights: their
// levels and waterways, a lake's nodes carved under its level, its edge holding it and no level
// over all its nodes, the two lakes the LiDAR reads no hollow under left dry, the surface a river
// polygon is carved under falling downstream, its outer edge left as the ground was, and no tree,
// parked car or player spawn in the water.
import assert from "node:assert/strict"
import { test } from "node:test"

import { fillPolygon } from "../../sim/collide.ts"
import type { Area, Water } from "../../sim/map/index.ts"
import { anchorOf, isWaterArea } from "../../sim/map/kinds.ts"
import { reachOf } from "../../sim/water/channel.ts"
import { ringBox, segDist2 } from "../geometry.ts"
import { type JoinedMap, wholeMap } from "../map-file.ts"
import { inRings } from "../water-areas.ts"

/** Each map, and the lakes in it the LiDAR reads no hollow under (a point inside each). */
const MAPS: ReadonlyArray<readonly [string, JoinedMap, ReadonlyArray<readonly [number, number]>]> =
  [
    [
      "Lunigiana",
      wholeMap("monzone"),
      [
        [-114, -4678], // the intermittent pond at Prati di Campocecina, on a 24 % slope
        [2934, -2611], // the 18 m² pool on the Canale Doglio's cascade
      ],
    ],
    ["Cesena", wholeMap("cesena"), []],
  ]

/** The rounding of the grid's heights (whole decimetres), m. */
const ROUND = 0.05

/** The heightmap cells (column, row) whose centre `rings` holds, filled as the land cover is. */
const cellsOf = (map: JoinedMap, rings: ReadonlyArray<ReadonlyArray<number>>) => {
  const hm = map.heightmap,
    anchor = anchorOf(hm),
    cols = hm.cols - 1,
    out: Array<readonly [number, number]> = []
  fillPolygon(
    rings,
    anchor.x,
    anchor.y,
    hm.cell,
    { c0: -anchor.i, r0: -anchor.j, cols, rows: hm.rows - 1 },
    (k) => out.push([k % cols, Math.floor(k / cols)]),
  )
  return out
}

/** A node of a water area: its position, height (m) and whether one of its four cells is in no water area (the edge). */
interface AreaNode {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly edge: boolean
}

/**
 * The nodes of the water areas of `map`, by area: every node one of its cells touches, on the edge
 * where a cell of it lies in no water area (the seam between two polygons is no edge).
 */
const areaNodes = (map: JoinedMap, areas: ReadonlyArray<Area>) => {
  const hm = map.heightmap,
    cols = hm.cols - 1
  const cells = areas.map((a) => cellsOf(map, a.rings)),
    wet = new Set(cells.flat().map(([i, j]) => j * cols + i))
  return cells.map((own) => {
    const nodes = new Map<number, AreaNode>()
    for (const [i, j] of own)
      for (const [ni, nj] of [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ] as const)
        nodes.set(nj * hm.cols + ni, {
          x: hm.x0 + ni * hm.cell,
          y: hm.y0 + nj * hm.cell,
          z: hm.data[nj * hm.cols + ni]! / 10,
          edge: [
            [ni - 1, nj - 1],
            [ni, nj - 1],
            [ni - 1, nj],
            [ni, nj],
          ].some(([ci, cj]) => !wet.has(cj! * cols + ci!)),
        })
    return [...nodes.values()]
  })
}

/** Distance from (x, y) to the nearest edge of `rings`, m. */
const shore = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number) => {
  let best = Number.MAX_VALUE
  for (const ring of rings)
    for (let k = 0, n = ring.length; k < n; k += 2)
      best = Math.min(
        best,
        segDist2(x, y, ring[k]!, ring[k + 1]!, ring[(k + 2) % n]!, ring[(k + 3) % n]!).d2,
      )
  return Math.sqrt(best)
}

/** Whether the centreline of `w` passes within `d` m of (x, y). */
const within = (w: Water, x: number, y: number, d: number) => {
  for (let k = 0; k + 3 < w.pts.length; k += 2)
    if (segDist2(x, y, w.pts[k]!, w.pts[k + 1]!, w.pts[k + 2]!, w.pts[k + 3]!).d2 <= d * d)
      return true
  return false
}

/** Whether a point of the centreline of `w`, read every half metre, lies inside `rings`. */
const passesInside = (w: Water, rings: ReadonlyArray<ReadonlyArray<number>>) => {
  for (let k = 0; k + 3 < w.pts.length; k += 2) {
    const ax = w.pts[k]!,
      ay = w.pts[k + 1]!,
      bx = w.pts[k + 2]!,
      by = w.pts[k + 3]!,
      n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5))
    for (let s = 0; s <= n; s++)
      if (inRings(rings, ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n)) return true
  }
  return false
}

test("water areas: the 8 OSM water polygons of Lunigiana as 7 lakes with their levels and the Aulella's river polygon on every stream with a sample in it, the Fosso di Tufo too", () => {
  const [, map] = MAPS[0]!
  const water = map.areas.filter((a) => isWaterArea(a.kind))
  assert.equal(water.filter((a) => a.kind === "lake").length, 7)
  assert.equal(water.filter((a) => a.kind === "river").length, 1)
  const lakeAt = (x: number, y: number) =>
    water.find((a) => a.kind === "lake" && inRings(a.rings, x, y))
  assert.equal(lakeAt(2410, 944)?.level, 272, "the lake by the Solco di Equi, at its spill")
  assert.equal(water.find((a) => a.name === "Bozzetti")?.kind, "lake")
  const river = water.find((a) => a.kind === "river")!,
    waters = new Set(river.waters)
  assert.ok(inRings(river.rings, 4343, 3873), "on the Tassonaro")
  // The Fosso di Tufo, coming down from the north edge to join the Tassonaro inside the polygon.
  const tufo = map.water.findIndex((w) => within(w, 4510, 3885, 1))
  assert.ok(tufo >= 0 && !inRings(river.rings, 4510, 3885), "the Fosso di Tufo, north of it")
  assert.ok(waters.has(tufo), `${map.water[tufo]!.name} joins the Tassonaro in it`)
  // Its waters: every piece with a vertex inside (a vertex is a sample), and none whose line stays out.
  const box = ringBox(river.rings[0]!)
  map.water.forEach((w, i) => {
    const [x0, y0, x1, y1] = ringBox(w.pts)
    if (x1 < box[0] || x0 > box[2] || y1 < box[1] || y0 > box[3]) return
    const vertexIn = w.z.some((_, v) => inRings(river.rings, w.pts[2 * v]!, w.pts[2 * v + 1]!))
    if (vertexIn) assert.ok(waters.has(i), `${w.name} (water ${i}) has a vertex inside`)
    if (waters.has(i)) assert.ok(passesInside(w, river.rings), `${w.name} (water ${i}) runs in`)
  })
  assert.ok(
    map.areas.some((a) => a.kind === "pebble" && inRings(a.rings, -1337, 1967)),
    "UCS gravel on the Lucido at Pian del Molino",
  )
})

for (const [name, map, dry] of MAPS) {
  const areas = map.areas.filter((a) => isWaterArea(a.kind))
  const nodes = areaNodes(map, areas)

  test(`water areas, ${name}: each holds still water at a level in whole decimetres or its waterways' running water, and at least a cell`, () => {
    for (const a of areas) {
      assert.ok(
        a.level === undefined
          ? a.waters !== undefined && a.waters.length > 0
          : a.level === Math.round(a.level * 10) / 10 && a.waters === undefined,
        JSON.stringify({ kind: a.kind, level: a.level, waters: a.waters }),
      )
      assert.ok(cellsOf(map, a.rings).length > 0, `${a.kind} round ${a.rings[0]!.slice(0, 2)}`)
    }
  })

  test(`water areas, ${name}: a lake's nodes are carved under its level, deeper from its shore, but a bank over it, and its edge holds it but where a stream's channel leaves`, () => {
    areas.forEach((a, n) => {
      const level = a.level
      if (level === undefined) return
      for (const { x, y, z, edge } of nodes[n]!) {
        if (edge) {
          const channel = () => map.water.some((w) => within(w, x, y, w.w / 2 + 2))
          assert.ok(z >= level - ROUND || channel(), `edge (${x}, ${y}) at ${z} under ${level}`)
          continue
        }
        // A node outside the rings (a cell of it inside) is at the shore: d = 0.
        const d = inRings(a.rings, x, y) ? shore(a.rings, x, y) : 0,
          bed: number = level - Math.min(3, 0.1 * d)
        assert.ok(
          z >= level + 1 - ROUND || z <= bed + ROUND,
          `(${x}, ${y}) at ${z}: neither a bank over ${level + 1} nor carved to ${bed}`,
        )
      }
    })
  })

  test(`water areas, ${name}: a lake's level is no higher than the highest node of its cells, so it never floats over them all (where a stream's channel crosses its whole edge too)`, () => {
    areas.forEach((a, n) => {
      if (a.level === undefined) return
      const highest = Math.max(...nodes[n]!.map((v) => v.z))
      assert.ok(highest >= a.level - ROUND, `${a.kind} round ${a.rings[0]!.slice(0, 2)}`)
    })
  })

  test(`water areas, ${name}: every lake holds water but where the LiDAR reads no hollow, where it stands at its spill over every node of it`, () => {
    let lakes = 0
    areas.forEach((a, n) => {
      const level = a.level
      if (level === undefined || a.kind !== "lake") return
      lakes++
      const own = nodes[n]!,
        at = `lake round ${a.rings[0]!.slice(0, 2)} at ${level}`
      const lowest = Math.min(...own.map((v) => v.z)),
        spill = Math.min(...own.filter((v) => v.edge).map((v) => v.z))
      if (dry.some(([x, y]) => inRings(a.rings, x, y))) {
        assert.equal(spill, level, `${at}: its spill`)
        assert.ok(lowest >= level - ROUND, `${at}: a node at ${lowest}`)
      } else assert.ok(lowest < level - ROUND, `${at}: dry, its lowest node ${lowest}`)
    })
    assert.equal(lakes, name === "Lunigiana" ? 7 : 2)
    for (const [x, y] of dry)
      assert.ok(
        areas.some((a) => a.kind === "lake" && inRings(a.rings, x, y)),
        `a lake at (${x}, ${y})`,
      )
  })

  test(`water areas, ${name}: the surface a river polygon is carved under (its waterways' built surface) falls downstream through it`, () => {
    for (const a of areas)
      for (const w of a.waters ?? []) {
        const { pts, z } = map.water[w]!
        let last = Number.MAX_VALUE
        for (let v = 0; v < z.length; v++) {
          if (!inRings(a.rings, pts[2 * v]!, pts[2 * v + 1]!)) continue
          assert.ok(z[v]! <= last + 1e-9, `water ${w} vertex ${v}: ${z[v]} after ${last}`)
          last = z[v]!
        }
      }
  })

  test(`water areas, ${name}: a river polygon's outer edge is left as the ground was, over its waterways' bed but where their own channels cut it`, () => {
    let edges = 0
    areas.forEach((a, n) => {
      if (a.waters === undefined) return
      const [x0, y0, x1, y1] = ringBox(a.rings[0]!)
      // The lines carve out to their bed's half-width and a cell more (`carve` in terrain.ts).
      const lines = map.water.filter((w) => {
        const [bx0, by0, bx1, by1] = ringBox(w.pts),
          r = reachOf(w) + map.heightmap.cell
        return bx0 - r <= x1 && bx1 + r >= x0 && by0 - r <= y1 && by1 + r >= y0
      })
      for (const { x, y, z, edge } of nodes[n]!) {
        if (!edge || lines.some((w) => within(w, x, y, reachOf(w) + map.heightmap.cell))) continue
        // The bed at the nearest point of its waterways: their built surface less depth/2.
        let best = Number.MAX_VALUE,
          bed = 0
        for (const i of a.waters) {
          const w = map.water[i]!
          for (let v = 0; v + 1 < w.z.length; v++) {
            const { d2, t } = segDist2(
              x,
              y,
              w.pts[2 * v]!,
              w.pts[2 * v + 1]!,
              w.pts[2 * v + 2]!,
              w.pts[2 * v + 3]!,
            )
            if (d2 < best) [best, bed] = [d2, w.z[v]! + (w.z[v + 1]! - w.z[v]!) * t - w.depth / 2]
          }
        }
        edges++
        assert.ok(z >= bed, `edge (${x}, ${y}) at ${z} under the bed at ${bed.toFixed(2)}`)
      }
    })
    assert.ok(edges > (name === "Lunigiana" ? 100 : 500), `${edges} edge nodes`)
  })

  test(`water areas, ${name}: no tree, parked car or player spawn stands in the water`, () => {
    const inWater = (x: number, y: number) =>
      areas.some((a) => {
        if (!inRings(a.rings, x, y)) return false
        // A tree's mask is 2 m pixels and its spot a whole metre: one may stand that near the edge.
        for (const ring of a.rings)
          for (let k = 0, n = ring.length; k < n; k += 2)
            if (
              segDist2(x, y, ring[k]!, ring[k + 1]!, ring[(k + 2) % n]!, ring[(k + 3) % n]!).d2 <= 4
            )
              return false
        return true
      })
    for (let k = 0; k < map.trees.length; k += 3)
      assert.ok(
        !inWater(map.trees[k]!, map.trees[k + 1]!),
        `tree at ${map.trees[k]}, ${map.trees[k + 1]}`,
      )
    for (const s of [...map.spawns.parked, map.spawns.player])
      assert.ok(!inWater(s.x, s.y), `spawn at ${s.x}, ${s.y}`)
  })
}

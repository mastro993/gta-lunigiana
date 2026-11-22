// The lakes and river polygons of both built maps (water-areas.ts) read from their heights: their
// levels and waterways, a lake's nodes carved under its level, its edge holding it and no level
// over all its nodes, the lakes the terrain reads no hollow under or with no node inside their edge
// left dry, the surface a river polygon is carved under falling downstream, its outer edge left as
// the ground was, and no tree, parked car or player spawn in the water.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { fillPolygon, insideSpans } from "../../sim/collide.ts"
import type { Area, Water } from "../../sim/map/index.ts"
import { heightAt } from "../../sim/map/index.ts"
import { anchorOf, IN_POLYGON, isWaterArea, reachOf } from "../../sim/map/kinds.ts"
import { inRings, ringBox, segDist2 } from "../geometry.ts"
import { BLEND, coreHalf } from "../grid-claims.ts"
import { listedNodes } from "../grid-tiles.ts"
import { type JoinedMap, wholeMap } from "../map-file.ts"
import { inRects, ligDir, PARTS } from "../region.ts"
import { LINE_TOL } from "../water.ts"
import { checkSeaUnderZero, floorErrors } from "./sea-checks.ts"

/** The repository's root, which the raw inputs' paths are read from. */
const ROOT = join(import.meta.dirname, "../../..")

/**
 * Each map, and the lakes in it the terrain reads no hollow under (a point inside each). A lake every
 * node of whose cells is its edge (no node all four of whose cells are water) holds none either,
 * and the test finds it by its nodes: the carve lowers only the nodes inside a lake's edge
 * (`carveAreas`), and its level is no higher than its spill (`levelOf`).
 */
const MAPS: ReadonlyArray<readonly [string, JoinedMap, ReadonlyArray<readonly [number, number]>]> =
  [
    [
      "Lunigiana",
      wholeMap("monzone"),
      [
        [-114, -4678], // the intermittent pond at Prati di Campocecina, on a 24 % slope
        // The Arlia power station's forebay, 300 m along a hillside: its outline's foot reaches 3–5 m
        // under the basin, where its level spills.
        [688, 10840],
        // A 24 × 29 m pond on a slope 320 m past the play area's east edge, its foot 1.6 m under it.
        [10432, 8160],
        // The Bottaccio, a mill pond OSM maps by Castelnuovo Magra (issue #20), 31 × 18 m on a
        // hillside rising 9 m across it on Liguria's DTM: its foot, where it spills, 103 m.
        [-8152, -6716],
      ],
    ],
    ["Cesena", wholeMap("cesena"), []],
  ]

/**
 * The rounding of the grid's heights (whole decimetres), m, and a float's slack: a node carved to
 * 2.15 m rounds up to 2.2, which 2.15 + 0.05 misses by 3e-16 (a pond by Sarzana's Bozi di Saudino,
 * (−13216, −6928), 23.5 m from its shore).
 */
const ROUND = 0.05 + 1e-9

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
 * The nodes of the water areas of `map`, by area: every node one of its cells touches that a listed
 * tile holds, on the edge where a cell of it lies in no water area (the seam between two polygons is
 * no edge). The build reads no terrain in a tile the region leaves off its list (an L's notch), and
 * the joined heightmap holds 0 there: a lake in one (the 1 km one in Fivizzano's notch, x 9150…10110
 * by y −150…910) has no node.
 */
const areaNodes = (map: JoinedMap, areas: ReadonlyArray<Area>) => {
  const hm = map.heightmap,
    cols = hm.cols - 1,
    listed = listedNodes(hm, map.tiles)
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
        if (listed[nj * hm.cols + ni] === 1)
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
const within = (w: Pick<Water, "pts">, x: number, y: number, d: number) => {
  for (let k = 0; k + 3 < w.pts.length; k += 2)
    if (segDist2(x, y, w.pts[k]!, w.pts[k + 1]!, w.pts[k + 2]!, w.pts[k + 3]!).d2 <= d * d)
      return true
  return false
}

/**
 * The lines of `map` whose claims may write on the ground (`claimOf` in grid-claims.ts): each road
 * off a deck and out of a tunnel, and the rail, with their heights and how far their writes reach,
 * the core and the blend back to the terrain.
 */
const claimsOf = (map: JoinedMap) => [
  ...map.roads
    .filter((r) => r.bridge !== true && r.tunnel !== true)
    .map((r) => ({ pts: r.pts, z: r.z, reach: coreHalf(r.w, map.heightmap.cell) + BLEND })),
  ...map.rail
    .filter((r) => r.bridge !== true && r.tunnel !== true)
    .map((r) => ({ pts: r.pts, z: r.z, reach: coreHalf(4, map.heightmap.cell) + BLEND })),
]

/** The lowest height of the lines of `claims` whose writes reach (x, y) (their own height there), Infinity where none does. */
const claimedUnder = (claims: ReturnType<typeof claimsOf>, x: number, y: number) => {
  let low = Number.POSITIVE_INFINITY
  for (const c of claims)
    for (let k = 0; k + 3 < c.pts.length; k += 2) {
      const { d2, t } = segDist2(x, y, c.pts[k]!, c.pts[k + 1]!, c.pts[k + 2]!, c.pts[k + 3]!)
      if (d2 <= c.reach * c.reach)
        low = Math.min(low, c.z[k / 2]! + (c.z[k / 2 + 1]! - c.z[k / 2]!) * t)
    }
  return low
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

/** Whether a vertex of `ring` lies in lucido's rectangle: its water areas, the Aulella's polygon across its north edge too. */
const onLucido = (ring: ReadonlyArray<number>) => {
  for (let k = 0; k < ring.length; k += 2)
    if (inRects([PARTS[0]!.rects[0]!], ring[k]!, ring[k + 1]!)) return true
  return false
}

test("water areas: lucido's 8 OSM water polygons as 7 lakes with their levels and the Aulella's river polygon on every stream with a sample in it, the Fosso di Tufo too", () => {
  const [, map] = MAPS[0]!
  // A part beside lucido brings its own lakes and river polygons.
  const water = map.areas.filter((a) => isWaterArea(a.kind) && onLucido(a.rings[0]!))
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
  // The lake's rules below are not the sea's: it is carved to its floor (sea-floor.ts), and a piece
  // the build cuts at a tile's side or the box's edge with no shore of its own (Lunigiana's at
  // (−23100, −8500), in the Gulf of La Spezia beyond the play area) stands over every node of it.
  // coast-sea.map-test.ts checks the sea on the coast test region.
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
      if (level === undefined || a.kind === "sea") return
      for (const { x, y, z, edge } of nodes[n]!) {
        // The lines are carved after the lakes (`carveAreas`), out to their bed's half-width and a
        // cell more (`carve` in terrain.ts): where one leaves a lake, or runs in or along it (the
        // Canale di Agnolo's and the Canale della Fola's ponds), its banks cut the lake's edge and
        // its own banks.
        const channel = () =>
          map.water.some((w) => within(w, x, y, reachOf(w) + map.heightmap.cell))
        if (edge) {
          assert.ok(z >= level - ROUND || channel(), `edge (${x}, ${y}) at ${z} under ${level}`)
          continue
        }
        // A node outside the rings (a cell of it inside) is at the shore: d = 0.
        const d = inRings(a.rings, x, y) ? shore(a.rings, x, y) : 0,
          bed: number = level - Math.min(3, 0.1 * d)
        assert.ok(
          z >= level + 1 - ROUND || z <= bed + ROUND || channel(),
          `(${x}, ${y}) at ${z}: neither a bank over ${level + 1} nor carved to ${bed}`,
        )
      }
    })
  })

  test(`water areas, ${name}: a lake's level is no higher than the highest node of its cells, so it never floats over them all (where a stream's channel crosses its whole edge too)`, () => {
    areas.forEach((a, n) => {
      if (a.level === undefined || a.kind === "sea" || nodes[n]!.length === 0) return
      const highest = Math.max(...nodes[n]!.map((v) => v.z))
      assert.ok(highest >= a.level - ROUND, `${a.kind} round ${a.rings[0]!.slice(0, 2)}`)
    })
  })

  test(`water areas, ${name}: every lake holds water but where the terrain reads no hollow or no node lies inside its edge, where it stands at its spill over every node of it`, () => {
    let lakes = 0
    areas.forEach((a, n) => {
      const level = a.level
      if (level === undefined || a.kind !== "lake" || nodes[n]!.length === 0) return
      if (name === "Cesena" || onLucido(a.rings[0]!)) lakes++
      const own = nodes[n]!,
        at = `lake round ${a.rings[0]!.slice(0, 2)} at ${level}`
      const lowest = Math.min(...own.map((v) => v.z)),
        spill = Math.min(...own.filter((v) => v.edge).map((v) => v.z))
      if (own.every((v) => v.edge) || dry.some(([x, y]) => inRings(a.rings, x, y))) {
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

  test(`water areas, ${name}: a river polygon's outer edge is left as the ground was, over its waterways' bed where they run in it, but where their own channels cut it or a road under that bed keeps its own level`, () => {
    let edges = 0
    const claims = claimsOf(map)
    areas.forEach((a, n) => {
      if (a.waters === undefined) return
      const [x0, y0, x1, y1] = ringBox(a.rings[0]!)
      const meets = (pts: ReadonlyArray<number>, r: number) => {
        const [bx0, by0, bx1, by1] = ringBox(pts)
        return bx0 - r <= x1 && bx1 + r >= x0 && by0 - r <= y1 && by1 + r >= y0
      }
      // The lines carve out to their bed's half-width and a cell more (`carve` in terrain.ts).
      const lines = map.water.filter((w) => meets(w.pts, reachOf(w) + map.heightmap.cell))
      // The claims write on the outer edge after it is raised, and a road there keeps its own
      // level (`carveAreas`): the Calcandola's polygon by Sarzana runs 6 m from a road 0.6 m under
      // its bed, whose blend back to the terrain takes its edge.
      const roads = claims.filter((c) => meets(c.pts, c.reach))
      // Its waterways' parts inside it (`nearestOn` in water-areas.ts), each with its surface and
      // depth at both ends.
      const spans = insideSpans(a.rings, IN_POLYGON)
      const parts = a.waters.flatMap((i) => {
        const w = map.water[i]!
        return w.z.slice(1).flatMap((_, v) => {
          const [ax, ay, bx, by] = w.pts.slice(2 * v, 2 * v + 4) as [number, number, number, number]
          const za = w.z[v]!,
            zb = w.z[v + 1]!
          return spans(ax, ay, bx, by).map(([t0, t1]) => ({
            ax: ax + (bx - ax) * t0,
            ay: ay + (by - ay) * t0,
            bx: ax + (bx - ax) * t1,
            by: ay + (by - ay) * t1,
            za: za + (zb - za) * t0 - w.depth / 2,
            zb: za + (zb - za) * t1 - w.depth / 2,
          }))
        })
      })
      for (const { x, y, z, edge } of nodes[n]!) {
        if (!edge || lines.some((w) => within(w, x, y, reachOf(w) + map.heightmap.cell))) continue
        // The bed at the nearest point of its waterways where they run in it: their built surface
        // less depth/2. The build cuts its 2 m samples at the polygon's edge as it stood before the
        // map rounded it and the line, so where the water enters it the build's point may lie up to
        // IN_POLYGON along from this one: the lower bed within that. The stream 789354484 falls 2.1 m
        // over the 6.1 m where it enters the Magra's polygon by (−14264, 4212).
        let best = Number.MAX_VALUE,
          bed = 0
        for (const p of parts) {
          const { d2, t } = segDist2(x, y, p.ax, p.ay, p.bx, p.by)
          if (d2 >= best) continue
          const slack = IN_POLYGON / (Math.hypot(p.bx - p.ax, p.by - p.ay) || 1),
            at = (u: number) => p.za + (p.zb - p.za) * Math.min(1, Math.max(0, u))
          ;[best, bed] = [d2, Math.min(at(t - slack), at(t + slack))]
        }
        if (claimedUnder(roads, x, y) < bed) continue
        edges++
        // The build raises the edge HALF_STEP over the bed its 2 m samples give, so the grid's
        // rounding keeps it over that; the shipped line strays up to LINE_TOL from the samples, and
        // its vertices are rounded to the decimetre.
        assert.ok(
          z >= bed - LINE_TOL - ROUND,
          `edge (${x}, ${y}) at ${z} under the bed at ${bed.toFixed(2)}`,
        )
      }
    })
    // 30,998 on Lunigiana and 523 on Cesena (measured 2026-11-21): a road under the bed takes none
    // of Cesena's.
    assert.ok(edges > (name === "Lunigiana" ? 30_000 : 500), `${edges} edge nodes`)
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

// Sarzana's part (issue #20) grows Lunigiana's box over the Gulf of La Spezia beyond the play area,
// so the shipped map holds the sea the coast test region checks (coast-sea.map-test.ts): the same
// rules on it here. No isobath of Regione Liguria's survey lies in it (the nearest vertex 455 m south
// of the box), so the floor is the shoreface profile's, blended to the survey's within 1 km of it
// (sea-floor.ts): the survey check has nothing to read, and the day the survey reaches it, the check
// below says so.
test("the sea beyond the play area, Lunigiana: every node of its areas stands under 0 m but where the shore holds it, and no isobath of the survey lies in it", () => {
  const lunigiana = MAPS[0]![1]
  const { nodes, atCoast, tops } = checkSeaUnderZero(lunigiana)
  // 276,387 sea nodes, 683 at the coastline, 45 raised (measured 2026-11-21)
  assert.ok(
    nodes > 250_000 && atCoast <= 800 && tops <= 100,
    `${nodes} sea nodes, ${atCoast} at the coastline, ${tops} raised`,
  )
  const files = PARTS.map((part) => join(ROOT, ligDir(part), "isobaths.json.gz")).filter((f) =>
    existsSync(f),
  )
  assert.ok(files.length > 0, "Regione Liguria's isobaths: pnpm fetch-raw restores them")
  const errors = floorErrors(lunigiana, heightAt, files)
  assert.equal(errors.length, 0, "isobath vertices in Lunigiana's sea: check its floor on them")
})

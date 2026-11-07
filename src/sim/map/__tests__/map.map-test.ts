import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { type Dem, loadDtm } from "../../../tools/dtm.ts"
import { pointInRing as inRing, ringBox } from "../../../tools/geometry.ts"
import { listedNodes } from "../../../tools/grid-tiles.ts"
import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../../../tools/map-file.ts"
import { ROAD_PASSES } from "../../../tools/profiles.ts"
import { dtmDir, inRects, PARTS, regionFromArgs } from "../../../tools/region.ts"
import { STONE_CORES } from "../../../tools/stone-cores.ts"
import { sheet2k, SOURCES } from "../../../tools/survey-ids.ts"
import { PERCH } from "../../../tools/water.ts"
import { meets } from "../../body.ts"
import { moveCircles, segmentDistance, staticGrid } from "../../collide.ts"
import { roadLevel } from "../ground.ts"
import {
  BUILDING_STYLES,
  districtAt,
  graph,
  heightAt,
  inPlay,
  isAreaKind,
  isDrivable,
  isMotorRoad,
  MAP,
  outlineDistance,
  type Road,
  ROAD_CLASSES,
  type Segment,
  wallsNear,
} from "../index.ts"
import { overpassShortfalls } from "./overpass-checks.ts"

const { hypot } = Ops
/** The dense layers and the vectors live in the tiles: these checks read them all, joined in the whole map's order. */
const WHOLE = wholeMap()
const segsOf = (flat: ReadonlyArray<number>, closed = false): Array<Segment> => {
  const out: Array<Segment> = [],
    n = flat.length / 2
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n
    out.push({ ax: flat[2 * i]!, ay: flat[2 * i + 1]!, bx: flat[2 * j]!, by: flat[2 * j + 1]! })
  }
  return out
}
/** Points every `step` m along a flat polyline. */
const samples = (pts: ReadonlyArray<number>, step: number) =>
  segsOf(pts).flatMap((s) => {
    const len = hypot(s.bx - s.ax, s.by - s.ay),
      out: Array<{ x: number; y: number }> = []
    for (let d = 0; d < len; d += step)
      out.push({ x: s.ax + ((s.bx - s.ax) * d) / len, y: s.ay + ((s.by - s.ay) * d) / len })
    return out
  })
/** Crossing points of two flat polylines with the parameter along each segment. */
const crossings = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const out: Array<{ x: number; y: number; i: number; t: number; j: number; u: number }> = []
  segsOf(a).forEach((p, i) =>
    segsOf(b).forEach((q, j) => {
      const ex = p.bx - p.ax,
        ey = p.by - p.ay,
        fx = q.bx - q.ax,
        fy = q.by - q.ay,
        den = ex * fy - ey * fx
      if (den === 0) return
      const t = ((q.ax - p.ax) * fy - (q.ay - p.ay) * fx) / den,
        u = ((q.ax - p.ax) * ey - (q.ay - p.ay) * ex) / den
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
        out.push({ x: p.ax + ex * t, y: p.ay + ey * t, i, t, j, u })
    }),
  )
  return out
}
const zAt = (z: ReadonlyArray<number>, i: number, t: number) => z[i]! + (z[i + 1]! - z[i]!) * t
/**
 * Items gridded by the bounding box of their flat coordinates grown by `pad` m: `near` lists, in
 * input order, every item whose grown box may overlap the query box (a broad phase for the exact test).
 */
const bucketed = <T>(
  items: ReadonlyArray<T>,
  flat: (t: T) => ReadonlyArray<number>,
  pad: number,
) => {
  const boxes = items.map((t) => {
    const [x0, y0, x1, y1] = ringBox(flat(t))
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad] as const
  })
  const grid = staticGrid(items.length, (k) => boxes[k]!, 32)
  return (x0: number, y0: number, x1 = x0, y1 = y0): Array<T> => {
    const found: Array<number> = []
    grid(x0, y0, x1, y1, (k) => found.push(k))
    return found.sort((a, b) => a - b).map((k) => items[k]!)
  }
}
/**
 * No wall of `kind` within `r` of (x, y) that a body whose ground stands at `level()` meets, read
 * only for a wall with a level (a bridge's parapet stands on its deck's); every wall with no `level`.
 */
const clear = (
  kind: "walk" | "drive",
  x: number,
  y: number,
  r: number,
  level?: () => number | undefined,
) =>
  wallsNear(kind, x - r, y - r, x + r, y + r).every((s) => {
    if (segmentDistance(s, x, y) >= r) return true
    const z = s.level === undefined ? undefined : level?.()
    return z !== undefined && !meets(s, z)
  })
/** Strictly inside the built terrain's box, where the trees stand. */
const inside = (x: number, y: number) =>
  x > MAP.bounds.minX && x < MAP.bounds.maxX && y > MAP.bounds.minY && y < MAP.bounds.maxY
const STATION = { x: -493.8, y: 436.9 },
  ALTO = { x: -34.4, y: -300.3 }
/** OSM place nodes of the villages the map was widened for. */
const VILLAGES = {
  "Equi Terme": { x: 1804.9, y: 721 },
  Gragnola: { x: -1751.2, y: 3360.4 },
  Colognola: { x: -1732.9, y: 1119.4 },
  Campiglione: { x: -2255.9, y: 1473.2 },
  Viano: { x: -2319.6, y: 58.6 },
  Vinca: { x: 2273.6, y: -2620.3 },
  Ugliancaldo: { x: 4157.6, y: 1461.8 },
  Tenerano: { x: -2169.5, y: -986.6 },
  // Fivizzano's part (#17), each toLocal of its OSM place node to 0.1 m.
  Fivizzano: { x: -320.8, y: 8511.4 }, // 61753605, place=town
  "Casola in Lunigiana": { x: 3636.2, y: 4245.8 }, // 61753608
  Gassano: { x: -2931.1, y: 4708.6 }, // 1267021147
  Soliera: { x: -4821.2, y: 5160.6 }, // 1267021078
  Moncigoli: { x: -3288.1, y: 6589.5 }, // 1267021341
  Mommio: { x: 5044.1, y: 9835.6 }, // 1293345469
  Pugliano: { x: 5494.5, y: 5007.8 }, // 1293344699, Minucciano (LU)
  "Pieve San Lorenzo": { x: 5305.7, y: 3596 }, // 686999380, Minucciano (LU)
  Vigneta: { x: 4280.6, y: 5462.6 }, // 689297699
  Castiglioncello: { x: 4440, y: 5894.1 }, // 691864868
  Signano: { x: 1240.2, y: 9427.5 }, // 1293344812
  Turano: { x: 1712.1, y: 9444 }, // 1293345648
  Antognano: { x: 6014.3, y: 4363.9 }, // 1293344553, Minucciano (LU)
  "Pieve San Paolo": { x: 3450.9, y: 10553.7 }, // 1293344540
  Verrucola: { x: 639.8, y: 8993.7 }, // 1467639451: its disc holds the Fortezza della Verrucola
  // Fosdinovo's part (#18), each toLocal of its OSM place node to 0.1 m: the issue's ten, then
  // every other village and hamlet in its play area that the traffic graph reaches.
  Fosdinovo: { x: -8889.1, y: -3103.5 }, // 61753606: its disc holds the Castello Malaspina
  Caniparola: { x: -10575.6, y: -5990.5 }, // 6216431816
  Tendola: { x: -7377.9, y: -56.6 }, // 251991765
  Ponzanello: { x: -10377.7, y: 425.1 }, // 6550116039; the issue's (-10265, 634) is its castle's node 6910610606
  "San Terenzo Monti": { x: -6375.3, y: 1266.2 }, // 1267019877
  Ceserano: { x: -6021, y: 3373.4 }, // 251993868
  Bardine: { x: -9182.4, y: 2895.5 }, // 1267020593, Aulla's; Fivizzano's Bardine (1411140437) shares the name
  Marciaso: { x: -4174, y: -1608 }, // 1267021604
  Pulica: { x: -6751.4, y: -1728.8 }, // 1267019411
  Gignago: { x: -8601.1, y: -4305.5 }, // 616791768
  Colla: { x: -5009, y: 2602.5 }, // 1267019481
  Castelpoggio: { x: -4409.2, y: -5498.8 }, // 579493397, Carrara: the mask bends out for it
  "Bardine di San Terenzo": { x: -5296, y: 1661.9 }, // 1267021422
  "Cà della Vacca": { x: -9498.6, y: -5688.1 }, // 616625011, Castelnuovo Magra (SP)
  Canova: { x: -7973.1, y: 3393.1 }, // 1267021246
  Caprignano: { x: -8664.2, y: -5132.1 }, // 616625695, Castelnuovo Magra (SP)
  Caprognano: { x: -8823.7, y: -4697.4 }, // 616625842
  Cecina: { x: -3724.7, y: -877.6 }, // 1267019643
  Celso: { x: -11091, y: -3931.4 }, // 1411140343
  Colletto: { x: -11197.8, y: -3740.1 }, // 1411140753
  Corsano: { x: -3187.4, y: 2037.9 }, // 1267021377
  Gallogna: { x: -3872.7, y: 2042.5 }, // 1267020398
  Gignola: { x: -9081.3, y: -2180.8 }, // 1267019579
  Giucano: { x: -10521.5, y: -1991 }, // 1267020222
  Gorasco: { x: -8063.4, y: 2315.8 }, // 1267020909
  "La Vagina": { x: -9050.8, y: -1111.8 }, // 1267020986
  Maglietola: { x: -4281.3, y: 2070.8 }, // 1267020741
  "Monte Carboli": { x: -8260.1, y: -2302.8 }, // 1267020365
  Montecchio: { x: -9725.4, y: -6007.8 }, // 1411140963, Castelnuovo Magra (SP)
  Pomarino: { x: -10151.6, y: 2796.8 }, // 1267021765
  Porredo: { x: -10140.8, y: -5106.7 }, // 1411140877
  Posterla: { x: -4591.4, y: 306.7 }, // 1267020947
  Vallecchia: { x: -7893.4, y: -5782.9 }, // 1411140583, Castelnuovo Magra (SP)
  Vercalda: { x: -9593.6, y: -3728.2 }, // 1411140955
  "Villaggio Bertani": { x: -10530.7, y: -5256.7 }, // 1411140648
}

test("bounds and heightmap cover the play area", () => {
  const region = regionFromArgs([])
  assert.deepEqual(MAP.bounds, region.bounds)
  const { data, ...hm } = WHOLE.heightmap
  assert.deepEqual(MAP.heightmap, hm)
  // Its lattice counts from the region's anchor, west of its first node once Fivizzano grew it.
  assert.deepEqual([hm.ax ?? hm.x0, hm.ay ?? hm.y0], [region.anchor.x, region.anchor.y])
  assert.equal(data.length, hm.cols * hm.rows)
  assert.ok(hm.x0 <= MAP.bounds.minX && hm.x0 + (hm.cols - 1) * hm.cell >= MAP.bounds.maxX)
  assert.ok(hm.y0 <= MAP.bounds.minY && hm.y0 + (hm.rows - 1) * hm.cell >= MAP.bounds.maxY)
  // The listed tiles' nodes, from the Magra plain by Sarzana at the map's south-west corner (18.1 m)
  // to the Emilian ridge by Cima Belfiore (1856 m); the notches', which no tile holds, are 0 in the
  // joined map.
  const listed = listedNodes(hm, MAP.tiles)
  for (let k = 0; k < data.length; k++) {
    const v = data[k]!
    assert.ok(
      listed[k] === 1 ? Number.isInteger(v) && v > 100 && v < 19000 : v === 0,
      `node ${k}: ${v}`,
    )
  }
})

// Regression: rounded to the metre, neighbouring lattice trees could land on one spot (drawn and collided twice).
test("trees: inside the bounds, at most one per spot", () => {
  const spots = new Set<number>()
  const { trees } = WHOLE
  for (let i = 0; i < trees.length; i += 3) {
    const x = trees[i]!,
      y = trees[i + 1]!
    assert.ok(inside(x, y), `tree at ${x},${y}`)
    spots.add(x * 65536 + y)
  }
  assert.equal(spots.size, trees.length / 3)
})

test("heightAt: station on the valley floor, Monzone Alto on its spur", () => {
  const station = heightAt(STATION.x, STATION.y),
    alto = heightAt(ALTO.x, ALTO.y)
  assert.ok(station > 205 && station < 225, `station ${station}`)
  assert.ok(alto > 270 && alto < 310, `alto ${alto}`)
  assert.equal(heightAt(-1e6, -1e6), heightAt(MAP.bounds.minX, MAP.bounds.minY)) // clamped
})

test("player spawn and parked cars are inside the play area, clear of walls and off traffic lanes", () => {
  const spots = [MAP.spawns.player, ...MAP.spawns.parked]
  // Counted in lucido's rectangle, the bounds lucido's map was checked on: a spot is kept by its own
  // place (spawns.ts), so a part added beside it moves only those near the seam.
  const lucido = MAP.spawns.parked.filter((p) => inRects([PARTS[0]!.rects[0]!], p.x, p.y))
  assert.ok(lucido.length >= 700 && lucido.length <= 950, `${lucido.length} parked on lucido`)
  // Each village's own district, not one of its name: Aulla's Bardine shares Fivizzano's.
  const parkedIn = new Set(MAP.spawns.parked.map((s) => districtAt(s.x, s.y)))
  for (const [name, p] of Object.entries(VILLAGES))
    assert.ok(parkedIn.has(districtAt(p.x, p.y)), `no parking in ${name}`)
  for (const s of spots) {
    assert.ok(inPlay(s.x, s.y), JSON.stringify(s))
    assert.ok(clear("walk", s.x, s.y, 1.2) && clear("drive", s.x, s.y, 1.2), JSON.stringify(s))
  }
  const police = MAP.spawns.police!
  assert.ok(
    hypot(MAP.spawns.player.x - police.x, MAP.spawns.player.y - police.y) < 40,
    "player near the Carabinieri",
  )
  // Regression: spread over five villages, the hash draw left Monzone's station without a spot within 50 m.
  assert.ok(
    MAP.spawns.parked.filter((p) => hypot(p.x - police.x, p.y - police.y) < 40).length >= 2,
    "two parked spots by the Carabinieri",
  )
  const lanes = graph.trafficEdges.map((e) => {
    const { a, b, road } = graph.edges[e]!
    return {
      ax: graph.nodes[a]!.x,
      ay: graph.nodes[a]!.y,
      bx: graph.nodes[b]!.x,
      by: graph.nodes[b]!.y,
      half: WHOLE.roads[road]!.w / 2,
    }
  })
  const lanesNear = bucketed(lanes, (l) => [l.ax, l.ay, l.bx, l.by], 10)
  for (const p of MAP.spawns.parked) {
    const c = Ops.cos(p.angle),
      s = Ops.sin(p.angle)
    for (const [u, v] of [
      [0, 0],
      [1.85, 0.85],
      [1.85, -0.85],
      [-1.85, 0.85],
      [-1.85, -0.85],
    ] as const) {
      const x = p.x + c * u - s * v,
        y = p.y + s * u + c * v
      for (const l of lanesNear(x, y))
        assert.ok(
          segmentDistance(l, x, y) >= l.half - 0.05,
          `parked ${JSON.stringify(p)} on a lane`,
        )
    }
  }
})

test("walls: none on a road; only buildings and barriers come inside w/2", () => {
  assert.ok(WHOLE.walls.walk.length > 0 && WHOLE.walls.drive.length > 0)
  const near = (x: number, y: number, ring: ReadonlyArray<number>, d: number) =>
    inRing(x, y, ring) || segsOf(ring, true).some((s) => segmentDistance(s, x, y) < d)
  const buildings = bucketed(WHOLE.buildings, (b) => b.outer, 0.35),
    barriers = bucketed(WHOLE.barriers, (b) => b.pts, 0.05)
  const fixed = (s: Segment) => {
    const on = (x: number, y: number) =>
      buildings(x, y).some((b) => near(x, y, b.outer, 0.35)) ||
      barriers(x, y).some((b) => segsOf(b.pts).some((q) => segmentDistance(q, x, y) < 0.05))
    return on(s.ax, s.ay) && on(s.bx, s.by)
  }
  WHOLE.roads.forEach((r, i) => {
    if (r.tunnel === true) return
    for (const { x, y } of samples(r.pts, 2)) {
      if (outlineDistance(x, y) < 10) continue // road-exit caps
      const where = `${r.cls} ${r.id} at ${x.toFixed(1)},${y.toFixed(1)}`
      // On the road's level: a bridge's parapets over it stand on the deck's.
      const z = () => roadLevel(i, x, y)
      assert.ok(clear("walk", x, y, Math.min(0.6, r.w / 2), z), `walk wall on ${where}`)
      if (isDrivable(r.cls))
        assert.ok(clear("drive", x, y, 1, z), `drive wall within 1 m of ${where}`)
      const h = r.w / 2 - 0.05
      for (const kind of isDrivable(r.cls) ? (["walk", "drive"] as const) : (["walk"] as const))
        for (const s of wallsNear(kind, x - h, y - h, x + h, y + h)) {
          if (segmentDistance(s, x, y) >= h) continue
          const on = s.level === undefined ? undefined : z()
          if (on === undefined || meets(s, on))
            assert.ok(fixed(s), `terrain/trunk ${kind} wall inside w/2 of ${where}`)
        }
    }
  })
})

test("building interiors are closed: walking or driving in from the nearest road stops at the outline", () => {
  const roads = bucketed(
    WHOLE.roads.flatMap((r) => segsOf(r.pts)),
    (s) => [s.ax, s.ay, s.bx, s.by],
    40,
  )
  for (const b of WHOLE.buildings) {
    const xs = b.outer.filter((_, i) => i % 2 === 0),
      ys = b.outer.filter((_, i) => i % 2 === 1)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    // Only roads within the 40 m search radius of the footprint can matter (same order, same ties).
    const centrelines = roads(x0, y0, x1, y1).filter(
      (s) =>
        Math.max(s.ax, s.bx) >= x0 - 40 &&
        Math.min(s.ax, s.bx) <= x1 + 40 &&
        Math.max(s.ay, s.by) >= y0 - 40 &&
        Math.min(s.ay, s.by) <= y1 + 40,
    )
    // Interior target: the grid point deepest inside the footprint, away from any lane through it.
    let tx = 0,
      ty = 0,
      depth = 0
    for (let x = x0; x <= x1; x += 0.5)
      for (let y = y0; y <= y1; y += 0.5) {
        if (
          !inRing(x, y, b.outer) ||
          (b.holes ?? []).some((h) => inRing(x, y, h)) ||
          centrelines.some((s) => segmentDistance(s, x, y) < 2)
        )
          continue
        const d = Math.min(...segsOf(b.outer, true).map((s) => segmentDistance(s, x, y)))
        if (d > depth) [tx, ty, depth] = [x, y, d]
      }
    if (depth < 0.8) continue
    // Starts on the roads' centrelines outside the footprint within 40 m, nearest first (ties in order).
    const starts: Array<{ readonly x: number; readonly y: number; readonly d: number }> = []
    for (const s of centrelines)
      for (let t = 0; t <= 1; t += 0.05) {
        const x = s.ax + (s.bx - s.ax) * t,
          y = s.ay + (s.by - s.ay) * t,
          d = hypot(x - tx, y - ty)
        if (d < 40 && !inRing(x, y, b.outer)) starts.push({ x, y, d })
      }
    starts.sort((p, q) => p.d - q.d)
    for (const [kind, r] of [
      ["walk", 0.35],
      ["drive", 0.9],
    ] as const) {
      // From the nearest the body stands clear at: one already in two walls is pushed out by them in
      // the order the broad phase hands them, which a grown region moves (the car's 0.9 m on a 1.5 m
      // path between a house and a bank at Monte dei Bianchi went in on the 2-part map, out on lucido's).
      const start = starts.find((q) => clear(kind, q.x, q.y, r))
      if (start === undefined) continue
      let p = { x: start.x, y: start.y }
      for (let step = 0; step < 400; step++) {
        const dx = tx - p.x,
          dy = ty - p.y,
          d = hypot(dx, dy)
        if (d < 0.05) break
        const k = Math.min(1, 0.25 / d),
          q = moveCircles(
            p,
            [{ x: 0, y: 0 }],
            { x: dx * k, y: dy * k },
            r,
            wallsNear(kind, p.x - 2, p.y - 2, p.x + 2, p.y + 2),
          )
        if (hypot(q.position.x - p.x, q.position.y - p.y) < 1e-3) break
        p = q.position
      }
      assert.ok(
        hypot(p.x - tx, p.y - ty) > 0.5,
        `${kind} gets inside building ${b.id} at ${tx},${ty}`,
      )
    }
  }
})

/** The least distance between two flat outer rings, m: from each one's vertices to the other's edges. */
const ringGap = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const toward = (p: ReadonlyArray<number>, q: ReadonlyArray<number>) => {
    let d = Infinity
    for (let i = 0; i < p.length; i += 2)
      for (const s of segsOf(q, true)) d = Math.min(d, segmentDistance(s, p[i]!, p[i + 1]!))
    return d
  }
  return Math.min(toward(a, b), toward(b, a))
}
/** Road clip pieces of one surveyed footprint lie at most this far apart, m (`clipBuildings` cuts a road's corridor through it: 4.11 m at most on Lunigiana). */
const PIECE_GAP = 6

test("buildings: no two share an id unless they are pieces of one footprint, nor an outline, and none of OSM stands on a DBT unit, on Lunigiana, Cesena and the L", (t) => {
  // The L is built into test-maps/ by `pnpm maps`; CI, which sets CI=true, always builds it.
  const lUrl = builtMapUrl(regionFromArgs(["--region", "lunigiana-l"]))
  if (!existsSync(lUrl)) {
    assert.notEqual(process.env.CI, "true", "no lunigiana-l build in test-maps")
    t.diagnostic("no lunigiana-l build in test-maps: the L is not checked")
  }
  const maps: ReadonlyArray<readonly [string, JoinedMap]> = [
    ["Lunigiana", WHOLE],
    ["Cesena", wholeMap("cesena")],
    ...(existsSync(lUrl) ? [["the L", readWholeMap(lUrl)] as const] : []),
  ]
  for (const [name, { buildings }] of maps) {
    const byId = Map.groupBy(buildings, (b) => b.id)
    for (const [id, pieces] of byId) {
      if (pieces.length < 2) continue
      // Pieces of one footprint: a surveyed unit cut by a road (`clipBuildings`), or for OSM also
      // the outer rings of one multipolygon (Cesena's relations 1083815 and 2026837), any distance apart.
      const [first] = pieces
      for (const p of pieces)
        assert.deepEqual(
          [p.kind, p.name, p.style, p.ruins, p.tint],
          [first!.kind, first!.name, first!.style, first!.ruins, first!.tint],
          `${name}: building ${id}`,
        )
      if (id > 0) continue
      for (const p of pieces) {
        const gap = Math.min(...pieces.filter((q) => q !== p).map((q) => ringGap(p.outer, q.outer)))
        assert.ok(
          gap <= PIECE_GAP,
          `${name}: building ${id} has a piece ${gap.toFixed(2)} m from the others`,
        )
      }
    }
    // Regression: two comuni's DBT archives of one survey hold the same units, and the map drew 528
    // of Minucciano's and Giuncugnano's twice, under each comune's ids.
    const outlines = Map.groupBy(buildings, (b) => b.outer.join(","))
    for (const [, same] of outlines)
      assert.equal(
        same.length,
        1,
        `${name}: buildings ${same.map((b) => b.id).join(", ")} share one outline`,
      )
    // Regression: the mapped area kept the copy of a Minucciano zone that Giuncugnano's archive cut
    // at its edge, so 7 OSM buildings by the Carpinelli road stood on the DBT's own units.
    const dbt = buildings
      .filter((b) => b.id < 0 && Math.floor(-b.id / 4294967296 / 65536) === SOURCES.dbt2k)
      .map((b) => ({ id: b.id, outer: b.outer, box: ringBox(b.outer) }))
    for (const { id, outer } of buildings.filter((b) => b.id > 0)) {
      let x = 0,
        y = 0
      for (let k = 0; k < outer.length; k += 2) {
        x += outer[k]!
        y += outer[k + 1]!
      }
      x /= outer.length / 2
      y /= outer.length / 2
      const under = dbt.find(
        (d) =>
          x >= d.box[0] && y >= d.box[1] && x <= d.box[2] && y <= d.box[3] && inRing(x, y, d.outer),
      )
      assert.equal(under, undefined, `${name}: OSM building ${id} stands on DBT unit ${under?.id}`)
    }
  }
})

test("traffic graph: one component reaching the station, Monzone Alto and the villages, edges clear of walls, exits inside the caps", () => {
  const chord = (e: number): Segment => {
    const { a, b } = graph.edges[e]!
    return {
      ax: graph.nodes[a]!.x,
      ay: graph.nodes[a]!.y,
      bx: graph.nodes[b]!.x,
      by: graph.nodes[b]!.y,
    }
  }
  const near = (p: { x: number; y: number }, r: number) =>
    graph.trafficEdges.some((e) => segmentDistance(chord(e), p.x, p.y) < r)
  assert.ok(near(STATION, 30) && near(ALTO, 60))
  for (const [name, p] of Object.entries(VILLAGES))
    assert.ok(near(p, 80), `no traffic near ${name}`)
  const traffic = new Set(graph.trafficEdges)
  const seen = new Set([graph.edges[graph.trafficEdges[0]!]!.a])
  for (const stack = [...seen]; stack.length > 0;)
    for (const e of graph.adjacency[stack.pop()!]!) {
      if (!traffic.has(e)) continue
      for (const n of [graph.edges[e]!.a, graph.edges[e]!.b])
        if (!seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
    }
  assert.ok(
    graph.trafficEdges.every((e) => seen.has(graph.edges[e]!.a) && seen.has(graph.edges[e]!.b)),
    "traffic is connected",
  )
  assert.ok(
    graph.edges.every((e) => e.length > 0 && e.length <= 25.5 && e.road < WHOLE.roads.length),
  )
  assert.ok(graph.walkEdges.length > graph.trafficEdges.length)
  assert.ok(
    graph.walkEdges.every((e) => !isMotorRoad(WHOLE.roads[graph.edges[e]!.road]!)),
    "a walk edge on a motor road",
  )
  // On each edge's road's level: a bridge's parapets over it stand on the deck's.
  for (const e of graph.trafficEdges)
    for (const { x, y } of samples([chord(e).ax, chord(e).ay, chord(e).bx, chord(e).by], 1))
      assert.ok(
        clear("drive", x, y, 1, () => roadLevel(graph.edges[e]!.road, x, y)),
        `traffic edge ${e} within 1 m of a drive wall at ${x.toFixed(1)},${y.toFixed(1)}`,
      )
  graph.nodes.forEach((n, i) => {
    const edges = graph.adjacency[i]!.filter((e) => traffic.has(e))
    assert.ok(
      edges.length !== 1 ||
        clear("drive", n.x, n.y, 2.3, () => roadLevel(graph.edges[edges[0]!]!.road, n.x, n.y)),
      `a car at traffic dead end ${i} (${n.x},${n.y}) touches a wall`,
    )
  })
})

test("profiles: class grades (1.5x relaxed at most), deck and underpass clearances, no perched water", () => {
  // 1.5 x each class's grade limit (ROAD_PASSES), plus the 0.1 m the map rounds elevations to over
  // the 8 m measured; the rail's, plus slack where two junction pins conflict.
  const limit: Record<string, number> = {
    ...Object.fromEntries(
      ROAD_PASSES.flatMap((p) => p.classes.map((cls) => [cls, 1.5 * p.grade + 0.1 / 8])),
    ),
    rail: 0.0425,
  }
  for (const cls of ROAD_CLASSES)
    assert.ok(
      limit[cls] !== undefined || cls === "path" || cls === "steps",
      `${cls} has no grade limit`,
    )
  const ends = bucketed(WHOLE.roads, (r) => r.pts, 0.1)
  /** Whether vertex k of `pts` lies on another road: a junction a road profiled before it may pin. */
  const shared = (pts: ReadonlyArray<number>, k: number) => {
    const x = pts[2 * k]!,
      y = pts[2 * k + 1]!
    return ends(x, y).some(
      (q) => q.pts !== pts && segsOf(q.pts).some((sg) => segmentDistance(sg, x, y) < 0.1),
    )
  }
  /** Both ends on another road: a link whose two junctions were set by roads profiled before it. */
  const pinned = (pts: ReadonlyArray<number>) => shared(pts, 0) && shared(pts, pts.length / 2 - 1)
  /** The survey's ground (the uncarved DTM the build starts from), read only for a steep pinned stretch. */
  let dem: Dem | undefined
  const LUNIGIANA = regionFromArgs([])
  /**
   * Whether vertices i…j of `r` (arc lengths `s`) lie in a stretch between two junctions that the fit
   * drew straight (pins it cannot meet within the grade: the line between them), over ground the
   * survey reads climbing steeper than `max` itself: old lanes straight up a village's hillside
   * (Sercognano's Via Vittorio Emanuele at 29 % on the LiDAR, the lane down from Posara at 43 %).
   */
  const steepPinned = (r: Road, s: ReadonlyArray<number>, i: number, j: number, max: number) => {
    let a = i,
      b = j
    while (a > 0 && !shared(r.pts, a)) a--
    while (b + 1 < r.z.length && !shared(r.pts, b)) b++
    if (!shared(r.pts, a) || !shared(r.pts, b)) return false
    const line = (k: number) => r.z[a]! + ((r.z[b]! - r.z[a]!) * (s[k]! - s[a]!)) / (s[b]! - s[a]!)
    for (let k = a; k <= b; k++) if (Math.abs(r.z[k]! - line(k)) >= 0.15) return false
    dem ??= loadDtm(join(import.meta.dirname, "../../../..", dtmDir(LUNIGIANA)), LUNIGIANA)
    const ground = (k: number) => dem!.at(r.pts[2 * k]!, r.pts[2 * k + 1]!)
    return Math.abs(ground(b) - ground(a)) / (s[b]! - s[a]!) > max
  }
  for (const r of [...WHOLE.roads, ...MAP.rail.map((q) => ({ ...q, cls: "rail" }))]) {
    const max = limit[r.cls]
    if (max === undefined) continue
    const s = [0]
    for (let i = 1; i < r.z.length; i++)
      s.push(
        s[i - 1]! + hypot(r.pts[2 * i]! - r.pts[2 * i - 2]!, r.pts[2 * i + 1]! - r.pts[2 * i - 1]!),
      )
    // A track shortcut between two bends of one quarry road (Carrara side of the Sagro) can only be the straight line between them.
    const straight = r.z.every(
      (z, i) => Math.abs(z - r.z[0]! - ((r.z.at(-1)! - r.z[0]!) * s[i]!) / s.at(-1)!) < 0.15,
    )
    if (r.cls === "track" && straight && pinned(r.pts)) continue
    for (let i = 0; i < r.z.length; i++)
      for (let j = i + 1; j < r.z.length; j++)
        if (s[j]! - s[i]! >= 8) {
          const g = Math.abs(r.z[j]! - r.z[i]!) / (s[j]! - s[i]!)
          assert.ok(
            g <= max || (r.cls !== "rail" && steepPinned(r as Road, s, i, j, max)),
            `${r.cls} ${r.id} grade ${(g * 100).toFixed(1)}% at ${r.pts[2 * i]},${r.pts[2 * i + 1]}`,
          )
          break
        }
  }
  const decks = [
    ...WHOLE.roads.filter((r) => r.bridge === true),
    ...MAP.rail.filter((r) => r.bridge === true),
  ]
  for (const w of WHOLE.water)
    for (const d of decks)
      for (const c of crossings(w.pts, d.pts)) {
        const gap = zAt(d.z, c.j, c.u) - zAt(w.z, c.i, c.t)
        assert.ok(gap >= 2.4, `bridge ${d.id} only ${gap.toFixed(1)} m over water ${w.id}`)
      }
  for (const rl of MAP.rail)
    for (const rd of WHOLE.roads)
      if (rl.bridge === true || rd.tunnel === true)
        for (const c of crossings(rl.pts, rd.pts)) {
          const gap = zAt(rl.z, c.i, c.t) - zAt(rd.z, c.j, c.u)
          assert.ok(gap >= 4.6, `rail ${rl.id} only ${gap.toFixed(1)} m over road ${rd.id}`)
        }
  // A road under a road bridge keeps its maxheight (4 m untagged) plus a 1.5 m deck (road-levels.ts).
  assert.deepEqual(overpassShortfalls(WHOLE.roads), [])
  // A road bridge over the rail clears the ATR 220 (4.185 m over the rail head, 0.12 m over the
  // bed) under its 0.9 m deck, with 0.3 m to spare (rail-levels.ts; the Equi Terme overpass left
  // the roof 0.46 m in the deck).
  for (const rl of MAP.rail)
    for (const rd of WHOLE.roads)
      if (rd.bridge === true && rl.tunnel !== true && rl.bridge !== true)
        for (const c of crossings(rl.pts, rd.pts)) {
          const gap = zAt(rd.z, c.j, c.u) - zAt(rl.z, c.i, c.t)
          assert.ok(gap >= 5.4, `road ${rd.id} only ${gap.toFixed(2)} m over rail ${rl.id}`)
        }
  const channels = bucketed(
    WHOLE.water.flatMap((o) => segsOf(o.pts).map((s) => ({ ...s, w: o.w }))),
    (s) => [s.ax, s.ay, s.bx, s.by],
    Math.max(...WHOLE.water.map((o) => o.w / 2 + 1)),
  )
  // A lake's water stands over its carved bed, up to 3 m under its level (water-areas.ts): a stream
  // within PERCH of the level of a lake round it is the lake's (dropPerched), as the stream through
  // the pond 560 m east of Soliera, 0.3 m under its level and 2.6 m over its bed.
  const lakes = bucketed(
    WHOLE.areas.filter((a) => a.level !== undefined),
    (a) => a.rings[0]!,
    0,
  )
  const lakeWater = (x: number, y: number, z: number) =>
    lakes(x, y).some(
      (a) => a.rings.filter((r) => inRing(x, y, r)).length % 2 === 1 && z <= a.level! + PERCH,
    )
  for (const w of WHOLE.water)
    for (let i = 0; i < w.z.length; i++) {
      const x = w.pts[2 * i]!,
        y = w.pts[2 * i + 1]!
      const joins = channels(x, y).some((s) => s.w > w.w && segmentDistance(s, x, y) < s.w / 2 + 1)
      if (!joins && !lakeWater(x, y, w.z[i]!))
        assert.ok(
          w.z[i]! - heightAt(x, y) <= 2.5,
          `water ${w.id} perched ${(w.z[i]! - heightAt(x, y)).toFixed(1)} m at ${x},${y}`,
        )
    }
})

test("road names, classes, styles, area kinds and districts", () => {
  const labels = new Set(WHOLE.roads.flatMap((r) => [r.name, r.ref]))
  for (const name of [
    "SP59",
    "SP10",
    "SR445",
    "Via Riolo",
    "Via delle Cave",
    "Via Cesare Battisti",
  ])
    assert.ok(labels.has(name), name)
  assert.ok(
    WHOLE.roads.every(
      (r) =>
        (ROAD_CLASSES as ReadonlyArray<string>).includes(r.cls) && r.z.length * 2 === r.pts.length,
    ),
  )
  // OSM's primary, the SR445 della Garfagnana, keeps its class, but for its slip roads (OSM's
  // primary_link, folded into secondary: kinds.ts), each under 60 m: six at one junction by Lago
  // Fario, 173 m of its 24.5 km.
  const sr445 = WHOLE.roads.filter((r) => r.ref === "SR445")
  for (const r of sr445) {
    let length = 0
    for (let k = 2; k < r.pts.length; k += 2)
      length += hypot(r.pts[k]! - r.pts[k - 2]!, r.pts[k + 1]! - r.pts[k - 1]!)
    assert.ok(r.cls === "primary" || (r.cls === "secondary" && length < 60), `${r.id} ${r.cls}`)
  }
  assert.ok(sr445.filter((r) => r.cls === "primary").length > 50)
  assert.ok(
    WHOLE.buildings.every(
      (b) =>
        (BUILDING_STYLES as ReadonlyArray<string>).includes(b.style) &&
        b.tint >= 0 &&
        b.tint <= 3 &&
        b.h >= 1.5 &&
        b.h <= 45,
    ),
  )
  assert.ok(
    WHOLE.areas.every((a) => isAreaKind(a.kind)),
    "every area kind is one of AREA_KINDS",
  )
  // The Regione Toscana land cover: the sparse vegetation of the high slopes (it alone has it) and the bare rock of Pizzo d'Uccello.
  assert.ok(
    WHOLE.areas.some((a) => a.kind === "sparse"),
    "UCS sparse vegetation",
  )
  const uccello = MAP.pois.find((p) => p.kind === "natural=peak" && p.name === "Pizzo d'Uccello")!
  assert.ok(
    WHOLE.areas.some((a) => a.kind === "rock" && inRing(uccello.x, uccello.y, a.rings[0]!)),
    "Pizzo d'Uccello is bare rock",
  )
  // Regression: running on into the unmapped mountains, the road from Casciana lost the CTR name of its Ugliancaldo stretch.
  assert.ok(
    WHOLE.roads.some((r) => r.name === "Via di Ugliancaldo"),
    "Via di Ugliancaldo",
  )
  const names = new Set(MAP.districts.map((d) => d.name))
  for (const name of [
    "Monzone (Stazione)",
    "Monzone Alto",
    "Santa Lucia",
    "Torrignana",
    "Aiola",
    "Castello di Aiola",
    "Novicchia",
    "Acquanera",
  ])
    assert.ok(names.has(name), name)
  const centres = WHOLE.buildings.map((b) => {
    const n = b.outer.length / 2
    return {
      x: b.outer.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / n,
      y: b.outer.filter((_, i) => i % 2 === 1).reduce((a, v) => a + v, 0) / n,
    }
  })
  // A settlement's buildings, found by geometry rather than by OSM's place nodes (the discs' own
  // centres, so a village OSM leaves without a node, or tags `locality`, still counts against
  // them): those with 10 or more others within 150 m. The rest are farmhouses, mountain huts and
  // quarry sheds: 9% of lucido's and Fivizzano's part's buildings, 18% of Fosdinovo's.
  const near = bucketed(centres, (c) => [c.x, c.y], 0)
  const settled = centres.filter(
    (c) =>
      near(c.x - 150, c.y - 150, c.x + 150, c.y + 150).filter(
        (o) => hypot(o.x - c.x, o.y - c.y) <= 150,
      ).length > 10,
  )
  const covered = settled.filter((c) =>
    MAP.districts.some((d) => hypot(c.x - d.x, c.y - d.y) <= d.r),
  ).length
  // Most are inside a district disc: 86.8% (lucido's 90.0%, Fivizzano's part's 88.7%, Fosdinovo's
  // 80.5%, where 24 of its 38 discs stand at the 400 m cap and Ceserano's node is 506 m off its
  // church).
  assert.ok(
    covered >= 0.8 * settled.length,
    `${covered}/${settled.length} settled buildings inside a district disc`,
  )
  assert.equal(districtAt(STATION.x, STATION.y).name, "Monzone (Stazione)")
  assert.equal(districtAt(ALTO.x, ALTO.y).name, "Monzone Alto")
  for (const [name, p] of Object.entries(VILLAGES)) assert.equal(districtAt(p.x, p.y).name, name)
  assert.ok(MAP.districts.includes(districtAt(MAP.bounds.maxX, MAP.bounds.minY))) // far corner: nearest rim
  // Regression: by the nearest rim, the HUD named Vinca on the summits above it; a wide Balzone disc then took Vinca's hairpins.
  for (const name of [
    "Monte Sagro",
    "Pizzo d'Uccello",
    "Cima Belfiore",
    "Monte Tondo",
    "La Pizza",
  ]) {
    const peak = MAP.pois.find((p) => p.kind === "natural=peak" && p.name === name)!
    assert.equal(districtAt(peak.x, peak.y).name, name)
  }
  // Issues #17 and #18: the passes name their own districts, Carpinelli's inside Casone Carpinelli's
  // disc.
  for (const name of [
    "Passo dei Carpinelli",
    "Passo di Tea",
    "Passo del Romito",
    "Foce del Cucco",
  ]) {
    const pass = MAP.pois.find((p) => p.kind === "natural=saddle" && p.name === name)
    assert.ok(pass !== undefined, `${name}'s OSM node`)
    assert.equal(districtAt(pass.x, pass.y).name, name)
  }
  // The Fortezza della Verrucola is the hamlet's, by the castle rule: its own disc holds it.
  assert.equal(districtAt(468, 9009).name, "Verrucola")
  assert.equal(districtAt(1379, -2603).name, "Vinca", "the SP59 hairpins below Vinca")
  // Regression: the I Pianelli locality (a hillside above the railway) took Equi Terme's station and spa.
  for (const p of MAP.pois.filter(
    (q) => q.kind === "railway=station" || q.name === "Terme di Equi",
  )) {
    if (p.name?.includes("Equi") === true)
      assert.equal(districtAt(p.x, p.y).name, "Equi Terme", `${p.kind} ${p.name}`)
  }
  // Regression: CTR names came out as "Via Xx Settembre" and "Via Castel Dell'aquila" (OSM spells it "Via Castel dell'Aquila").
  assert.ok(labels.has("Via Castel dell'Aquila") && labels.has("Via XX Settembre"))
  assert.ok(
    WHOLE.roads.every((r) => !/\b(Xx|Ii|Xxiv)\b|\b(Dell|Dall|Sull|Nell)'/.test(r.name ?? "")),
    "mis-cased street name",
  )
  // Regression: its stone-core disc sat 54 m off the castle, which came out plaster.
  assert.equal(WHOLE.buildings.find((b) => b.name === "Castello dell'Aquila")?.style, "stone")
})

test("the Carrara side's buildings come from the CTR 1:2000 of 2009", () => {
  // A surveyed building's id slot is its source and section (survey-ids.ts): the 2009 sheets'
  // section is 22D. readSurveys skips a missing source folder, so a build on a data/raw without
  // the 2009 sheets keeps OSM's buildings there and fails no other check.
  const slot = SOURCES.ctr2009 * 65536 + sheet2k("22D04").section
  const slotOf = (id: number) => (id < 0 ? Math.floor(-id / 4294967296) : undefined)
  assert.ok(
    WHOLE.buildings.some((b) => slotOf(b.id) === slot),
    "no building of the CTR 2009",
  )
  // The Chiesetta alpina, a 2009 unit in place of OSM's chapel 700633221.
  const church = WHOLE.buildings.find((b) => b.style === "church" && inRing(-441, -4844, b.outer))
  assert.ok(church !== undefined, "no church on (-441, -4844)")
  assert.equal(slotOf(church.id), slot, `${church.name} ${church.id}`)
})

// Regression: every way named Torrente Lucido was 8 m wide, up the Vinca valley to its source under the Garnerone.
test("Fivizzano's walled centre is stone: every building in its cores but the churches", () => {
  // Issue #17. OSM maps no city walls: the cores trace the walls' outline, each disc the smallest,
  // to 5 m, holding its buildings (STONE_CORES), so a building within 5 m of a disc's rim may stand
  // outside the walls.
  const cores = STONE_CORES.filter(
    ([x, y]) => Ops.hypot(x - VILLAGES.Fivizzano.x, y - VILLAGES.Fivizzano.y) < 500,
  )
  assert.equal(cores.length, 4)
  let inside = 0
  for (const b of WHOLE.buildings) {
    let x = 0,
      y = 0
    for (let k = 0; k < b.outer.length; k += 2) {
      x += b.outer[k]!
      y += b.outer[k + 1]!
    }
    x /= b.outer.length / 2
    y /= b.outer.length / 2
    if (!cores.some(([cx, cy, r]) => Ops.hypot(x - cx, y - cy) < r - 5)) continue
    inside++
    assert.equal(b.style, b.kind === "church" ? "church" : "stone", `${b.kind} ${b.id}`)
  }
  assert.ok(inside > 150, `${inside} buildings in Fivizzano's cores`)
})

test("water: the Lucido is 8 m on the valley floor and 4 m above Vinca", () => {
  const w = (id: number) => WHOLE.water.find((o) => o.id === id)?.w
  assert.deepEqual([w(254825035), w(140780317), w(696231807), w(687230881)], [8, 4, 8, 14])
})

// Issue #17: the Aulella's valley row keeps lucido's ways; its gorge above the Tassonaro's mouth, the
// Rosaro above Fivizzano and the Mommio below 775 m are wooded torrents; the Rosaro's river part has
// its own bed; their heads are named streams.
test("water: the Aulella, Rosaro and Mommio take their measured widths by reach", () => {
  const w = (id: number) => WHOLE.water.find((o) => o.id === id)?.w
  // Aulella: lucido's 788520105 (205 m), the gorge's 788514364 (294 m), the head's 788514391 (363 m).
  assert.deepEqual([w(788520105), w(788514364), w(788514391)], [12, 6, 4])
  // Rosaro: its river part 687230888, a stream above Fivizzano 790403608.
  assert.deepEqual([w(687230888), w(790403608)], [7, 6])
  // Mommio: 788514606 (303 m) and 788514696 (766 m) wooded, 788514702 (782 m) a named stream.
  assert.deepEqual([w(788514606), w(788514696), w(788514702)], [6, 6, 4])
})

test("water: catchments grow downstream; the Lucido drains 47 km² where it meets the Aulella, the Rosaro brings its 14.7 km² of heads, the Aulella leaves the play area with 199 and the Bardine with 59", () => {
  for (const w of WHOLE.water)
    w.area.forEach((a, k) =>
      assert.ok(k === 0 || a >= w.area[k - 1]!, `water ${w.id} shrinks at ${k}`),
    )
  // Regression: a tributary's mouth read the receiving river's node, so a trickle's last vertex took the river's 45 km².
  for (const w of WHOLE.water) {
    const [before, mouth] = w.area.slice(-2)
    if (before !== undefined)
      assert.ok(
        mouth! <= 1.5 * before + 1,
        `water ${w.id}: ${before} km² jumps to ${mouth} at its mouth`,
      )
  }
  const lucido = WHOLE.water.filter((w) => w.name === "Torrente Lucido" && w.kind === "river")
  const mouth = Math.max(...lucido.map((w) => w.area.at(-1)!))
  assert.ok(Math.abs(mouth - 47) < 2, `the Lucido drains ${mouth} km²`)
  // Regression: the Rosaro's heads beyond y 13000 were sized as the Soliera gauge's 208 km² less
  // what the map's D8 gathers, 26.2 km², near twice the 14.7 a D8 on the MS 10 m DTM gives them.
  const head = Math.max(
    ...WHOLE.water
      .filter((w) => w.name === "Torrente Rosaro")
      .flatMap((w) => w.area.filter((_, k) => w.pts[2 * k + 1]! > 12900)),
  )
  assert.ok(Math.abs(head - 14.7) < 0.5, `the Rosaro brings ${head} km² in`)
  // ARPAL gives the gauge 208 km²; the DTMs' own basins are smaller (the MS 10 m DTM's 200.7 at
  // Soliera), and the map's ground and the Rosaro's heads give 196.8 there.
  const aulella = Math.max(
    ...WHOLE.water.filter((w) => w.name === "Torrente Aulella").map((w) => w.area.at(-1)!),
  )
  assert.ok(Math.abs(aulella - 199) < 3, `the Aulella leaves with ${aulella} km²`)
  // Regression: fosdinovo's north edge cut the Bardine 100 m short of the notch, and its basin
  // drained out up the Canale del Torchio to the box's west edge: the Bardine left with 117.3 km²,
  // its own 58.1 twice and the Torchio's 0.8 (issue #18).
  const bardine = Math.max(
    ...WHOLE.water.filter((w) => w.name === "Torrente Bardine").map((w) => w.area.at(-1)!),
  )
  assert.ok(Math.abs(bardine - 59) < 2, `the Bardine leaves with ${bardine} km²`)
  // Regression: fivizzano's west edge cut the Aulella 700 m short of the notch, the fill made its
  // trench a lake for 10 km, and D8 ran the river across it down a 2 m side stream by Soliera (way
  // 140780331, 108.5 km²) and, by Gragnola, Il Canalaccio (55.4); the Torchio drained the Bardine's
  // 59.2 out to the box's west edge.
  const most = (keep: (w: (typeof WHOLE.water)[number]) => boolean) =>
    Math.max(...WHOLE.water.filter(keep).flatMap((w) => w.area))
  assert.ok(most((w) => w.id === 140780331) < 1, "the side stream by Soliera")
  assert.ok(most((w) => w.name === "Il Canalaccio") < 6, "Il Canalaccio")
  assert.ok(most((w) => w.name === "Canale del Torchio") < 2, "the Canale del Torchio")
})

test("walls: water stops neither feet nor wheels; the shore walls ring it, and people and animals keep to them", () => {
  // The middle of every wide river's reach away from the roads and the map's edge: no walk or drive wall within 2 m, a shore wall
  // within its bed.
  const { minX, minY, maxX, maxY } = MAP.bounds
  let checked = 0
  for (const w of WHOLE.water.filter((o) => o.w >= 12))
    for (let k = 0; k < w.pts.length / 2; k += 5) {
      const x = w.pts[2 * k]!,
        y = w.pts[2 * k + 1]!
      if (
        Math.min(x - minX, maxX - x, y - minY, maxY - y) < 30 ||
        WHOLE.roads.some((r) =>
          r.pts.some((v, i) => i % 2 === 0 && Ops.hypot(v - x, r.pts[i + 1]! - y) < 30),
        )
      )
        continue
      checked++
      const near = (kind: "walk" | "land" | "drive", r: number) =>
        wallsNear(kind, x - r, y - r, x + r, y + r).some((s) => segmentDistance(s, x, y) < r)
      assert.ok(!near("walk", 2) && !near("drive", 2), `a wall in the water at ${x}, ${y}`)
      assert.ok(near("land", w.bed + 5), `no shore wall by the water at ${x}, ${y}`)
    }
  assert.ok(checked > 20, `${checked} river points checked`)
})

// Regression: OSM centrelines ran up to 3.5 m inside CTR houses; the walls opened a corridor the house drawn did not show.
test("drivable roads never run inside a footprint: where OSM and the CTR disagree, the house gives way", () => {
  const buildings = bucketed(WHOLE.buildings, (b) => b.outer, 0)
  for (const r of WHOLE.roads) {
    if (!isDrivable(r.cls) || r.tunnel === true) continue
    for (const { x, y } of samples(r.pts, 0.5)) {
      const hit = buildings(x, y).find(
        (b) => inRing(x, y, b.outer) && !(b.holes ?? []).some((h) => inRing(x, y, h)),
      )
      assert.equal(
        hit,
        undefined,
        `${r.cls} ${r.id} inside building ${hit?.id} at ${x.toFixed(1)},${y.toFixed(1)}`,
      )
    }
  }
})

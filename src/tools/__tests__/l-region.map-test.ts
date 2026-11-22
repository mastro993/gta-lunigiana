// The L test region (`lunigiana-l`, region.ts) as built: its outline walls close its play area,
// nothing on foot gets out of it, everything the map places lies in it, and its place reads no
// ground of its notch. This process loads the L (`useDiskMap`), from test-maps/, which
// `node src/tools/build-map.ts --region lunigiana-l` writes. Without that build every check here is skipped, but in CI, which builds it with the maps
// (`pnpm maps`), a missing build fails: a skip there would pass with nothing checked.
import assert from "node:assert/strict"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { placeFrom } from "../../sim/sky/place.ts"
import { centroid, pointInRing, ringBox, segDist2 } from "../geometry.ts"
import { listedNodes } from "../grid-tiles.ts"
import { readWholeMap, wholeMap } from "../map-file.ts"
import { along, assertOutlineWalls, crosses, edgesOf, walkFlood } from "./outline-checks.ts"
import { skipUnbuilt, TEST_MAPS } from "./test-maps.ts"

const [NAME, URL_L] = TEST_MAPS.find(([name]) => name === "the L")!
const skip = skipUnbuilt(NAME, URL_L)
if (skip === false) useDiskMap(URL_L)
const sim = skip === false ? await import("../../sim/map/index.ts") : undefined
const coarse = skip === false ? await import("../../sim/map/coarse.ts") : undefined
const cover = skip === false ? await import("../../sim/map/cover.ts") : undefined
/** The L whole: its walls, trees and vectors live in its tiles, joined back in the whole map's order. */
const WHOLE = skip === false ? readWholeMap(URL_L) : undefined

/** The L's outline: counter-clockwise from its lowest (y, x) vertex, the notch's corner at (0, 1400). */
const RING = [-2400, 0, 2400, 0, 2400, 1400, 0, 1400, 0, 3900, -2400, 3900]
/** The notch's two sides, as edges of `RING`: x = 0 from y 1400 to 3900, y = 1400 from x 0 to 2400. */
const NOTCH = [2, 3]
/** `RING`'s edges, vertex k to the next. */
const EDGES = edgesOf(RING)

test(
  "the L: its play area two rectangles of lucido, 6 tiles listed and its notch's 2 not",
  { skip },
  () => {
    const { MAP } = sim!
    assert.deepEqual(MAP.outline, [RING])
    assert.deepEqual(
      MAP.tiles.map(({ i, j }) => `${i}_${j}`),
      ["-2_0", "-1_0", "0_0", "1_0", "-2_1", "-1_1"],
    )
    // Monzone's station and Carabinieri, Gragnola and Equi Terme, and the start by the Carabinieri
    assert.deepEqual(MAP.railway.stations.map((s) => s.name).sort(), [
      "Equi Terme",
      "Gragnola",
      "Monzone-Monte dei Bianchi-Isolano",
    ])
    const police = MAP.pois.find((p) => p.id === 14183344901)!
    assert.deepEqual(MAP.spawns.police, { x: police.x, y: police.y })
    assert.ok(Math.hypot(MAP.spawns.player.x - police.x, MAP.spawns.player.y - police.y) < 40)
  },
)

test(
  "outline walls, walk and drive, run end to end along every edge of the L, and the game finds them there",
  { skip },
  () => {
    assertOutlineWalls(WHOLE!.walls, EDGES, sim!.wallsNear)
  },
)

test(
  "a drivable road leaving the L is capped by a drive wall a few metres in, across its two sides' notch too",
  { skip },
  () => {
    const { isDrivable, outlineDistance, wallsNear } = sim!
    const capped: Array<number> = []
    const drivable = WHOLE!.roads.filter((r) => isDrivable(r.cls))
    /** The drivable roads with a vertex at (x, y). */
    const at = (x: number, y: number) =>
      drivable.filter((r) => r.pts.some((v, i) => i % 2 === 0 && v === x && r.pts[i + 1] === y))
    /**
     * Whether (x, y) lies on the carriageway of a drivable road other than `road` and the piece
     * joined end to end with it at its inner end (`next`, where no third way meets it).
     */
    const onOther = (road: (typeof drivable)[number], next: unknown, x: number, y: number) =>
      drivable.some((r) => {
        if (r === road || r === next) return false
        for (let k = 0; k + 3 < r.pts.length; k += 2)
          if (
            segDist2(x, y, r.pts[k]!, r.pts[k + 1]!, r.pts[k + 2]!, r.pts[k + 3]!).d2 <
            (r.w / 2) ** 2
          )
            return true
        return false
      })
    for (const road of drivable) {
      const n = road.pts.length / 2
      for (const [e, step] of [
        [0, 1],
        [n - 1, -1],
      ] as const) {
        const ex = road.pts[2 * e]!,
          ey = road.pts[2 * e + 1]!
        if (outlineDistance(ex, ey) > 0.05) continue
        // from the end to 8 m back along its last segment (the build caps it 4 m in): a drive wall off
        // the outline crosses it. The segment's other end is the first vertex the 0.1 m rounding left
        // apart from the end (a vertex 2 cm in rounds onto it).
        let p = e + step
        while (road.pts[2 * p] === ex && road.pts[2 * p + 1] === ey) p += step
        const px = road.pts[2 * p]!,
          py = road.pts[2 * p + 1]!,
          len = Math.hypot(ex - px, ey - py),
          ix = ex + ((px - ex) * 8) / len,
          iy = ey + ((py - ey) * 8) / len
        // A road leaving a few metres from a junction, where its cap would stand on another road's
        // carriageway, is left uncapped (exit-caps.ts: a cap shuts its own road alone), and the
        // outline's walls shut it: the L's 1 m stub 689546076 by the track 227686934.
        const inner = e === 0 ? n - 1 : 0
        const joined = at(road.pts[2 * inner]!, road.pts[2 * inner + 1]!).filter((r) => r !== road)
        if (
          onOther(
            road,
            joined.length === 1 ? joined[0] : undefined,
            ex + ((px - ex) * 4) / len,
            ey + ((py - ey) * 4) / len,
          )
        )
          continue
        const caps = wallsNear(
          "drive",
          Math.min(ix, ex),
          Math.min(iy, ey),
          Math.max(ix, ex),
          Math.max(iy, ey),
        ).filter(
          (w) =>
            outlineDistance(w.ax, w.ay) + outlineDistance(w.bx, w.by) > 0.1 &&
            crosses(w.ax, w.ay, w.bx, w.by, ix, iy, ex, ey) &&
            Math.hypot(w.bx - w.ax, w.by - w.ay) >= Math.min(road.w, 16),
        )
        assert.ok(caps.length > 0, `road ${road.id} leaves at ${ex}, ${ey} uncapped`)
        const k = EDGES.findIndex((g) => along(g, ex, ey) !== undefined)
        capped.push(k)
      }
    }
    // the notch is real land: roads cross both its sides
    for (const k of NOTCH)
      assert.ok(capped.filter((c) => c === k).length >= 5, `notch side ${k}: ${capped.join(",")}`)
  },
)

/** Flood cell side, m: fine enough for the gaps between houses, and every outline edge between two cells' centres. */
const STEP = 2

test(
  "on foot from the start, a flood stopped by the walk walls never leaves the L, and reaches every one of its edges",
  { skip },
  () => {
    const { MAP, inPlay, wallsNear } = sim!
    const { reached, near } = walkFlood({
      bounds: MAP.bounds,
      start: MAP.spawns.player,
      edges: EDGES,
      wallsNear,
      inPlay,
      step: STEP,
    })
    // the L's area is 12.72 km²: the flood covers most of it, 10.2 (the rest is cliffs, houses and banks)
    assert.ok(reached * STEP * STEP > 9e6, `${reached} cells reached`)
    assert.deepEqual(
      near,
      EDGES.map((_, k) => k),
    )
  },
)

test(
  "every graph node, spawn, POI, building and platform of the L lies in its play area",
  { skip },
  () => {
    const { MAP, graph, inPlay, outlineDistance } = sim!
    for (const n of graph.nodes) assert.ok(inPlay(n.x, n.y), `node at ${n.x}, ${n.y}`)
    for (const p of MAP.railway.platforms)
      for (const ring of WHOLE!.areas[p.area]!.rings)
        for (let i = 0; i < ring.length; i += 2)
          assert.ok(inPlay(ring[i]!, ring[i + 1]!), `platform at ${ring[i]}, ${ring[i + 1]}`)
    for (const s of [MAP.spawns.player, ...MAP.spawns.parked])
      assert.ok(inPlay(s.x, s.y, 1), `spawn at ${s.x}, ${s.y}`)
    for (const p of MAP.pois) assert.ok(inPlay(p.x, p.y), `poi ${p.id} at ${p.x}, ${p.y}`)
    // kept by its centroid (rounded to 0.1 m since); none at all would check nothing
    assert.ok(WHOLE!.buildings.length > 0, "the L has no buildings")
    for (const b of WHOLE!.buildings) {
      const [cx, cy] = centroid(b.outer)
      assert.ok(inPlay(cx, cy) || outlineDistance(cx, cy) < 0.1, `building ${b.id} at ${cx}, ${cy}`)
    }
  },
)

// Beyond the outline the L holds no roads, water or buildings, but lucido's map holds them there:
// the build cuts them to the box for the trees to keep off (`clipBeyond`), as lucido's trees do.
test(
  "no tree of the L beyond its outline stands on a road, in a stream or in a building lucido holds there",
  { skip },
  () => {
    const { inPlay } = sim!
    const lucido = wholeMap()
    /** Each feature's test, with its box grown by its reach. */
    const near = (pts: ReadonlyArray<number>, reach: number) => {
      const [x0, y0, x1, y1] = ringBox(pts)
      return {
        box: [x0 - reach, y0 - reach, x1 + reach, y1 + reach] as const,
        hit: (x: number, y: number) => {
          for (let i = 2; i < pts.length; i += 2)
            if (segDist2(x, y, pts[i - 2]!, pts[i - 1]!, pts[i]!, pts[i + 1]!).d2 < reach * reach)
              return true
          return false
        },
      }
    }
    const features = [
      ...lucido.roads.map((r) => ({ what: `road ${r.id}`, ...near(r.pts, r.w / 2) })),
      ...lucido.water.map((w) => ({ what: `water ${w.id}`, ...near(w.pts, w.w / 2) })),
      ...lucido.buildings.map((b) => ({
        what: `building ${b.id}`,
        box: ringBox(b.outer),
        hit: (x: number, y: number) => pointInRing(x, y, b.outer),
      })),
    ]
    const { trees } = WHOLE!
    let beyond = 0
    for (let k = 0; k < trees.length; k += 3) {
      const x = trees[k]!,
        y = trees[k + 1]!
      if (inPlay(x, y)) continue
      beyond++
      for (const { what, box, hit } of features)
        if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && hit(x, y))
          assert.fail(`the tree at ${x}, ${y} stands on lucido's ${what}`)
    }
    // the notch's strip in the listed tiles, x 0…2400 by y 1400…2000, is mostly wood
    assert.ok(beyond > 15000, `${beyond} trees beyond the outline`)
  },
)

// Hosts read the coarse grid where the tiles round a point are not in memory: it must answer as the
// tiles do, in the notch too, where both extend the nearest listed tile's edge.
test(
  "the L's coarse grid holds its tiles' terrain and land cover at every node, the notch's too",
  { skip },
  () => {
    const { heightAt, MAP } = sim!
    const { coarseCoverAt, coarseHeightAt } = coarse!
    const { coverAt } = cover!
    const { cell, cols, rows, x0, y0 } = MAP.coarse
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * cell,
          y = y0 + r * cell
        assert.equal(coarseHeightAt(x, y), heightAt(x, y), `height at ${x}, ${y}`)
        assert.equal(coarseCoverAt(x, y), coverAt(x, y), `cover at ${x}, ${y}`)
      }
  },
)

// The build reads no terrain in the notch's tiles (grid-tiles.ts), and the joined heightmap holds 0
// there: fitted over every node, the place would take those for the map's low ground.
test(
  "the L's place is fitted over the nodes of its listed tiles alone, none of its notch's",
  { skip },
  () => {
    const { MAP } = sim!
    const { heightmap } = WHOLE!
    const { floor, downslope } = placeFrom(MAP.origin, heightmap, listedNodes(heightmap, MAP.tiles))
    assert.deepEqual({ floor, downslope }, MAP.place)
    assert.equal(placeFrom(MAP.origin, heightmap).floor, 0)
  },
)

// The walls stage blocks no cell whose centre lies outside the play area (walls.ts): beyond the
// outline lie only its own walls, the caps 4 m in from it and the sides of a building kept whole
// across it, none of them far out; the notch's slopes and banks are walled by the outline alone.
test("no wall of the L lies wholly more than 5 m outside its play area", { skip }, () => {
  const { inPlay, outlineDistance } = sim!
  const out = (x: number, y: number) => !inPlay(x, y) && outlineDistance(x, y) > 5
  for (const kind of ["walk", "shore", "drive"] as const) {
    const flat = WHOLE!.walls[kind]
    for (let w = 0; w < flat.length; w += 4) {
      const ax = flat[w]!,
        ay = flat[w + 1]!,
        bx = flat[w + 2]!,
        by = flat[w + 3]!
      assert.ok(!(out(ax, ay) && out(bx, by)), `${kind} wall ${ax}, ${ay} to ${bx}, ${by}`)
    }
  }
})

// The notch's sides cut the L's lines as the outline cuts the shipped map's (`clipPieces`): before
// a cut gave way to a vertex on its 0.1 m point, road 1002673816 repeated (0, 1912.5).
test("no line of the L repeats a vertex in a row where the outline cuts it", { skip }, () => {
  for (const [what, lines] of [
    ["road", WHOLE!.roads],
    ["water", WHOLE!.water],
    ["rail", WHOLE!.rail],
    ["barrier", WHOLE!.barriers],
  ] as const)
    lines.forEach((l, n) => {
      for (let i = 2; i < l.pts.length; i += 2)
        assert.ok(
          l.pts[i] !== l.pts[i - 2] || l.pts[i + 1] !== l.pts[i - 1],
          `${what} ${"id" in l ? l.id : n} repeats (${l.pts[i]}, ${l.pts[i + 1]})`,
        )
    })
})

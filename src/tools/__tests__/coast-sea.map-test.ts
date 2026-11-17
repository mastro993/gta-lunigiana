// Issue #13's checks of the sea on the coast test region (`magra-coast`, region.ts) as built: the
// sea's floor under 0 m and on Regione Liguria's survey, the beaches over it, the Magra and every
// stream meeting it at 0 m, and the catchments draining into it, read through the game's own
// lookups. This process loads the coast (`useDiskMap`) from test-maps/, which `pnpm maps` builds;
// without the build every check here is skipped, but in CI, which builds it, a missing build fails.
// The survey's isobaths are fetch-lig's (data/raw/lig/magra-coast), which `pnpm fetch-raw` restores.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"

import { MEAN, SPATE } from "../../sim/__tests__/flows.ts"
import { TILE } from "../../sim/map/kinds.ts"
import { useDiskMap } from "../../sim/map/source.ts"
import { fillPolygon, segDist2 } from "../geometry.ts"
import { readWholeMap } from "../map-file.ts"
import { ligDir, regionFromArgs } from "../region.ts"
import { BREAKWATER_TOP, PIER_DECK } from "../shore.ts"
import { readIsobaths } from "../ucs.ts"
import { inAreas } from "../water-areas.ts"
import { intoSea, pastEnd } from "./coast-map.ts"
import { skipUnbuilt, TEST_MAPS } from "./test-maps.ts"

const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const sim = skip === false ? await import("../../sim/map/index.ts") : undefined
const ground = skip === false ? await import("../../sim/map/ground.ts") : undefined
const cover = skip === false ? await import("../../sim/map/cover.ts") : undefined
const rivers = skip === false ? await import("../../sim/water/rivers.ts") : undefined
/** The coast whole: its terrain, land cover and vectors joined back from its tiles. */
const WHOLE = skip === false ? readWholeMap(URL_COAST) : undefined

const ROOT = join(import.meta.dirname, "../../..")
const ISOBATHS = join(
  ROOT,
  ligDir(regionFromArgs(["--region", "magra-coast"]).parts[0]!),
  "isobaths.json.gz",
)

/** The edges of `areas`' rings, flat (ax, ay, bx, by) each. */
const edgesOf = (
  areas: ReadonlyArray<{ readonly rings: ReadonlyArray<ReadonlyArray<number>> }>,
): Array<number> => {
  const out: Array<number> = []
  for (const { rings } of areas)
    for (const r of rings)
      for (let i = 0, j = r.length / 2 - 1; 2 * i < r.length; j = i++)
        out.push(r[2 * j]!, r[2 * j + 1]!, r[2 * i]!, r[2 * i + 1]!)
  return out
}

/** The distance (m) from (x, y) to the nearest of `edges` (flat, as `edgesOf` gives them). */
const distanceTo = (edges: ReadonlyArray<number>, x: number, y: number) => {
  let d2 = Infinity
  for (let s = 0; s < edges.length; s += 4)
    d2 = Math.min(d2, segDist2(x, y, edges[s]!, edges[s + 1]!, edges[s + 2]!, edges[s + 3]!).d2)
  return Math.sqrt(d2)
}

/** The coast's sea areas: OSM's coastline closed into a piece per tile (coast.ts). */
const seaAreas = () => WHOLE!.areas.filter((a) => a.kind === "sea")

/** A ring's ends within this of a line lie on it, m: half the rings' 0.1 m rounding. */
const ON_LINE = 0.05

/** Whether `v` (m, along x or y) lies on a tile's side, a multiple of TILE, or on bound `low` or `high`. */
const onCut = (v: number, low: number, high: number) =>
  Math.abs(v - Math.round(v / TILE) * TILE) < ON_LINE ||
  Math.abs(v - low) < ON_LINE ||
  Math.abs(v - high) < ON_LINE

/**
 * The coastline's edges (flat, as `edgesOf` gives them): the sea areas' edges less the cuts along a
 * tile's side or the map's bounds, where the sea goes on (`isCut` in rivers.ts).
 */
const coastline = (): Array<number> => {
  const { minX, minY, maxX, maxY } = WHOLE!.bounds,
    edges = edgesOf(seaAreas()),
    out: Array<number> = []
  for (let s = 0; s < edges.length; s += 4) {
    const ax = edges[s]!,
      ay = edges[s + 1]!,
      bx = edges[s + 2]!,
      by = edges[s + 3]!
    const cut =
      (Math.abs(bx - ax) < ON_LINE && onCut(ax, minX, maxX)) ||
      (Math.abs(by - ay) < ON_LINE && onCut(ay, minY, maxY))
    if (!cut) out.push(ax, ay, bx, by)
  }
  return out
}

/** Whether each node of the heightmap (row-major from its south-west node) lies in the sea: the nodes the build carves to its floor. */
const seaNodes = (): Uint8Array => {
  const { cell, cols, rows, x0, y0 } = WHOLE!.heightmap
  const out = new Uint8Array(cols * rows)
  // Pixels of a cell's side centred on the nodes.
  for (const { rings } of seaAreas())
    fillPolygon(rings, x0 - cell / 2, y0 - cell / 2, cell, { c0: 0, r0: 0, cols, rows }, (k) => {
      out[k] = 1
    })
  return out
}

/**
 * The beach face's fall into the sea, a share (`PROFILE` in sea-floor.ts: 0.6 m over its first
 * 7.5 m): the heightmap holds whole decimetres, so a node nearer the coast than 0.05 m of it rounds
 * to 0 m, and the sea's rings are the coastline rounded to 0.1 m.
 */
const AT_COAST = 0.05 / (0.6 / 7.5) + 0.1

test(
  "the sea: every node of its areas stands under 0 m, but at the coastline (no cut along a tile's side or the map's bounds), where the beach face rounds to 0 m, and where a breakwater, a groyne or a pier's area raises it to its top (the islets are holes in it)",
  { skip },
  () => {
    const { cell, cols, data, x0, y0 } = WHOLE!.heightmap
    const sea = seaNodes(),
      coast = coastline()
    // The areas the shore raises over the sea: the breakwaters and groynes, and a pier's.
    const isRaised = (kind: string) => kind === "rock" || kind === "paved",
      raised = edgesOf(WHOLE!.areas.filter((a) => isRaised(a.kind))),
      inRaised = inAreas(WHOLE!.areas, isRaised)
    let nodes = 0,
      atCoast = 0,
      tops = 0
    for (let k = 0; k < sea.length; k++) {
      if (sea[k] === 0) continue
      nodes++
      const z = data[k]! / 10
      if (z < 0) continue
      const x = x0 + (k % cols) * cell,
        y = y0 + Math.floor(k / cols) * cell
      if (z === 0 && distanceTo(coast, x, y) < AT_COAST) {
        atCoast++
        continue
      }
      // The build raises every node of a cell such an area touches (`raiseAreas`): within a cell's
      // diagonal of it.
      assert.ok(
        (z === BREAKWATER_TOP || z === PIER_DECK) &&
          (inRaised(x, y) || distanceTo(raised, x, y) <= cell * Math.SQRT2),
        `the sea's node at ${x}, ${y} stands at ${z} m`,
      )
      tops++
    }
    // 695,905 sea nodes, 281 at the coastline, 333 raised (measured 2026-11-17)
    assert.ok(nodes > 600_000, `${nodes} sea nodes`)
    assert.ok(tops > 300 && atCoast <= 300, `${tops} raised, ${atCoast} at the coastline`)
  },
)

/**
 * An isobath shorter than this, m, is no contour of the floor (`SHORT` in sea-floor.ts): the
 * survey's stacked raster seams and broken bits.
 */
const SHORT = 50

/** A line's length, m. */
const lengthOf = (pts: ReadonlyArray<readonly [number, number]>) =>
  pts.slice(1).reduce((s, [x, y], k) => s + Math.hypot(x - pts[k]![0], y - pts[k]![1]), 0)

test(
  "the sea's floor: at every vertex of the survey's isobaths in the sea the ground stands at its depth, the median within 2 cm and 95 % or more within 0.25 m",
  { skip },
  () => {
    if (!existsSync(ISOBATHS))
      throw new Error(`no isobaths at ${relative(ROOT, ISOBATHS)}: pnpm fetch-raw restores them`)
    const { heightAt } = sim!
    const inSea = inAreas(WHOLE!.areas, (kind) => kind === "sea")
    const errors: Array<number> = []
    for (const { depth, pts } of readIsobaths([ISOBATHS]))
      if (lengthOf(pts) >= SHORT)
        for (const [x, y] of pts) if (inSea(x, y)) errors.push(heightAt(x, y) + depth)
    errors.sort((a, b) => a - b)
    const median = errors[errors.length >> 1]!,
      within = errors.filter((e) => Math.abs(e) <= 0.25).length / errors.length
    // 10,642 vertices: median 0.00 m, 96.7 % within 0.25 m, p1 −0.38 and p99 +0.30 (measured 2026-11-17)
    assert.ok(errors.length > 10_000, `${errors.length} vertices`)
    assert.ok(Math.abs(median) <= 0.02, `the median vertex stands ${median.toFixed(3)} m off`)
    assert.ok(within >= 0.95, `${(100 * within).toFixed(1)} % within 0.25 m`)
  },
)

/**
 * Why the beach cell (i, j), its centre (x, y) at z m on the drawn mesh, may stand outside 0–3 m:
 * "shore" where the beach face dips into the sea (a sea node of `sea` among its corners), "bed"
 * where a stream's bed crosses it (the game finds the stream's water there), else undefined.
 */
const excuse = (sea: Uint8Array, i: number, j: number, x: number, y: number, z: number) => {
  const { cols } = WHOLE!.heightmap
  if ([0, 1, cols, cols + 1].some((d) => sea[j * cols + i + d] === 1)) return "shore"
  return rivers!.waterAt(x, y, z, MEAN) === undefined ? undefined : "bed"
}

test(
  "sand beaches: every sand cell stands 0–3 m over the sea at its centre, but where the beach face dips into the sea (a sea node among its corners) or a stream's bed crosses it (the game finds the stream's water there)",
  { skip },
  () => {
    const { cell, cols, rows, x0, y0 } = WHOLE!.heightmap
    const { terrainZ } = ground!,
      { coverName } = cover!
    const sea = seaNodes(),
      // The sand's cover byte.
      value = Array.from({ length: 256 }, (_, v) => v).find((v) => coverName(v) === "sand")
    let cells = 0,
      shore = 0,
      beds = 0
    for (let j = 0; j + 1 < rows; j++)
      for (let i = 0; i + 1 < cols; i++) {
        if (WHOLE!.cover[j * (cols - 1) + i] !== value) continue
        cells++
        const x = x0 + (i + 0.5) * cell,
          y = y0 + (j + 0.5) * cell,
          z = terrainZ(x, y)
        if (z >= 0 && z <= 3) continue
        const why = excuse(sea, i, j, x, y, z)
        if (why === undefined)
          assert.fail(`the sand cell at ${x}, ${y} stands at ${z.toFixed(2)} m`)
        if (why === "shore") shore++
        else beds++
      }
    // 16,581 sand cells, 23 dipping into the sea and 2 in stream 311359630's bed (measured 2026-11-17)
    assert.ok(cells > 15_000, `${cells} sand cells`)
    assert.ok(shore + beds < cells / 100, `${shore} cells at the sea and ${beds} in a bed`)
  },
)

/**
 * Within this of the coastline, m, a pebble beach's cells stand 0–3 m as sand's do: the cells at
 * the waterline. Further in they stand on Liguria's DTM, which ramps from the coastline's 0 m up to
 * the cliffs' contours (docs/map.md's Known data limitations).
 */
const PEBBLE_FACE = 2

test(
  "pebble beaches (the pebble areas meeting the sea): every cell stands 0 m or more over the sea at its centre and, within 2 m of the coastline, 3 m or less, with sand's exceptions; further in, where Liguria's DTM ramps up to the cliffs, at most 47 % of them stand over 3 m and none over 9 m",
  { skip },
  () => {
    const { cell, cols, rows, x0, y0 } = WHOLE!.heightmap
    const { terrainZ } = ground!
    const sea = seaNodes(),
      coast = coastline()
    // A pebble area meets the sea where a vertex of its rings lies within two cells of the coastline:
    // the coves under Montemarcello and Punta Bianca and Bocca di Magra's beach.
    const meets = (r: ReadonlyArray<number>) =>
        r.some((_, k) => k % 2 === 0 && distanceTo(coast, r[k]!, r[k + 1]!) <= 2 * cell),
      beaches = WHOLE!.areas.filter((a) => a.kind === "pebble" && a.rings.some(meets)),
      inBeach = inAreas(beaches, () => true)
    let cells = 0,
      shore = 0,
      beds = 0,
      inland = 0,
      high = 0,
      top = 0
    for (let j = 0; j + 1 < rows; j++)
      for (let i = 0; i + 1 < cols; i++) {
        const x = x0 + (i + 0.5) * cell,
          y = y0 + (j + 0.5) * cell
        if (!inBeach(x, y)) continue
        cells++
        const z = terrainZ(x, y),
          face = distanceTo(coast, x, y) < PEBBLE_FACE
        if (!face) inland++
        if (!face && z > 3) {
          high++
          top = Math.max(top, z)
          continue
        }
        if (z >= 0 && z <= 3) continue
        const why = excuse(sea, i, j, x, y, z)
        if (why === undefined)
          assert.fail(`the pebble beach's cell at ${x}, ${y} stands at ${z.toFixed(2)} m`)
        if (why === "shore") shore++
        else beds++
      }
    // 6 areas, 670 cells (one where two overlap), 55 within 2 m of the coastline; of the 615 further
    // in 283 stand over 3 m (46.0 %), the highest 8.70 m 35–40 m from the sea under Montemarcello; 44
    // dip into the sea and none lies in a bed (measured 2026-11-17)
    assert.ok(beaches.length >= 6 && cells > 600, `${beaches.length} areas, ${cells} cells`)
    assert.ok(high <= 0.47 * inland, `${high} of ${inland} cells over 3 m`)
    assert.ok(top <= 9, `a pebble beach's cell at ${top.toFixed(2)} m`)
    assert.ok(shore + beds < cells / 10, `${shore} cells at the sea and ${beds} in a bed`)
  },
)

test(
  "the Magra meets the sea at 0 m: its line ends at 0 m at its mouth, where the sea holds its water at 0 m at the mean flow and never lets it under in a spate, the sea past it at 0 m; no water of the coast stands under 0 m, and each piece ending in the sea ends at 0 m",
  { skip },
  () => {
    const { waterAt } = rivers!
    const ending = intoSea(WHOLE!),
      magra = ending.filter((w) => w.name === "Fiume Magra")
    assert.equal(magra.length, 1, "the Magra's mouth")
    const { pts, z } = magra[0]!,
      mouth = { x: pts.at(-2)!, y: pts.at(-1)! }
    assert.equal(z.at(-1), 0, "its line's last vertex")
    // Under the deepest floor, so the level is the water's wherever it stands.
    assert.equal(waterAt(mouth.x, mouth.y, -100, MEAN)?.level, 0, "at the mean flow")
    // With the 6 km² of its basin the map holds (the rest past the map: #21), a spate's stage stays
    // under the sea's level and the sea holds it at 0 m too.
    assert.ok(waterAt(mouth.x, mouth.y, -100, SPATE)!.level >= 0, "in a spate")
    const sea = pastEnd(pts, 20)
    for (const q of [MEAN, SPATE]) assert.equal(waterAt(sea.x, sea.y, -100, q)?.level, 0, "the sea")
    // Every water piece: its surface at every vertex, and the level waterAt answers there.
    for (const w of WHOLE!.water)
      w.z.forEach((h, k) => {
        assert.ok(h >= 0, `water ${w.id}'s vertex ${k} at ${h} m`)
        for (const q of [0, MEAN, SPATE]) {
          const level = waterAt(w.pts[2 * k]!, w.pts[2 * k + 1]!, -100, q)?.level
          assert.ok(level === undefined || level >= 0, `water ${w.id}'s vertex ${k}: ${level} m`)
        }
      })
    for (const w of ending)
      assert.equal(w.z.at(-1), 0, `water ${w.id} ends in the sea at ${w.z.at(-1)} m`)
    // the Magra, the Parmignola, the Fossa Maestra, a stream across Marinella's beach and two of
    // Montemarcello's
    assert.equal(ending.length, 6, "pieces ending in the sea")
  },
)

test(
  "catchments: the sea drains the land, the Magra reaching it with the 6.06 km² of its basin the map holds and the Parmignola with 1.0; every water's area grows downstream, and none jumps at its mouth",
  { skip },
  () => {
    const water = WHOLE!.water
    for (const w of water)
      w.area.forEach((a, k) =>
        assert.ok(k === 0 || a >= w.area[k - 1]!, `water ${w.id} shrinks at ${k}`),
      )
    for (const w of water) {
      const [before, mouth] = w.area.slice(-2)
      if (before !== undefined)
        assert.ok(
          mouth! <= 1.5 * before + 1,
          `water ${w.id}: ${before} km² jumps to ${mouth} at its mouth`,
        )
    }
    const leaves = (name: string) =>
      Math.max(...water.filter((w) => w.name === name).map((w) => w.area.at(-1)!))
    // As measured once the sea's nodes became the catchments' outlets (2026-11-17).
    const magra = leaves("Fiume Magra"),
      parmignola = leaves("Torrente Parmignola")
    assert.ok(Math.abs(magra - 6.06) <= 0.2, `the Magra reaches the sea with ${magra} km²`)
    assert.ok(Math.abs(parmignola - 1) <= 0.05, `the Parmignola with ${parmignola} km²`)
  },
)

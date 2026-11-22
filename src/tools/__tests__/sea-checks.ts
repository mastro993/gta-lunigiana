// The checks of the sea a built map holds, on its joined whole, which the coast test region's
// (coast-sea.map-test.ts, issue #13) and Lunigiana's, the Gulf of La Spezia beyond Sarzana's part
// (water-areas.map-test.ts, issue #20), share: every node of its areas under 0 m but where the shore
// holds it, and its floor on Regione Liguria's survey of it.
import assert from "node:assert/strict"

import { TILE } from "../../sim/map/kinds.ts"
import { fillPolygon, segDist2 } from "../geometry.ts"
import type { JoinedMap } from "../map-file.ts"
import { BREAKWATER_TOP, PIER_DECK } from "../shore.ts"
import { readIsobaths } from "../ucs.ts"
import { inAreas } from "../water-areas.ts"

/** The edges of `areas`' rings, flat (ax, ay, bx, by) each. */
export const edgesOf = (
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
export const distanceTo = (edges: ReadonlyArray<number>, x: number, y: number) => {
  let d2 = Infinity
  for (let s = 0; s < edges.length; s += 4)
    d2 = Math.min(d2, segDist2(x, y, edges[s]!, edges[s + 1]!, edges[s + 2]!, edges[s + 3]!).d2)
  return Math.sqrt(d2)
}

/** The sea areas of `whole`: OSM's coastline closed into a piece per tile (coast.ts). */
const seaAreas = (whole: JoinedMap) => whole.areas.filter((a) => a.kind === "sea")

/** A ring's ends within this of a line lie on it, m: half the rings' 0.1 m rounding. */
const ON_LINE = 0.05

/** Whether `v` (m, along x or y) lies on a tile's side, a multiple of TILE, or on bound `low` or `high`. */
const onCut = (v: number, low: number, high: number) =>
  Math.abs(v - Math.round(v / TILE) * TILE) < ON_LINE ||
  Math.abs(v - low) < ON_LINE ||
  Math.abs(v - high) < ON_LINE

/**
 * The coastline's edges (flat, as `edgesOf` gives them): the sea areas' edges less the cuts along a
 * tile's side or the map's bounds, where the sea goes on (`isCut` in water/banks.ts).
 */
export const coastline = (whole: JoinedMap): Array<number> => {
  const { minX, minY, maxX, maxY } = whole.bounds,
    edges = edgesOf(seaAreas(whole)),
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
export const seaNodes = (whole: JoinedMap): Uint8Array => {
  const { cell, cols, rows, x0, y0 } = whole.heightmap
  const out = new Uint8Array(cols * rows)
  // Pixels of a cell's side centred on the nodes.
  for (const { rings } of seaAreas(whole))
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
export const AT_COAST = 0.05 / (0.6 / 7.5) + 0.1

/**
 * Asserts that every node of `whole`'s sea areas stands under 0 m, but at the coastline (no cut along
 * a tile's side or the map's bounds), where the beach face rounds to 0 m, and where a breakwater, a
 * groyne or a pier's area raises it to its top (the islets are holes in it); returns how many nodes
 * the sea holds, how many stand at the coastline and how many at a top.
 */
export const checkSeaUnderZero = (whole: JoinedMap) => {
  const { cell, cols, data, x0, y0 } = whole.heightmap
  const sea = seaNodes(whole),
    coast = coastline(whole)
  // The areas the shore raises over the sea: the breakwaters and groynes, and a pier's.
  const isRaised = (kind: string) => kind === "rock" || kind === "paved",
    raised = edgesOf(whole.areas.filter((a) => isRaised(a.kind))),
    inRaised = inAreas(whole.areas, isRaised)
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
  return { nodes, atCoast, tops }
}

/**
 * An isobath shorter than this, m, is no contour of the floor (`SHORT` in sea-floor.ts): the
 * survey's stacked raster seams and broken bits.
 */
const SHORT = 50

/** A line's length, m. */
const lengthOf = (pts: ReadonlyArray<readonly [number, number]>) =>
  pts.slice(1).reduce((s, [x, y], k) => s + Math.hypot(x - pts[k]![0], y - pts[k]![1]), 0)

/**
 * How far the ground stands off the floor the survey gives, m (its height plus the depth), at every
 * vertex in `whole`'s sea of the isobaths in `files` at least SHORT long, read by `heightAt`: sorted.
 */
export const floorErrors = (
  whole: JoinedMap,
  heightAt: (x: number, y: number) => number,
  files: ReadonlyArray<string>,
): Array<number> => {
  const inSea = inAreas(whole.areas, (kind) => kind === "sea")
  const errors: Array<number> = []
  for (const { depth, pts } of readIsobaths(files))
    if (lengthOf(pts) >= SHORT)
      for (const [x, y] of pts) if (inSea(x, y)) errors.push(heightAt(x, y) + depth)
  return errors.sort((a, b) => a - b)
}

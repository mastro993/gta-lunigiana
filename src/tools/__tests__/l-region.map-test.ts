// The L test region (`lunigiana-l`, region.ts) as built: its outline walls close its play area,
// nothing on foot gets out of it, and everything the map places lies in it. This process loads
// the L (`loadBuiltMap`), from test-maps/, which `node src/tools/build-map.ts --region lunigiana-l`
// writes. Without that build every check here is skipped, but in CI, which builds it with the maps
// (`pnpm maps`), a missing build fails: a skip there would pass with nothing checked.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { centroid } from "../geometry.ts"
import { builtMapUrl, loadBuiltMap, readWholeMap } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"

const REGION = regionFromArgs(["--region", "lunigiana-l"])
const URL_L = builtMapUrl(REGION)
const skip = existsSync(URL_L)
  ? false
  : `no ${REGION.key} build in test-maps: run node src/tools/build-map.ts --region ${REGION.key}`
// GitHub Actions sets CI=true.
if (skip !== false && process.env.CI === "true") throw new Error(skip)
if (skip === false) await loadBuiltMap(REGION)
const sim = skip === false ? await import("../../sim/map/index.ts") : undefined
const WHOLE = skip === false ? readWholeMap(URL_L) : undefined

/** The L's outline: counter-clockwise from its lowest (y, x) vertex, the notch's corner at (0, 1400). */
const RING = [-2400, 0, 2400, 0, 2400, 1400, 0, 1400, 0, 3900, -2400, 3900]
/** The notch's two sides, as edges of `RING`: x = 0 from y 1400 to 3900, y = 1400 from x 0 to 2400. */
const NOTCH = [2, 3]
/** A point lies on an edge within this (m): the L's edges are whole metres, and walls round to 0.1 m. */
const ON = 1e-6

/** Edge k of `RING`: from vertex k to the next. */
const edge = (k: number) => {
  const n = RING.length / 2,
    m = (k + 1) % n
  return { ax: RING[2 * k]!, ay: RING[2 * k + 1]!, bx: RING[2 * m]!, by: RING[2 * m + 1]! }
}
const EDGES = Array.from({ length: RING.length / 2 }, (_, k) => edge(k))
/** Where along axis-aligned edge `e` (0 at a, its length at b) point (x, y) lies, or undefined off its line. */
const along = (e: ReturnType<typeof edge>, x: number, y: number): number | undefined => {
  if (e.ax === e.bx)
    return Math.abs(x - e.ax) <= ON ? (y - e.ay) * Math.sign(e.by - e.ay) : undefined
  return Math.abs(y - e.ay) <= ON ? (x - e.ax) * Math.sign(e.bx - e.ax) : undefined
}
const lengthOf = (e: ReturnType<typeof edge>) => Math.abs(e.bx - e.ax) + Math.abs(e.by - e.ay)

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
    const { wallsNear } = sim!
    for (const kind of ["walk", "drive"] as const) {
      const flat = WHOLE!.walls[kind]
      EDGES.forEach((e, k) => {
        // the stretches of the edge its walls cover, merged
        const spans: Array<[number, number]> = []
        for (let w = 0; w < flat.length; w += 4) {
          const s = along(e, flat[w]!, flat[w + 1]!),
            t = along(e, flat[w + 2]!, flat[w + 3]!)
          // on the edge, not on its line past an end
          if (
            s !== undefined &&
            t !== undefined &&
            Math.max(s, t) > 0 &&
            Math.min(s, t) < lengthOf(e)
          )
            spans.push([Math.min(s, t), Math.max(s, t)])
        }
        spans.sort((a, b) => a[0] - b[0])
        let reach = 0
        for (const [s, t] of spans) {
          assert.ok(s <= reach + ON, `${kind} edge ${k}: a gap from ${reach} to ${s} m`)
          reach = Math.max(reach, t)
        }
        assert.ok(reach >= lengthOf(e) - ON, `${kind} edge ${k}: walls stop at ${reach} m`)
        // every 4 m along it, a lookup there answers a wall on it
        for (let d = 2; d < lengthOf(e); d += 4) {
          const x = e.ax + Math.sign(e.bx - e.ax) * d,
            y = e.ay + Math.sign(e.by - e.ay) * d
          assert.ok(
            wallsNear(kind, x - 0.5, y - 0.5, x + 0.5, y + 0.5).some((w) => {
              const s = along(e, w.ax, w.ay),
                t = along(e, w.bx, w.by)
              return (
                s !== undefined && t !== undefined && Math.min(s, t) <= d && d <= Math.max(s, t)
              )
            }),
            `${kind} edge ${k}: no wall found at ${x}, ${y}`,
          )
        }
      })
    }
  },
)

test(
  "a drivable road leaving the L is capped by a drive wall a few metres in, across its two sides' notch too",
  { skip },
  () => {
    const { MAP, isDrivable, outlineDistance, wallsNear } = sim!
    const capped: Array<number> = []
    for (const road of MAP.roads) {
      if (!isDrivable(road.cls)) continue
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

/** Whether segments a–b and c–d cross or touch. */
const crosses = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean => {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px))
  const d1 = side(cx, cy, dx, dy, ax, ay),
    d2 = side(cx, cy, dx, dy, bx, by),
    d3 = side(ax, ay, bx, by, cx, cy),
    d4 = side(ax, ay, bx, by, dx, dy)
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0)
}

/** Flood cell side, m: fine enough for the gaps between houses, and every outline edge between two cells' centres. */
const STEP = 2
/** How far past the bounds the flood may go, m: a leak through the outline would reach it. */
const BEYOND = 40
/** Side of the cells whose walls are looked up once, m. */
const BLOCK = 16

test(
  "on foot from the start, a flood stopped by the walk walls never leaves the L, and reaches every one of its edges",
  { skip },
  () => {
    const { MAP, inPlay, wallsNear } = sim!
    const { minX, minY, maxX, maxY } = MAP.bounds
    const x0 = minX - BEYOND,
      y0 = minY - BEYOND,
      cols = (maxX - minX + 2 * BEYOND) / STEP,
      rows = (maxY - minY + 2 * BEYOND) / STEP
    const per = BLOCK / STEP,
      bcols = Math.ceil(cols / per)
    /** Each block's walk walls (and trunks), flat, looked up once. */
    const blocks = new Map<number, Float64Array>()
    const wallsOf = (b: number): Float64Array => {
      let flat = blocks.get(b)
      if (flat === undefined) {
        const bx = x0 + (b % bcols) * BLOCK,
          by = y0 + Math.floor(b / bcols) * BLOCK
        const found = wallsNear("walk", bx, by, bx + BLOCK, by + BLOCK)
        flat = new Float64Array(found.length * 4)
        found.forEach((w, k) => flat!.set([w.ax, w.ay, w.bx, w.by], 4 * k))
        blocks.set(b, flat)
      }
      return flat
    }
    const blockOf = (c: number, r: number) => Math.floor(r / per) * bcols + Math.floor(c / per)
    const centre = (c: number) => x0 + (c + 0.5) * STEP
    const middle = (r: number) => y0 + (r + 0.5) * STEP
    const open = (c: number, r: number, d: number, e: number) => {
      const ax = centre(c),
        ay = middle(r),
        bx = centre(d),
        by = middle(e)
      for (const b of new Set([blockOf(c, r), blockOf(d, e)])) {
        const w = wallsOf(b)
        for (let k = 0; k < w.length; k += 4)
          if (crosses(w[k]!, w[k + 1]!, w[k + 2]!, w[k + 3]!, ax, ay, bx, by)) return false
      }
      return true
    }
    const seen = new Uint8Array(cols * rows)
    const { x, y } = MAP.spawns.player
    const start = Math.floor((y - y0) / STEP) * cols + Math.floor((x - x0) / STEP)
    const stack = [start]
    seen[start] = 1
    let reached = 0
    const near = new Set<number>()
    while (stack.length > 0) {
      const k = stack.pop()!,
        c = k % cols,
        r = Math.floor(k / cols)
      reached++
      const cx = centre(c),
        cy = middle(r)
      assert.ok(inPlay(cx, cy), `the flood got out at ${cx}, ${cy}`)
      EDGES.forEach((e, k) => {
        if (edgeNear(e, cx, cy)) near.add(k)
      })
      for (const [d, e] of [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ] as const) {
        if (d < 0 || e < 0 || d >= cols || e >= rows || seen[e * cols + d] === 1) continue
        if (!open(c, r, d, e)) continue
        seen[e * cols + d] = 1
        stack.push(e * cols + d)
      }
    }
    // the L's area is 12.72 km²: the flood covers most of it, 10.2 (the rest is cliffs, houses and banks)
    assert.ok(reached * STEP * STEP > 9e6, `${reached} cells reached`)
    assert.deepEqual(
      [...near].sort((a, b) => a - b),
      EDGES.map((_, k) => k),
    )
  },
)

/** Whether (x, y) lies within `STEP` m of axis-aligned edge `e`, beside it. */
const edgeNear = (e: ReturnType<typeof edge>, x: number, y: number) =>
  e.ax === e.bx
    ? Math.abs(x - e.ax) < STEP && y >= Math.min(e.ay, e.by) && y <= Math.max(e.ay, e.by)
    : Math.abs(y - e.ay) < STEP && x >= Math.min(e.ax, e.bx) && x <= Math.max(e.ax, e.bx)

test(
  "every graph node, spawn, POI, building and platform of the L lies in its play area",
  { skip },
  () => {
    const { MAP, graph, inPlay, outlineDistance } = sim!
    for (const n of graph.nodes) assert.ok(inPlay(n.x, n.y), `node at ${n.x}, ${n.y}`)
    for (const p of MAP.railway.platforms)
      for (const ring of MAP.areas[p.area]!.rings)
        for (let i = 0; i < ring.length; i += 2)
          assert.ok(inPlay(ring[i]!, ring[i + 1]!), `platform at ${ring[i]}, ${ring[i + 1]}`)
    for (const s of [MAP.spawns.player, ...MAP.spawns.parked])
      assert.ok(inPlay(s.x, s.y, 1), `spawn at ${s.x}, ${s.y}`)
    for (const p of MAP.pois) assert.ok(inPlay(p.x, p.y), `poi ${p.id} at ${p.x}, ${p.y}`)
    // kept by its centroid (rounded to 0.1 m since)
    for (const b of MAP.buildings) {
      const [cx, cy] = centroid(b.outer)
      assert.ok(inPlay(cx, cy) || outlineDistance(cx, cy) < 0.1, `building ${b.id} at ${cx}, ${cy}`)
    }
  },
)

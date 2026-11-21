// The houses' collision walls and footprints: a footprint's outline, opened where a way runs through
// it on its level (a passage, steps under an arch, a tunnel's bore), and the footprints the drivable
// roads cut, where OSM and the CTR disagree by a metre or two.
import { segT, staticGrid } from "../sim/collide.ts"
import { isDrivable, isMotorRoad, ONE_LEVEL, UNDERPASS } from "../sim/map/kinds.ts"
import type { BuildingF, RoadF } from "./features.ts"
import { flatRing, pointInRing, r1, ringBox, segD2, signedArea } from "./geometry.ts"
import { simplifyLoop, traceLoops } from "./loops.ts"
import { boundary, pushPolyline } from "./wall-pieces.ts"

/** Half-width of the corridor kept open where a road centreline runs through or along a footprint. */
export const ARCH = 1.2
/** Raster cell for footprints cut by such a corridor, m. */
const FOOTPRINT_RES = 0.2
/** How far a traced footprint's outline may stray from its raster, m (`simplifyLoop`'s tolerance). */
const TRACE_TOL = 0.15
/** Smallest piece of a clipped footprint kept, m². */
const MIN_PIECE = 4
/** The kerb either side of a bore's carriageway, m, as its walls are drawn (`boreOf` in src/render/bores.ts). */
export const KERB = 1
/**
 * The most the ground along a house's wall with a level spans, m: a wall meets the grounds within
 * ONE_LEVEL of its level, half a metre in from either end of that (`SPAN` in deck-walls.ts).
 */
const SPAN = 2 * ONE_LEVEL - 1
/** How far apart the ground is read along such a wall, m. */
const ALONG = 0.5

/**
 * Roads that clip the footprints they cross (`clipBuildings`): drivable, not tunnels. OSM and the
 * CTR disagree by a metre or two, and none of these is tagged as a passage, so the house gives way.
 * The rest (tunnels, paths and steps under arches) only open a corridor in the walls.
 */
const clips = (r: RoadF) => isDrivable(r.cls) && r.tunnel !== true

/**
 * A centreline segment (ax, ay, bx, by), its corridor half-width, and for a road tunnel's bore (no
 * building passage) its road's index and its clear height, m; -1 and NaN for any other way, which
 * opens whatever stands over it.
 */
type Cut = readonly [number, number, number, number, number, number, number]

/**
 * The corridor of every centreline segment of the `roads` that `keep`, min(w/2, ARCH) m half-width,
 * indexed by its box: a motor road's whole w/2, as no arch spans a motorway's or trunk road's
 * tunnel, and a deck's that clips (`clips`), as no house stands on a bridge: a footprint reaching
 * into its carriageway stands under it or beside it, and gives way as at grade. With `bores`, a
 * tunnel's, but a building passage's, carries its road's index and clear height (its `maxheight`,
 * else UNDERPASS), which `byLevel` reads.
 */
const corridors = (roads: ReadonlyArray<RoadF>, keep: (r: RoadF) => boolean, bores = false) => {
  const cuts: Array<Cut> = []
  roads.forEach((r, i) => {
    if (!keep(r)) return
    const bore = bores && r.tunnel === true && r.passage !== true
    for (let k = 0; k + 1 < r.pts.length; k++)
      cuts.push([
        r.pts[k]!.x,
        r.pts[k]!.y,
        r.pts[k + 1]!.x,
        r.pts[k + 1]!.y,
        isMotorRoad(r) || (r.bridge === true && clips(r)) ? r.w / 2 : Math.min(r.w / 2, ARCH),
        bore ? i : -1,
        bore ? (r.maxheight ?? UNDERPASS) : Number.NaN,
      ])
  })
  const index = staticGrid(
    cuts.length,
    (k) => {
      const [ax, ay, bx, by, h] = cuts[k]!
      return [
        Math.min(ax, bx) - h,
        Math.min(ay, by) - h,
        Math.max(ax, bx) + h,
        Math.max(ay, by) + h,
      ]
    },
    32,
  )
  /** The corridors that reach into the box. */
  return (x0: number, y0: number, x1: number, y1: number): Array<Cut> => {
    const out: Array<Cut> = []
    index(x0, y0, x1, y1, (k) => {
      const [ax, ay, bx, by, h] = cuts[k]!
      if (
        Math.max(ax, bx) > x0 - h &&
        Math.min(ax, bx) < x1 + h &&
        Math.max(ay, by) > y0 - h &&
        Math.min(ay, by) < y1 + h
      )
        out.push(cuts[k]!)
    })
    return out
  }
}
/** The corridors that reach into a box (`corridors`). */
export type Arches = ReturnType<typeof corridors>

/** Road `road`'s level at its point nearest (x, y), m a.s.l. (`levelOn` in build-ground.ts). */
export type Level = (road: number, x: number, y: number) => number

/**
 * `arches` split as building `b`, its floor at `floor` m a.s.l., meets them: `at` its level, which
 * open its walls, and `under` it, a tunnel's bore deep under the house, the floor the clear height
 * or more over the road (`level`) abeam the footprint's middle, as the mouths' bake reads a house
 * over a way (`housed` in src/render/mouths/tunnel-lines.ts). Carved by the A15's 10 m Galleria
 * Fresonara deep under it, a house on the hill over the bore at Fresonara stood open.
 */
const byLevel = (
  arches: Arches,
  b: BuildingF,
  floor: number,
  level: Level,
): { readonly at: Arches; readonly under: Arches } => {
  const n = b.outer.length / 2
  let cx = 0,
    cy = 0
  for (let k = 0; k < n; k++) [cx, cy] = [cx + b.outer[2 * k]! / n, cy + b.outer[2 * k + 1]! / n]
  const deep = ([ax, ay, bx, by, , road, clear]: Cut) => {
    if (road < 0) return false
    const t = segT(cx, cy, ax, ay, bx, by)
    return floor - level(road, ax + (bx - ax) * t, ay + (by - ay) * t) >= clear
  }
  return {
    at: (x0, y0, x1, y1) => arches(x0, y0, x1, y1).filter((c) => !deep(c)),
    under: (x0, y0, x1, y1) => arches(x0, y0, x1, y1).filter(deep),
  }
}

/** Squared distance between segments a-b and c-d, 0 where they cross. */
const segSegDist2 = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) => {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
  if (
    side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 &&
    side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0
  )
    return 0
  return Math.min(
    segD2(ax, ay, cx, cy, dx, dy),
    segD2(bx, by, cx, cy, dx, dy),
    segD2(cx, cy, ax, ay, bx, by),
    segD2(dx, dy, ax, ay, bx, by),
  )
}

/** Whether a corridor's centreline comes within its half-width of footprint `b`'s outline. */
const reaches = (b: BuildingF, cuts: ReadonlyArray<Cut>) =>
  cuts.some(([ax, ay, bx, by, h]) =>
    [b.outer, ...(b.holes ?? [])].some((ring) => {
      for (let i = 0, n = ring.length / 2; i < n; i++) {
        const j = (i + 1) % n
        const [px, py, qx, qy] = [ring[2 * i]!, ring[2 * i + 1]!, ring[2 * j]!, ring[2 * j + 1]!]
        if (segSegDist2(ax, ay, bx, by, px, py, qx, qy) < h * h) return true
      }
      return false
    }),
  )

/**
 * Footprint `b` rasterised at FOOTPRINT_RES m minus the `roads` corridors that reach inside it, each
 * grown by `pad` m, or undefined when none reaches inside it ungrown. With a pad, a corridor that
 * reaches the outline by less than a cell (no cell centre inside it: a corner poking in) carves it
 * too, so its walls are traced clear of the corridor rather than left on the outline inside it.
 */
const carved = (b: BuildingF, roads: Arches, pad = 0) => {
  const [x0, y0, x1, y1] = ringBox(b.outer)
  const cuts = roads(x0, y0, x1, y1)
  if (cuts.length === 0) return
  const res = FOOTPRINT_RES,
    gx = x0 - res,
    gy = y0 - res
  const cw = Math.ceil((x1 - x0) / res) + 2,
    ch = Math.ceil((y1 - y0) / res) + 2
  const blocked = new Uint8Array(cw * ch),
    holes = b.holes ?? []
  let cut = false
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const x = gx + (i + 0.5) * res,
        y = gy + (j + 0.5) * res
      if (!pointInRing(x, y, b.outer) || holes.some((h) => pointInRing(x, y, h))) continue
      let inside = false,
        clear = true
      for (const [ax, ay, bx, by, h] of cuts) {
        // No object a cell (`segDist2` makes one): the features stage made about 87 GB of them on
        // Lunigiana.
        const d2 = segD2(x, y, ax, ay, bx, by)
        if (d2 < h * h) inside = true
        if (d2 < (h + pad) * (h + pad)) clear = false
      }
      if (inside) cut = true
      if (clear) blocked[j * cw + i] = 1
    }
  if (!cut && pad > 0) cut = reaches(b, cuts)
  return cut
    ? { grid: { cell: res, cols: cw + 1, rows: ch + 1, x0: gx, y0: gy }, blocked }
    : undefined
}

/**
 * Buildings with every corridor of a road that `clips` cut out of the footprint: one building per
 * piece left (same id, style and height; slivers under MIN_PIECE m² dropped), traced like the
 * walls, so the house drawn and the house collided with are one outline.
 */
export const clipBuildings = (
  buildings: ReadonlyArray<BuildingF>,
  roads: ReadonlyArray<RoadF>,
): Array<BuildingF> => {
  const clipping = corridors(roads, clips)
  return buildings.flatMap((b) => {
    const c = carved(b, clipping)
    if (c === undefined) return [b]
    const rings = Array.from(traceLoops(c.grid, c.blocked), (loop) =>
      simplifyLoop(loop, TRACE_TOL).slice(0, -1),
    )
    const holes = rings
      .filter((r) => signedArea(r) < 0)
      .map((r) => flatRing(r, false))
      .filter((r) => r !== undefined)
    const { holes: _, ...rest } = b
    return rings.flatMap((r) => {
      const outer = signedArea(r) >= MIN_PIECE ? flatRing(r, true) : undefined
      if (outer === undefined) return []
      const inside = holes.filter((h) => pointInRing(h[0]!, h[1]!, outer))
      return [{ ...rest, outer, ...(inside.length > 0 ? { holes: inside } : {}) }]
    })
  })
}

/** The corridors of the `roads` that open the houses' walls rather than clip them (`houseWalls`), a tunnel's with its bore's index and clear height. */
export const houseArches = (roads: ReadonlyArray<RoadF>): Arches =>
  corridors(roads, (r) => !clips(r), true)

/**
 * Wall a-b split where the `terrain` along it spans SPAN or more, each piece with the level midway
 * through the ground along it: anyone on that ground meets it, within ONE_LEVEL of its level.
 */
export const levelled = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  terrain: (x: number, y: number) => number,
): Array<readonly [number, number, number, number, number]> => {
  const len = Math.hypot(bx - ax, by - ay),
    n = Math.max(1, Math.ceil(len / ALONG))
  let lo = Infinity,
    hi = -Infinity
  for (let q = 0; q <= n; q++) {
    const z = terrain(ax + ((bx - ax) * q) / n, ay + ((by - ay) * q) / n)
    lo = Math.min(lo, z)
    hi = Math.max(hi, z)
  }
  if (hi - lo >= SPAN && len > 2 * ALONG) {
    const mx = r1((ax + bx) / 2),
      my = r1((ay + by) / 2)
    return [...levelled(ax, ay, mx, my, terrain), ...levelled(mx, my, bx, by, terrain)]
  }
  return [[ax, ay, bx, by, r1((lo + hi) / 2)]]
}

/**
 * Building `b`'s walls, flat (ax, ay, bx, by), and each one's level, m a.s.l. (NaN for one that
 * stands at every level). Where a tunnel, path or steps centreline comes within min(w/2, ARCH) of
 * the footprint on its level (`byLevel`), the walls are the outline of the footprint minus those
 * corridors: passages and steps under arches stay open, the interior stays closed. The corridors
 * are grown by half a raster cell and the trace's tolerance, as the slope walls' road buffers are,
 * so no traced wall comes back inside one: ungrown, a footway in Giucano cut one cell into a house,
 * and the trace left its wall 0.54 m from the footway's centreline, inside its 0.75 m. Over a bore
 * deep under the house, the walls within its corridor and a KERB (where the bore's traffic goes)
 * take the level of the `terrain` along them (`levelled`), so they stop anyone on the hill round
 * the house and nothing in the bore; the rest stand at every level. Levelled whole at the ground at
 * its middle, a wall of a house over the Galleria Fresonara stood 2.59 m off its level at one end
 * on the hill, and a walker passed it there.
 */
export const houseWalls = (
  b: BuildingF,
  arches: Arches,
  floor: number,
  level: Level,
  terrain: (x: number, y: number) => number,
): { readonly walls: Array<number>; readonly levels: Array<number> } => {
  const { at, under } = byLevel(arches, b, floor, level)
  const traced: Array<number> = []
  const c = carved(b, at, FOOTPRINT_RES / 2 + TRACE_TOL)
  if (c === undefined)
    for (const ring of [b.outer, ...(b.holes ?? [])]) pushPolyline(traced, ring, true)
  else boundary(c.grid, c.blocked, [traced], TRACE_TOL)
  const deep = under(...ringBox(b.outer))
  if (deep.length === 0)
    return { walls: traced, levels: Array.from({ length: traced.length / 4 }, () => Number.NaN) }
  const walls: Array<number> = [],
    levels: Array<number> = []
  for (let w = 0; w < traced.length; w += 4) {
    const [ax, ay, bx, by] = [traced[w]!, traced[w + 1]!, traced[w + 2]!, traced[w + 3]!]
    const reached = deep.some(
      ([cx, cy, dx, dy, h]) => segSegDist2(ax, ay, bx, by, cx, cy, dx, dy) < (h + KERB) ** 2,
    )
    for (const [px, py, qx, qy, z] of reached
      ? levelled(ax, ay, bx, by, terrain)
      : [[ax, ay, bx, by, Number.NaN] as const]) {
      walls.push(px, py, qx, qy)
      levels.push(z)
    }
  }
  return { walls, levels }
}

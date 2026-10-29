// Station platforms: the CTR's (AGE 0141) where its sheets map the ground, OSM's (railway=platform)
// elsewhere, clipped clear of every track, off the carriageways and off the CTR's level-crossing
// areas (AGE 0122), then sorted into raised platforms and rail-level walkways. Each one's top
// follows the rail head of the running track beside it, so the sim's ground and the render share it
// (`platformTop` in src/sim/map/ground.ts).
import { RAIL_LIFT } from "../sim/map/kinds.ts"
import type { Polygon } from "./ctr-rail.ts"
import {
  centroid,
  fillPolygon,
  pointInRing,
  r1,
  ringBox,
  segDist2,
  signedArea,
} from "./geometry.ts"
import { simplifyLoop, traceLoops } from "./walls.ts"

/** Kept this far (m) from every track centreline: the ATR 220's half-width (2.883 m wide) plus 0.16 m. */
const PLATFORM_CLEAR = 1.6
/** Kept this far (m) past a carriageway's edge (w/2 from the centreline). */
const OFF_ROAD = 0.5
/** Narrower than this (m) after the clipping, a piece is a walkway. */
const WALKWAY_WIDTH = 1.2
/**
 * A piece with tracks under this far apart (m, centreline to centreline) on both sides of most of
 * it is a walkway between them: Gragnola's strip between tracks 1 and 2, 4.3–5.0 m apart, is 1.1–1.8
 * m wide once clipped, while Equi Terme's island platform lies between tracks 7.1–7.6 m apart.
 */
const BETWEEN = 6
/**
 * A platform's top over the rail head, m: the line's low platforms ("altezza limitata secondo
 * vecchi standard", 2015 line study; RFI lists none raised to 55 cm); the exact height is not known.
 */
const PLATFORM_RISE = 0.25
/** A walkway's top over the rail head, m. */
const WALKWAY_RISE = 0.02
/** Raster cell, m. */
const RES = 0.05
/** Simplification tolerance of the traced outline, m (it takes out the raster's steps). */
const TOL = 0.06
/**
 * The raster keeps cells this much further (m) from every obstacle than its clearance, so the traced
 * outline (within half a cell plus the chord between two crossings, 0.045 m) and its simplification
 * (TOL) keep the clearance; rounding to 0.1 m then picks a grid point that keeps it too.
 */
const MARGIN = 0.045 + TOL
/**
 * A cell whose terrain lies more than this (m) under the platform's top is ground at another level,
 * not platform: Gragnola's polygon wraps the station building, whose forecourt side stands 2 m under
 * the track.
 */
const PLATFORM_DROP = 1
/** Pieces smaller than this (m²) are dropped. */
const MIN_AREA = 4
/** A platform takes the name of the nearest station or stop node within this distance (m). */
const NAME_REACH = 300
/** The axis runs this far (m) past the platform's ends along its track. */
const AXIS_PAST = 1

/** A polyline (flat x, y) with a value per vertex. */
interface Track {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/** What the platforms are cut from and stand by. */
export interface PlatformInput {
  /** Platform polygons, each `src` named for the report. */
  readonly polygons: ReadonlyArray<{ readonly src: string; readonly rings: Polygon }>
  /** Every drawn track out of the tunnels, flat x, y; `group` tells tracks apart (a line's pieces share one). */
  readonly tracks: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly group: number }>
  /** The running lines, chained, with the bed `z` per vertex. */
  readonly lines: ReadonlyArray<Track>
  /** At-grade drivable roads: centreline (flat x, y) and carriageway width. */
  readonly roads: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly w: number }>
  /** Level-crossing areas (CTR AGE 0122). */
  readonly crossings: ReadonlyArray<Polygon>
  /** Named station and stop nodes. */
  readonly stops: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number }>
  /** The terrain (the finished grid), m a.s.l. */
  readonly terrain: (x: number, y: number) => number
}

/** A platform or walkway as built: rings (outer counter-clockwise first, then holes) rounded to 0.1 m, the top along its axis. */
export interface PlatformOut {
  readonly src: string
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  readonly walkway: boolean
  readonly name?: string
  /** The centreline of the line it stands nearest, over its extent, and its top per vertex. */
  readonly axis: ReadonlyArray<number>
  readonly top: ReadonlyArray<number>
  /** For the report: area (m²), width (m, twice the deepest point's distance to the edge), share of it between close tracks. */
  readonly area: number
  readonly width: number
  readonly between: number
  /** Least distance (m) of the shipped ring from a track centreline. */
  readonly clear: number
}

/** Distance from (x, y) to a flat polyline, the foot point, its arc length and its segment. */
export const footOnLine = (pts: ReadonlyArray<number>, x: number, y: number) => {
  let best = { d2: Number.MAX_VALUE, x: 0, y: 0, s: 0, k: 0 },
    s = 0
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!,
      ay = pts[k + 1]!,
      bx = pts[k + 2]!,
      by = pts[k + 3]!,
      len = Math.hypot(bx - ax, by - ay)
    const { d2, t } = segDist2(x, y, ax, ay, bx, by)
    if (d2 < best.d2)
      best = { d2, x: ax + (bx - ax) * t, y: ay + (by - ay) * t, s: s + len * t, k: k / 2 }
    s += len
  }
  return { d: Math.sqrt(best.d2), x: best.x, y: best.y, s: best.s, k: best.k }
}

/** A centreline segment near a platform: ends, the clearance kept from it, its track group (-1 for a road) and its index in its line. */
type Seg = readonly [number, number, number, number, number, number, number]

/** The segments of `lines` whose box comes within `reach` of the box, with their clearance and group. */
const segmentsNear = (
  lines: ReadonlyArray<{ readonly pts: ReadonlyArray<number> }>,
  clear: (i: number) => number,
  group: (i: number) => number,
  reach: number,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
): Array<Seg> =>
  lines.flatMap((l, i) => {
    const out: Array<Seg> = []
    for (let k = 0; k + 3 < l.pts.length; k += 2) {
      const ax = l.pts[k]!,
        ay = l.pts[k + 1]!,
        bx = l.pts[k + 2]!,
        by = l.pts[k + 3]!
      if (Math.min(ax, bx) > x1 + reach || Math.max(ax, bx) < x0 - reach) continue
      if (Math.min(ay, by) > y1 + reach || Math.max(ay, by) < y0 - reach) continue
      out.push([ax, ay, bx, by, clear(i), group(i), k / 2])
    }
    return out
  })

/** The sub-polyline of `line` from arc length s0 to s1, with the value per vertex interpolated at its ends. */
const slice = (line: Track, s0: number, s1: number) => {
  const pts: Array<number> = [],
    z: Array<number> = []
  const at = (k: number, t: number) => {
    pts.push(
      r1(line.pts[2 * k]! + (line.pts[2 * k + 2]! - line.pts[2 * k]!) * t),
      r1(line.pts[2 * k + 1]! + (line.pts[2 * k + 3]! - line.pts[2 * k + 1]!) * t),
    )
    z.push(line.z[k]! + (line.z[k + 1]! - line.z[k]!) * t)
  }
  let s = 0
  for (let k = 0; k + 1 < line.z.length; k++) {
    const len = Math.hypot(
      line.pts[2 * k + 2]! - line.pts[2 * k]!,
      line.pts[2 * k + 3]! - line.pts[2 * k + 1]!,
    )
    const e = s + len
    if (e >= s0 && s <= s1) {
      if (pts.length === 0) at(k, len > 0 ? Math.max(0, (s0 - s) / len) : 0)
      if (e <= s1) {
        pts.push(line.pts[2 * k + 2]!, line.pts[2 * k + 3]!)
        z.push(line.z[k + 1]!)
      } else at(k, len > 0 ? (s1 - s) / len : 1)
    }
    s = e
  }
  return { pts, z }
}

/** Cell distances to the nearest cell outside the pieces (chamfer 1 and √2, in m), for their widths. */
const depthOf = (kept: Uint8Array, cw: number, ch: number): Float64Array => {
  const depth = new Float64Array(cw * ch)
  for (let k = 0; k < depth.length; k++) depth[k] = kept[k] === 1 ? Number.MAX_VALUE : 0
  const diag = RES * Math.SQRT2
  const relax = (k: number, i: number, j: number, d: number) => {
    if (i < 0 || j < 0 || i >= cw || j >= ch) depth[k] = Math.min(depth[k]!, RES / 2)
    else depth[k] = Math.min(depth[k]!, depth[j * cw + i]! + d)
  }
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++)
      if (kept[j * cw + i] === 1)
        for (const [di, dj, d] of [
          [-1, 0, RES],
          [0, -1, RES],
          [-1, -1, diag],
          [1, -1, diag],
        ] as const)
          relax(j * cw + i, i + di, j + dj, d)
  for (let j = ch - 1; j >= 0; j--)
    for (let i = cw - 1; i >= 0; i--)
      if (kept[j * cw + i] === 1)
        for (const [di, dj, d] of [
          [1, 0, RES],
          [0, 1, RES],
          [1, 1, diag],
          [-1, 1, diag],
        ] as const)
          relax(j * cw + i, i + di, j + dj, d)
  return depth
}

/** 4-connected pieces of the kept cells, as cell lists. */
const piecesOfMask = (kept: Uint8Array, cw: number, ch: number): Array<Array<number>> => {
  const seen = new Uint8Array(cw * ch)
  const pieces: Array<Array<number>> = []
  for (let k0 = 0; k0 < kept.length; k0++) {
    if (kept[k0] === 0 || seen[k0] === 1) continue
    const cells = [k0]
    seen[k0] = 1
    for (let q = 0; q < cells.length; q++) {
      const k = cells[q]!,
        i = k % cw
      for (const nk of [i + 1 < cw ? k + 1 : -1, i > 0 ? k - 1 : -1, k + cw, k - cw])
        if (nk >= 0 && nk < kept.length && kept[nk] === 1 && seen[nk] === 0) {
          seen[nk] = 1
          cells.push(nk)
        }
    }
    pieces.push(cells)
  }
  return pieces
}

/** The pieces of one polygon left once clipped, each traced, sorted and given its top. */
const piecesOf = (src: string, rings: Polygon, input: PlatformInput): Array<PlatformOut> => {
  const outer = rings[0]!
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (let k = 0; k + 1 < outer.length; k += 2)
    [x0, y0, x1, y1] = [
      Math.min(x0, outer[k]!),
      Math.min(y0, outer[k + 1]!),
      Math.max(x1, outer[k]!),
      Math.max(y1, outer[k + 1]!),
    ]
  const box = [x0, y0, x1, y1] as const
  const gx = x0 - 2 * RES,
    gy = y0 - 2 * RES
  const cw = Math.ceil((x1 - x0) / RES) + 4,
    ch = Math.ceil((y1 - y0) / RES) + 4
  const groups = (i: number) => input.tracks[i]!.group
  const obstacles = [
    ...segmentsNear(input.tracks, () => PLATFORM_CLEAR, groups, 3, box),
    ...segmentsNear(
      input.roads,
      (i) => input.roads[i]!.w / 2 + OFF_ROAD,
      () => -1,
      10,
      box,
    ),
  ]
  const crossings = input.crossings.flatMap((rings) => {
    const [cx0, cy0, cx1, cy1] = ringBox(rings[0]!)
    return cx0 <= x1 && cx1 >= x0 && cy0 <= y1 && cy1 >= y0
      ? [{ rings, box: [cx0, cy0, cx1, cy1] as const }]
      : []
  })
  const inCrossing = (x: number, y: number) =>
    crossings.some(
      ({ rings: [r, ...holes], box: [cx0, cy0, cx1, cy1] }) =>
        x >= cx0 &&
        x <= cx1 &&
        y >= cy0 &&
        y <= cy1 &&
        pointInRing(x, y, r!) &&
        !holes.some((h) => pointInRing(x, y, h)),
    )
  // The line it stands nearest carries its top; the bed under a cell is that line's at the cell's foot.
  let line = 0,
    best = Number.MAX_VALUE
  input.lines.forEach((l, li) => {
    for (let k = 0; k < outer.length; k += 2) {
      const d = footOnLine(l.pts, outer[k]!, outer[k + 1]!).d
      if (d < best) [line, best] = [li, d]
    }
  })
  const bed = input.lines[line]!
  const bedSegs = segmentsNear(
    [bed],
    () => 0,
    () => 0,
    50,
    box,
  ).map(([ax, ay, bx, by, , , k]) => [ax, ay, bx, by, bed.z[k]!, bed.z[k + 1]!] as const)
  const bedAt = (x: number, y: number) => {
    let d2 = Number.MAX_VALUE,
      z = 0
    for (const [ax, ay, bx, by, za, zb] of bedSegs) {
      const f = segDist2(x, y, ax, ay, bx, by)
      if (f.d2 < d2) [d2, z] = [f.d2, za + (zb - za) * f.t]
    }
    return z
  }
  /** Whether (x, y) keeps every clearance. */
  const clear = (x: number, y: number) =>
    obstacles.every(([ax, ay, bx, by, c]) => segDist2(x, y, ax, ay, bx, by).d2 >= c * c) &&
    !inCrossing(x, y)
  // Each obstacle blocks the cells within its clearance plus MARGIN; the polygon keeps the rest.
  const blocked = new Uint8Array(cw * ch)
  for (const [ax, ay, bx, by, c] of obstacles) {
    const r = c + MARGIN
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - gx) / RES)),
      i1 = Math.min(cw - 1, Math.ceil((Math.max(ax, bx) + r - gx) / RES)),
      j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - gy) / RES)),
      j1 = Math.min(ch - 1, Math.ceil((Math.max(ay, by) + r - gy) / RES))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (segDist2(gx + (i + 0.5) * RES, gy + (j + 0.5) * RES, ax, ay, bx, by).d2 < r * r)
          blocked[j * cw + i] = 1
  }
  const kept = new Uint8Array(cw * ch)
  fillPolygon(rings, gx, gy, RES, cw, ch, (k) => {
    const x = gx + ((k % cw) + 0.5) * RES,
      y = gy + (Math.floor(k / cw) + 0.5) * RES
    if (blocked[k] === 1 || inCrossing(x, y)) return
    if (input.terrain(x, y) < bedAt(x, y) + RAIL_LIFT + PLATFORM_RISE - PLATFORM_DROP) return
    kept[k] = 1
  })
  const depth = depthOf(kept, cw, ch)
  const near = segmentsNear(input.tracks, () => 0, groups, BETWEEN, box)
  return piecesOfMask(kept, cw, ch).flatMap((cells, p): Array<PlatformOut> => {
    const area = cells.length * RES * RES
    if (area < MIN_AREA) return []
    let deepest = 0
    for (const k of cells) deepest = Math.max(deepest, depth[k]!)
    // Between close tracks: the nearest track on each side of a cell under BETWEEN apart (cells every 0.25 m).
    let between = 0,
      sampled = 0
    for (const k of cells) {
      const i = k % cw,
        j = Math.floor(k / cw)
      if (i % 5 !== 0 || j % 5 !== 0) continue
      sampled++
      const x = gx + (i + 0.5) * RES,
        y = gy + (j + 0.5) * RES
      const nearest = new Map<number, { d: number; x: number; y: number }>()
      for (const [ax, ay, bx, by, , g] of near) {
        const { d2, t } = segDist2(x, y, ax, ay, bx, by)
        if (d2 < (nearest.get(g)?.d ?? BETWEEN) ** 2)
          nearest.set(g, { d: Math.sqrt(d2), x: ax + (bx - ax) * t, y: ay + (by - ay) * t })
      }
      const sides = [...nearest.values()].sort((a, b) => a.d - b.d)
      const a = sides[0]
      if (
        a !== undefined &&
        sides.some((b) => (a.x - x) * (b.x - x) + (a.y - y) * (b.y - y) < 0 && a.d + b.d < BETWEEN)
      )
        between++
    }
    const share = sampled === 0 ? 0 : between / sampled
    const walkway = 2 * deepest < WALKWAY_WIDTH || share >= 0.5
    // Traced and simplified, then each vertex rounded to the nearest 0.1 m grid point that keeps every clearance.
    const mask = new Uint8Array(cw * ch)
    for (const k of cells) mask[k] = 1
    const round = ([x, y]: readonly [number, number]): readonly [number, number] => {
      const options: Array<readonly [number, number]> = []
      for (const ox of [Math.floor(x * 10) / 10, Math.ceil(x * 10) / 10])
        for (const oy of [Math.floor(y * 10) / 10, Math.ceil(y * 10) / 10])
          options.push([r1(ox), r1(oy)])
      options.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))
      return options.find(([ox, oy]) => clear(ox, oy)) ?? options[0]!
    }
    const loops = traceLoops({ cell: RES, cols: cw + 1, rows: ch + 1, x0: gx, y0: gy }, mask)
      .map((loop) => simplifyLoop(loop, TOL).slice(0, -1).map(round))
      .map((loop) =>
        loop.filter((v, i) => v[0] !== loop.at(i - 1)![0] || v[1] !== loop.at(i - 1)![1]),
      )
      .filter((loop) => loop.length >= 3 && Math.abs(signedArea(loop)) >= 0.5)
    const flat = (loop: ReadonlyArray<readonly [number, number]>) =>
      loop.flatMap(([x, y]) => [x, y])
    const outers = loops
      .filter((l) => signedArea(l) > 0)
      .sort((a, b) => signedArea(b) - signedArea(a))
    const ringsOut = [flat(outers[0]!), ...loops.filter((l) => signedArea(l) < 0).map(flat)]
    let least = Number.MAX_VALUE
    for (const ring of ringsOut)
      for (let k = 0; k < ring.length; k += 2) {
        const j = (k + 2) % ring.length,
          n = Math.ceil(Math.hypot(ring[j]! - ring[k]!, ring[j + 1]! - ring[k + 1]!) / 0.1)
        for (let q = 0; q <= n; q++) {
          const x = ring[k]! + ((ring[j]! - ring[k]!) * q) / n,
            y = ring[k + 1]! + ((ring[j + 1]! - ring[k + 1]!) * q) / n
          for (const [ax, ay, bx, by, , g] of obstacles)
            if (g >= 0) least = Math.min(least, Math.sqrt(segDist2(x, y, ax, ay, bx, by).d2))
        }
      }
    if (least < PLATFORM_CLEAR - 0.05)
      throw new Error(`platform ${src}: ${least.toFixed(2)} m from a track`)
    const verts = ringsOut[0]!
    let s0 = Number.MAX_VALUE,
      s1 = -Number.MAX_VALUE
    for (let k = 0; k < verts.length; k += 2) {
      const f = footOnLine(input.lines[line]!.pts, verts[k]!, verts[k + 1]!)
      ;[s0, s1] = [Math.min(s0, f.s), Math.max(s1, f.s)]
    }
    const axis = slice(input.lines[line]!, s0 - AXIS_PAST, s1 + AXIS_PAST)
    const rise = RAIL_LIFT + (walkway ? WALKWAY_RISE : PLATFORM_RISE)
    const [cx, cy] = centroid(verts)
    let name: string | undefined,
      reach = NAME_REACH
    for (const stop of input.stops) {
      const d = Math.hypot(stop.x - cx, stop.y - cy)
      if (d < reach) [name, reach] = [stop.name, d]
    }
    return [
      {
        src: p === 0 ? src : `${src}.${p}`,
        rings: ringsOut,
        walkway,
        ...(name === undefined ? {} : { name }),
        axis: axis.pts,
        top: axis.z.map((z) => Math.round((z + rise) * 100) / 100),
        area,
        width: 2 * deepest,
        between: share,
        clear: least,
      },
    ]
  })
}

/** Every platform and walkway cut from `input.polygons`, in their order; throws when a piece ends up nearer a track than PLATFORM_CLEAR − 0.05 m. */
export const buildPlatforms = (input: PlatformInput): Array<PlatformOut> => {
  if (input.polygons.length > 0 && input.lines.length === 0)
    throw new Error("platforms: no running line to stand beside")
  return input.polygons.flatMap(({ src, rings }) => piecesOf(src, rings, input))
}

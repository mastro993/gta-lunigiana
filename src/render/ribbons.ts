/**
 * The geometry the static pieces share (roads and water in lines.ts, the railway in rail.ts,
 * portals.ts and stations.ts): strips along a map polyline, densified so they follow the terrain
 * facets and cut into the chunks quad by quad, the straight run of a line on across the apron past
 * the map's edge, boxes, copying triangles, and the road surface as the ribbons draw it.
 *
 * @module render/ribbons
 */
import { segDist2 } from "../sim/collide.ts"
import { drawnZ, groundZ } from "../sim/map/ground.ts"
import { MAP } from "../sim/map/index.ts"
import { APRON } from "./chunks.ts"
import {
  type Box,
  boxOver,
  type Flowing,
  type Piece,
  type Sink,
  type SinkAt,
  Triangles,
  WaterTriangles,
} from "./geometry.ts"
import { yOf } from "./ground.ts"

/** A strip along a polyline. `y` gives the render height of an edge point from the centreline elevation there. */
export interface RibbonSpec {
  readonly pts: ReadonlyArray<number>
  /** Elevation (m a.s.l.) per vertex of `pts`. */
  readonly z: ReadonlyArray<number>
  readonly width: number
  readonly hex: number
  readonly y: (x: number, y: number, z: number) => number
  /** Lateral shift of the strip's centre, metres (positive = left of travel). */
  readonly offset?: number
  /** Dash length (m): draw every other `dash` metres. */
  readonly dash?: number
  /** Water's: each vertex's rise and flow (`Flowing`), in step with `pts`; a ribbon with them goes in the water layer, else in the decal one. */
  readonly flowing?: ReadonlyArray<Flowing>
  /** Leaves out the quads whose centreline midpoint (map x, y) it holds: the track where a road crosses it. */
  readonly skip?: (x: number, y: number) => boolean
}

const { minX, minY, maxX, maxY } = MAP.bounds
const OUT = APRON * MAP.heightmap.cell
/** Where (x, y) on the bounds goes when pushed straight out across the apron, or undefined if it is inside. */
const outward = (x: number, y: number): readonly [number, number] | undefined =>
  x <= minX + 0.5
    ? [x - OUT, y]
    : x >= maxX - 0.5
      ? [x + OUT, y]
      : y <= minY + 0.5
        ? [x, y - OUT]
        : y >= maxY - 0.5
          ? [x, y + OUT]
          : undefined

/**
 * A line that leaves the map continues straight across the apron at its edge elevation, like the
 * apron terrain (edge heights extruded outwards), so roads, rivers and the track do not stop at the bounds.
 */
export const throughApron = <T = never>(
  pts: ReadonlyArray<number>,
  z: ReadonlyArray<number>,
  along: ReadonlyArray<T> = [],
): { pts: Array<number>; z: Array<number>; along: Array<T> } => {
  const head = outward(pts[0]!, pts[1]!),
    tail = outward(pts.at(-2)!, pts.at(-1)!)
  const ends = <V>(values: ReadonlyArray<V>): Array<V> =>
    values.length === 0
      ? []
      : [
          ...(head === undefined ? [] : [values[0]!]),
          ...values,
          ...(tail === undefined ? [] : [values.at(-1)!]),
        ]
  return { pts: [...(head ?? []), ...pts, ...(tail ?? [])], z: ends(z), along: ends(along) }
}

/**
 * Adds segments k0..k1 of a ribbon to its layer of the chunks they cross. Their neighbours
 * are densified too, for the mitres, and their quads go wherever `at` puts them; the arc length
 * (dashes) still counts from the start of the line.
 */
const ribbon = (at: SinkAt, spec: RibbonSpec, k0: number, k1: number): void => {
  const step = spec.dash === undefined ? 2 : Math.min(1, spec.dash / 2)
  const xs: Array<number> = [],
    ys: Array<number> = [],
    zs: Array<number> = [],
    ss: Array<number> = [],
    fs: Array<Flowing> = []
  const flowing = spec.flowing
  /** `flows` at vertex k and `t` of the way to the next. */
  const flowAt = (flows: ReadonlyArray<Flowing>, k: number, t: number): Flowing => {
    const a = flows[k]!,
      b = flows[Math.min(flows.length - 1, k + 1)]!
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t,
    ]
  }
  const first = Math.max(0, k0 - 1),
    last = Math.min(spec.z.length - 2, k1 + 1)
  let s = 0
  for (let k = 0; k < first; k++)
    s += Math.hypot(
      spec.pts[2 * k + 2]! - spec.pts[2 * k]!,
      spec.pts[2 * k + 3]! - spec.pts[2 * k + 1]!,
    )
  for (let k = first; k <= last; k++) {
    const ax = spec.pts[2 * k]!,
      ay = spec.pts[2 * k + 1]!,
      bx = spec.pts[2 * k + 2]!,
      by = spec.pts[2 * k + 3]!
    const len = Math.hypot(bx - ax, by - ay),
      n = Math.max(1, Math.ceil(len / step))
    // Even steps, and a dashed line also cut where each dash starts and ends, so every dash is exactly its length.
    const ts = Array.from({ length: n }, (_, j) => j / n)
    if (spec.dash !== undefined)
      for (let m = Math.ceil(s / spec.dash); m * spec.dash < s + len; m++)
        ts.push((m * spec.dash - s) / len)
    ts.sort((a, b) => a - b)
    let previous = -1
    for (const t of ts) {
      if (t - previous < 1e-6) continue
      previous = t
      xs.push(ax + (bx - ax) * t)
      ys.push(ay + (by - ay) * t)
      zs.push(spec.z[k]! + (spec.z[k + 1]! - spec.z[k]!) * t)
      ss.push(s + len * t)
      if (flowing !== undefined) fs.push(flowAt(flowing, k, t))
    }
    s += len
  }
  xs.push(spec.pts[2 * last + 2]!)
  ys.push(spec.pts[2 * last + 3]!)
  zs.push(spec.z[last + 1]!)
  ss.push(s)
  if (flowing !== undefined) fs.push(flowAt(flowing, last + 1, 0))
  const count = xs.length
  if (count < 2) return
  // Left normal of segment i, then mitred edge points per vertex (clamped at sharp corners).
  const left = (i: number): readonly [number, number] => {
    const dx = xs[i + 1]! - xs[i]!,
      dy = ys[i + 1]! - ys[i]!,
      l = Math.hypot(dx, dy) || 1
    return [-dy / l, dx / l]
  }
  const half = spec.width / 2,
    offset = spec.offset ?? 0
  const edges: Array<readonly [number, number, number, number, number, number]> = []
  for (let i = 0; i < count; i++) {
    const a = left(Math.max(0, i - 1)),
      b = left(Math.min(count - 2, i))
    let mx = a[0] + b[0],
      my = a[1] + b[1]
    const ml = Math.hypot(mx, my) || 1
    mx /= ml
    my /= ml
    const k = 1 / Math.max(mx * b[0] + my * b[1], 0.5)
    const lx = xs[i]! + mx * (offset + half) * k,
      ly = ys[i]! + my * (offset + half) * k
    const rx = xs[i]! + mx * (offset - half) * k,
      ry = ys[i]! + my * (offset - half) * k
    edges.push([lx, ly, spec.y(lx, ly, zs[i]!), rx, ry, spec.y(rx, ry, zs[i]!)])
  }
  for (let i = 0; i + 1 < count; i++) {
    if (spec.dash !== undefined && Math.floor((ss[i]! + ss[i + 1]!) / 2 / spec.dash) % 2 === 1)
      continue
    const mx = (xs[i]! + xs[i + 1]!) / 2,
      my = (ys[i]! + ys[i + 1]!) / 2
    if (spec.skip?.(mx, my) === true) continue
    const [lx0, ly0, lh0, rx0, ry0, rh0] = edges[i]!,
      [lx1, ly1, lh1, rx1, ry1, rh1] = edges[i + 1]!
    // Right edge forward, then left edge back: counter-clockwise seen from above.
    const sink = at(mx, my)
    if (flowing === undefined)
      sink.decal.quad(
        [rx0, rh0, -ry0],
        [rx1, rh1, -ry1],
        [lx1, lh1, -ly1],
        [lx0, lh0, -ly0],
        spec.hex,
      )
    else
      sink.water.waterQuad(
        [rx0, rh0, -ry0],
        [rx1, rh1, -ry1],
        [lx1, lh1, -ly1],
        [lx0, lh0, -ly0],
        spec.hex,
        [fs[i]!, fs[i + 1]!, fs[i + 1]!, fs[i]!],
      )
  }
}

/**
 * A box swept from (ax, ay) to (bx, by) whose bottom and top follow the heights `ya` → `yb`
 * (sheared, so consecutive pieces join on slopes); `offset` shifts it sideways (left positive).
 */
export const prism = (
  tris: Triangles,
  ax: number,
  ay: number,
  ya: number,
  bx: number,
  by: number,
  yb: number,
  offset: number,
  width: number,
  bottom: number,
  top: number,
  hex: number,
): void => {
  const dx = bx - ax,
    dy = by - ay,
    l = Math.hypot(dx, dy) || 1
  const nx = -dy / l,
    ny = dx / l
  const p = (end: 0 | 1, side: number, level: number) => {
    const w = offset + (side * width) / 2
    return [
      (end === 0 ? ax : bx) + nx * w,
      (end === 0 ? ya : yb) + level,
      -((end === 0 ? ay : by) + ny * w),
    ] as const
  }
  tris.face(p(0, -1, top), p(1, -1, top), p(1, 1, top), p(0, 1, top), [0, 1, 0], hex)
  tris.face(p(0, -1, bottom), p(1, -1, bottom), p(1, 1, bottom), p(0, 1, bottom), [0, -1, 0], hex)
  tris.face(p(0, 1, bottom), p(1, 1, bottom), p(1, 1, top), p(0, 1, top), [nx, 0, -ny], hex)
  tris.face(p(0, -1, bottom), p(1, -1, bottom), p(1, -1, top), p(0, -1, top), [-nx, 0, ny], hex)
  tris.face(p(0, -1, bottom), p(0, 1, bottom), p(0, 1, top), p(0, -1, top), [-dx, 0, dy], hex)
  tris.face(p(1, -1, bottom), p(1, 1, bottom), p(1, 1, top), p(1, -1, top), [dx, 0, -dy], hex)
}

/** A piece drawing every ribbon in `specs` along `line`. */
export const strips = (
  line: { readonly pts: ReadonlyArray<number> },
  specs: ReadonlyArray<RibbonSpec>,
): Piece => ({
  pts: line.pts,
  draw: (at, k0, k1) => {
    for (const spec of specs) ribbon(at, spec, k0, k1)
  },
})

/**
 * A box centred at (x, y, z) (three space) with half sizes `out` along the horizontal unit `(ux, uz)`,
 * `up` vertically and `side` across, in one colour.
 */
export const block = (
  tris: Triangles,
  x: number,
  y: number,
  z: number,
  ux: number,
  uz: number,
  out: number,
  up: number,
  side: number,
  hex: number,
): void => {
  const corner = (a: number, b: number, c: number) =>
    [x + ux * out * a - uz * side * c, y + up * b, z + uz * out * a + ux * side * c] as const
  for (const s of [-1, 1]) {
    tris.face(
      corner(s, -1, -1),
      corner(s, -1, 1),
      corner(s, 1, 1),
      corner(s, 1, -1),
      [ux * s, 0, uz * s],
      hex,
    )
    tris.face(
      corner(-1, -1, s),
      corner(1, -1, s),
      corner(1, 1, s),
      corner(-1, 1, s),
      [-uz * s, 0, ux * s],
      hex,
    )
    tris.face(
      corner(-1, s, -1),
      corner(1, s, -1),
      corner(1, s, 1),
      corner(-1, s, 1),
      [0, s, 0],
      hex,
    )
  }
}

/** Appends `from`'s triangles to `to`, or only triangle `i` of them. */
export const append = (from: Triangles, to: Triangles, i?: number): void => {
  const [a, b] = i === undefined ? [0, from.position.length] : [9 * i, 9 * i + 9]
  for (let k = a; k < b; k++) {
    to.position.push(from.position[k]!)
    to.normal.push(from.normal[k]!)
    to.color.push(from.color[k]!)
  }
}

/** The render height of triangle `t` of `tris` over map (x, y), if it covers it seen from above. */
const heightIn = (tris: Triangles, t: number, x: number, y: number): number | undefined => {
  const p = tris.position,
    z = -y
  const ax = p[9 * t]!,
    ay = p[9 * t + 1]!,
    az = p[9 * t + 2]!,
    bx = p[9 * t + 3]!,
    by = p[9 * t + 4]!,
    bz = p[9 * t + 5]!,
    cx = p[9 * t + 6]!,
    cy = p[9 * t + 7]!,
    cz = p[9 * t + 8]!
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(d) < 1e-12) return undefined
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d,
    l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
  return l1 >= 0 && l2 >= 0 && l1 + l2 <= 1 ? l1 * ay + l2 * by + (1 - l1 - l2) * cy : undefined
}

/** The cells (m) `surfaceNear` buckets the ribbons' triangles in. */
const CELL = 2

/** Calls `visit` with each piece of `pieces` that has segments within `reach` m of (x, y), and the first and last of them. */
const piecesNear = (
  pieces: ReadonlyArray<Piece>,
  x: number,
  y: number,
  reach: number,
  visit: (piece: Piece, k0: number, k1: number) => void,
): void => {
  for (const piece of pieces) {
    const pts = piece.pts
    let k0 = -1,
      k1 = -1
    for (let k = 0; 2 * k + 3 < pts.length; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        bx = pts[2 * k + 2]!,
        by = pts[2 * k + 3]!
      // A cheap reject first: both ends past the reach on one side.
      if (Math.min(ax, bx) > x + reach || Math.max(ax, bx) < x - reach) continue
      if (Math.min(ay, by) > y + reach || Math.max(ay, by) < y - reach) continue
      if (segDist2(x, y, ax, ay, bx, by).d2 > reach * reach) continue
      if (k0 < 0) k0 = k
      k1 = k
    }
    if (k0 >= 0) visit(piece, k0, k1)
  }
}

/**
 * Where `surfaceNear` with the same arguments reads the ground: over the segments it draws again
 * and their neighbours (a ribbon's joints), and the box `reach` m round (x, y).
 */
export const surfaceReads = (
  pieces: ReadonlyArray<Piece>,
  x: number,
  y: number,
  reach: number,
): Box => {
  let box: Box = [x - reach, y - reach, x + reach, y + reach]
  piecesNear(pieces, x, y, reach, ({ pts }, k0, k1) => {
    const [minX, minY, maxX, maxY] = boxOver(
      pts,
      Math.max(0, k0 - 1),
      Math.min(pts.length / 2 - 1, k1 + 2),
    )
    box = [
      Math.min(box[0], minX),
      Math.min(box[1], minY),
      Math.max(box[2], maxX),
      Math.max(box[3], maxY),
    ]
  })
  return box
}

/**
 * The surface the decal ribbons of `pieces` (the world's road pieces) draw within `reach` m of (x, y), as a lookup of render y
 * at a map point there: the highest ribbon over it, exactly as drawn (each piece's segments in reach drawn again), or past
 * their edges the highest road the sim knows (`drawnZ`, which can sit centimetres under a ribbon where the terrain bends).
 */
export const surfaceNear = (
  pieces: ReadonlyArray<Piece>,
  x: number,
  y: number,
  reach: number,
): ((x: number, y: number) => number) => {
  const scratch: Sink = {
    solid: new Triangles(),
    decal: new Triangles(),
    water: new WaterTriangles(),
    glow: new Triangles(),
    pieces: [],
  }
  piecesNear(pieces, x, y, reach, (piece, k0, k1) => piece.draw(() => scratch, k0, k1))
  const tris = scratch.decal,
    cells = new Map<number, Array<number>>(),
    key = (i: number, j: number) => i * 65536 + j
  for (let t = 0; t < tris.position.length / 9; t++) {
    const xs = [0, 3, 6].map((o) => tris.position[9 * t + o]!),
      ys = [2, 5, 8].map((o) => -tris.position[9 * t + o]!)
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
      for (
        let j = Math.floor(Math.min(...ys) / CELL);
        j <= Math.floor(Math.max(...ys) / CELL);
        j++
      ) {
        const list = cells.get(key(i, j))
        if (list === undefined) cells.set(key(i, j), [t])
        else list.push(t)
      }
  }
  return (px, py) => {
    let top = -Infinity
    for (const t of cells.get(key(Math.floor(px / CELL), Math.floor(py / CELL))) ?? [])
      top = Math.max(top, heightIn(tris, t, px, py) ?? -Infinity)
    return top > -Infinity ? top : yOf(drawnZ(px, py, groundZ(px, py)))
  }
}

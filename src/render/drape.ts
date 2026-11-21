/**
 * Strips laid on what lies under them, where their corners alone would miss it. A road's ribbon at
 * grade reads its road's surface (the higher of its profile and the terrain, plus its lift:
 * `roadZ`) at its corners, so where the terrain mesh folds up between them (a ridge along a cell's
 * diagonal, a node held far off its neighbours) the mesh stood through it; a painted line read the
 * surface at its own corners, under its ribbon wherever the ribbon stood over the surface between
 * its corners. A ribbon's triangle the mesh would stand through is cut along the mesh's folds
 * (`drape`), and a line lies on its ribbon as drawn, cut along the ribbon's folds where they would
 * stand through it (`layOver`).
 *
 * @module render/drape
 */
import { terrainZ } from "../sim/map/ground.ts"
import { MAP } from "../sim/map/index.ts"
import { type Sink, type SinkAt, Triangles } from "./geometry.ts"
import { terrainNodeY } from "./ground.ts"

/**
 * A strip triangle's corner: map x, map y and a value linear over the triangle (a ribbon's profile,
 * m a.s.l.; a line's height, render y).
 */
export type Corner = readonly [x: number, y: number, z: number]

/** How near (m) its ribbon may come under a painted line's triangle (2 cm over it) before it is cut. */
const CLEAR = 0.01

/**
 * How far (m) the terrain mesh may stand over a ribbon's triangle before it is cut: the decals'
 * polygon offset pulls a ribbon a texel's depth toward the camera, and the 1.1 cm the mesh stood
 * over the SS63's ribbon by Fivizzano's underpass 145347886 shows at none of the game's zooms nor
 * at 40 texels a metre. Cut wherever it stood over at all, that ribbon's pieces drew the kink of
 * its junction's blend as a dark crease across it.
 */
export const DRAPE_POKE = 0.02

const { x0: X0, y0: Y0, cell: CELL } = MAP.heightmap

/** Twice the area (m²) under which a piece's triangle is a sliver along a fold, left out. */
const SLIVER = 1e-6

/** A polygon's vertices as flat (x, y, z) triples, z linear over it as a `Corner`'s. */
type Polygon = Array<number>

/** The part of `poly` where `side` (linear over the polygon) is at least 0, its vertices in order. */
const clip = (poly: Polygon, side: (x: number, y: number, z: number) => number): Polygon => {
  const out: Polygon = [],
    n = poly.length / 3
  for (let k = 0; k < n; k++) {
    const m = (k + 1) % n,
      sa = side(poly[3 * k]!, poly[3 * k + 1]!, poly[3 * k + 2]!),
      sb = side(poly[3 * m]!, poly[3 * m + 1]!, poly[3 * m + 2]!)
    if (sa >= 0) out.push(poly[3 * k]!, poly[3 * k + 1]!, poly[3 * k + 2]!)
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb)
      for (let c = 0; c < 3; c++)
        out.push(poly[3 * k + c]! + (poly[3 * m + c]! - poly[3 * k + c]!) * t)
    }
  }
  return out.length >= 9 ? out : []
}

/** Adds polygon `p` to `tris` fanned from its first vertex, each vertex at `height`, but its slivers. */
const fan = (
  tris: Triangles,
  p: Polygon,
  height: (x: number, y: number, z: number) => number,
  hex: number,
): void => {
  const h: Array<number> = []
  for (let k = 0; k < p.length; k += 3) h.push(height(p[k]!, p[k + 1]!, p[k + 2]!))
  for (let k = 1; k + 1 < h.length; k++) {
    const area =
      (p[3 * k]! - p[0]!) * (p[3 * k + 4]! - p[1]!) -
      (p[3 * k + 1]! - p[1]!) * (p[3 * k + 3]! - p[0]!)
    if (Math.abs(area) < SLIVER) continue
    tris.tri(
      p[0]!,
      h[0]!,
      -p[1]!,
      p[3 * k]!,
      h[k]!,
      -p[3 * k + 1]!,
      p[3 * k + 3]!,
      h[k + 1]!,
      -p[3 * k + 4]!,
      hex,
    )
  }
}

/** The plane through heights `ha`, `hb`, `hc` at the corners of triangle abc, over map (x, y); undefined for a sliver. */
const planeOf = (
  a: Corner,
  b: Corner,
  c: Corner,
  ha: number,
  hb: number,
  hc: number,
): Plane | undefined => {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    det = ux * vy - uy * vx
  if (Math.abs(det) < SLIVER) return undefined
  // h = ha + (hb − ha) s + (hc − ha) t, with s and t the point's share of u and v.
  const gx = ((hb - ha) * vy - (hc - ha) * uy) / det,
    gy = ((hc - ha) * ux - (hb - ha) * vx) / det
  return [ha - gx * a[0] - gy * a[1], gx, gy]
}

/**
 * Whether `visit` holds at some whole number f from `fa` to `fb`, given f and how far along from
 * `fa` to `fb` it lies (none when they are equal).
 */
const crosses = (fa: number, fb: number, visit: (f: number, t: number) => boolean): boolean => {
  if (fa === fb) return false
  const last = Math.max(fa, fb)
  for (let f = Math.ceil(Math.min(fa, fb)); f <= last; f++)
    if (visit(f, (f - fa) / (fb - fa))) return true
  return false
}

/**
 * Whether the terrain mesh stands more than DRAPE_POKE over the straight line from p to q (render
 * y `hp` to `hq`) anywhere along it: where it crosses a cell side or a south-west to north-east
 * diagonal, where alone the mesh folds (its ends lie on the road's surface, a lift over the
 * terrain). Read from its western end, or its southern of two in line, so the two triangles a side
 * parts read it alike.
 */
const sideFolds = (p: Corner, hp: number, q: Corner, hq: number): boolean => {
  if (q[0] < p[0] || (q[0] === p[0] && q[1] < p[1])) return sideFolds(q, hq, p, hp)
  const ua = (p[0] - X0) / CELL,
    va = (p[1] - Y0) / CELL,
    ub = (q[0] - X0) / CELL,
    vb = (q[1] - Y0) / CELL
  /** Whether the mesh, `h` where the side crosses a fold `t` along it, stands too high over it. */
  const over = (t: number, h: number) => h > hp + (hq - hp) * t + DRAPE_POKE
  return (
    // A line of the grid x = i: the mesh there between nodes (i, j) and (i, j + 1).
    crosses(ua, ub, (i, t) => {
      const v = va + (vb - va) * t,
        j = Math.floor(v)
      return over(t, terrainNodeY(i, j) + (terrainNodeY(i, j + 1) - terrainNodeY(i, j)) * (v - j))
    }) ||
    crosses(va, vb, (j, t) => {
      const u = ua + (ub - ua) * t,
        i = Math.floor(u)
      return over(t, terrainNodeY(i, j) + (terrainNodeY(i + 1, j) - terrainNodeY(i, j)) * (u - i))
    }) ||
    // A diagonal u − v = d: the mesh there between nodes (i, i − d) and (i + 1, i − d + 1).
    crosses(ua - va, ub - vb, (d, t) => {
      const u = ua + (ub - ua) * t,
        i = Math.floor(u),
        j = i - d
      return over(
        t,
        terrainNodeY(i, j) + (terrainNodeY(i + 1, j + 1) - terrainNodeY(i, j)) * (u - i),
      )
    })
  )
}

/**
 * Adds triangle abc of a road's ribbon at grade (each corner's z its road's profile there),
 * counter-clockwise seen from above, to `tris` in colour `hex`, each corner at `surface` (the render
 * y of the road over a point from its profile there: the higher of it and the terrain mesh, plus
 * its lift). Whole where the terrain mesh stands DRAPE_POKE or less over the plane through its
 * corners everywhere (at the mesh's nodes inside it and where its sides cross the mesh's folds,
 * where alone it folds); else cut along the mesh's cell sides and south-west to north-east
 * diagonals and where the profile meets the terrain, each piece on the surface, but along a side
 * the mesh stands no higher than that over, which stays straight, as the triangle across it draws
 * it (`sideFolds`): cut along such a side too, a triangle beside a whole one stepped off it, 1.35 m
 * on Cesena's trunk 23130070, and the terrain showed through the crack.
 */
export const drape = (
  tris: Triangles,
  a: Corner,
  b: Corner,
  c: Corner,
  surface: (x: number, y: number, z: number) => number,
  hex: number,
): void => {
  const ha = surface(a[0], a[1], a[2]),
    hb = surface(b[0], b[1], b[2]),
    hc = surface(c[0], c[1], c[2]),
    chord = planeOf(a, b, c, ha, hb, hc)
  const whole = () => tris.tri(a[0], ha, -a[1], b[0], hb, -b[1], c[0], hc, -c[1], hex)
  if (chord === undefined) return whole()
  const on = (x: number, y: number) => chord[0] + chord[1] * x + chord[2] * y
  const i0 = Math.floor((Math.min(a[0], b[0], c[0]) - X0) / CELL),
    i1 = Math.floor((Math.max(a[0], b[0], c[0]) - X0) / CELL) + 1,
    j0 = Math.floor((Math.min(a[1], b[1], c[1]) - Y0) / CELL),
    j1 = Math.floor((Math.max(a[1], b[1], c[1]) - Y0) / CELL) + 1
  // Every node of the cells round it DRAPE_POKE or less over the plane: the mesh, between them on
  // each of its triangles, is too.
  let near = false,
    inside = false
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const x = X0 + i * CELL,
        y = Y0 + j * CELL
      if (terrainNodeY(i, j) <= on(x, y) + DRAPE_POKE) continue
      near = true
      // On the inner side of each of its sides, whichever way round a sharp bend's mitre turns it.
      const d1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]),
        d2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]),
        d3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0])
      if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) inside = true
    }
  if (!near) return whole()
  const sides = [
    [a, b, sideFolds(a, ha, b, hb)],
    [b, c, sideFolds(b, hb, c, hc)],
    [c, a, sideFolds(c, hc, a, ha)],
  ] as const
  if (!inside && sides.every(([, , folds]) => !folds)) return whole()
  /** Whether map point (x, y) lies on a side of it that stays straight. */
  const straight = (x: number, y: number) =>
    sides.some(([p, q, folds]) => {
      if (folds) return false
      const ex = q[0] - p[0],
        ey = q[1] - p[1]
      return Math.abs(ex * (y - p[1]) - ey * (x - p[0])) < 1e-7 * Math.hypot(ex, ey)
    })
  const height = (x: number, y: number, z: number) => (straight(x, y) ? on(x, y) : surface(x, y, z))
  const corners: Polygon = [...a, ...b, ...c]
  for (let i = i0; i < i1; i++)
    for (let j = j0; j < j1; j++) {
      const x = X0 + i * CELL,
        y = Y0 + j * CELL
      let cell = clip(corners, (px) => px - x)
      for (const side of [
        (px: number) => x + CELL - px,
        (_: number, py: number) => py - y,
        (_: number, py: number) => y + CELL - py,
      ])
        if (cell.length > 0) cell = clip(cell, side)
      // The cell's two triangles, south-east of its diagonal and north-west; on each the terrain is
      // one plane, so the profile meets it along one line.
      for (const half of [1, -1]) {
        const part = cell.length === 0 ? [] : clip(cell, (px, py) => half * (px - x - (py - y)))
        for (const meets of [1, -1]) {
          const piece =
            part.length === 0 ? [] : clip(part, (px, py, z) => meets * (z - terrainZ(px, py)))
          if (piece.length > 0) fan(tris, piece, height, hex)
        }
      }
    }
}

/**
 * Triangles as drawn, seen from above, for `heightAt` and `layOver`: each one's corners (map x, map
 * y, render y), its plane (render y over map x, y) and its box, flat, bucketed by map position.
 */
export interface Drawn {
  /** Corners by triangle: nine values each, (x, y, h) three times. */
  readonly corners: Float64Array
  /** Planes by triangle: (c, ux, uy), h = c + ux · x + uy · y; NaN for a sliver. */
  readonly planes: Float64Array
  /** The highest of them over map (x, y), render y; undefined where none covers it. */
  readonly heightAt: (x: number, y: number) => number | undefined
  /** The indices of those whose box meets map box (x0, y0)–(x1, y1), ascending. */
  readonly under: (x0: number, y0: number, x1: number, y1: number) => Array<number>
}

/** A plane as render y over map (x, y): y = c + ux · x + uy · y. */
type Plane = readonly [c: number, ux: number, uy: number]

/** The cells (m) `drawn` buckets triangles in. */
const BUCKET = 2

/** `tris` (decal triangles) as drawn (`Drawn`). */
export const drawn = (tris: Triangles): Drawn => {
  const p = tris.position,
    count = p.length / 9,
    corners = new Float64Array(9 * count),
    planes = new Float64Array(3 * count),
    boxes = new Float64Array(4 * count),
    cells = new Map<number, Array<number>>(),
    key = (i: number, j: number) => i * 65536 + j
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      corners[9 * t + 3 * k] = p[9 * t + 3 * k]!
      corners[9 * t + 3 * k + 1] = -p[9 * t + 3 * k + 2]!
      corners[9 * t + 3 * k + 2] = p[9 * t + 3 * k + 1]!
    }
    const c = corners.subarray(9 * t, 9 * t + 9),
      plane = planeOf([c[0]!, c[1]!, 0], [c[3]!, c[4]!, 0], [c[6]!, c[7]!, 0], c[2]!, c[5]!, c[8]!)
    planes.set(plane ?? [NaN, NaN, NaN], 3 * t)
    const x0 = Math.min(c[0]!, c[3]!, c[6]!),
      y0 = Math.min(c[1]!, c[4]!, c[7]!),
      x1 = Math.max(c[0]!, c[3]!, c[6]!),
      y1 = Math.max(c[1]!, c[4]!, c[7]!)
    boxes.set([x0, y0, x1, y1], 4 * t)
    for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++)
      for (let j = Math.floor(y0 / BUCKET); j <= Math.floor(y1 / BUCKET); j++) {
        const list = cells.get(key(i, j))
        if (list === undefined) cells.set(key(i, j), [t])
        else if (list.at(-1) !== t) list.push(t)
      }
  }
  /** Whether triangle `t` covers map (x, y), seen from above, whichever way round. */
  const covers = (t: number, x: number, y: number): boolean => {
    const o = 9 * t,
      ax = corners[o]!,
      ay = corners[o + 1]!,
      bx = corners[o + 3]!,
      by = corners[o + 4]!,
      cx = corners[o + 6]!,
      cy = corners[o + 7]!
    const d1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax),
      d2 = (cx - bx) * (y - by) - (cy - by) * (x - bx),
      d3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)
  }
  return {
    corners,
    planes,
    heightAt: (x, y) => {
      let top: number | undefined
      for (const t of cells.get(key(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ?? []) {
        if (Number.isNaN(planes[3 * t]!) || !covers(t, x, y)) continue
        const h = planes[3 * t]! + planes[3 * t + 1]! * x + planes[3 * t + 2]! * y
        if (top === undefined || h > top) top = h
      }
      return top
    },
    under: (x0, y0, x1, y1) => {
      const found: Array<number> = []
      for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++)
        for (let j = Math.floor(y0 / BUCKET); j <= Math.floor(y1 / BUCKET); j++)
          for (const t of cells.get(key(i, j)) ?? [])
            if (
              boxes[4 * t]! <= x1 &&
              boxes[4 * t + 2]! >= x0 &&
              boxes[4 * t + 1]! <= y1 &&
              boxes[4 * t + 3]! >= y0 &&
              !Number.isNaN(planes[3 * t]!)
            )
              found.push(t)
      found.sort((a, b) => a - b)
      return found.filter((t, k) => k === 0 || found[k - 1] !== t)
    },
  }
}

/** Triangles written to two meshes at once: a chunk's and a segment's own. */
class Tee extends Triangles {
  private readonly first: Triangles
  private readonly second: Triangles

  constructor(first: Triangles, second: Triangles) {
    super()
    this.first = first
    this.second = second
  }

  override tri(...corners: Parameters<Triangles["tri"]>): void {
    this.first.tri(...corners)
    this.second.tri(...corners)
  }
}

/**
 * Has `draw` lay a ribbon's quads, each given the segment it lies along, in the chunks' meshes `at`
 * puts them in and apart by segment, and returns each segment's as drawn, for its painted lines
 * (`layOver`): a line reads no neighbouring segment, which a chunk draws with its far mitre unmade,
 * so a chunk keeps its cut of a whole-map build.
 */
export const drawnBySegment = (
  at: SinkAt,
  draw: (into: (x: number, y: number, segment: number) => Sink) => void,
): ((segment: number) => Drawn | undefined) => {
  const bySegment = new Map<number, Triangles>(),
    drawnBy = new Map<number, Drawn>()
  draw((x, y, segment) => {
    const sink = at(x, y)
    let own = bySegment.get(segment)
    if (own === undefined) bySegment.set(segment, (own = new Triangles()))
    return { ...sink, decal: new Tee(sink.decal, own) }
  })
  return (segment) => {
    const own = bySegment.get(segment)
    if (own === undefined) return undefined
    let found = drawnBy.get(segment)
    if (found === undefined) drawnBy.set(segment, (found = drawn(own)))
    return found
  }
}

/**
 * Adds triangle abc of a painted line (each corner's z its render y: `over` m or more over the
 * ribbon drawn there), counter-clockwise seen from above, to `tris` in colour `hex`: whole where
 * every triangle of `ribbon` under it stands more than CLEAR under the plane through its corners,
 * else cut along the sides of those triangles, each piece `over` m over the one it lies on, or on
 * that plane where it stands higher.
 */
export const layOver = (
  tris: Triangles,
  a: Corner,
  b: Corner,
  c: Corner,
  ribbon: Drawn,
  over: number,
  hex: number,
): void => {
  const chord = planeOf(a, b, c, a[2], b[2], c[2])
  const under =
    chord === undefined
      ? []
      : ribbon.under(
          Math.min(a[0], b[0], c[0]),
          Math.min(a[1], b[1], c[1]),
          Math.max(a[0], b[0], c[0]),
          Math.max(a[1], b[1], c[1]),
        )
  const { corners, planes } = ribbon
  /** How far ribbon triangle `t`'s plane stands under the line's at (x, y), less CLEAR: under 0, too near. */
  const room = (t: number, x: number, y: number) =>
    chord![0] +
    chord![1] * x +
    chord![2] * y -
    (planes[3 * t]! + planes[3 * t + 1]! * x + planes[3 * t + 2]! * y) -
    CLEAR
  // Each plane CLEAR under the line's at its corners is under it all across.
  let near = false
  for (const t of under)
    if (room(t, a[0], a[1]) < 0 || room(t, b[0], b[1]) < 0 || room(t, c[0], c[1]) < 0) near = true
  if (!near) {
    tris.tri(a[0], a[2], -a[1], b[0], b[2], -b[1], c[0], c[2], -c[1], hex)
    return
  }
  const pieces: Array<readonly [Polygon, number]> = []
  near = false
  for (const t of under) {
    const o = 9 * t,
      turn = Math.sign(
        (corners[o + 3]! - corners[o]!) * (corners[o + 7]! - corners[o + 1]!) -
          (corners[o + 4]! - corners[o + 1]!) * (corners[o + 6]! - corners[o]!),
      )
    let piece: Polygon = [...a, ...b, ...c]
    for (let k = 0; k < 3 && piece.length > 0; k++) {
      const ax = corners[o + 3 * k]!,
        ay = corners[o + 3 * k + 1]!,
        bx = corners[o + ((3 * k + 3) % 9)]!,
        by = corners[o + ((3 * k + 4) % 9)]!
      piece = clip(piece, (x, y) => turn * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)))
    }
    if (piece.length === 0) continue
    for (let k = 0; k < piece.length; k += 3) if (room(t, piece[k]!, piece[k + 1]!) < 0) near = true
    pieces.push([piece, t])
  }
  if (!near) {
    tris.tri(a[0], a[2], -a[1], b[0], b[2], -b[1], c[0], c[2], -c[1], hex)
    return
  }
  for (const [piece, t] of pieces)
    fan(
      tris,
      piece,
      (x, y) =>
        Math.max(
          planes[3 * t]! + planes[3 * t + 1]! * x + planes[3 * t + 2]! * y + over,
          chord![0] + chord![1] * x + chord![2] * y,
        ),
      hex,
    )
}

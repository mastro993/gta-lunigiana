// The ground under the bridges' decks: once the grid is built, the terrain under every road and
// rail deck's slab (DECK_SLAB, as src/render/lines.ts draws it) is lowered so it shows through no
// deck. A deck meets the ground at its ends, where its approaches' cores hold their cells: walking in
// from each end, its end run lasts until its slab first stands clear of the ground across its width,
// END_RUN m at most, and there the ground only stays within the rail bed's BED over its profile,
// under every road's surface (the road is never buried); between the end runs, the ground stays
// under the slab. A deck's pieces (OSM splits a bridge into ways) join where they share a vertex on
// one level: a joint is mid-bridge, with no end run. The bare-earth model has no decks, so it rose
// into them (issue #92).
import { DECK_BALLAST, DECK_SLAB, isRoadClass, ON_DECK, ROAD_LIFT } from "../sim/map/kinds.ts"
import { BED } from "./rail-bed.ts"
import { anchorNode, type Grid } from "./terrain.ts"

/** A deck as shipped: its flat polyline and profile per vertex, its slab's half width and its top over the profile, m. */
export interface Slab {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly half: number
  readonly lift: number
}

/** A line as shipped: its flat polyline and its profile per vertex. */
interface Line {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/** A road bridge's slab: its carriageway and DECK_SLAB.margin either side, under the road's surface (`ROAD_LIFT`). */
export const roadSlab = (road: { readonly cls: string; readonly w: number }, line: Line): Slab => ({
  pts: line.pts,
  z: line.z,
  half: road.w / 2 + DECK_SLAB.margin,
  lift: ROAD_LIFT[isRoadClass(road.cls) ? road.cls : "path"],
})

/** A rail bridge's slab: its ballast (`DECK_BALLAST`) and DECK_SLAB.margin either side, under the ballast's top. */
export const railSlab = (line: Line): Slab => ({
  pts: line.pts,
  z: line.z,
  half: DECK_BALLAST.width / 2 + DECK_SLAB.margin,
  lift: DECK_BALLAST.lift,
})

/** How far apart a deck's cross-sections lie along it, and their points across it at most, m. */
const STEP = 0.5

/**
 * How far in from a deck's end its end run reaches at most, m: issue #92 asks for no ground in the
 * slab more than a few metres from either end (it measured past 4 m). Past it a deck lying on a bank
 * (an OSM bridge drawn over the ground, 143 m of one in Cesena) has the ground lowered under its slab.
 */
export const END_RUN = 4

/**
 * Per slab, the other slabs joined to it at its first and at its last vertex: those with a vertex at
 * the same point whose top there lies within ON_DECK of its own, the next piece of the same bridge
 * or a deck it meets on its level. An end with none is an outer end, where the deck meets the ground.
 */
export const jointsOf = (
  slabs: ReadonlyArray<Slab>,
): Array<readonly [ReadonlyArray<number>, ReadonlyArray<number>]> => {
  const at = new Map<string, Array<readonly [number, number]>>()
  const key = (slab: Slab, k: number) => `${slab.pts[2 * k]},${slab.pts[2 * k + 1]}`
  slabs.forEach((slab, i) => {
    for (let k = 0; k < slab.z.length; k++)
      at.set(key(slab, k), [...(at.get(key(slab, k)) ?? []), [i, slab.z[k]! + slab.lift]])
  })
  return slabs.map((slab, i) => {
    const joined = (k: number) => {
      const top = slab.z[k]! + slab.lift
      return [
        ...new Set(
          (at.get(key(slab, k)) ?? []).flatMap(([j, t]) =>
            j !== i && Math.abs(t - top) < ON_DECK ? [j] : [],
          ),
        ),
      ]
    }
    return [joined(0), joined(slab.z.length - 1)] as const
  })
}

/** A deck's cross-section: how far along it, and the least height of its top over the terrain across its slab, m. */
export interface Section {
  readonly s: number
  readonly gap: number
}

/**
 * A deck's cross-sections, every STEP m from its first vertex and at its last, each read on
 * `terrain` across its slab, edges included, every STEP m or less.
 */
export const sections = (slab: Slab, terrain: (x: number, y: number) => number): Array<Section> => {
  const { pts, z, half, lift } = slab
  const s = [0]
  for (let k = 2; k + 1 < pts.length; k += 2)
    s.push(s.at(-1)! + Math.hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!))
  const length = s.at(-1)!,
    across = Math.ceil((2 * half) / STEP),
    along = Array.from({ length: Math.floor(length / STEP) + 1 }, (_, m) => m * STEP)
  if (along.at(-1)! < length) along.push(length)
  let k = 0
  return along.map((at) => {
    // The segment the section lies on, skipping any of no length.
    while (k + 2 < s.length && (s[k + 1]! < at || s[k + 1] === s[k])) k++
    const span = s[k + 1]! - s[k]!,
      t = span > 0 ? Math.min(1, (at - s[k]!) / span) : 0
    const dx = pts[2 * k + 2]! - pts[2 * k]!,
      dy = pts[2 * k + 3]! - pts[2 * k + 1]!
    const nx = span > 0 ? -dy / span : 0,
      ny = span > 0 ? dx / span : 0
    const top = z[k]! + (z[k + 1]! - z[k]!) * t + lift
    let gap = Infinity
    for (let c = 0; c <= across; c++) {
      const o = -half + (2 * half * c) / across
      gap = Math.min(
        gap,
        top - terrain(pts[2 * k]! + dx * t + nx * o, pts[2 * k + 1]! + dy * t + ny * o),
      )
    }
    return { s: at, gap }
  })
}

/** Whether a cross-section's slab stands clear of the terrain all across: DECK_SLAB.depth under the deck's top. */
const isClear = (section: Section): boolean => section.gap >= DECK_SLAB.depth - 1e-9

/**
 * The stretch between a deck's end runs, [s0, s1] (m along it), from its cross-sections (`sections`)
 * and whether each end is an outer end (`jointsOf`): from its first clear cross-section (`isClear`),
 * or END_RUN in where that lies farther, to its last, or END_RUN short of its far end; at a joint the
 * stretch reaches the end itself. s0 > s1 on a deck under 2 END_RUN long that is clear nowhere: its
 * end runs then cover it.
 */
export const clearRun = (
  cuts: ReadonlyArray<Section>,
  outer: readonly [boolean, boolean],
): readonly [number, number] => {
  const length = cuts.at(-1)!.s
  return [
    outer[0] ? Math.min(cuts.find(isClear)?.s ?? Infinity, END_RUN) : 0,
    outer[1] ? Math.max(cuts.findLast(isClear)?.s ?? -Infinity, length - END_RUN) : length,
  ]
}

/** The terrain at (x, y) as the game draws it: each 4 m cell of `g` (the whole grid) split along its south-west to north-east diagonal (`terrainZ` in src/sim/map/ground.ts). */
export const meshZ = (g: Grid, x: number, y: number): number => {
  const [oi, oj] = anchorNode(g)
  const fx = (x - g.ax) / g.cell,
    fy = (y - g.ay) / g.cell
  const fi = Math.floor(fx),
    fj = Math.floor(fy)
  const u = fx - fi,
    v = fy - fj
  const node = (i: number, j: number) =>
    g.z[Math.min(g.rows - 1, Math.max(0, j)) * g.cols + Math.min(g.cols - 1, Math.max(0, i))]!
  const i = fi + oi,
    j = fj + oj
  const sw = node(i, j),
    se = node(i + 1, j),
    nw = node(i, j + 1),
    ne = node(i + 1, j + 1)
  return u >= v ? sw + (se - sw) * u + (ne - se) * v : sw + (ne - nw) * u + (nw - sw) * v
}

/** One segment of a deck: its first vertex, its unit direction and length, its top at either end, its slab's half width. */
interface Segment {
  readonly ax: number
  readonly ay: number
  readonly ux: number
  readonly uy: number
  readonly len: number
  readonly ta: number
  readonly tb: number
  readonly half: number
}

/** Segment k of `slab`, or undefined where its two vertices coincide. */
const segmentOf = (slab: Slab, k: number): Segment | undefined => {
  const ax = slab.pts[2 * k]!,
    ay = slab.pts[2 * k + 1]!,
    len = Math.hypot(slab.pts[2 * k + 2]! - ax, slab.pts[2 * k + 3]! - ay)
  if (len === 0) return undefined
  return {
    ax,
    ay,
    ux: (slab.pts[2 * k + 2]! - ax) / len,
    uy: (slab.pts[2 * k + 3]! - ay) / len,
    len,
    ta: slab.z[k]! + slab.lift,
    tb: slab.z[k + 1]! + slab.lift,
    half: slab.half,
  }
}

/**
 * Calls `visit` with each cell (i, j) of `g` (whole-grid indices, from its south-west node) that the
 * slab of `seg` reaches over between d0 and d1 m along it; a cell it only touches is left out.
 */
const cellsUnder = (
  g: Omit<Grid, "z" | "span">,
  seg: Segment,
  d0: number,
  d1: number,
  visit: (i: number, j: number) => void,
): void => {
  const { ax, ay, ux, uy, half } = seg
  const xs = [d0, d1].flatMap((d) => [ax + ux * d - uy * half, ax + ux * d + uy * half]),
    ys = [d0, d1].flatMap((d) => [ay + uy * d + ux * half, ay + uy * d - ux * half])
  const [oi, oj] = anchorNode(g),
    c = g.cell
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - g.ax) / c) + oi),
    i1 = Math.min(g.cols - 2, Math.floor((Math.max(...xs) - g.ax) / c) + oi),
    j0 = Math.max(0, Math.floor((Math.min(...ys) - g.ay) / c) + oj),
    j1 = Math.min(g.rows - 2, Math.floor((Math.max(...ys) - g.ay) / c) + oj)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      // Separating axes: the cell's own two (the box above) and the slab's two.
      const corners = [0, 1, 2, 3].map(
        (q) => [g.x0 + (i + (q & 1)) * c - ax, g.y0 + (j + (q >> 1)) * c - ay] as const,
      )
      const along = corners.map(([x, y]) => x * ux + y * uy),
        across = corners.map(([x, y]) => y * ux - x * uy)
      if (Math.max(...along) <= d0 || Math.min(...along) >= d1) continue
      if (Math.max(...across) <= -half || Math.min(...across) >= half) continue
      visit(i, j)
    }
}

/**
 * The two triangles a cell is drawn as (split along its south-west to north-east diagonal): each
 * its corners as (column, row) offsets from the south-west node, and the weights of a point (u, v)
 * of the cell (fractions east and north) on them.
 */
const TRIANGLES = [
  {
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    weights: (u: number, v: number) => [1 - u, u - v, v],
  },
  {
    corners: [
      [0, 0],
      [1, 1],
      [0, 1],
    ],
    weights: (u: number, v: number) => [1 - v, u, v - u],
  },
] as const

/** The part of the convex polygon `poly` where a·x + b·y ≤ c (one Sutherland–Hodgman step). */
const clip = (
  poly: ReadonlyArray<readonly [number, number]>,
  a: number,
  b: number,
  c: number,
): Array<readonly [number, number]> => {
  const out: Array<readonly [number, number]> = []
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length]!,
      fp = a * p[0] + b * p[1] - c,
      fq = a * q[0] + b * q[1] - c
    if (fp <= 0) out.push(p)
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq)
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  })
  return out
}

/**
 * Lowers the drawn mesh under the slab of `seg` from d0 to d1 m along it until no point of it
 * stands over the plane `depth` m under the deck's top (exact: the mesh and the plane are linear on
 * each triangle, so the corners of the slab's part of it bound it). Where a corner of that part
 * stands over the plane, the triangle's corners that may move are lowered, the one that weighs most
 * there first, each just enough and at most DECK_SLAB.depth under the plane, floored to the grid's
 * 0.1 m: the ground under the slab goes before a bank its edge grazes (lowering each corner of the
 * cells it reached over to the plane cut a hillside 11.2 m, 7.3 m off a track bridge), and no deep
 * pit is dug to make up for one.
 */
const lay = (
  g: Grid,
  seg: Segment,
  d0: number,
  d1: number,
  depth: number,
  keep: (n: number) => boolean,
  lower: (n: number, z: number) => void,
): void => {
  const { ax, ay, ux, uy, len, ta, tb, half } = seg,
    c = g.cell
  const plane = (x: number, y: number) =>
    ta + ((tb - ta) * ((x - ax) * ux + (y - ay) * uy)) / len - depth
  cellsUnder(g, seg, d0, d1, (i, j) => {
    for (const { corners, weights } of TRIANGLES) {
      let part: Array<readonly [number, number]> = corners.map(([di, dj]) => [
        g.x0 + (i + di) * c,
        g.y0 + (j + dj) * c,
      ])
      // Inside the slab: d0 ≤ along ≤ d1 and |across| ≤ half.
      part = clip(part, -ux, -uy, -d0 - ax * ux - ay * uy)
      part = clip(part, ux, uy, d1 + ax * ux + ay * uy)
      part = clip(part, -uy, ux, half - ax * uy + ay * ux)
      part = clip(part, uy, -ux, half + ax * uy - ay * ux)
      const nodes = corners.map(([di, dj]) => (j + dj) * g.cols + i + di)
      for (const [x, y] of part) {
        const w = weights((x - g.x0) / c - i, (y - g.y0) / c - j)
        // The corners' heights over the plane, which is linear: its height at (x, y) is theirs weighed.
        const excess = () =>
          nodes.map(
            (n, q) =>
              g.z[n]! - plane(g.x0 + (i + corners[q]![0]) * c, g.y0 + (j + corners[q]![1]) * c),
          )
        for (;;) {
          const e = excess(),
            over = e.reduce((sum, h, q) => sum + w[q]! * h, 0)
          if (over <= 1e-6) break
          let best = -1
          for (let q = 0; q < 3; q++)
            if (
              e[q]! > 1e-6 - DECK_SLAB.depth &&
              w[q]! > 1e-6 &&
              !keep(nodes[q]!) &&
              (best < 0 || w[q]! > w[best]!)
            )
              best = q
          if (best < 0) break
          const n = nodes[best]!,
            drop = Math.min(e[best]! + DECK_SLAB.depth, over / w[best]!)
          lower(n, Math.floor((g.z[n]! - drop) * 10 + 1e-6) / 10)
        }
      }
    }
  })
}

/** Whether (x, y) lies abeam of `slab`'s deck, between the lines across the ends of one of its segments. */
export const abeamOf = (slab: Slab, x: number, y: number): boolean =>
  slab.z.slice(1).some((_, k) => {
    const seg = segmentOf(slab, k),
      d = seg === undefined ? -1 : (x - seg.ax) * seg.ux + (y - seg.ay) * seg.uy
    return seg !== undefined && d >= 0 && d <= seg.len
  })

/**
 * Every whole-grid node a corner of a cell some slab reaches over, ascending, each with whether it
 * lies abeam of that slab's deck (`abeamOf`): a line's core there is no line at grade but an
 * approach's reaching past its deck's end, beside or under it. It reads only the grid's lattice, so
 * it holds for any window of it.
 */
export const slabNodes = (
  g: Omit<Grid, "z" | "span">,
  slabs: ReadonlyArray<Slab>,
): Array<readonly [number, boolean]> => {
  const beside = new Map<number, boolean>()
  for (const slab of slabs)
    for (let k = 0; k + 1 < slab.z.length; k++) {
      const seg = segmentOf(slab, k)
      if (seg === undefined) continue
      cellsUnder(g, seg, 0, seg.len, (i, j) => {
        for (let q = 0; q < 4; q++) {
          const n = (j + (q >> 1)) * g.cols + i + (q & 1)
          const x = g.x0 + (i + (q & 1)) * g.cell,
            y = g.y0 + (j + (q >> 1)) * g.cell
          beside.set(n, beside.get(n) === true || abeamOf(slab, x, y))
        }
      })
    }
  return [...beside].sort((a, b) => a[0] - b[0])
}

/**
 * Lowers the ground of `g` (the whole grid) under every deck's slab, leaving `keep`'s nodes: along
 * its end runs to BED over its profile (an approach's core, its profile rounded to 0.1 m, stays),
 * between them (`clearRun`, read on the drawn mesh, at its outer ends, `jointsOf`) out of its slab,
 * DECK_SLAB.depth under its top. A deck with a cross-section between its end runs left in its slab
 * (the lowered ground cleared some in an end run) is laid again over the new stretch, until it lies
 * still. Returns each node moved, by whole-grid index, with how far (negative), ascending.
 */
export const deckGround = (
  g: Grid,
  slabs: ReadonlyArray<Slab>,
  keep: (n: number) => boolean,
): Array<readonly [number, number]> => {
  const was = new Map<number, number>()
  const lower = (n: number, z: number) => {
    if (keep(n) || z >= g.z[n]!) return
    if (!was.has(n)) was.set(n, g.z[n]!)
    g.z[n] = z
  }
  const terrain = (x: number, y: number) => meshZ(g, x, y)
  const outer = jointsOf(slabs).map(
    ([first, last]) => [first.length === 0, last.length === 0] as const,
  )
  const laid = new Map<Slab, string>()
  for (let settled = false; !settled;) {
    settled = true
    for (const [i, slab] of slabs.entries()) {
      const cuts = sections(slab, terrain),
        [s0, s1] = clearRun(cuts, outer[i]!),
        key = `${s0},${s1}`
      const together = cuts.every((cut) => cut.s < s0 || cut.s > s1 || isClear(cut))
      if (laid.has(slab) && (laid.get(slab) === key || together)) continue
      laid.set(slab, key)
      settled = false
      const end = slab.lift - BED
      for (let k = 0, s = 0; k + 1 < slab.z.length; k++) {
        const seg = segmentOf(slab, k)
        if (seg === undefined) continue
        // The segment's part on each run, [from, to] m along the deck, and how far under the top.
        for (const [from, to, depth] of [
          [-Infinity, s0, end],
          [s0, s1, DECK_SLAB.depth],
          [s1, Infinity, end],
        ] as const) {
          const d0 = Math.max(0, from - s),
            d1 = Math.min(seg.len, to - s)
          if (d1 > d0 || (d1 === d0 && depth !== end)) lay(g, seg, d0, d1, depth, keep, lower)
        }
        s += seg.len
      }
    }
  }
  return [...was].sort((a, b) => a[0] - b[0]).map(([n, z]) => [n, g.z[n]! - z] as const)
}

/** The nodes `deckGround` lowered and the deepest cut, m. */
export const deckReport = (
  moved: ReadonlyArray<readonly [number, number]>,
): { nodes: number; deepest: number } => ({
  nodes: moved.length,
  deepest: moved.reduce((deepest, [, dz]) => Math.max(deepest, -dz), 0),
})

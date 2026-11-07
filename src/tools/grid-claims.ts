// What a road or rail profile writes into the terrain grid (profiles.ts): its claims, each flattening
// the nodes round its line (`flatten`) in the order they are made, and a road tunnel's mouths, which
// hold the grid round each at the approach's level, written before every other claim.
import { flatten, GRID_CELL, type Grid, type Profile } from "./terrain.ts"

/**
 * Half-width (m) of the core a line `w` m wide writes into a grid of `cell` m: half a cell past
 * the carriageway's edge, so the terrain under it is (nearly) level across it.
 */
export const coreHalf = (w: number, cell: number): number => Math.max(w / 2 + 0.3 + cell / 2, 3)

/**
 * How far (m) along its approach a road tunnel's mouth holds the grid (`mouths` in profiles.ts's `Spec`): a cell's
 * diagonal, the farthest a corner of the cell holding the mouth lies from it.
 */
const MOUTH = GRID_CELL * Math.SQRT2

/**
 * A profile to write into the grid (`flatten`): its core half-width by segment, rank, and the
 * samples whose segment writes nothing (bridges, tunnels).
 */
export interface Claim {
  readonly p: Profile
  /** The core's half-width (`coreHalf`) of the segment from each sample, m: its own piece's. */
  readonly core: Float64Array
  /** Metres its writes reach past its core, blending back to the terrain. */
  readonly blend: number
  /** A point and a direction (x, y, dx, dy): it writes only the nodes abeam or ahead of the point (a mouth's claim, out of its tunnel). */
  readonly ahead?: readonly [number, number, number, number]
  /** It writes only the nodes where this holds (a run-out's claim, beyond the play area). */
  readonly writes?: (x: number, y: number) => boolean
  readonly rank: number
  readonly skip: Uint8Array
  /** The box its writes reach: [minX, minY, maxX, maxY]. */
  readonly box: readonly [number, number, number, number]
}

/** Metres a claim's writes reach past its core: the blend back to the terrain. */
export const BLEND = 8

/** The rank of a tunnel mouth's claim: every other claim's equal or above, and it is written first. */
const MOUTH_RANK = 0

/**
 * Writes `claims` into the nodes `g` holds, in order: what one pass over the whole grid writes
 * there, since a node's writes read only that node. `owner` and `protect` are indexed like `g.z`.
 */
export const replayClaims = (
  g: Grid,
  claims: ReadonlyArray<Claim>,
  owner: Uint8Array,
  protect: Uint8Array,
): void => {
  const { i0, j0, cols, rows } = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const minX = g.x0 + i0 * g.cell,
    minY = g.y0 + j0 * g.cell,
    maxX = g.x0 + (i0 + cols - 1) * g.cell,
    maxY = g.y0 + (j0 + rows - 1) * g.cell
  for (const { p, core, blend, ahead, writes, rank, skip, box } of claims)
    if (box[0] <= maxX && box[2] >= minX && box[1] <= maxY && box[3] >= minY)
      flatten(
        g,
        p,
        core,
        blend,
        rank,
        owner,
        protect,
        (k) => skip[k] === 1,
        ahead === undefined
          ? writes
          : (x, y) => (x - ahead[0]) * ahead[2] + (y - ahead[1]) * ahead[3] >= 0,
      )
}

/**
 * A claim along profile `p`, the segment from sample k `w(k)` m wide (its own piece's width), at
 * `rank`, blending `blend` m, but for segments from samples where `skip`, on the nodes where
 * `writes` holds (all with none).
 */
export const claimOf = (
  p: Profile,
  w: (segment: number) => number,
  rank: number,
  blend: number,
  skip: (k: number) => boolean,
  writes?: (x: number, y: number) => boolean,
): Claim => {
  const n = Math.max(0, p.z.length - 1),
    core = Float64Array.from({ length: n }, (_, k) => coreHalf(w(k), GRID_CELL))
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let k = 0; k < n; k++) {
    const reach = core[k]! + blend
    for (const e of [k, k + 1]) {
      minX = Math.min(minX, p.x[e]! - reach)
      minY = Math.min(minY, p.y[e]! - reach)
      maxX = Math.max(maxX, p.x[e]! + reach)
      maxY = Math.max(maxY, p.y[e]! + reach)
    }
  }
  return {
    p,
    core,
    blend,
    ...(writes === undefined ? {} : { writes }),
    rank,
    skip: Uint8Array.from({ length: n }, (_, k) => (skip(k) ? 1 : 0)),
    box: [minX, minY, maxX, maxY],
  }
}

/**
 * The approach to a mouth at sample `k` of `p`, walking `step` (±1) along it to MOUTH m out while
 * `atGrade` holds of each segment (by its first sample): a profile of its own; undefined where
 * none leaves it at grade (the chain ends there, at a junction, or a bridge does).
 */
const approach = (
  p: Profile,
  k: number,
  step: 1 | -1,
  atGrade: (segment: number) => boolean,
): Profile | undefined => {
  const x = [p.x[k]!],
    y = [p.y[k]!],
    z = [p.z[k]!]
  for (let o = k; o + step >= 0 && o + step < p.z.length; o += step) {
    if (!atGrade(Math.min(o, o + step))) break
    const n = o + step,
      from = Math.abs(p.s[o]! - p.s[k]!),
      to = Math.abs(p.s[n]! - p.s[k]!),
      t = to <= MOUTH ? 1 : (MOUTH - from) / (to - from)
    x.push(p.x[o]! + (p.x[n]! - p.x[o]!) * t)
    y.push(p.y[o]! + (p.y[n]! - p.y[o]!) * t)
    z.push(p.z[o]! + (p.z[n]! - p.z[o]!) * t)
    if (to >= MOUTH) break
  }
  return x.length === 1 ? undefined : { x, y, s: [], z: Float64Array.from(z), vertexSample: [] }
}

/**
 * The claim of a tunnel's mouth at sample `k` of `p`, the road `w` m wide leaving it by `step` (±1)
 * while `atGrade` holds: its approach's first MOUTH m, in its core ahead of the mouth alone (the
 * road over the tunnel keeps its cells), at MOUTH_RANK; none where no approach leaves it at grade.
 */
export const mouthClaim = (
  p: Profile,
  k: number,
  step: 1 | -1,
  w: number,
  atGrade: (segment: number) => boolean,
): Claim | undefined => {
  const out = approach(p, k, step, atGrade)
  if (out === undefined) return undefined
  return {
    ...claimOf(
      out,
      () => w,
      MOUTH_RANK,
      0,
      () => false,
    ),
    ahead: [out.x[0]!, out.y[0]!, out.x[1]! - out.x[0]!, out.y[1]! - out.y[0]!],
  }
}

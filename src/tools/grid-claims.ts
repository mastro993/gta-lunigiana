// What a road or rail profile writes into the terrain grid (profiles.ts): its claims, each flattening
// the nodes round its line (`flatten`) in the order they are made, and a road tunnel's mouths, which
// hold the grid round each at the approach's level, written before every other claim.
import { lifted } from "./chains.ts"
import type { RoadF } from "./features.ts"
import { segDist2, type V } from "./geometry.ts"
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
export const MOUTH = GRID_CELL * Math.SQRT2

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
  /**
   * A point and a direction (x, y, dx, dy): it writes the nodes abeam or ahead of the point, and
   * behind it only those where `writes` holds (a mouth's claim, out of its tunnel: `mouthClaim`).
   */
  readonly ahead?: readonly [number, number, number, number]
  /** It writes only the nodes where this holds (a run-out's claim, beyond the play area; a mouth's behind it, with `ahead`). */
  readonly writes?: (x: number, y: number) => boolean
  readonly rank: number
  readonly skip: Uint8Array
  /** The samples where its written line meets a bridge's deck (1), past which its core is under the deck (`flatten`); none with none. */
  readonly deckEnds?: Uint8Array
  /** The box its writes reach: [minX, minY, maxX, maxY]. */
  readonly box: readonly [number, number, number, number]
}

/** Metres a claim's writes reach past its core: the blend back to the terrain. */
export const BLEND = 8

/** How far a road tunnel's bore reaches past its carriageway's edge, m: its kerbs (`KERB` in src/render/bores.ts). */
const BORE_SIDE = 1

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
  // The nodes a core holds past a deck's end, under the deck: any other core takes them (`flatten`).
  const capped = new Uint8Array(owner.length)
  for (const { p, core, blend, ahead, writes, rank, skip, deckEnds, box } of claims)
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
          : (x, y) =>
              (x - ahead[0]) * ahead[2] + (y - ahead[1]) * ahead[3] >= 0 ||
              (writes?.(x, y) ?? false),
        deckEnds === undefined ? undefined : (k) => deckEnds[k] === 1,
        capped,
      )
}

/**
 * A claim along profile `p`, the segment from sample k `w(k)` m wide (its own piece's width), at
 * `rank`, blending `blend` m, but for segments from samples where `skip`, on the nodes where
 * `writes` holds (all with none), its line meeting a bridge's deck at the samples where `deckEnd`
 * holds.
 */
export const claimOf = (
  p: Profile,
  w: (segment: number) => number,
  rank: number,
  blend: number,
  skip: (k: number) => boolean,
  writes?: (x: number, y: number) => boolean,
  deckEnd?: (k: number) => boolean,
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
  const ends =
    deckEnd === undefined
      ? undefined
      : Uint8Array.from({ length: p.z.length }, (_, k) => (deckEnd(k) ? 1 : 0))
  return {
    p,
    core,
    blend,
    ...(writes === undefined ? {} : { writes }),
    rank,
    skip: Uint8Array.from({ length: n }, (_, k) => (skip(k) ? 1 : 0)),
    ...(ends === undefined || !ends.includes(1) ? {} : { deckEnds: ends }),
    box: [minX, minY, maxX, maxY],
  }
}

/**
 * The line from sample `k` of `p`, walking `step` (±1) along it up to `reach` m while `ok` holds of
 * each segment (by its first sample): its points and their levels (`level` by sample, the
 * profile's when unset), from sample `k` on.
 */
const stretch = (
  p: Profile,
  k: number,
  step: 1 | -1,
  reach: number,
  ok: (segment: number) => boolean,
  level: (sample: number) => number = (q) => p.z[q]!,
): { readonly x: Array<number>; readonly y: Array<number>; readonly z: Array<number> } => {
  const x = [p.x[k]!],
    y = [p.y[k]!],
    z = [level(k)]
  for (let o = k; o + step >= 0 && o + step < p.z.length; o += step) {
    if (!ok(Math.min(o, o + step))) break
    const n = o + step,
      from = Math.abs(p.s[o]! - p.s[k]!),
      to = Math.abs(p.s[n]! - p.s[k]!),
      t = to <= reach ? 1 : (reach - from) / (to - from)
    x.push(p.x[o]! + (p.x[n]! - p.x[o]!) * t)
    y.push(p.y[o]! + (p.y[n]! - p.y[o]!) * t)
    z.push(level(o) + (level(n) - level(o)) * t)
    if (to >= reach) break
  }
  return { x, y, z }
}

/** Metres between the points of a carriageway `carriagewayCells` tests the grid's nodes against. */
const SAMPLE = 0.25

/**
 * Whether a node of the grid at (x, y) is a corner of a cell that the carriageway `w` m wide along
 * `line` runs in, abeam or ahead of its first point facing (dx, dy): less than a cell's side from
 * one of its points (every SAMPLE m) along both axes of the grid. Memoized by node.
 */
const carriagewayCells = (
  line: { readonly x: ReadonlyArray<number>; readonly y: ReadonlyArray<number> },
  w: number,
  dx: number,
  dy: number,
): ((x: number, y: number) => boolean) => {
  const px: Array<number> = [],
    py: Array<number> = [],
    across = Math.ceil(w / SAMPLE)
  for (let i = 0; i + 1 < line.x.length; i++) {
    const ax = line.x[i]!,
      ay = line.y[i]!,
      ex = line.x[i + 1]! - ax,
      ey = line.y[i + 1]! - ay,
      l = Math.hypot(ex, ey),
      n = Math.ceil(l / SAMPLE)
    if (l === 0) continue
    for (let a = 0; a <= n; a++)
      for (let b = 0; b <= across; b++) {
        const o = -w / 2 + (w * b) / across,
          x = ax + (ex * a) / n - (ey / l) * o,
          y = ay + (ey * a) / n + (ex / l) * o
        if ((x - line.x[0]!) * dx + (y - line.y[0]!) * dy < 0) continue
        px.push(x)
        py.push(y)
      }
  }
  const seen = new Map<string, boolean>()
  return (x, y) => {
    const key = `${x},${y}`
    let is = seen.get(key)
    if (is === undefined) {
      is = px.some((sx, i) => Math.abs(sx - x) < GRID_CELL && Math.abs(py[i]! - y) < GRID_CELL)
      seen.set(key, is)
    }
    return is
  }
}

/**
 * The claim of a tunnel's mouth at sample `k` of `p`, the road `w` m wide leaving it by `step` (±1)
 * while `atGrade` holds: its approach's first MOUTH m, in its core ahead of the mouth, at
 * MOUTH_RANK; none where no approach leaves it at grade (the chain ends there, at a junction, or a
 * bridge does). With `floor` (the bore's floor by sample), behind the mouth too, within the core of
 * the bore's line at its floor (straight on at the mouth's level where `p` ends there, the bore
 * another chain's), the corners of the cells its carriageway runs in ahead of the mouth's face,
 * across the bore's line at the mouth (`carriagewayCells`; read along the approach's heading, the
 * road out of the east mouth of Fivizzano's underpass 145347886, turning 34° there, reached 1.2 m
 * behind the face), and no other node: each of them is a corner of a mesh triangle the
 * approach's first metres may lie on, and one left at the level of what stands over the bore (a
 * road over it, the hill) lifted the road out of the mouth toward it, as the terrain mesh reads it:
 * the A12 over the underpass 89579488 at Sarzana, 5.7 m over its floor, lifted its approach 2.4 m
 * within 2 m of the mouth. Held as deep as such a corner may lie (`GRID_CELL` × (|ux| + |uy|) m
 * behind the mouth heading out (ux, uy)) across the whole core, the cells behind Fivizzano's 16 m
 * underpass 145347886 dropped the nodes under the SS63's edges over it 4.3 m behind each mouth 6–7
 * m, and the node between them, which the junction there holds 0.4 m over the SS63's profile, stood
 * through its ribbon, which read the ground at its corners alone then. A path or steps at grade over
 * the bore keeps the cells of its vertices behind the mouth too (`footways`, their vertices within a
 * distance of a point; within the bore's kerbs, `BORE_SIDE` past its carriageway, of its line): it
 * follows the terrain, and held at the floor, the cell under the footway 1484690678, 5.5 m behind
 * the east mouth of the service tunnel 376037643 at Sarzana, dropped it 2.6 m, to 1.7 m over the
 * road in the bore. One beside the bore keeps nothing: the footway 1462688623, 3.7 m off the axis of
 * that tunnel, 1.9 m behind its west mouth, kept its cell and lifted the road out of it 1.4 m.
 */
export const mouthClaim = (
  p: Profile,
  k: number,
  step: 1 | -1,
  w: number,
  atGrade: (segment: number) => boolean,
  floor?: (sample: number) => number,
  footways?: (x: number, y: number, r: number) => ReadonlyArray<V>,
): Claim | undefined => {
  const out = stretch(p, k, step, MOUTH, atGrade)
  if (out.x.length === 1) return undefined
  const dx = out.x[1]! - out.x[0]!,
    dy = out.y[1]! - out.y[0]!,
    l = Math.hypot(dx, dy)
  const x = [...out.x],
    y = [...out.y],
    z = [...out.z]
  let writes: ((x: number, y: number) => boolean) | undefined
  if (floor !== undefined) {
    // Behind the mouth, along the bore, `back` m in: its points reversed before the mouth's, and on
    // straight at the level it reached where `p` ends short of that.
    const back = (GRID_CELL * (Math.abs(dx) + Math.abs(dy))) / l,
      into = stretch(p, k, step === 1 ? -1 : 1, back, () => true, floor)
    let reached = 0
    for (let i = 1; i < into.x.length; i++)
      reached += Math.hypot(into.x[i]! - into.x[i - 1]!, into.y[i]! - into.y[i - 1]!)
    if (back - reached > 1e-9) {
      into.x.push(into.x.at(-1)! - (dx / l) * (back - reached))
      into.y.push(into.y.at(-1)! - (dy / l) * (back - reached))
      into.z.push(into.z.at(-1)!)
    }
    x.unshift(...into.x.slice(1).reverse())
    y.unshift(...into.y.slice(1).reverse())
    z.unshift(...into.z.slice(1).reverse())
    // The footways' vertices behind the mouth over the bore, as far as a node it writes there
    // reaches their cells. The bore's line, not the approach's heading: the road out of that
    // tunnel's east mouth turns 55° off it.
    const behind = into.x.length - 1,
      reach = w / 2 + BORE_SIDE
    const overBore = (v: V) => {
      for (let i = 0; i < behind; i++)
        if (segDist2(v.x, v.y, x[i]!, y[i]!, x[i + 1]!, y[i + 1]!).d2 <= reach * reach) return true
      return false
    }
    const kept = (
      footways?.(out.x[0]!, out.y[0]!, back + GRID_CELL * Math.SQRT2 + coreHalf(w, GRID_CELL)) ?? []
    ).filter((v) => (v.x - out.x[0]!) * dx + (v.y - out.y[0]!) * dy < 0 && overBore(v))
    // Ahead of the mouth's face, across the bore's line there: the carriageway of a road turning
    // at the mouth reaches behind it, into the bank beside the bore, as its line leaves the mouth.
    const cells = carriagewayCells(out, w, into.x[0]! - into.x[1]!, into.y[0]! - into.y[1]!)
    writes = (px, py) =>
      cells(px, py) &&
      !kept.some((v) => Math.abs(v.x - px) < GRID_CELL && Math.abs(v.y - py) < GRID_CELL)
  }
  return {
    ...claimOf(
      { x, y, s: [], z: Float64Array.from(z), vertexSample: [] },
      () => w,
      MOUTH_RANK,
      0,
      () => false,
      writes,
    ),
    ahead: [out.x[0]!, out.y[0]!, dx, dy],
  }
}

/** The floor of the bore from sample `k0` to sample `k1` of `p` as shipped, by sample: straight from end to end. */
const boreFloor =
  (p: Profile, k0: number, k1: number) =>
  (k: number): number =>
    p.z[k0]! + ((p.z[k1]! - p.z[k0]!) * (p.s[k]! - p.s[k0]!)) / (p.s[k1]! - p.s[k0]!)

/**
 * A mouth along a chain's profile (`mouthsAlong`): its sample, the way out of the bore along the
 * profile, the approach's width and, for the chain's own bore, the samples of the bore's ends.
 */
export interface MouthEnd {
  readonly k: number
  readonly step: 1 | -1
  readonly w: number
  readonly bore?: readonly [number, number]
}

/**
 * The claims of the mouths along profile `p` (`mouthClaim`), the line at grade where `atGrade`
 * holds: each held behind at its bore's floor, straight from end to end (`boreFloor`), or, where
 * the chain ends at another chain's bore (no `bore`: its approach of another class, or one of the
 * roads at a junction at the mouth), at the mouth's level. The service tunnel 438625870 at Sarzana
 * opens onto the residential 438625873, whose pass is another, and the hill over its bore lifted
 * that road 4.6 m within 2 m of the mouth. Never over the mouth's level: a bore climbing in from a
 * mouth at the foot of its approach (the service 378473978 climbing out of the underpass 378473973
 * at Sarzana) held the corner 2.3 m behind it 0.4 m over the road there, and the mesh stood 0.12 m
 * through its ribbon.
 */
export const mouthsAlong = (
  p: Profile,
  ends: ReadonlyArray<MouthEnd>,
  atGrade: (segment: number) => boolean,
  footways?: (x: number, y: number, r: number) => ReadonlyArray<V>,
): Array<Claim> =>
  ends.flatMap(({ k, step, w, bore }) => {
    const along = bore === undefined ? () => p.z[k]! : boreFloor(p, ...bore)
    return mouthClaim(p, k, step, w, atGrade, (q) => Math.min(along(q), p.z[k]!), footways) ?? []
  })

/**
 * Where the road tunnels of `classes` among `roads` open: the node ids at an end of one of their
 * pieces that no other of them passes (`tunnelEnds` in profiles.ts's `makeProfiler`).
 */
export const boreEnds = (
  roads: ReadonlyArray<RoadF>,
  classes: ReadonlySet<string>,
): ReadonlySet<string> => {
  const bored = new Map<string, number>()
  for (const r of roads)
    if (r.tunnel === true && classes.has(r.cls))
      for (const v of r.pts) if (v.id !== undefined) bored.set(v.id, (bored.get(v.id) ?? 0) + 1)
  return new Set(
    roads.flatMap((r) =>
      r.tunnel === true && classes.has(r.cls)
        ? [r.pts[0]!.id, r.pts.at(-1)!.id].filter(
            (id): id is string => id !== undefined && bored.get(id) === 1,
          )
        : [],
    ),
  )
}

/** Side of the buckets `footwaysNear` holds the footways' vertices in, m. */
const FOOTWAY_BUCKET = 16

/**
 * The vertices of the paths and steps at grade among `roads` within `r` m of (x, y): what a mouth's
 * hold behind it leaves (`mouthClaim`).
 */
export const footwaysNear = (
  roads: ReadonlyArray<RoadF>,
): ((x: number, y: number, r: number) => Array<V>) => {
  const buckets = new Map<string, Array<V>>()
  const key = (i: number, j: number) => `${i},${j}`
  for (const r of roads)
    if ((r.cls === "path" || r.cls === "steps") && !lifted(r))
      for (const v of r.pts) {
        const k = key(Math.floor(v.x / FOOTWAY_BUCKET), Math.floor(v.y / FOOTWAY_BUCKET))
        const list = buckets.get(k)
        if (list === undefined) buckets.set(k, [v])
        else list.push(v)
      }
  return (x, y, r) => {
    const out: Array<V> = []
    for (
      let i = Math.floor((x - r) / FOOTWAY_BUCKET);
      i <= Math.floor((x + r) / FOOTWAY_BUCKET);
      i++
    )
      for (
        let j = Math.floor((y - r) / FOOTWAY_BUCKET);
        j <= Math.floor((y + r) / FOOTWAY_BUCKET);
        j++
      )
        for (const v of buckets.get(key(i, j)) ?? [])
          if (Math.hypot(v.x - x, v.y - y) <= r) out.push(v)
    return out
  }
}

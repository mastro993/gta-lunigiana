// Road and rail elevations for the map build: pieces chained through shared end nodes (bridges
// and tunnels included), smoothed, grade-fitted through junction and crossing pins, then written
// into the terrain grid (except under bridges and tunnels).
import type { RoadClass } from "../sim/map/kinds.ts"
import { arcLengths, type V } from "./geometry.ts"
import { type Graded, junctionReach } from "./junction-reach.ts"
import {
  fitProfile,
  flatten,
  GRID_CELL,
  keepSamples,
  resample,
  smooth,
  type Grid,
  type Pin,
  type Profile,
} from "./terrain.ts"

export interface Linear {
  readonly pts: ReadonlyArray<V>
  readonly bridge?: true
  readonly tunnel?: true
}
export const lifted = (l: Linear): boolean => l.bridge === true || l.tunnel === true

/** A chain member; `rev` = walked from its last vertex to its first. */
interface Link<T> {
  readonly item: T
  readonly rev: boolean
}

/** Pieces joined into chains through nodes where exactly two piece ends meet; longest chain first. */
export const chainsOf = <T extends Linear>(items: ReadonlyArray<T>): Array<Array<Link<T>>> => {
  const ends = new Map<string, Array<number>>()
  items.forEach((t, i) => {
    for (const v of [t.pts[0]!, t.pts.at(-1)!])
      if (v.id !== undefined) ends.set(v.id, [...(ends.get(v.id) ?? []), i])
  })
  const through = (id: string | undefined) => id !== undefined && ends.get(id)!.length === 2
  const used = new Uint8Array(items.length)
  const walk = (start: number, rev: boolean): Array<Link<T>> => {
    const chain: Array<Link<T>> = []
    for (let i = start, r = rev; ;) {
      used[i] = 1
      chain.push({ item: items[i]!, rev: r })
      const tail = r ? items[i]!.pts[0]!.id : items[i]!.pts.at(-1)!.id
      const j = through(tail) ? ends.get(tail!)!.find((n) => n !== i) : undefined
      if (j === undefined || used[j] === 1) return chain
      r = items[j]!.pts[0]!.id !== tail
      i = j
    }
  }
  const chains: Array<Array<Link<T>>> = []
  items.forEach((t, i) => {
    if (used[i] === 1) return
    if (!through(t.pts[0]!.id)) chains.push(walk(i, false))
    else if (!through(t.pts.at(-1)!.id)) chains.push(walk(i, true))
  })
  items.forEach((_, i) => {
    if (used[i] === 0) chains.push(walk(i, false)) // closed loops
  })
  const length = (c: ReadonlyArray<Link<T>>) =>
    c.reduce((s, { item }) => s + arcLengths(item.pts).at(-1)!, 0)
  return chains
    .map((c) => [c, length(c)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
}

/**
 * Half-width (m) of the core a line `w` m wide writes into a grid of `cell` m: half a cell past
 * the carriageway's edge, so the terrain under it is (nearly) level across it.
 */
export const coreHalf = (w: number, cell: number): number => Math.max(w / 2 + 0.3 + cell / 2, 3)

/** A bridge's or tunnel's end may take the elevation of the ground this far (m) out of it along the chain. */
const PORTAL = 4

/**
 * How far (m) along its approach a road tunnel's mouth holds the grid (`mouths` in `Spec`): a cell's
 * diagonal, the farthest a corner of the cell holding the mouth lies from it.
 */
const MOUTH = GRID_CELL * Math.SQRT2

/** An elevation at a point of a chain (nearest sample); `min`/`max` only bind when the fit crosses them. */
export interface Bound {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly kind?: "min" | "max"
  /**
   * The piece of the chain it holds on, its nearest sample: where a chain crosses itself, the
   * nearest of all is as likely on the other level (the SR445's loop under its own bridge at
   * Gassano took the bridge's bound).
   */
  readonly on?: Linear
  /**
   * Inside a bridge or tunnel, carry the bound to each end along the deck's slope (the profile's
   * line between its ends before the fit) rather than pin both ends at `z`: the straight deck still
   * keeps it where it applies, and a climbing tunnel's far portal stays at its level (pinned flat,
   * a road over a 3% motorway tunnel 50 m from its low portal sank the high one 10.5 m underground).
   */
  readonly tilt?: true
}

/**
 * The road passes after the rail's, in order: the classes each profiles, their rank (lower keeps a
 * grid cell where two cores meet), grade limit and smoothing half-window (m). Motorways and trunk
 * roads come first and keep their cells against every road and the rail (rank 0), with a gentle
 * grade and the rail's long smoothing; primary and secondary share tertiary's pass and rank, so the
 * SR445 keeps the profile it had as a tertiary road. Paths and steps are not profiled: they follow
 * the terrain.
 */
export const ROAD_PASSES = [
  { classes: ["motorway", "trunk"], rank: 0, grade: 0.06, half: 100 },
  { classes: ["primary", "secondary", "tertiary"], rank: 1, grade: 0.1, half: 20 },
  { classes: ["unclassified", "residential"], rank: 3, grade: 0.15, half: 20 },
  { classes: ["service", "track"], rank: 4, grade: 0.2, half: 20 },
] as const satisfies ReadonlyArray<{
  readonly classes: ReadonlyArray<Exclude<RoadClass, "path" | "steps">>
  readonly rank: number
  readonly grade: number
  readonly half: number
}>

/** The rail's pass, before every road's: its rank (it keeps its cells against all but the main roads), grade limit and smoothing half-window (m). */
export const RAIL_PASS = { rank: 2, grade: 0.025, half: 100 } as const

/** Rank of the tracks only the CTR has: written after every road, into the cells no road took. */
export const EXTRA_RANK = 5

/** The ranks the road passes write: a grid cell one of them owns is a road's core. */
export const ROAD_RANKS: ReadonlySet<number> = new Set(ROAD_PASSES.map((p) => p.rank))

/** Whether a road of `cls` keeps the grid cells under its core against the rail (its rank is lower). */
export const beatsRail = (cls: string): boolean =>
  ROAD_PASSES.some(
    (p) => p.rank < RAIL_PASS.rank && (p.classes as ReadonlyArray<string>).includes(cls),
  )

/**
 * Road core half-width written into the grid, rank (lower wins at junctions), grade limit,
 * smoothing half-window (m), the elevation tolerance (m) of the bend samples kept in the output,
 * whether consecutive bridge (or tunnel) pieces make one deck, straight from end to end, and whether
 * each junction the fit sets keeps within reach of the junctions already set that a road not yet
 * fitted leads it to (`junctionReach`): the roads'. The rail keeps a deck a piece: its 2.5 % grade
 * and 100 m smoothing hold a joint to the line between its deck's ends, and its platforms and
 * crossings are fitted on that profile. It keeps its own grade at a level crossing too: the road
 * meets it there. With `mouths` (the roads'), a tunnel's approaches hold the grid round each of its
 * mouths at their level against every other claim: the first MOUTH m out of it, in their core,
 * before anything else is written. A road over the tunnel or beside the mouth took that cell at its
 * own level otherwise: Via della Stazione, a tertiary road over Pieve San Lorenzo's underpass 4.5 m
 * from its south mouth, buried that mouth 5.8 m. The rail's portals open in their hills, and its
 * bridges over an underpass's mouth (`underpasses` in rail-spans.ts) write nothing there.
 */
interface Spec {
  readonly w: number
  readonly rank: number
  readonly grade: number
  readonly half: number
  readonly tol?: number
  readonly decks?: true
  readonly mouths?: true
  readonly reach?: true
}

/** A piece as written to the map: its OSM vertices plus the profile samples where the elevation bends between them. */
interface Dense {
  readonly pts: ReadonlyArray<V>
  readonly z: ReadonlyArray<number>
}

/** Elevations set at shared nodes, and the ids in the order they were first set (what `grown` reads). */
class NodeZ extends Map<string, number> {
  readonly order: Array<string> = []
  override set(id: string, z: number): this {
    if (!this.has(id)) this.order.push(id)
    return super.set(id, z)
  }
}

/** A binary min-heap of integers. */
const minHeap = () => {
  const items: Array<number> = []
  return {
    push(n: number) {
      let k = items.length
      items.push(n)
      while (k > 0) {
        const up = (k - 1) >> 1
        if (items[up]! <= n) break
        items[k] = items[up]!
        k = up
      }
      items[k] = n
    },
    /** The least item, removed; undefined when empty. */
    pop(): number | undefined {
      const top = items[0],
        last = items.pop()
      if (last === undefined || items.length === 0) return top
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        if (l >= items.length) break
        const m = l + 1 < items.length && items[l + 1]! < items[l]! ? l + 1 : l
        if (items[m]! >= last) break
        items[k] = items[m]!
        k = m
      }
      items[k] = last
      return top
    },
  }
}

/**
 * A profile to write into the grid (`flatten`): its core half-width, rank, and the samples whose
 * segment writes nothing (bridges, tunnels).
 */
export interface Claim {
  readonly p: Profile
  readonly core: number
  /** Metres its writes reach past its core, blending back to the terrain. */
  readonly blend: number
  /** A point and a direction (x, y, dx, dy): it writes only the nodes abeam or ahead of the point (a mouth's claim, out of its tunnel). */
  readonly ahead?: readonly [number, number, number, number]
  readonly rank: number
  readonly skip: Uint8Array
  /** The box its writes reach: [minX, minY, maxX, maxY]. */
  readonly box: readonly [number, number, number, number]
}

/** Metres a claim's writes reach past its core: the blend back to the terrain. */
const BLEND = 8

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
  for (const { p, core, blend, ahead, rank, skip, box } of claims)
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
          ? undefined
          : (x, y) => (x - ahead[0]) * ahead[2] + (y - ahead[1]) * ahead[3] >= 0,
      )
}

/**
 * Profiles chains against `ground` (the uncarved terrain) and records the claims they make on the
 * grid, in order (`replayClaims` writes them). Elevations set at shared nodes (`nodeZ`) pin every
 * later chain through them; `zOf` holds per-vertex z and `denseOf` the output polyline. `links` are
 * the roads a chain's junctions keep within reach of (`Spec.reach`).
 */
export const makeProfiler = (
  ground: (x: number, y: number) => number,
  links: ReadonlyArray<Graded> = [],
) => {
  const nodeZ = new NodeZ()
  const zOf = new Map<Linear, Array<number>>()
  const denseOf = new Map<Linear, Dense>()
  /** The claims in the order they are written: the tunnels' mouths first, then the rest as made. */
  const claims: Array<Claim> = []
  const junctions = junctionReach(links, ground)
  let mouthClaims = 0
  /** A claim along profile `p` of a line `w` m wide at `rank`, blending `blend` m, but for segments from samples where `skip`. */
  const claimOf = (
    p: Profile,
    w: number,
    rank: number,
    blend: number,
    skip: (k: number) => boolean,
  ): Claim => {
    const core = coreHalf(w, GRID_CELL),
      reach = core + blend
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (let k = 0; k < p.x.length; k++) {
      minX = Math.min(minX, p.x[k]! - reach)
      minY = Math.min(minY, p.y[k]! - reach)
      maxX = Math.max(maxX, p.x[k]! + reach)
      maxY = Math.max(maxY, p.y[k]! + reach)
    }
    return {
      p,
      core,
      blend,
      rank,
      skip: Uint8Array.from({ length: Math.max(0, p.z.length - 1) }, (_, k) => (skip(k) ? 1 : 0)),
      box: [minX, minY, maxX, maxY],
    }
  }
  /** Claims the grid along profile `p` of a line `w` m wide at `rank`, but for segments from samples where `skip`. */
  const claim = (p: Profile, w: number, rank: number, skip: (k: number) => boolean) => {
    claims.push(claimOf(p, w, rank, BLEND, skip))
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
  const profile = <T extends Linear>(
    chain: ReadonlyArray<Link<T>>,
    spec: Spec,
    bounds: ReadonlyArray<Bound> = [],
  ): void => {
    const runs = chain.map(({ item, rev }) => (rev ? [...item.pts].reverse() : [...item.pts]))
    const pts = runs.flatMap((r, i) => (i === 0 ? r : r.slice(1)))
    const first: Array<number> = []
    for (let i = 0, v = 0; i < runs.length; v += runs[i]!.length - 1, i++) first.push(v)
    const p = resample(pts, 4, ground)
    const pieceOfSample = (k: number) => {
      let i = runs.length - 1
      while (i > 0 && p.vertexSample[first[i]!]! > k) i--
      return i
    }
    const isLifted = (i: number) => lifted(chain[i]!.item)
    const isTunnel = (i: number) => chain[i]!.item.tunnel === true
    // A deck: the consecutive lifted pieces of one kind round piece i, first and last, straight from
    // end to end. OSM splits a bridge or a bore where its tags change: taken piece by piece, the
    // joint of the SS63's two-piece bridge over the Rosaro at Soliera fell toward the ground 12 m
    // under it (4.9 m), and the joint inside the Galleria del Lupacino, at its speed limit, took the
    // hill's surface over it. A tunnel's pieces always join; a bridge's only on a profile whose spec
    // asks for it (`decks`, the roads': the rail keeps a deck a piece, as the CTR draws its spans).
    const deckOf = (i: number): readonly [number, number] => {
      let a = i,
        b = i
      const joins = (k: number) =>
        isLifted(k) && isTunnel(k) === isTunnel(i) && (isTunnel(i) || spec.decks === true)
      while (a > 0 && joins(a - 1)) a--
      while (b + 1 < runs.length && joins(b + 1)) b++
      return [a, b]
    }
    /** The first and last vertex of deck `[a, b]`, as indices into `pts`. */
    const deckEnds = ([a, b]: readonly [number, number]) =>
      [first[a]!, first[b]! + runs[b]!.length - 1] as const
    for (let i = 0; i < runs.length; i++) {
      if (!isLifted(i)) continue
      const [i0, i1] = deckOf(i)
      i = i1
      const [k0, k1] = deckEnds([i0, i1]).map((v) => p.vertexSample[v]!) as [number, number]
      // Each end takes the ground PORTAL m out of it when that is nearer the line's level: at a
      // tunnel's portal the terrain model climbs the hill's face (3.6 m over the cutting at the
      // Ugliancaldo tunnel's west portal), and a bridge's end may stand on the slope of what it
      // spans (the Lucido's banks at Monzone).
      const tunnel = isTunnel(i0)
      for (const [k, step] of [
        [k0, -1],
        [k1, 1],
      ] as const) {
        let o = k
        while (o + step >= 0 && o + step < p.z.length && Math.abs(p.s[o]! - p.s[k]!) < PORTAL)
          o += step
        if (o !== k && Math.abs(p.s[o]! - p.s[k]!) >= PORTAL)
          p.z[k] = tunnel ? Math.min(p.z[k]!, p.z[o]!) : Math.max(p.z[k]!, p.z[o]!)
      }
      // An end the play area's outline cut (the chain's own end, with no id: `clipPieces` gives a
      // cut point none) is no portal or abutment: the ground there is the hill over the tunnel or
      // the valley under the bridge, so it takes its other end's level. The Galleria del Lupacino,
      // cut 1325 m in at x 6700, fell 3.7% from the hill's 528 m there to its portal at 357 m.
      const cut0 = i0 === 0 && runs[i0]![0]!.id === undefined,
        cut1 = i1 === runs.length - 1 && runs[i1]!.at(-1)!.id === undefined
      if (cut0 && !cut1) p.z[k0] = p.z[k1]!
      if (cut1 && !cut0) p.z[k1] = p.z[k0]!
      for (let k = k0 + 1; k < k1; k++)
        p.z[k] = p.z[k0]! + ((p.z[k1]! - p.z[k0]!) * (p.s[k]! - p.s[k0]!)) / (p.s[k1]! - p.s[k0]!)
    }
    smooth(p, spec.half)
    const pins: Array<Pin> = []
    pts.forEach((v, i) => {
      const z = v.id === undefined ? undefined : nodeZ.get(v.id)
      if (z !== undefined) pins.push({ k: p.vertexSample[i]!, z })
    })
    // Bounds of a kind on one sample (a deck's end, under several crossings) keep the strictest: the
    // fit enforces one bound per sample.
    const strictest = new Map<string, Pin>()
    const keep = (k: number, z: number, kind: "min" | "max") => {
      const key = `${kind}:${k}`,
        was = strictest.get(key)
      if (was === undefined || (kind === "min" ? z > was.z : z < was.z))
        strictest.set(key, { k, z, kind })
    }
    // A junction this fit sets keeps within reach of those set before, along the roads fitted after
    // it, at its own vertex.
    if (spec.reach === true) {
      const members = new Set<Linear>(chain.map((m) => m.item))
      const open = (l: Linear) => !zOf.has(l) && !members.has(l)
      pts.forEach((v, i) => {
        const r =
          v.id === undefined || nodeZ.has(v.id)
            ? undefined
            : junctions(v.id, (n) => nodeZ.get(n), open)
        if (r === undefined) return
        keep(p.vertexSample[i]!, r[0], "min")
        keep(p.vertexSample[i]!, r[1], "max")
      })
    }
    // A bound inside a bridge or tunnel holds at both ends of its deck, straight between them (a
    // `tilt` bound, shifted along the deck's slope).
    for (const b of bounds) {
      // The samples it may take: its own piece's, from its first vertex to its last.
      const on = b.on === undefined ? -1 : chain.findIndex((m) => m.item === b.on)
      const from = on < 0 ? 0 : p.vertexSample[first[on]!]!,
        to = on < 0 ? p.z.length - 1 : p.vertexSample[first[on]! + runs[on]!.length - 1]!
      let best = from,
        d2 = Number.MAX_VALUE
      for (let k = from; k <= to; k++) {
        const e = (p.x[k]! - b.x) ** 2 + (p.y[k]! - b.y) ** 2
        if (e < d2) [best, d2] = [k, e]
      }
      const i = pieceOfSample(Math.min(best, p.z.length - 2))
      const at = isLifted(i) ? deckEnds(deckOf(i)).map((v) => p.vertexSample[v]!) : [best]
      const [k0, k1] = [at[0]!, at.at(-1)!],
        t = k1 === k0 ? 0 : (p.s[best]! - p.s[k0]!) / (p.s[k1]! - p.s[k0]!),
        deck = p.z[k0]! + (p.z[k1]! - p.z[k0]!) * t
      for (const k of at) {
        const z = b.tilt === true ? b.z + p.z[k]! - deck : b.z
        if (b.kind === undefined) pins.push({ k, z })
        else keep(k, z, b.kind)
      }
    }
    pins.push(...strictest.values())
    fitProfile(p, spec.grade, pins)
    // A sample's segment belongs to the piece whose first vertex precedes it; the last sample closes the last piece.
    // The core reaches half a cell past the carriageway's edge, so the terrain under the carriageway is (nearly) level across it.
    claim(p, spec.w, spec.rank, (k) => isLifted(pieceOfSample(k)))
    // A tunnel's mouths, with `mouths`: each approach's first MOUTH m, in its core ahead of the
    // mouth alone (the road over the tunnel keeps its cells), at MOUTH_RANK, written first. An end
    // the outline cut is no mouth.
    if (spec.mouths === true)
      for (let i = 0; i < runs.length; i++) {
        if (!isTunnel(i)) continue
        const [i0, i1] = deckOf(i)
        i = i1
        const [v0, v1] = deckEnds([i0, i1])
        for (const [v, step] of [
          [v0, -1],
          [v1, 1],
        ] as const) {
          if (pts[v]!.id === undefined) continue
          const out = approach(p, p.vertexSample[v]!, step, (k) => !isLifted(pieceOfSample(k)))
          if (out === undefined) continue
          const ahead = [
            out.x[0]!,
            out.y[0]!,
            out.x[1]! - out.x[0]!,
            out.y[1]! - out.y[0]!,
          ] as const
          claims.splice(mouthClaims++, 0, {
            ...claimOf(out, spec.w, MOUTH_RANK, 0, () => false),
            ahead,
          })
        }
      }
    runs.forEach((r, i) => {
      const z = r.map((_, j) => p.z[p.vertexSample[first[i]! + j]!]!)
      if (isLifted(i)) {
        const [v0, v1] = deckEnds(deckOf(i)),
          s = arcLengths(pts.slice(v0, v1 + 1)),
          z0 = p.z[p.vertexSample[v0]!]!,
          z1 = p.z[p.vertexSample[v1]!]!
        for (let j = 0; j < z.length; j++) {
          const v = first[i]! + j
          if (v > v0 && v < v1) z[j] = z0 + ((z1 - z0) * s[v - v0]!) / s.at(-1)!
        }
      }
      r.forEach((v, j) => {
        if (v.id !== undefined && !nodeZ.has(v.id)) nodeZ.set(v.id, z[j]!)
      })
      const vks = r.map((_, j) => p.vertexSample[first[i]! + j]!)
      const ks = isLifted(i) ? vks : keepSamples(p, vks, spec.tol)
      const vertexAt = new Map(vks.map((k, j) => [k, j]))
      const dense = ks.map((k) =>
        vertexAt.has(k)
          ? { v: r[vertexAt.get(k)!]!, z: z[vertexAt.get(k)!]! }
          : { v: { x: p.x[k]!, y: p.y[k]! }, z: p.z[k]! },
      )
      if (chain[i]!.rev) dense.reverse()
      denseOf.set(chain[i]!.item, { pts: dense.map((d) => d.v), z: dense.map((d) => d.z) })
      zOf.set(chain[i]!.item, chain[i]!.rev ? z.reverse() : z)
    })
  }
  /**
   * Chains in profiling order: next the longest one touching a node an earlier chain set, else the
   * longest left. Elevations spread along the network from where it is already pinned, so a short
   * link is not pinned at both ends by chains fitted apart (a lane between two levels would get a
   * straight line far over its grade limit).
   */
  function* grown<T extends Linear>(
    chains: ReadonlyArray<ReadonlyArray<Link<T>>>,
  ): Generator<ReadonlyArray<Link<T>>> {
    // The chains through each node id; a chain touches once any of its ids is set, and stays so.
    const through = new Map<string, Array<number>>()
    chains.forEach((c, i) => {
      for (const { item } of c)
        for (const v of item.pts) {
          if (v.id === undefined) continue
          const list = through.get(v.id)
          if (list === undefined) through.set(v.id, [i])
          else if (list.at(-1) !== i) list.push(i)
        }
    })
    const used = new Uint8Array(chains.length),
      touching = new Uint8Array(chains.length),
      ready = minHeap()
    let seen = 0,
      first = 0
    for (let n = 0; n < chains.length; n++) {
      // The elevations set since the last chain (by it, or between passes) make more chains touch.
      for (; seen < nodeZ.order.length; seen++)
        for (const i of through.get(nodeZ.order[seen]!) ?? [])
          if (touching[i] === 0) {
            touching[i] = 1
            ready.push(i)
          }
      let next = ready.pop()
      while (next !== undefined && used[next] === 1) next = ready.pop()
      if (next === undefined) {
        while (used[first] === 1) first++
        next = first
      }
      used[next] = 1
      yield chains[next]!
    }
  }
  return { profile, claim, claims, grown, nodeZ, zOf, denseOf }
}

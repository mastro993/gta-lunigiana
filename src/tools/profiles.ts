// Road and rail elevations for the map build: pieces chained through shared end nodes (bridges
// and tunnels included), smoothed, grade-fitted through junction and crossing pins, then written
// into the terrain grid (except under bridges and tunnels).
import type { RoadClass } from "../sim/map/kinds.ts"
import { lifted, type Linear, type Link } from "./chains.ts"
import { along, arcLengths, type V } from "./geometry.ts"
import { BLEND, type Claim, claimOf, type MouthEnd, mouthsAlong } from "./grid-claims.ts"
import { type Graded, junctionReach } from "./junction-reach.ts"
import { deckKnots, type Here, laidOut, levelLifted, onKnots } from "./lifted-runs.ts"
import {
  fitProfile,
  keepSamples,
  RELAX,
  resample,
  smooth,
  type Pin,
  type Profile,
} from "./profile-fit.ts"

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
  /**
   * Inside a bridge or tunnel, hold at its own sample, as `Spec.ramps` holds every bound: a bound
   * read off another straight deck all along this one (a twin track's, `rail-twins.ts`) holds its
   * ends and its line between them alike.
   */
  readonly here?: true
}

/**
 * The road passes after the rail's, in order: the classes each profiles, their rank (lower keeps a
 * grid cell where two cores meet), grade limit, smoothing half-window (m), and how far its fit may
 * raise its grade limit to stay near the ground (`relax`). Motorways and trunk roads come first and
 * keep their cells against every road and the rail (rank 0), with a gentle grade and the rail's
 * long smoothing, and never steeper, as on an embankment: the A15's Parma carriageway at Calcinara,
 * at grade over a dip the survey reads 13 m under its twin 12 m beside it, relaxed to 8.5% over 8
 * m and 6.7% over 100 m into it and out. Primary and secondary share tertiary's pass and rank, so the
 * SR445 keeps the profile it had as a tertiary road. Paths and steps at grade are not profiled: they
 * follow the terrain (their bridges and tunnels are, after every road: PATH_PASS).
 */
export const ROAD_PASSES = [
  { classes: ["motorway", "trunk"], rank: 0, grade: 0.06, half: 100, relax: 1 },
  { classes: ["primary", "secondary", "tertiary"], rank: 1, grade: 0.1, half: 20, relax: RELAX },
  { classes: ["unclassified", "residential"], rank: 3, grade: 0.15, half: 20, relax: RELAX },
  { classes: ["service", "track"], rank: 4, grade: 0.2, half: 20, relax: RELAX },
] as const satisfies ReadonlyArray<{
  readonly classes: ReadonlyArray<Exclude<RoadClass, "path" | "steps">>
  readonly rank: number
  readonly grade: number
  readonly half: number
  readonly relax: number
}>

/**
 * The paths' and steps' pass, after every road's: their bridges and tunnels alone, each chain of them
 * from the levels set at its ends (`ends` in build-terrain.ts: none where a path or steps at grade
 * leads on, its approach, which then meets it) over or under the ways it crosses
 * (road-levels.ts), fitted sample by sample (`ramps`) at the steepest road's grade limit (service
 * and track's), raised as theirs where the fit strays from the ground, and straight between two pins
 * it cannot meet within it (a stair). Unsmoothed: before the fit a deck is the line between its ends.
 * Their decks write no cell; the paths and steps at grade leading from them (path-approaches.ts)
 * write theirs at its rank, under every other claim.
 */
export const PATH_PASS = { classes: ["path", "steps"], rank: 6, grade: 0.2, half: 0 } as const

/**
 * Ground falling away from a rail tunnel's mouth along the line more steeply than this (per metre)
 * is the hill's face over its cutting (`Spec.faces`): the steepest grade limit of any pass, the
 * service and track roads' and the paths' 20%.
 */
const FACE = Math.max(PATH_PASS.grade, ...ROAD_PASSES.map((p) => p.grade))

/**
 * The rail's pass, before every road's: its rank (it keeps its cells against all but the main
 * roads), grade limit and smoothing half-window (m), and its tunnels' mouths at the foot of the
 * hill's face (`Spec.faces`).
 */
export const RAIL_PASS = { rank: 2, grade: 0.025, half: 100, faces: true } as const

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
 * The carriageway width each piece is cored at, rank (lower wins at junctions), grade limit,
 * smoothing half-window (m), the elevation tolerance (m) of the bend samples kept in the output,
 * and whether each junction the fit sets keeps within reach of the junctions already set that a
 * road not yet fitted leads it to (`junctionReach`): the roads'. Consecutive bridge (or tunnel)
 * pieces make one deck, straight from end to end, the rail's as the roads', but where it keeps to a
 * twin track (`deckKnots` in lifted-runs.ts). The rail keeps its own
 * grade at a level crossing: the road meets it there. With `mouths` (the roads'), a tunnel's approaches hold the grid round each of its
 * mouths at their level against every other claim: the first MOUTH m out of it, in their core, and
 * the corners behind the mouth of the cells their carriageway runs in ahead of its face
 * (`mouthsAlong`), before anything else is written. A road over the tunnel or beside the mouth took that cell at its
 * own level otherwise: Via della Stazione, a tertiary road over Pieve San Lorenzo's underpass 4.5 m
 * from its south mouth, buried that mouth 5.8 m. The rail's portals open in their hills, and its
 * bridges over an underpass's mouth (`underpasses` in rail-spans.ts) write nothing there. With
 * `start`, the chain runs on from a level already set at its first vertex, which has no id: a line's
 * terminal, its run-out walking on beyond the play area (rail-runouts.ts). Its first sample takes
 * that level, pinned, and its first vertex is no cut, so a bore or a deck from there keeps the level
 * to where the box cuts it. With `writes`, its claims write only the nodes where it holds (a
 * run-out's: those beyond the play area, which keeps what its own lines wrote). With `ramps` (the
 * paths' and steps' decks), its bridges and tunnels are fitted sample by sample, as a road at grade
 * is, from their ends' levels (`ends`, pinned at the chain's ends that have an id and a level), rather than
 * straight from end to end: a footbridge rises over what it crosses and an underpass dips under it
 * between their ends, and a bound in either holds at its own sample. With `inside` (the rail's), a
 * chain's end inside a bore or on a deck runs its deck level from the chains before it.
 */
interface Spec<T extends Linear> {
  /**
   * The carriageway's width, m: one for every piece (the rail's 4 m), or each piece's own (a road's
   * `w`). A piece is cored at its own, never a wider piece's elsewhere on the chain: cored at its
   * chain's widest, Fosdinovo's 8.4 m tertiary joined onto the Strada comunale per Campo Cecina's
   * chain widened its core as far as x −592, 3.9 km east of the joint.
   */
  readonly w: number | ((piece: T) => number)
  readonly rank: number
  readonly grade: number
  readonly half: number
  /** How far the fit may raise `grade` to stay near the ground (`fitProfile`): RELAX when unset. */
  readonly relax?: number
  readonly tol?: number
  readonly mouths?: true
  readonly reach?: true
  readonly start?: number
  readonly writes?: (x: number, y: number) => boolean
  readonly ramps?: true
  /** The level a chain's end `v` (of `piece`) is pinned at; undefined leaves it to the fit. */
  readonly ends?: (v: V, piece: T) => number | undefined
  /** Whether node `id` lies inside a bore or on a deck (`insideNodes`): a chain's end there is no portal or abutment. */
  readonly inside?: (id: string) => boolean
  /**
   * Whether a tunnel's mouth takes the ground at the foot of the hill's face (`FACE`), the rail's:
   * ground falling 20% a metre along a line whose grade limit is 2.5% can only be a face over its
   * cutting, but along a road's it may be the valley's side under a bench its OSM line misses. The
   * SR445's east mouth by Groppoli, its line's ground falling on past the foot, sank 7.7 m into a V,
   * its approach falling 14.8% into it; no gully's guard (`levelLifted`) holds that.
   */
  readonly faces?: true
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
 * Profiles chains against `ground` (the uncarved terrain) and records the claims they make on the
 * grid, in order (`replayClaims` writes them). Elevations set at shared nodes (`nodeZ`) pin every
 * later chain through them; `zOf` holds per-vertex z and `denseOf` the output polyline. `links` are
 * the roads a chain's junctions keep within reach of (`Spec.reach`); `bridgeEnds` the node ids where a
 * bridge's deck ends, past which a chain ending there runs on under it (`deckEnd` in `flatten`);
 * `tunnelEnds` those where a road tunnel's bore opens (an end of a road's tunnel piece no other one
 * goes on from), where a chain ending there at grade, with `Spec.mouths`, holds its mouth; and
 * `footways` the vertices of the paths and steps at grade within a distance of a point, whose cells
 * a mouth's hold behind it leaves (`mouthClaim`).
 */
export const makeProfiler = (
  ground: (x: number, y: number) => number,
  links: ReadonlyArray<Graded> = [],
  bridgeEnds: ReadonlySet<string> = new Set(),
  tunnelEnds: ReadonlySet<string> = new Set(),
  footways?: (x: number, y: number, r: number) => ReadonlyArray<V>,
) => {
  const nodeZ = new NodeZ()
  const zOf = new Map<Linear, Array<number>>()
  const denseOf = new Map<Linear, Dense>()
  /** The claims in the order they are written: the tunnels' mouths first, then the rest as made. */
  const claims: Array<Claim> = []
  const junctions = junctionReach(links, ground)
  let mouthClaims = 0
  /** Claims the grid along profile `p` of a line `w` m wide at `rank`, but for segments from samples where `skip`. */
  const claim = (p: Profile, w: number, rank: number, skip: (k: number) => boolean) => {
    claims.push(claimOf(p, () => w, rank, BLEND, skip))
  }
  /** Records a tunnel mouth's claim (`mouthClaim`): after the mouths before it, ahead of every other claim. */
  const mouth = (c: Claim) => {
    claims.splice(mouthClaims++, 0, c)
  }
  const profile = <T extends Linear>(
    chain: ReadonlyArray<Link<T>>,
    spec: Spec<T>,
    bounds: ReadonlyArray<Bound> = [],
  ): void => {
    /** Piece i's carriageway width (`Spec.w`). */
    const widthOf = (i: number) => (typeof spec.w === "number" ? spec.w : spec.w(chain[i]!.item))
    const runs = chain.map(({ item, rev }) => (rev ? [...item.pts].reverse() : [...item.pts]))
    const pts = runs.flatMap((r, i) => (i === 0 ? r : r.slice(1)))
    const first: Array<number> = []
    for (let i = 0, v = 0; i < runs.length; v += runs[i]!.length - 1, i++) first.push(v)
    const p = resample(pts, 4, ground)
    if (spec.start !== undefined) p.z[0] = spec.start
    const laid = laidOut(
      p,
      runs,
      first,
      (i) => lifted(chain[i]!.item),
      (i) => chain[i]!.item.tunnel === true,
    )
    const { pieceOfSample, isLifted, isTunnel, deckOf, deckEnds } = laid
    // With `ends`, the chain's ends that have an id and a level there take it, pinned, before its
    // decks are drawn between them.
    const endPins: Array<Pin> = []
    if (spec.ends !== undefined)
      for (const [v, k, i] of [
        [pts[0]!, 0, 0],
        [pts.at(-1)!, p.z.length - 1, runs.length - 1],
      ] as const) {
        const z = v.id === undefined ? undefined : spec.ends(v, chain[i]!.item)
        if (z === undefined) continue
        p.z[k] = z
        endPins.push({ k, z })
      }
    // Before the fit, the bridges and tunnels take their ends' levels and run straight between them.
    levelLifted(
      laid,
      {
        ...(spec.faces === true ? { face: FACE } : {}),
        half: spec.half,
        start: spec.start !== undefined,
        ...(spec.inside === undefined ? {} : { inside: spec.inside }),
      },
      nodeZ,
    )
    smooth(p, spec.half)
    const pins: Array<Pin> = [
      ...endPins,
      ...(spec.start === undefined ? [] : [{ k: 0, z: spec.start }]),
    ]
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
    // `tilt` bound, shifted along the deck's slope); with `ramps`, or a `here` bound, at its own sample.
    // A bound at a deck's end holds there alone: the straight deck keeps it, and carried to the other
    // end along the slope before the fit it held that end too (the A15's road-levels twin bounds at a
    // deck's ends, each from its twin's level there, would have bound each end twice).
    /** The `here` bounds inside a straight deck, by the deck's first piece: what `bent` reads. */
    const heres: Array<Here> = []
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
      const ends =
        isLifted(i) && spec.ramps !== true && b.here !== true
          ? deckEnds(deckOf(i)).map((v) => p.vertexSample[v]!)
          : [best]
      const at = ends.includes(best) ? [best] : ends
      const [k0, k1] = [at[0]!, at.at(-1)!],
        t = k1 === k0 ? 0 : (p.s[best]! - p.s[k0]!) / (p.s[k1]! - p.s[k0]!),
        deck = p.z[k0]! + (p.z[k1]! - p.z[k0]!) * t
      for (const k of at) {
        const z = b.tilt === true ? b.z + p.z[k]! - deck : b.z
        if (b.kind === undefined) pins.push({ k, z })
        else keep(k, z, b.kind)
      }
      if (b.here === true && isLifted(i) && spec.ramps !== true)
        heres.push({ deck: deckOf(i)[0], pin: { k: best, z: b.z, kind: b.kind } })
    }
    pins.push(...strictest.values())
    fitProfile(p, spec.grade, pins, spec.relax)
    // A deck ships straight between its ends, but bent where that line breaks a `here` bound inside
    // it (`deckKnots`).
    const knots = deckKnots(laid, heres, spec.tol ?? 0)
    // With `ramps`, a bridge's deck spans between its humps: each sample of it as high as the lower
    // of the highest before it and the highest after it on the deck, a fill that keeps the fit's
    // grades, so a footbridge over two ways bridges between them rather than dipping to the ground.
    // Fitted sample by sample, the coast's 153 m cycle footbridge 522153380 fell from 7.7 m over a
    // driveway to 1.8 m and climbed back to 6.1 m over a footway, at 25–30%. A bore dips under what
    // it passes, and a deck held under a way over it (a `max` bound inside it) keeps its dip there.
    if (spec.ramps === true)
      for (let i = 0; i < runs.length; i++) {
        if (!isLifted(i)) continue
        const [i0, i1] = deckOf(i)
        i = i1
        const [k0, k1] = deckEnds([i0, i1]).map((v) => p.vertexSample[v]!) as [number, number]
        if (isTunnel(i0) || pins.some((q) => q.kind === "max" && q.k > k0 && q.k < k1)) continue
        const after = Float64Array.from({ length: k1 - k0 + 1 }, (_, o) => p.z[k0 + o]!)
        for (let o = after.length - 2; o >= 0; o--) after[o] = Math.max(after[o]!, after[o + 1]!)
        for (let k = k0 + 1, before = p.z[k0]!; k < k1; k++) {
          before = Math.max(before, p.z[k]!)
          p.z[k] = Math.max(p.z[k]!, Math.min(before, after[k - k0]!))
        }
      }
    // A sample's segment belongs to the piece whose first vertex precedes it; the last sample closes the last piece.
    // Its core reaches half a cell past its own piece's carriageway edge, so the terrain under the
    // carriageway is (nearly) level across it.
    const pieceOf = Int32Array.from({ length: Math.max(0, p.z.length - 1) }, (_, k) =>
      pieceOfSample(k),
    )
    const last = p.z.length - 1
    // Where the line at grade meets a bridge's deck: between a segment at grade and one on the deck,
    // or at the chain's end where a deck of another chain ends (a junction at its end, a road of
    // another pass carrying on over it).
    const deckEnd = (k: number) => {
      const before = k > 0 ? pieceOf[k - 1] : undefined,
        after = k < last ? pieceOf[k] : undefined
      if (before !== undefined && after !== undefined)
        return isLifted(before) !== isLifted(after) && !isTunnel(isLifted(before) ? before : after)
      const piece = before ?? after,
        id = (k === 0 ? pts[0] : pts.at(-1))!.id
      return piece !== undefined && !isLifted(piece) && id !== undefined && bridgeEnds.has(id)
    }
    // A chain all on decks and in bores writes no cell, and makes no claim.
    if (pieceOf.some((i) => !isLifted(i)))
      claims.push(
        claimOf(
          p,
          (k) => widthOf(pieceOf[k]!),
          spec.rank,
          BLEND,
          (k) => isLifted(pieceOf[k]!),
          spec.writes,
          deckEnd,
        ),
      )
    // A tunnel's mouths, with `mouths`, written first (`mouthsAlong`), each at its approach's width:
    // the piece out of it, none past the chain's ends (an end the outline cut is no mouth); and a
    // mouth of another chain's bore where this one ends at grade.
    if (spec.mouths === true) {
      const ends: Array<MouthEnd> = []
      for (let i = 0; i < runs.length; i++) {
        if (!isTunnel(i)) continue
        const [i0, i1] = deckOf(i)
        i = i1
        const [v0, v1] = deckEnds([i0, i1]),
          bore = [p.vertexSample[v0]!, p.vertexSample[v1]!] as const
        for (const [v, step, out] of [
          [v0, -1, i0 - 1],
          [v1, 1, i1 + 1],
        ] as const)
          if (pts[v]!.id !== undefined && out >= 0 && out < runs.length)
            ends.push({ k: p.vertexSample[v]!, step, w: widthOf(out), bore })
      }
      for (const [k, step, i] of [
        [0, 1, 0],
        [last, -1, runs.length - 1],
      ] as const) {
        const id = (k === 0 ? pts[0] : pts.at(-1))!.id
        if (id !== undefined && tunnelEnds.has(id) && !isLifted(i))
          ends.push({ k, step, w: widthOf(i) })
      }
      for (const m of mouthsAlong(p, ends, (k) => !isLifted(pieceOf[k]!), footways)) mouth(m)
    }
    runs.forEach((r, i) => {
      const z = r.map((_, j) => p.z[p.vertexSample[first[i]! + j]!]!),
        straight = isLifted(i) && spec.ramps !== true,
        bent = straight ? knots.get(deckOf(i)[0]) : undefined
      if (straight) {
        const [v0, v1] = deckEnds(deckOf(i)),
          s = arcLengths(pts.slice(v0, v1 + 1)),
          z0 = p.z[p.vertexSample[v0]!]!,
          z1 = p.z[p.vertexSample[v1]!]!
        for (let j = 0; j < z.length; j++) {
          const v = first[i]! + j
          if (v > v0 && v < v1)
            z[j] =
              bent === undefined
                ? z0 + ((z1 - z0) * s[v - v0]!) / s.at(-1)!
                : onKnots(p, bent, p.vertexSample[v]!)
        }
      }
      r.forEach((v, j) => {
        if (v.id !== undefined && !nodeZ.has(v.id)) nodeZ.set(v.id, z[j]!)
      })
      const vks = r.map((_, j) => p.vertexSample[first[i]! + j]!)
      // A straight deck ships its vertices, a bent one its knots too, the rest their bends.
      const bends = (bent ?? []).filter((q) => q.k > vks[0]! && q.k < vks.at(-1)!)
      const ks = straight
        ? [...new Set([...vks, ...bends.map((q) => q.k)])].sort((a, b) => a - b)
        : keepSamples(p, vks, spec.tol)
      const vertexAt = new Map(vks.map((k, j) => [k, j])),
        knotAt = new Map(bends.map((q) => [q.k, q.z]))
      const dense = ks.map((k) =>
        vertexAt.has(k)
          ? { v: r[vertexAt.get(k)!]!, z: z[vertexAt.get(k)!]! }
          : { v: { x: p.x[k]!, y: p.y[k]! }, z: knotAt.get(k) ?? p.z[k]! },
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
  /**
   * A fitted line's level at arc length `s` along it, m: on its profile as written (`denseOf`, the
   * bends between its vertices kept), else between its vertices. Read on the chord between them,
   * the A12's 420870862, three vertices over 1.4 km, stood 17.6 m over the track's tunnel 205932308
   * where its fit dips to 11.3 m, and the tunnel's bound left it 0.9 m under the motorway.
   */
  const zAt = (l: Linear, s: number): number => {
    const d = denseOf.get(l)
    return d === undefined
      ? along(arcLengths(l.pts), zOf.get(l)!, s)
      : along(arcLengths(d.pts), d.z, s)
  }
  return { profile, claim, mouth, claims, grown, nodeZ, zOf, denseOf, zAt }
}

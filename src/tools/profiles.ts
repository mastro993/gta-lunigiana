// Road and rail elevations for the map build: pieces chained through shared end nodes (bridges
// and tunnels included), smoothed, grade-fitted through junction and crossing pins, then written
// into the terrain grid (except under bridges and tunnels).
import { arcLengths, type V } from "./geometry.ts"
import {
  fitProfile,
  flatten,
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

/** An elevation at a point of a chain (nearest sample); `min`/`max` only bind when the fit crosses them. */
export interface Bound {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly kind?: "min" | "max"
}

/**
 * Road core half-width written into the grid, rank (lower wins at junctions), grade limit,
 * smoothing half-window (m) and the elevation tolerance (m) of the bend samples kept in the output.
 */
interface Spec {
  readonly w: number
  readonly rank: number
  readonly grade: number
  readonly half: number
  readonly tol?: number
}

/** A piece as written to the map: its OSM vertices plus the profile samples where the elevation bends between them. */
interface Dense {
  readonly pts: ReadonlyArray<V>
  readonly z: ReadonlyArray<number>
}

/**
 * Profiles chains against `ground` (the uncarved terrain) and flattens them into `grid`. Elevations
 * set at shared nodes (`nodeZ`) pin every later chain through them; `zOf` holds per-vertex z and
 * `denseOf` the output polyline.
 */
export const makeProfiler = (
  grid: Grid,
  ground: (x: number, y: number) => number,
  owner: Uint8Array,
  protect: Uint8Array,
) => {
  const nodeZ = new Map<string, number>()
  const zOf = new Map<Linear, Array<number>>()
  const denseOf = new Map<Linear, Dense>()
  /** Writes profile `p` of a line `w` m wide into the grid at `rank`, skipping segments from samples where `skip`. */
  const claim = (p: Profile, w: number, rank: number, skip: (k: number) => boolean) =>
    flatten(grid, p, coreHalf(w, grid.cell), 8, rank, owner, protect, skip)
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
    runs.forEach((r, i) => {
      if (!isLifted(i)) return
      const k0 = p.vertexSample[first[i]!]!,
        k1 = p.vertexSample[first[i]! + r.length - 1]!
      // Each end takes the ground PORTAL m out of it when that is nearer the line's level: at a
      // tunnel's portal the terrain model climbs the hill's face (3.6 m over the cutting at the
      // Ugliancaldo tunnel's west portal), and a bridge's end may stand on the slope of what it
      // spans (the Lucido's banks at Monzone).
      const tunnel = chain[i]!.item.tunnel === true
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
      for (let k = k0 + 1; k < k1; k++)
        p.z[k] = p.z[k0]! + ((p.z[k1]! - p.z[k0]!) * (p.s[k]! - p.s[k0]!)) / (p.s[k1]! - p.s[k0]!)
    })
    smooth(p, spec.half)
    const pins: Array<Pin> = []
    pts.forEach((v, i) => {
      const z = v.id === undefined ? undefined : nodeZ.get(v.id)
      if (z !== undefined) pins.push({ k: p.vertexSample[i]!, z })
    })
    // A bound inside a bridge or tunnel holds at both of its ends: the deck is straight between them.
    for (const b of bounds) {
      let best = 0,
        d2 = Number.MAX_VALUE
      for (let k = 0; k < p.z.length; k++) {
        const e = (p.x[k]! - b.x) ** 2 + (p.y[k]! - b.y) ** 2
        if (e < d2) [best, d2] = [k, e]
      }
      const i = pieceOfSample(Math.min(best, p.z.length - 2))
      const at = isLifted(i)
        ? [p.vertexSample[first[i]!]!, p.vertexSample[first[i]! + runs[i]!.length - 1]!]
        : [best]
      for (const k of at)
        pins.push({ k, z: b.z, ...(b.kind === undefined ? {} : { kind: b.kind }) })
    }
    fitProfile(p, spec.grade, pins)
    // A sample's segment belongs to the piece whose first vertex precedes it; the last sample closes the last piece.
    // The core reaches half a cell past the carriageway's edge, so the terrain under the carriageway is (nearly) level across it.
    claim(p, spec.w, spec.rank, (k) => isLifted(pieceOfSample(k)))
    runs.forEach((r, i) => {
      const z = r.map((_, j) => p.z[p.vertexSample[first[i]! + j]!]!)
      if (isLifted(i)) {
        const s = arcLengths(r)
        for (let j = 1; j + 1 < z.length; j++)
          z[j] = z[0]! + ((z.at(-1)! - z[0]!) * s[j]!) / s.at(-1)!
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
    const left = [...chains]
    const touches = (c: ReadonlyArray<Link<T>>) =>
      c.some(({ item }) => item.pts.some((v) => v.id !== undefined && nodeZ.has(v.id)))
    while (left.length > 0) yield left.splice(Math.max(0, left.findIndex(touches)), 1)[0]!
  }
  return { profile, claim, grown, nodeZ, zOf, denseOf }
}

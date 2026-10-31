// Water surfaces for the map build: monotone downstream profiles that meet at confluences,
// carved into the terrain, then kept below bridge decks and road crossings.
import type { WaterF } from "./features.ts"
import { segIndex, type V } from "./geometry.ts"
import { carve, keepSamples, resample, type Grid, type Profile } from "./terrain.ts"

const TAIL = 0.25 // extra slope a tributary tail gets when lowered to meet the water it joins
const BRIDGE_CLEAR = 2.5 // m between a bridge deck and the water under it
const CULVERT = 0.3 // m an at-grade road sits above the stream it crosses (implied culvert)
const PERCH = 1 // m a surface may stand above depth/2 over the final terrain before it is dropped (a steep river's bed alone reaches ~1 m)

const runningMin = (p: Profile) => {
  for (let k = 1; k < p.z.length; k++) p.z[k] = Math.min(p.z[k]!, p.z[k - 1]!)
}

/**
 * Monotone downstream and continuous at shared nodes: a way continuing another starts no higher
 * than it ends (and the upstream tail drops to meet it); a tributary's mouth takes the level of
 * the water it joins (tail lowered at <= TAIL, or ponded up to it).
 */
const settle = (water: ReadonlyArray<WaterF>, wp: ReadonlyArray<Profile>) => {
  // Each node id's waters, in order, with the first vertex of each that has it.
  const at = new Map<string, Array<readonly [number, number]>>()
  water.forEach((r, j) =>
    r.pts.forEach((q, v) => {
      if (q.id === undefined) return
      const list = at.get(q.id)
      if (list === undefined) at.set(q.id, [[j, v]])
      else if (list.at(-1)![0] !== j) list.push([j, v])
    }),
  )
  for (let it = 0; it < 20; it++) {
    let changed = false
    for (const p of wp) runningMin(p)
    water.forEach((w, i) => {
      const mouth = w.pts.at(-1)!.id
      if (mouth === undefined) return
      const p = wp[i]!,
        end = p.z.length - 1
      for (const [j, v] of at.get(mouth)!) {
        const r = water[j]!
        if (j === i || v === r.pts.length - 1) continue // r ends there too: siblings, not a receiver
        const q = wp[j]!
        const level = v === 0 ? Math.min(q.z[0]!, p.z[end]!) : q.z[q.vertexSample[v]!]!
        if (v === 0 && q.z[0]! > level) [q.z[0], changed] = [level, true]
        if (Math.abs(p.z[end]! - level) < 1e-6) continue
        changed = true
        if (p.z[end]! < level) for (let k = 0; k <= end; k++) p.z[k] = Math.max(p.z[k]!, level)
        else {
          // Drop the tail by an offset fading in over the last drop/TAIL m: still monotone, adds at most TAIL of slope.
          const drop = p.z[end]! - level,
            fade = Math.max(20, drop / TAIL)
          for (let k = 0; k <= end; k++)
            p.z[k] = p.z[k]! - drop * Math.max(0, 1 - (p.s[end]! - p.s[k]!) / fade)
        }
      }
    })
    if (!changed) return
  }
}

/** Water-surface profiles every 2 m from the uncarved ground (ground - depth/2), settled. */
export const waterProfiles = (
  water: ReadonlyArray<WaterF>,
  ground: (x: number, y: number) => number,
): Array<Profile> => {
  const wp = water.map((w) => resample(w.pts, 2, (x, y) => ground(x, y) - w.depth / 2))
  settle(water, wp)
  return wp
}

export const carveAll = (
  g: Grid,
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  keep?: (n: number) => boolean,
): void => water.forEach((w, i) => carve(g, wp[i]!, w.w, w.bed, w.depth, keep))

/**
 * Caps the samples within `half` m (along the water) of arc length `at` to `z`, fading the drop in
 * over drop/TAIL m upstream (and downstream too with `both`), so the water runs down to the cap
 * instead of falling off a ledge.
 */
const cap = (p: Profile, at: number, half: number, z: number, both = false) => {
  const inside = (k: number) => Math.abs(p.s[k]! - at) <= half
  let first = -1,
    last = -1
  for (let k = 0; k < p.z.length; k++) if (inside(k)) [first, last] = [first < 0 ? k : first, k]
  if (first < 0) return
  const before = Float64Array.from(p.z)
  for (let k = first; k <= last; k++) p.z[k] = Math.min(p.z[k]!, z)
  const fade = (edge: number, step: -1 | 1) => {
    const drop = before[edge]! - z
    if (drop <= 0) return
    const reach = Math.max(20, drop / TAIL)
    for (
      let k = edge + step;
      k >= 0 && k < p.z.length && Math.abs(p.s[k]! - p.s[edge]!) < reach;
      k += step
    )
      p.z[k] = Math.min(p.z[k]!, before[k]! - drop * (1 - Math.abs(p.s[k]! - p.s[edge]!) / reach))
  }
  fade(first, -1)
  if (both) fade(last, 1)
}

export interface Crossed {
  readonly water: number
  readonly at: number
  readonly half: number
  readonly deck: number
  readonly bridge: boolean
}

/**
 * After the roads, before the beds are carved again: bridges keep BRIDGE_CLEAR over the water,
 * settled again downstream. Reads no terrain.
 */
export const capUnderDecks = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  crossed: ReadonlyArray<Crossed>,
): void => {
  const decks = () => {
    for (const c of crossed) if (c.bridge) cap(wp[c.water]!, c.at, c.half, c.deck - BRIDGE_CLEAR)
  }
  decks()
  settle(water, wp)
  decks() // settling may pond a tributary back up under a bridge near its mouth
}

/**
 * Once the beds are carved again under the capped water (`carveAll` outside the road cores):
 * at-grade roads pass over an implied culvert (a local dip, hidden under the road and its
 * approaches); then water left perched over a road cut (culverted streams end at the road) drops
 * to the terrain, except inside a wider channel it flows into, as long as it still runs downhill
 * there (a stream dropped into a river's carved bed never steps back up). `terrain[i][k]` is the
 * carved grid, before its rounding, under sample k of water i.
 */
export const dropPerched = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  crossed: ReadonlyArray<Crossed>,
  terrain: ReadonlyArray<ArrayLike<number>>,
): void => {
  for (const c of crossed) if (!c.bridge) cap(wp[c.water]!, c.at, c.half, c.deck - CULVERT, true)
  const channels = segIndex<number>()
  water.forEach((w, i) => channels.addLine(w.pts, w.w / 2 + 1, i))
  water.forEach((w, i) => {
    const p = wp[i]!
    for (let k = 0; k < p.z.length; k++) {
      const top = terrain[i]![k]! + w.depth / 2
      const joins =
        (k === 0 || p.z[k]! <= p.z[k - 1]!) &&
        channels.covers(p.x[k]!, p.y[k]!, (j) => j !== i && water[j]!.w > w.w)
      if (p.z[k]! > top + PERCH && !joins) p.z[k] = top
    }
  })
}

/** Output polyline of a water profile: every OSM vertex plus the samples that keep the dips under decks and culverts, and the sample each is. */
export const waterLine = (
  pts: ReadonlyArray<V>,
  p: Profile,
): { pts: Array<V>; z: Array<number>; keep: Array<number> } => {
  const vertexAt = new Map(p.vertexSample.map((k, v) => [k, pts[v]!]))
  const keep = keepSamples(p, p.vertexSample, 0.1)
  return {
    pts: keep.map((k) => vertexAt.get(k) ?? { x: p.x[k]!, y: p.y[k]! }),
    z: keep.map((k) => p.z[k]!),
    keep,
  }
}

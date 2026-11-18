// Water surfaces for the map build: monotone downstream profiles that meet at confluences and the
// sea, never under its level, carved into the terrain, then kept below bridge decks and road
// crossings.
import type { WaterF } from "./features.ts"
import { segIndex, type V } from "./geometry.ts"
import { carve, keepSamples, resample, type Grid, type Profile } from "./terrain.ts"

const TAIL = 0.25 // extra slope a tributary tail gets when lowered to meet the water it joins
/** A bridge's deck stands at least this high over the water under it, m. */
export const BRIDGE_CLEAR = 2.5
const CULVERT = 0.3 // m an at-grade road sits above the stream it crosses (implied culvert)
/**
 * A surface may stand this far (m) above depth/2 over the final terrain before it is dropped (a
 * steep river's bed alone reaches ~1 m), and this far over a lake's level and still be its water.
 */
export const PERCH = 1

/** The sea's level, m: no water's surface stands under it (issue #13). */
const SEA = 0
/** A piece reaches the sea when the point this far past its last vertex, along its last segment, lies in it, m. */
const PAST = 1

const runningMin = (p: Profile) => {
  for (let k = 1; k < p.z.length; k++) p.z[k] = Math.min(p.z[k]!, p.z[k - 1]!)
}

/** Every surface of `wp` raised to the sea's level where it lies under it. */
const aboveSea = (wp: ReadonlyArray<Profile>) => {
  for (const p of wp) for (let k = 0; k < p.z.length; k++) p.z[k] = Math.max(p.z[k]!, SEA)
}

/**
 * Monotone downstream and continuous at shared nodes: a way continuing another starts no higher
 * than it ends (and the upstream tail drops to meet it); a tributary's mouth takes the level of
 * the water it joins, and a piece reaching the sea (`mouths`, by index) the sea's (tail lowered at
 * <= TAIL, or ponded up to it).
 */
const settle = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  mouths: ReadonlySet<number> = new Set(),
) => {
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
      const mouth = w.pts.at(-1)!.id,
        p = wp[i]!,
        end = p.z.length - 1
      /** Piece i's mouth meets water at `level`: its tail lowered to it, or the piece ponded up to it. */
      const meet = (level: number) => {
        if (Math.abs(p.z[end]! - level) < 1e-6) return
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
      if (mouths.has(i)) meet(SEA)
      if (mouth === undefined) return
      for (const [j, v] of at.get(mouth)!) {
        const r = water[j]!
        if (j === i || v === r.pts.length - 1) continue // r ends there too: siblings, not a receiver
        const q = wp[j]!
        const level = v === 0 ? Math.min(q.z[0]!, p.z[end]!) : q.z[q.vertexSample[v]!]!
        if (v === 0 && q.z[0]! > level) [q.z[0], changed] = [level, true]
        meet(level)
      }
    })
    if (!changed) return
  }
}

/**
 * Water-surface profiles every 2 m from the uncarved ground (ground - depth/2), never under the
 * sea's level, settled: a piece reaching the sea (`sea` holds the point PAST m on past its last
 * vertex) meets it at its level, as a tributary meets the water it joins.
 */
export const waterProfiles = (
  water: ReadonlyArray<WaterF>,
  ground: (x: number, y: number) => number,
  sea: (x: number, y: number) => boolean = () => false,
): Array<Profile> => {
  const wp = water.map((w) => resample(w.pts, 2, (x, y) => ground(x, y) - w.depth / 2))
  aboveSea(wp)
  const mouths = new Set<number>()
  water.forEach(({ pts }, i) => {
    if (pts.length < 2) return
    const a = pts.at(-2)!,
      b = pts.at(-1)!,
      len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1
    if (sea(b.x + ((b.x - a.x) / len) * PAST, b.y + ((b.y - a.y) / len) * PAST)) mouths.add(i)
  })
  settle(water, wp, mouths)
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

/** A road or the rail over water `water`, `at` m along it, `half` m either side, its deck or road at `deck` m. */
export interface Crossed {
  readonly water: number
  readonly at: number
  readonly half: number
  readonly deck: number
  /** How far under a deck the water keeps, m (a bridge's BRIDGE_CLEAR, a pier's PIER_DECK); none at grade, over a culvert. */
  readonly clear?: number
}

/**
 * After the roads, before the beds are carved again: the water keeps each deck's clearance under
 * it (BRIDGE_CLEAR under a bridge's; a pier's deck stands on the water's own level), settled again
 * downstream, but none under the sea's level. Reads no terrain.
 */
export const capUnderDecks = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  crossed: ReadonlyArray<Crossed>,
): void => {
  const decks = () => {
    for (const c of crossed)
      if (c.clear !== undefined) cap(wp[c.water]!, c.at, c.half, c.deck - c.clear)
  }
  decks()
  settle(water, wp)
  decks() // settling may pond a tributary back up under a bridge near its mouth
  aboveSea(wp)
}

/**
 * Once the beds are carved again under the capped water (`carveAll` outside the road cores):
 * at-grade roads pass over an implied culvert (a local dip, hidden under the road and its
 * approaches); then water left perched over a road cut (culverted streams end at the road) drops
 * to the terrain, except inside a wider channel it flows into or a lake's water, whose carved beds
 * lie under it, as long as it still runs downhill there (a stream dropped into a river's carved bed
 * never steps back up). Nor does a sample after a dropped one, though within PERCH of its own ground,
 * stand over it while that ground lies under it, but in a lake's water: it drops to the dropped
 * surface. A stream falling into the Magra's gravel at Aulla (way 1430400928) kept a sample 0.1 m
 * over the one before it, dropped to its ground, as the river polygon's carve deepened the bed under
 * it, and the Torrente Arcinasso 1.0 m at (−8592, 4954). Where the ground rises past the dropped
 * surface the stream is out of the hole it dropped into (a culvert's dip under a road at grade) and
 * keeps its own: pinned to its ground there, a stream onto the Magra's gravel at (−13976, 9447) (way
 * 791364133, past a path at grade) rippled 0.3 m up and down. A lake's water stands within PERCH of its
 * level (`still` gives the level of the lake at a point); higher, a surface inside its outline is
 * the stream's on the bank, and drops no lower than the level, where it meets the lake's: the Canale
 * della Fola runs into a pond 570 m from Arlia at its ground, 1.7 m over the level the pond's outlet
 * caps it at, and its last sample there, over the outlet's cascade carved 4 m under it, stood 3.4 m
 * over the ground. None drops under the sea's level (the sea floor under a river's mouth).
 * `terrain[i][k]` is the carved grid, before its rounding, under sample k of water i.
 */
export const dropPerched = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  crossed: ReadonlyArray<Crossed>,
  terrain: ReadonlyArray<ArrayLike<number>>,
  still: (x: number, y: number) => number | undefined = () => undefined,
): void => {
  for (const c of crossed)
    if (c.clear === undefined) cap(wp[c.water]!, c.at, c.half, c.deck - CULVERT, true)
  const channels = segIndex<number>()
  water.forEach((w, i) => channels.addLine(w.pts, w.w / 2 + 1, i))
  water.forEach((w, i) => {
    const p = wp[i]!
    // The surface the last sample dropped to, while the samples after it would stand over it.
    let dropped = Number.POSITIVE_INFINITY
    for (let k = 0; k < p.z.length; k++) {
      const x = p.x[k]!,
        y = p.y[k]!,
        ground = terrain[i]![k]!,
        top = ground + w.depth / 2
      if (p.z[k]! <= top + PERCH) {
        if (p.z[k]! <= dropped || ground >= dropped) dropped = Number.POSITIVE_INFINITY
        else {
          const lake = still(x, y)
          if (lake !== undefined && p.z[k]! <= lake + PERCH) dropped = Number.POSITIVE_INFINITY
          else p.z[k] = dropped
        }
        continue
      }
      const downhill = k === 0 || p.z[k]! <= p.z[k - 1]!,
        lake = still(x, y)
      const joins =
        downhill &&
        ((lake !== undefined && p.z[k]! <= lake + PERCH) ||
          channels.covers(x, y, (j) => j !== i && water[j]!.w > w.w))
      if (joins) dropped = Number.POSITIVE_INFINITY
      else dropped = p.z[k] = Math.min(p.z[k]!, Math.max(top, lake ?? top))
    }
  })
  aboveSea(wp)
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

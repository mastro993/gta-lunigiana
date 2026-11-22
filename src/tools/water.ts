// Water surfaces for the map build: monotone downstream profiles that meet at confluences and the
// sea, never under its level, carved into the terrain, then kept below bridge decks and road
// crossings.
import { reachOf } from "../sim/map/kinds.ts"
import type { WaterF } from "./features.ts"
import { type V } from "./geometry.ts"
import { keepSamples, resample, type Profile } from "./profile-fit.ts"
import { segIndex } from "./spatial-index.ts"
import { carve, type Grid } from "./terrain.ts"

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
 * The waters each of `water` flows into at its last node, by index, each with its vertex there: a
 * receiver's, or a way's it continues into (its first), but none ending there too (siblings, which
 * flow on together).
 */
const receivers = (water: ReadonlyArray<WaterF>): Array<Array<readonly [number, number]>> => {
  const at = new Map<string, Array<readonly [number, number]>>()
  water.forEach((r, j) =>
    r.pts.forEach((q, v) => {
      if (q.id === undefined || v === r.pts.length - 1) return
      const list = at.get(q.id)
      if (list === undefined) at.set(q.id, [[j, v]])
      else if (list.at(-1)![0] !== j) list.push([j, v])
    }),
  )
  return water.map((w, i) => {
    const mouth = w.pts.at(-1)!.id
    return mouth === undefined ? [] : (at.get(mouth) ?? []).filter(([j]) => j !== i)
  })
}

/**
 * Every piece's index once, each after the pieces it flows into (`into`, by index: a piece's
 * receivers), so that those are final when it reads them; a loop's pieces in the order they are
 * met.
 */
const downstreamFirst = (into: ReadonlyArray<ReadonlyArray<readonly [number, number]>>) => {
  const order: Array<number> = [],
    seen = new Uint8Array(into.length)
  for (let root = 0; root < into.length; root++) {
    if (seen[root] === 1) continue
    seen[root] = 1
    const path = [root]
    while (path.length > 0) {
      const next = into[path.at(-1)!]!.find(([j]) => seen[j] === 0)
      if (next === undefined) order.push(path.pop()!)
      else {
        seen[next[0]] = 1
        path.push(next[0])
      }
    }
  }
  return order
}

/**
 * Monotone downstream and continuous at shared nodes: a way continuing another starts no higher
 * than it ends (and the upstream tail drops to meet it), but no lower than the level the water it
 * joins holds its own mouth at, so a way held up by the water it joins backs up the way it
 * continues too; a tributary's mouth takes the level of the water it joins, and a piece reaching
 * the sea (`mouths`, by index) the sea's (tail lowered at <= TAIL, or ponded up to it).
 */
const settle = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  mouths: ReadonlySet<number> = new Set(),
) => {
  const into = receivers(water)
  // The level each piece's mouth is held at, by index (-Infinity: none): the water it joins (a
  // receiver's, the sea's), or the way it continues into where that way holds it up. Lowered at
  // its start to the way it continues, a way ponded up to the water it joins was ponded again, and
  // so on for ever: a braid of the Vara at (−21347, 1960), rejoining the Vara 0.55 m over the end of
  // the way it continues, was left by the last round 0.55 m over its first sample.
  const held = new Float64Array(wp.length).fill(-Infinity)
  for (let it = 0; it < 20; it++) {
    let changed = false
    for (const p of wp) runningMin(p)
    wp.forEach((p, i) => {
      const end = p.z.length - 1
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
      let hold = -Infinity
      if (mouths.has(i)) meet((hold = SEA))
      for (const [j, v] of into[i]!) {
        const q = wp[j]!
        let level = q.z[q.vertexSample[v]!]!
        if (v > 0) hold = Math.max(hold, level)
        else {
          // The way it continues into starts no higher than it ends, unless that way is held up.
          level = Math.min(q.z[0]!, p.z[end]!)
          if (held[j]! > level) hold = Math.max(hold, (level = held[j]!))
          if (q.z[0]! > level) [q.z[0], changed] = [level, true]
        }
        meet(level)
      }
      held[i] = hold
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
  // ... and on downstream of it: capped under a footbridge after it was ponded up to the canal it
  // reaches, a ditch on the coast's plain (135653574) rose from 0 to 1 m down its 14 m.
  for (const p of wp) runningMin(p)
  aboveSea(wp)
}

/**
 * Once the beds are carved again under the capped water (`carveAll` outside the road cores):
 * at-grade roads pass over an implied culvert (a local dip, hidden under the road and its
 * approaches); then water left perched over a road cut (culverted streams end at the road) drops
 * to the terrain, except inside a wider channel it flows into or a lake's water, whose carved beds
 * lie under it, as long as it still runs downhill there (a stream dropped into a river's carved bed
 * never steps back up). Within the reach (`reachOf`) of a water no narrower than it that it flows
 * into, a river it joins or the way it continues into, it drops no lower than the level it meets
 * that water at, as in a lake's: dropped down the Vara's bank, the ditch 819040162 fell on to its
 * own top over the Vara's floor and met the Vara 0.8 m under its surface at Fornola (12.5 m, the
 * Vara 13.3 there), and 789354818, its last sample pulled down to the hollow it dropped into before
 * the way of its size it continues into, met that way 0.7 m under its start. The level is read where
 * they meet: read at the nearest point of any wider water, it held a stream up at the steeper
 * sibling it runs down beside (788514911 by 788514912), 1.6 m over the way both continue into. That
 * water drops first: dropped after the pieces flowing into it (the widest first, ties by index), it
 * left 180 of their samples on Lunigiana held at its level before it dropped, perched. A narrower
 * water's is no such level: the 4 m streams 501653280 and 797865829 flow into 2 m ways kept in their
 * channel over the bed their carve lowers, and held at it they stood 1.0 and 1.4 m over their own
 * top. Nor does a sample after a dropped one, within PERCH of its own ground or
 * perched too, stand over it while that ground lies under it, but in a lake's water: it drops to the
 * dropped surface (dropped each to its own top, a stream's perched samples falling into the Magra's
 * polygon by Caprigliola, way 789354420, rose 0.1 m with the bed carved under them). A stream
 * falling into the Magra's gravel at Aulla (way 1430400928) kept a sample 0.1 m over the one before
 * it, dropped to its ground, as the river polygon's carve deepened the bed under it, and the
 * Torrente Arcinasso 1.0 m at (−8592, 4954). Where the ground rises past the dropped
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
  const channels = segIndex<number>(),
    reaches = segIndex<number>()
  water.forEach((w, i) => {
    channels.addLine(w.pts, w.w / 2 + 1, i)
    reaches.addLine(w.pts, reachOf(w), i) // where it holds water across its line
  })
  // The waters no narrower than it each piece flows into, each with its vertex where they meet.
  const meetsOf = receivers(water).map((list, i) =>
    list.filter(([j]) => water[j]!.w >= water[i]!.w),
  )
  for (const i of downstreamFirst(meetsOf)) {
    const w = water[i]!,
      p = wp[i]!,
      meets = meetsOf[i]!
    // The level the water it flows into stands at where they meet, within that water's reach.
    const level = (x: number, y: number) => {
      let z: number | undefined
      for (const [j, v] of meets)
        if (reaches.covers(x, y, (o) => o === j))
          z = Math.max(z ?? -Infinity, wp[j]!.z[wp[j]!.vertexSample[v]!]!)
      return z
    }
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
      else {
        // In a lake's water no lower than its level; within the reach of the wider water it flows
        // into, no lower than the level it meets that water at.
        const own = Math.min(p.z[k]!, Math.max(top, lake ?? level(x, y) ?? top))
        // Perched too, it drops no higher than the dropped surface while its ground lies under it.
        dropped = p.z[k] = lake === undefined && ground < dropped ? Math.min(own, dropped) : own
      }
    }
  }
  aboveSea(wp)
}

/** How far the output line of a water profile strays from its 2 m samples at most, m (`waterLine`). */
export const LINE_TOL = 0.1

/** Output polyline of a water profile: every OSM vertex plus the samples that keep the dips under decks and culverts, and the sample each is. */
export const waterLine = (
  pts: ReadonlyArray<V>,
  p: Profile,
): { pts: Array<V>; z: Array<number>; keep: Array<number> } => {
  const vertexAt = new Map(p.vertexSample.map((k, v) => [k, pts[v]!]))
  const keep = keepSamples(p, p.vertexSample, LINE_TOL)
  return {
    pts: keep.map((k) => vertexAt.get(k) ?? { x: p.x[k]!, y: p.y[k]! }),
    z: keep.map((k) => p.z[k]!),
    keep,
  }
}

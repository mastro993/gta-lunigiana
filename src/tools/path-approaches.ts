// The paths and steps at grade that lead onto a path's or steps' bridge or into its tunnel: after the
// path pass (PATH_PASS in profiles.ts) each one through a node of those decks is that deck's or
// bore's approach, as a road's is. It meets the deck there at its level, and from a level off the
// ground its offset from the terrain closes at its class's grade (`APPROACH_GRADE`) until it meets
// it; that stretch is its fitted line, written into the grid (at the path pass's rank, under every
// other claim), and the rest of it keeps the terrain. A vertex of the stretch is set as the
// profiles' shared nodes are, so the paths at grade on from it are approaches in turn, and a path
// fitted before with it on the ground is fitted again. Fitted at the terrain's level, the station's
// steps at Aulla Lunigiana stood 5.8 m over the underpass they lead into (1387000572). A path or
// steps at grade crossing a deck or a bore on another level is fitted so too, from its clearance
// there, whether or not a deck leads onto it (`pathApproaches`'s `crossing`).
import { Ops } from "@typeonce/ritmo-math"

import { lifted } from "./chains.ts"
import type { RoadF } from "./features.ts"
import type { V } from "./geometry.ts"
import { BLEND, type Claim, claimOf, mouthClaim } from "./grid-claims.ts"
import { type Bound, PATH_PASS } from "./profiles.ts"
import { keepSamples, RELAX, resample } from "./terrain.ts"
import { WALK_SLOPE } from "./walls.ts"

/** How near the ground a level meets it, m: within half the file's 0.1 m rounding. */
const MET = 0.05

/**
 * The grade at which an approach's offset from the terrain closes, by class (on the flat, the
 * steepest it climbs or dips): a path at the path pass's
 * grade as far as its fit relaxes it (RELAX × PATH_PASS.grade, 30%); steps as steep as the
 * steepest ground a walker climbs (WALK_SLOPE, 35°: 70%), a stair's 16–20 cm risers on 25–30 cm
 * treads, where a path's 30% would stretch the station's 19.6 m steps at Aulla to the ground only at
 * their top.
 */
export const APPROACH_GRADE = {
  path: RELAX * PATH_PASS.grade,
  steps: Ops.tan((WALK_SLOPE * Math.PI) / 180),
} as const

/** An approach's line: its OSM vertices and the samples where its level bends, and z, undefined where it lies on the terrain (the finished grid's). */
export interface ApproachLine {
  readonly pts: ReadonlyArray<V>
  readonly z: ReadonlyArray<number | undefined>
}

/** The paths and steps at grade (neither bridge nor tunnel) through each node id. */
export const pathsAtGrade = (roads: ReadonlyArray<RoadF>): ReadonlyMap<string, Array<RoadF>> => {
  const through = new Map<string, Array<RoadF>>()
  for (const r of roads) {
    if (lifted(r) || (r.cls !== "path" && r.cls !== "steps")) continue
    for (const v of r.pts) {
      if (v.id === undefined) continue
      const list = through.get(v.id)
      if (list === undefined) through.set(v.id, [r])
      else if (list.at(-1) !== r) list.push(r)
    }
  }
  return through
}

/**
 * What an approach adds to the map: its line, its claims on the grid, the vertices whose level it
 * set, and whether it keeps a clearance (`crosses`), whose claims go first.
 */
interface Fit {
  readonly line: ApproachLine
  readonly claims: ReadonlyArray<Claim>
  readonly mouths: ReadonlyArray<Claim>
  readonly set: ReadonlyArray<V>
  readonly crosses: boolean
}

/** What an approach's fit reads round it besides the levels set. */
export interface Around {
  /** The uncarved terrain, m. */
  readonly ground: (x: number, y: number) => number
  /** Whether a path's bore opens at node `id`. */
  readonly mouthAt?: (id: string) => boolean
  /** Whether a bridge's deck ends at node `id`: under the deck past it the stretch's core yields to any other (`deckEnd` in `flatten`). */
  readonly deckEndAt?: (id: string) => boolean
}

/**
 * `piece` fitted from the levels set at its vertices (`nodeZ`): from each that `leads` (one the path
 * pass or an approach set), the samples walking either way until its offset from the terrain
 * (`ground`) closes at its grade, or the next level set, are its stretch off the ground. There it
 * keeps within its grade of the levels either side (straight between two it cannot meet within it,
 * a stair), nearest the terrain, and within the offset each of them closes to by then. The level
 * alone climbing at the grade from a footbridge's end 0.6 m under a 47% slope never caught the slope
 * and cut 2.4 m into it for 40 m (1121797190 by 93744740); the offset alone, closing over terrain
 * that rose back from a dip under a deck's end, lifted the sidewalk 1409723237 3.6 m over the
 * footbridge 1414943238 it leads onto. A level a road set (a junction) bounds the stretch but leads
 * none: a path at grade keeps the terrain beside a road's cut or bank. Its line takes the level of
 * each vertex it leads from, so it meets the deck there, and the stretch's; its claim writes the
 * stretch into the grid. Its first MOUTH m out of each level it leads from hold the grid at their
 * level (`mouthClaim`), so the nodes of the cell it meets the deck in stand at the deck's end: a
 * stream's bank carve dropped the ground 2.5–3.6 m under the ends of footbridges by Equi Terme and
 * Aulla (1125144076, 1062093193, 1308837496, 809448798, 1289055889, 719447156, 1109549328), which
 * took the uncarved ground's level. Out of a bore's mouth (`mouthAt`) those hold it ahead of every
 * other claim, as a road's do: a road over the bore took those cells at its own level otherwise.
 * Where it crosses over a tunnel or under a bridge, its stretch keeps the clearance (`clears`, each
 * a `min` or `max` level at a point of it), closing on it at its grade: an approach crossing back
 * over the bore it leads out of, or over a road's tunnel bound under its natural level, sank onto it
 * (Cesena's 22776463 2.45 m over the Secante, Lunigiana's 1311831119 0.4 m over 1311831121). None
 * where it leads from no level.
 */
const fitApproach = (
  piece: RoadF & { readonly cls: "path" | "steps" },
  nodeZ: ReadonlyMap<string, number>,
  leads: (id: string) => boolean,
  clears: ReadonlyArray<Bound>,
  { mouthAt = () => false, deckEndAt = () => false, ground }: Around,
): Fit | undefined => {
  const p = resample(piece.pts, 4, ground),
    n = p.z.length,
    grade = APPROACH_GRADE[piece.cls]
  /** Each level set on it by sample, and its offset from the terrain there. */
  const pins = new Map<number, { readonly z: number; readonly off: number }>(),
    starts: Array<number> = []
  piece.pts.forEach((v, i) => {
    const z = v.id === undefined ? undefined : nodeZ.get(v.id),
      k = p.vertexSample[i]!
    if (z === undefined) return
    pins.set(k, { z, off: z - p.z[k]! })
    if (leads(v.id!)) starts.push(k)
  })
  if (starts.length === 0 && clears.length === 0) return undefined
  const terrain = Float64Array.from(p.z),
    off = new Uint8Array(n)
  /** Fits the stretches off the ground from `pins` into `off` and `p.z`. */
  const fit = () => {
    off.fill(0)
    p.z.set(terrain)
    for (const at of starts)
      for (const step of [-1, 1])
        for (let k = at; k >= 0 && k < n; k += step) {
          if (k !== at && pins.has(k)) break
          if (Math.abs(pins.get(at)!.off) <= grade * Math.abs(p.s[k]! - p.s[at]!) + MET) break
          off[k] = 1
        }
    const sorted = [...pins].sort((a, b) => a[0] - b[0])
    for (let k = 0, i = -1; k < n; k++) {
      while (i + 1 < sorted.length && sorted[i + 1]![0] <= k) i++
      if (off[k] === 0) continue
      const [ka, a] = sorted[i] ?? [],
        [kb, b] = sorted[i + 1] ?? [],
        da = ka === undefined ? Infinity : p.s[k]! - p.s[ka]!,
        db = kb === undefined ? Infinity : p.s[kb]! - p.s[k]!
      const up = Math.min(
          a === undefined ? Infinity : a.z + grade * da,
          b === undefined ? Infinity : b.z + grade * db,
        ),
        down = Math.max(
          a === undefined ? -Infinity : a.z - grade * da,
          b === undefined ? -Infinity : b.z - grade * db,
        )
      const level =
        down <= up + 1e-9
          ? Math.min(up, Math.max(down, terrain[k]!))
          : a!.z + ((b!.z - a!.z) * da) / (da + db)
      const close = Math.max(
        0,
        a === undefined ? 0 : Math.abs(a.off) - grade * da,
        b === undefined ? 0 : Math.abs(b.off) - grade * db,
      )
      p.z[k] = terrain[k]! + Math.min(close, Math.max(-close, level - terrain[k]!))
    }
    for (const k of starts) if (off[k] === 0) p.z[k] = pins.get(k)!.z
  }
  fit()
  // A clearance the fit breaks holds at its sample (the nearest its point) as a level set there, and
  // the stretches are fitted again: the one it breaks most first, so that of two on one sample the
  // tighter holds (the first found, Via Torrione San Francesco, 48560613, shipped the 24.06 m the
  // footbridge 1392737826 asked where 1392737825 beside it asked 23.2 m).
  const at = clears.map((b) => {
    let best = 0
    for (let k = 1; k < n; k++)
      if (
        (p.x[k]! - b.x) ** 2 + (p.y[k]! - b.y) ** 2 <
        (p.x[best]! - b.x) ** 2 + (p.y[best]! - b.y) ** 2
      )
        best = k
    return best
  })
  for (let round = 0; round < clears.length; round++) {
    let broken = -1,
      most = 0
    clears.forEach((b, j) => {
      const by = b.kind === "min" ? b.z - p.z[at[j]!]! : p.z[at[j]!]! - b.z
      if (!pins.has(at[j]!) && by > most) [broken, most] = [j, by]
    })
    if (broken < 0) break
    pins.set(at[broken]!, { z: clears[broken]!.z, off: clears[broken]!.z - terrain[at[broken]!]! })
    starts.push(at[broken]!)
    fit()
  }
  // A clearance's sample ships the fit's level and its claim writes it there, never the grid other
  // claims raised: the ramps of Cesena's footbridge 683510421 held the grid under its deck at the
  // deck's level (their cores yield there now: `deckEndAt`), and the path 22776463, which the fit
  // kept 4.5 m under the deck, ran 3.5 m under it. But one under a deck alone that the fit left on
  // the ground (`held`) ships the grid as finished, its claim writing its level there as well, ahead
  // of the holds and the cores round a deck's ends: a road's core may hold the grid under it, and
  // the deck's clearance holds the lower: shipped at its uncarved 11.0 m, the sidewalk 1473703387
  // under the rail bridge 86258970 at Sarzana stood 2 m over the SS62's cut it runs in, at 9.0 m.
  // Over a bore it keeps its level, which the bore's mouth's hold may have lowered the grid under:
  // shipped on it, the footway 1462688623 over the service tunnel 376037643's mouth by Sarzana ran
  // 0.01 m over it.
  const over = new Set(at.filter((_, j) => clears[j]!.kind === "min")),
    held = new Uint8Array(n)
  for (const k of at)
    if (off[k] === 1 || over.has(k)) off[k] = 1
    else held[k] = 1
  // Its first MOUTH m out of each level it leads from hold the grid there, out of a bore's mouth
  // ahead of every other claim.
  const mouths: Array<Claim> = [],
    holds: Array<Claim> = []
  piece.pts.forEach((v, i) => {
    if (v.id === undefined || !leads(v.id)) return
    for (const step of [-1, 1] as const) {
      const m = mouthClaim(p, p.vertexSample[i]!, step, piece.w, () => true)
      if (m === undefined) continue
      if (mouthAt(v.id)) mouths.push(m)
      else holds.push({ ...m, rank: PATH_PASS.rank })
    }
  })
  // The line keeps the samples where its level bends off the ground, those it meets it at, and the
  // clearances'.
  const near = (k: number) => off[k] === 1 || off[k - 1] === 1 || off[k + 1] === 1
  const vertexAt = new Map(p.vertexSample.map((k, i) => [k, i]))
  const fixed = [...new Set([...p.vertexSample, ...at])].sort((a, b) => a - b)
  const keep = keepSamples(p, fixed).filter((k) => vertexAt.has(k) || near(k) || held[k] === 1)
  const lead = new Set(starts)
  /** The vertex at sample `k` leads from a bridge's deck's end: past it, under the deck, its core yields to any other. */
  const deckEnd = (k: number) => {
    const id = piece.pts[vertexAt.get(k) ?? -1]?.id
    return lead.has(k) && id !== undefined && deckEndAt(id)
  }
  return {
    line: {
      pts: keep.map((k) => piece.pts[vertexAt.get(k)!] ?? { x: p.x[k]!, y: p.y[k]! }),
      z: keep.map((k) => (off[k] === 1 || lead.has(k) ? p.z[k]! : undefined)),
    },
    // The stretch first: its core keeps the nodes the round end of a hold's core reaches too.
    claims: [
      ...(off.includes(1) || held.includes(1)
        ? [
            claimOf(
              p,
              () => piece.w,
              PATH_PASS.rank,
              BLEND,
              (k) => (off[k]! | off[k + 1]! | held[k]! | held[k + 1]!) === 0,
              undefined,
              deckEnd,
            ),
          ]
        : []),
      ...holds,
    ],
    mouths,
    // A level it set at a vertex: its stretch's, or a clearance held there.
    set: piece.pts.filter(
      (v, i) =>
        v.id !== undefined && (off[p.vertexSample[i]!] === 1 || lead.has(p.vertexSample[i]!)),
    ),
    crosses: clears.length > 0,
  }
}

/**
 * The approaches leading from the nodes `seeds` (those of the paths' and steps' decks) along the paths
 * and steps at grade through them (`through`, `pathsAtGrade`), each fitted from the levels set on it
 * (`fitApproach`; `clearOf` the clearances each keeps, `around` what else it reads), the levels it
 * sets at its vertices set in `nodeZ` and spread on from there: their lines, their claims on the
 * grid and their mouths' claims, in order. A path fitted before a level was set at a vertex of it,
 * that vertex on the ground, is fitted again from it: fitted once, Aulla's path 717897182 stood
 * 1.3 m over the steps 717897183 where they meet, and Fosdinovo's 1326730177 0.9 m over
 * 1335936638. A level is set once, so each vertex sends its paths back at most once. The paths and
 * steps at grade that cross a fitted way on another level (`crossing`: under a bridge or over a
 * tunnel) are fitted first, from their clearances (`clearOf`) whether or not a deck leads onto
 * them: each keeps its level there as its own claim, dipped to the clearance where the ground
 * breaks it (the A15's deck by its north end at Santo Stefano di Magra stood 0.6 m over the ground
 * the steps 374756566 run on under it), and its claims go before every other approach's, as the
 * holds and the cores round a deck's ends held the ground under it at the deck's level: Via
 * Mazzini (814776126) at Sarzana's Via Cittadella arch (814776124, 7.2 m), whose ends' holds reach
 * under all of it, at 24.6 m on its natural 20.3, and the path 205452561 under the A12's decks
 * (205451511 and 205451513) at 37.4–39.1 m on its natural 33.8–34.6, 1.0–2.7 m under them.
 */
export const pathApproaches = (
  through: ReadonlyMap<string, ReadonlyArray<RoadF>>,
  seeds: ReadonlyArray<string>,
  nodeZ: Map<string, number>,
  clearOf: (piece: RoadF) => ReadonlyArray<Bound>,
  around: Around,
  crossing: ReadonlyArray<RoadF> = [],
): {
  readonly lines: ReadonlyMap<RoadF, ApproachLine>
  readonly claims: Array<Claim>
  readonly mouths: Array<Claim>
} => {
  const fits = new Map<RoadF, Fit>(),
    queue = [...seeds],
    led = new Set(seeds)
  /** Fits `piece` from the levels set on it and its clearances, and sends its levels on. */
  const take = (piece: RoadF) => {
    const fit = fitApproach(
      piece as RoadF & { cls: "path" | "steps" },
      nodeZ,
      (id) => led.has(id),
      clearOf(piece),
      around,
    )
    if (fit === undefined) return
    fits.set(piece, fit)
    for (const v of fit.set)
      if (!nodeZ.has(v.id!)) {
        nodeZ.set(v.id!, fit.line.z[fit.line.pts.indexOf(v)]!)
        led.add(v.id!)
        for (const other of through.get(v.id!) ?? []) if (other !== piece) fits.delete(other)
        queue.push(v.id!)
      }
  }
  for (const piece of crossing) if (!fits.has(piece)) take(piece)
  for (let q = 0; q < queue.length; q++)
    for (const piece of through.get(queue[q]!) ?? []) if (!fits.has(piece)) take(piece)
  const all = [...fits.values()],
    ordered = [...all.filter((f) => f.crosses), ...all.filter((f) => !f.crosses)]
  return {
    lines: new Map([...fits].map(([piece, fit]) => [piece, fit.line])),
    claims: ordered.flatMap((fit) => fit.claims),
    mouths: all.flatMap((fit) => fit.mouths),
  }
}

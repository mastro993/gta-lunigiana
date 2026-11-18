// The paths and steps at grade that lead onto a path's or steps' bridge or into its tunnel: after the
// path pass (PATH_PASS in profiles.ts) each one through a node of those decks is that deck's or
// bore's approach, as a road's is. It meets the deck there at its level, and from a level off the
// ground its offset from the terrain closes at its class's grade (`APPROACH_GRADE`) until it meets
// it; that stretch is its fitted line, written into the grid (at the path pass's rank, under every
// other claim), and the rest of it keeps the terrain. A vertex of the stretch is set as the
// profiles' shared nodes are, so the paths at grade on from it are approaches in turn. Fitted at the
// terrain's level, the station's steps at Aulla Lunigiana stood 5.8 m over the underpass they lead
// into (1387000572).
import type { RoadF } from "./features.ts"
import type { V } from "./geometry.ts"
import { BLEND, type Claim, claimOf, mouthClaim } from "./grid-claims.ts"
import { lifted, PATH_PASS } from "./profiles.ts"
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
  steps: Math.tan((WALK_SLOPE * Math.PI) / 180),
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

/** What an approach adds to the map: its line, its claims on the grid, and the vertices whose level it set. */
interface Fit {
  readonly line: ApproachLine
  readonly claims: ReadonlyArray<Claim>
  readonly mouths: ReadonlyArray<Claim>
  readonly set: ReadonlyArray<V>
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
 * None where it leads from no level.
 */
const fitApproach = (
  piece: RoadF & { readonly cls: "path" | "steps" },
  nodeZ: ReadonlyMap<string, number>,
  leads: (id: string) => boolean,
  mouthAt: (id: string) => boolean,
  ground: (x: number, y: number) => number,
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
  if (starts.length === 0) return undefined
  const off = new Uint8Array(n)
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
      db = kb === undefined ? Infinity : p.s[kb]! - p.s[k]!,
      terrain = p.z[k]!
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
        ? Math.min(up, Math.max(down, terrain))
        : a!.z + ((b!.z - a!.z) * da) / (da + db)
    const close = Math.max(
      0,
      a === undefined ? 0 : Math.abs(a.off) - grade * da,
      b === undefined ? 0 : Math.abs(b.off) - grade * db,
    )
    p.z[k] = terrain + Math.min(close, Math.max(-close, level - terrain))
  }
  for (const k of starts) if (off[k] === 0) p.z[k] = pins.get(k)!.z
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
  // The line keeps the samples where its level bends off the ground, and those it meets it at.
  const near = (k: number) => off[k] === 1 || off[k - 1] === 1 || off[k + 1] === 1
  const vertexAt = new Map(p.vertexSample.map((k, i) => [k, i]))
  const keep = keepSamples(p, p.vertexSample).filter((k) => vertexAt.has(k) || near(k))
  const lead = new Set(starts)
  return {
    line: {
      pts: keep.map((k) => piece.pts[vertexAt.get(k)!] ?? { x: p.x[k]!, y: p.y[k]! }),
      z: keep.map((k) => (off[k] === 1 || lead.has(k) ? p.z[k]! : undefined)),
    },
    // The stretch first: its core keeps the nodes the round end of a hold's core reaches too.
    claims: [
      ...(off.includes(1)
        ? [
            claimOf(
              p,
              () => piece.w,
              PATH_PASS.rank,
              BLEND,
              (k) => off[k] === 0 && off[k + 1] === 0,
            ),
          ]
        : []),
      ...holds,
    ],
    mouths,
    set: piece.pts.filter((v, i) => v.id !== undefined && off[p.vertexSample[i]!] === 1),
  }
}

/**
 * The approaches leading from the nodes `seeds` (those of the paths' and steps' decks) along the paths
 * and steps at grade through them (`through`, `pathsAtGrade`), each fitted from the levels set on it
 * (`fitApproach`; `mouthAt` the nodes where a bore opens), the levels of their stretches off the
 * ground set in `nodeZ` and spread on from there: their lines, their claims on the grid and their
 * mouths' claims, in order.
 */
export const pathApproaches = (
  through: ReadonlyMap<string, ReadonlyArray<RoadF>>,
  seeds: ReadonlyArray<string>,
  nodeZ: Map<string, number>,
  mouthAt: (id: string) => boolean,
  ground: (x: number, y: number) => number,
): {
  readonly lines: ReadonlyMap<RoadF, ApproachLine>
  readonly claims: Array<Claim>
  readonly mouths: Array<Claim>
} => {
  const lines = new Map<RoadF, ApproachLine>(),
    claims: Array<Claim> = [],
    mouths: Array<Claim> = [],
    queue = [...seeds],
    led = new Set(seeds)
  for (let q = 0; q < queue.length; q++)
    for (const piece of through.get(queue[q]!) ?? []) {
      if (lines.has(piece)) continue
      const fit = fitApproach(
        piece as RoadF & { cls: "path" | "steps" },
        nodeZ,
        (id) => led.has(id),
        mouthAt,
        ground,
      )
      if (fit === undefined) continue
      lines.set(piece, fit.line)
      claims.push(...fit.claims)
      mouths.push(...fit.mouths)
      for (const v of fit.set)
        if (!nodeZ.has(v.id!)) {
          nodeZ.set(v.id!, fit.line.z[fit.line.pts.indexOf(v)]!)
          led.add(v.id!)
          queue.push(v.id!)
        }
    }
  return { lines, claims, mouths }
}

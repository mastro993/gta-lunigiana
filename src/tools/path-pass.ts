// The path pass, after every road's: the paths' and steps' bridges and tunnels profiled from their
// ends' levels over or under the ways they cross (PATH_PASS in profiles.ts), the piers' decks over
// their water, and the paths and steps at grade leading from them fitted as their approaches
// (path-approaches.ts), as are those crossing a deck or a bore on another level, from their
// clearance there (`clearancesAtGrade`).
import { DECK_BALLAST, DECK_SLAB, footReach, isDrivable, reachOf } from "../sim/map/kinds.ts"
import { chainsOf, lifted, type Linear } from "./chains.ts"
import { CORRIDOR } from "./deck-space.ts"
import type { RoadF, WaterF } from "./features.ts"
import { lineBox, segDist2, type V } from "./geometry.ts"
import { coreHalf } from "./grid-claims.ts"
import { pathApproaches, pathsAtGrade } from "./path-approaches.ts"
import { type Bound, type makeProfiler, PATH_PASS } from "./profiles.ts"
import type { railLevels } from "./rail-levels.ts"
import { type Clearance, clearanceAcross, type roadLevels } from "./road-levels.ts"
import { pierDeck } from "./shore.ts"
import { GRID_CELL, type Profile } from "./terrain.ts"

/** What the path pass reads of the roads' and rail's fit before it. */
export interface PathPassInput {
  readonly roads: ReadonlyArray<RoadF>
  /** The uncarved ground. */
  readonly ground: (x: number, y: number) => number
  /** Where each road and rail bridge's deck ends. */
  readonly bridgeEnds: ReadonlySet<string>
  readonly profiler: ReturnType<typeof makeProfiler>
  /** A fitted line's z at arc length `s`. */
  readonly zAt: (l: Linear, s: number) => number
  readonly rail: Pick<ReturnType<typeof railLevels>, "railRoad" | "roadBounds">
  readonly overpasses: ReturnType<typeof roadLevels>
  /** The water's level at a point, if any stands there. */
  readonly levelAt: (x: number, y: number) => number | undefined
  /** The highest water's surface whose bed reaches within `beyond` m of a point, if any (`waterTopOf`). */
  readonly waterTop: (x: number, y: number, beyond?: number) => number | undefined
}

/**
 * The highest surface at (x, y) of the water `levelAt` gives there (a lake's, a river polygon's)
 * and of each water line whose bed reaches within `beyond` m of it (`reachOf`), on its surface
 * profile (`wp`, by water): a path or steps at grade dipping under a deck there would run under it.
 */
export const waterTopOf = (
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  levelAt: (x: number, y: number) => number | undefined,
): ((x: number, y: number, beyond?: number) => number | undefined) => {
  const boxes = water.map((w) => lineBox(w.pts))
  return (x, y, beyond = 0) => {
    let top = levelAt(x, y)
    water.forEach((w, i) => {
      const p = wp[i]!,
        r = reachOf(w) + beyond,
        [x0, y0, x1, y1] = boxes[i]!
      if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) return
      for (let k = 0; k + 1 < p.z.length; k++) {
        const { d2, t } = segDist2(x, y, p.x[k]!, p.y[k]!, p.x[k + 1]!, p.y[k + 1]!)
        if (d2 > r * r) continue
        const z = p.z[k]! + (p.z[k + 1]! - p.z[k]!) * t
        if (top === undefined || z > top) top = z
      }
    })
    return top
  }
}

/**
 * How far off a rail deck's line someone on foot under it is under its slab, m: its ballast and the
 * slab's margin either side (`railSlab` in deck-ground.ts).
 */
const RAIL_SIDE = DECK_BALLAST.width / 2 + DECK_SLAB.margin

/**
 * The clearances each path or steps at grade keeps where it crosses a fitted way on another level:
 * the roads' and the paths' (`clears`, road-levels.ts's `clearances`), and the rail's bridges'
 * over it (`railRoad`, rail-levels.ts), across the rail's slab as a road's deck's (`clearanceAcross`:
 * bound where the lines cross alone, the sidewalk 1473703387 by the SS62 at Sarzana kept the rail
 * bridge 86258970's 5.5 m there and 4.33 m within the levels check's reach). A crossing under a deck
 * that would take it under the water within its core's reach (`waterTop`, `coreHalf`) keeps none,
 * and it keeps the ground there as before: the bank path 159053025 along the Canale Lunense, under
 * Via Fonda's bridge (647881621) level with its bank, would have dipped to the canal's surface
 * there, and shipped its natural level, 0.5 m over the deck; the coast's bank path 326011444 along
 * the Fossa Maestra, 3.99 m under Via Bassagrande's bridge (463589363), at −1.53 m, beside the
 * canal near the sea's level. Only that crossing's: one deck's bound 0.6 m under the water dropped
 * all six of the path 1134003774's.
 */
export const clearancesAtGrade = (
  clears: ReadonlyMap<RoadF, ReadonlyArray<Clearance>>,
  railRoad: ReturnType<typeof railLevels>["railRoad"],
  zAt: (l: Linear, s: number) => number,
  waterTop: (x: number, y: number, beyond?: number) => number | undefined,
): Map<RoadF, Array<Bound>> => {
  const all = new Map([...clears].map(([piece, list]) => [piece, [...list]]))
  for (const { rl, rd, c, clear } of railRoad)
    if (rl.bridge === true && !lifted(rd) && !isDrivable(rd.cls)) {
      const half = RAIL_SIDE + footReach(rd.cls, rd.w) + CORRIDOR
      all.set(rd, [
        ...(all.get(rd) ?? []),
        clearanceAcross(rd, c.sb, rl, half, (at) => zAt(rl, at) - clear, "max"),
      ])
    }
  const out = new Map<RoadF, Array<Bound>>()
  for (const [piece, list] of all) {
    // Within its core's reach of the water, which its claim writes at its level.
    const core = coreHalf(piece.w, GRID_CELL)
    const wet = ({ under }: Clearance) =>
      under.some((b) => b.kind === "max" && b.z < (waterTop(b.x, b.y, core) ?? -Infinity))
    const kept = list.filter((c) => !wet(c)).flatMap((c) => c.bounds)
    if (kept.length > 0) out.set(piece, kept)
  }
  return out
}

/**
 * Profiles the paths' and steps' bridges and tunnels and fits their approaches, their claims on the
 * grid recorded in the profiler's; returns each pier's deck z by vertex and the approaches.
 */
export const pathPass = ({
  roads,
  ground,
  bridgeEnds,
  profiler: { profile, claims, mouth, grown, nodeZ },
  zAt,
  rail: { railRoad, roadBounds },
  overpasses,
  levelAt,
  waterTop,
}: PathPassInput) => {
  // The paths and steps at grade, by the nodes they pass through: a deck's end they lead on from is
  // its approaches' to fit.
  const leads = pathsAtGrade(roads)
  /**
   * The level a path's or steps' bridge or tunnel ends at, `v` an end of `piece`: that of a way
   * fitted before it there, else of the road deck of its OSM level it stands on (`deckUnder`: the
   * sidewalk 1414943238, drawn as its own bridge along the SS62's 92904169 at Aulla, ends on that
   * deck 11 m short of its end, over a track 8 m under it); else, where a path or steps at grade
   * leads on from it, none: the fit sets it and its approach climbs or dips from there to the ground
   * (pinned at the ground's level, the ramp 1408285960 out of Aulla Lunigiana station's underpass
   * climbed 6.3 m in its 18.4 m, 34%, past its grade limit); else, at a dead end, that of a road
   * deck of any OSM level it stands on: the sidewalk 1474250671 (layer 1), drawn as its own bridge
   * along the SS62's 26498548 (layer 2) at Sarzana, fell 5.5 m in its last 4.3 m to the ground at
   * its dead end, 1.4 m from the sidewalk 1473703399 passing under it; else the uncarved ground's.
   * Under the rail, no higher than the road's clearance under it, as in a profiled tunnel (the
   * pedestrian underpass at Equi Terme station).
   */
  const ends = new Map<string, number>()
  for (const r of roads)
    for (const v of new Set(r.pts.map((u) => u.id)))
      if (v !== undefined) ends.set(v, (ends.get(v) ?? 0) + 1)
  const endLevel = (v: V, piece: RoadF) => {
    const at =
      nodeZ.get(v.id!) ??
      overpasses.deckUnder(v, piece) ??
      (leads.has(v.id!)
        ? undefined
        : ((ends.get(v.id!) === 1 ? overpasses.deckUnder(v, piece, true) : undefined) ??
          ground(v.x, v.y)))
    return at === undefined
      ? undefined
      : Math.min(
          ...railRoad.filter((x) => x.rd === piece).map((x) => zAt(x.rl, x.c.sa) - x.clear),
          at,
        )
  }
  // The paths' and steps' bridges and tunnels: each from its ends' levels over or under the ways it
  // crosses; then the paths and steps at grade that lead from their nodes, from those levels to the
  // ground.
  const pathDecks = roads.filter(
    (r) =>
      lifted(r) && r.pier !== true && (PATH_PASS.classes as ReadonlyArray<string>).includes(r.cls),
  )
  for (const ch of grown(chainsOf(pathDecks)))
    profile(ch, { w: (r) => r.w, ...PATH_PASS, ramps: true, ends: endLevel }, [
      ...roadBounds(ch),
      ...overpasses.bounds(ch),
    ])
  // A bore's mouth: the end of a path's or steps' tunnel that no other way in a tunnel passes.
  const bores = new Map<string, number>()
  for (const r of roads)
    if (r.tunnel === true)
      for (const v of r.pts) if (v.id !== undefined) bores.set(v.id, (bores.get(v.id) ?? 0) + 1)
  const mouths = new Set(
    pathDecks.flatMap((r) =>
      r.tunnel === true
        ? [r.pts[0]!.id, r.pts.at(-1)!.id].filter((id) => id !== undefined && bores.get(id) === 1)
        : [],
    ),
  )
  // A pier's deck stands over its water vertex by vertex (`pierDeck`), never fitted: the path pass
  // would lay it straight from its ends' levels. Where a path at grade leads on from its end (the
  // pier's own way cut at the water's edge, `splitPiers`), that end's level is its approach's to
  // meet, as a deck's: the piece on dry ground took the finished grid, 0.2–0.4 m under the deck's end
  // at the coast's piers 1382979298, 1382979299 and 1382979302.
  const pierZ = new Map(
    roads
      .filter((r) => r.pier === true)
      .map((r) => [
        r as Linear,
        pierDeck(
          r.pts,
          (v) => (v.id === undefined ? undefined : nodeZ.get(v.id)) ?? ground(v.x, v.y),
          levelAt,
        ),
      ]),
  )
  const pierEnds: Array<string> = []
  for (const [l, z] of pierZ)
    for (const k of [0, l.pts.length - 1]) {
      const id = l.pts[k]!.id
      if (id === undefined || !leads.has(id) || nodeZ.has(id)) continue
      nodeZ.set(id, z[k]!)
      pierEnds.push(id)
    }
  const clears = clearancesAtGrade(overpasses.clearances(), railRoad, zAt, waterTop)
  const approaches = pathApproaches(
    leads,
    [
      ...new Set(
        pathDecks.flatMap((r) => r.pts.flatMap((v) => (v.id === undefined ? [] : [v.id]))),
      ),
      ...pierEnds,
    ],
    nodeZ,
    (piece) => clears.get(piece) ?? [],
    {
      ground,
      mouthAt: (id) => mouths.has(id),
      deckEndAt: (id) => bridgeEnds.has(id),
    },
    [...clears.keys()],
  )
  claims.push(...approaches.claims)
  for (const m of approaches.mouths) mouth(m)
  return { pierZ, approaches }
}

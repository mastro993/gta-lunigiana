// The path pass, after every road's: the paths' and steps' bridges and tunnels profiled from their
// ends' levels over or under the ways they cross (PATH_PASS in profiles.ts), the piers' decks over
// their water, and the paths and steps at grade leading from them fitted as their approaches
// (path-approaches.ts).
import { chainsOf, lifted, type Linear } from "./chains.ts"
import type { RoadF } from "./features.ts"
import type { V } from "./geometry.ts"
import { pathApproaches, pathsAtGrade } from "./path-approaches.ts"
import { type Bound, type makeProfiler, PATH_PASS } from "./profiles.ts"
import type { railLevels } from "./rail-levels.ts"
import type { roadLevels } from "./road-levels.ts"
import { pierDeck } from "./shore.ts"

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
}

/**
 * Profiles the paths' and steps' bridges and tunnels and fits their approaches, their claims on the
 * grid recorded in the profiler's; returns each pier's deck z by vertex and the approaches.
 */
export const pathPass = ({
  roads,
  ground,
  bridgeEnds,
  profiler: { profile, claims, mouth, grown, nodeZ, zOf },
  zAt,
  rail: { railRoad, roadBounds },
  overpasses,
  levelAt,
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
   * climbed 6.3 m in its 18.4 m, 34%, past its grade limit); else the uncarved ground's. Under the rail, no
   * higher than the road's clearance under it, as in a profiled tunnel (the pedestrian underpass at
   * Equi Terme station).
   */
  const endLevel = (v: V, piece: RoadF) => {
    const at =
      nodeZ.get(v.id!) ??
      overpasses.deckUnder(v, piece) ??
      (leads.has(v.id!) ? undefined : ground(v.x, v.y))
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
  const approaches = pathApproaches(
    leads,
    [
      ...new Set(
        pathDecks.flatMap((r) => r.pts.flatMap((v) => (v.id === undefined ? [] : [v.id]))),
      ),
      ...pierEnds,
    ],
    nodeZ,
    // Over a fitted tunnel or under a fitted bridge, the clearance between them (road-levels.ts).
    (piece) =>
      overpasses.over.flatMap(({ up, down, c, clear }): Array<Bound> =>
        up === piece && down.tunnel === true && zOf.has(down)
          ? [{ x: c.x, y: c.y, z: zAt(down, c.sb) + clear, kind: "min" }]
          : down === piece && up.bridge === true && zOf.has(up)
            ? [{ x: c.x, y: c.y, z: zAt(up, c.sa) - clear, kind: "max" }]
            : [],
      ),
    {
      ground,
      mouthAt: (id) => mouths.has(id),
      deckEndAt: (id) => bridgeEnds.has(id),
    },
  )
  claims.push(...approaches.claims)
  for (const m of approaches.mouths) mouth(m)
  return { pierZ, approaches }
}

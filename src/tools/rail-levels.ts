// Where the rail and the roads meet in height: a road under a rail bridge (or in a tunnel under the
// rail) keeps its clearance under it, a road bridge over the rail clears a train, and a rail bridge
// stays over the river it crosses. The profiles pin these as bounds. At a level crossing the rail
// keeps its own grade and the road, profiled after it, meets it there (a rail pinned to the road's
// level made a V of up to 5% in its grade).
import type { RailF, RoadF, WaterF } from "./features.ts"
import { along, arcLengths, crossings, type V } from "./geometry.ts"
import type { Bound, Linear } from "./profiles.ts"
import type { Profile } from "./terrain.ts"

/** What the bounds are read from: the rail, the roads, the water with its surface profiles, the uncarved ground, and each profiled line's z at arc length s. */
interface LevelsInput {
  readonly allRail: ReadonlyArray<RailF>
  readonly roads: ReadonlyArray<RoadF>
  readonly water: ReadonlyArray<WaterF>
  readonly wp: ReadonlyArray<Profile>
  readonly ground: (x: number, y: number) => number
  readonly zAt: (l: Linear, s: number) => number
}

/** The rail's crossings with the roads (`railRoad`: rail over road, `roadRail`: road bridge over rail, `levels`: level crossings) and the bounds they put on road and rail profiles. */
export const railLevels = ({ allRail, roads, water, wp, ground, zAt }: LevelsInput) => {
  const RAIL_DECK = 1.5 // rail bridge structure above an underpass's clear height, m
  // Rail bed to the surface of a road bridge over it, m: the rail head 0.12, the ATR 220's 4.185 m,
  // 0.3 m of clearance and the 0.9 m deck the render draws under a road bridge.
  const UNDER_ROAD = 5.5
  const UNDERPASS = 4 // clear height of an untagged underpass, m
  const RAIL_OVER_WATER = 3 // minimum rail height over the river it bridges, m (more fights the station level crossing 25 m away)
  // Water at least this wide (m) is a river the rail bridges high; under the CTR's short bridges over
  // narrower streams the line keeps its level (the water dips under the deck, water.ts).
  const RIVER = 4
  /** A level crossing: rail and road share a vertex where they cross. */
  const level = (rl: RailF, rd: RoadF, c: V) =>
    rl.pts.some(
      (v) =>
        v.id !== undefined &&
        Math.hypot(v.x - c.x, v.y - c.y) < 0.1 &&
        rd.pts.some((u) => u.id === v.id),
    )
  /** Rail over road without a shared node (rail bridge or road tunnel): the road keeps the clearance under the rail. A rail tunnel passes under. */
  const railRoad = allRail.flatMap((rl) =>
    roads.flatMap((rd) => {
      if (rl.bridge !== true && rd.tunnel !== true) return []
      return crossings(rl.pts, rd.pts)
        .filter((c) => !level(rl, rd, c))
        .map((c) => ({
          rl,
          rd,
          c,
          clear: (rd.maxheight ?? UNDERPASS) + RAIL_DECK,
          tagged: rd.maxheight !== undefined,
        }))
    }),
  )
  /** A road bridge over at-grade rail (the one by Equi Terme): the train passes under its deck. */
  const roadRail = allRail.flatMap((rl) =>
    rl.bridge === true || rl.tunnel === true
      ? []
      : roads.flatMap((rd) =>
          rd.bridge === true
            ? crossings(rl.pts, rd.pts)
                .filter((c) => !level(rl, rd, c))
                .map((c) => {
                  // The deck before the roads are profiled: the line between the uncarved ground at its ends.
                  const a = rd.pts[0]!,
                    b = rd.pts.at(-1)!,
                    t = c.sb / (arcLengths(rd.pts).at(-1)! || 1)
                  return { rl, rd, c, deck: ground(a.x, a.y) * (1 - t) + ground(b.x, b.y) * t }
                })
            : [],
        ),
  )
  type Chain = ReadonlyArray<{ readonly item: Linear }>
  /** Mean uncarved ground along `l` within 35 m (arc length) of `s`: a road's natural level before it is profiled. */
  const naturalAt = (l: Linear, s: number) => {
    const ss = arcLengths(l.pts)
    let sum = 0,
      n = 0
    for (let d = Math.max(0, s - 35); d <= Math.min(ss.at(-1)!, s + 35); d += 2, n++)
      sum += ground(
        along(
          ss,
          l.pts.map((v) => v.x),
          d,
        ),
        along(
          ss,
          l.pts.map((v) => v.y),
          d,
        ),
      )
    return sum / Math.max(1, n)
  }
  /** Roads under the rail stay at least that far below it, and a road bridge over it UNDER_ROAD above. */
  const roadBounds = (chain: Chain): Array<Bound> => [
    ...railRoad
      .filter((x) => chain.some((m) => m.item === x.rd))
      .map((x) => ({ x: x.c.x, y: x.c.y, z: zAt(x.rl, x.c.sa) - x.clear, kind: "max" as const })),
    ...roadRail
      .filter((x) => chain.some((m) => m.item === x.rd))
      .map((x) => ({
        x: x.c.x,
        y: x.c.y,
        z: zAt(x.rl, x.c.sa) + UNDER_ROAD,
        kind: "min" as const,
      })),
  ]
  /** Level crossings: a rail node shared with a road. */
  const levels = allRail.flatMap((rl) =>
    roads.flatMap((rd) =>
      rd.pts.flatMap((v) =>
        v.id !== undefined && rl.pts.some((u) => u.id === v.id) ? [{ rl, rd, v }] : [],
      ),
    ),
  )
  /**
   * The rail stays at least maxheight + RAIL_DECK over the natural level of a tagged underpass (a
   * sign gives the least clearance: the Via delle Cave deck stands 1.1–3.3 m higher, and pinning
   * the rail to it held the line 2.7 m under its bed for 1.9 km), UNDER_ROAD under a road bridge's
   * deck, and RAIL_OVER_WATER above the river it bridges.
   */
  const railBounds = (chain: Chain): Array<Bound> => [
    ...railRoad
      .filter((x) => x.tagged && chain.some((m) => m.item === x.rl))
      .map((x) => ({
        x: x.c.x,
        y: x.c.y,
        z: naturalAt(x.rd, x.c.sb) + x.clear,
        kind: "min" as const,
      })),
    ...roadRail
      .filter((x) => chain.some((m) => m.item === x.rl))
      .map((x) => ({ x: x.c.x, y: x.c.y, z: x.deck - UNDER_ROAD, kind: "max" as const })),
    ...chain
      .filter((m) => m.item.bridge === true)
      .flatMap((m) =>
        water.flatMap((w, wi) =>
          (w.w < RIVER ? [] : crossings(m.item.pts, w.pts)).map((c) => ({
            x: c.x,
            y: c.y,
            z: along(wp[wi]!.s, wp[wi]!.z, c.sb) + RAIL_OVER_WATER,
            kind: "min" as const,
          })),
        ),
      ),
  ]
  return { railRoad, roadRail, levels, roadBounds, railBounds }
}

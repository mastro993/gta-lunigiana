/**
 * Tunnel mouths: where each tunnel's line comes out of the hill, and what stands there. At the
 * railway's, inside the play area, a portal round a single track, found from `MAP.rail` when asked;
 * at each road tunnel's, a portal, an underpass's head wall or neither (an open mouth), which the
 * build bakes into `MAP.derived.mouths` (`bakeMouths`, from src/tools/bake.ts). `standing` gives
 * what stands, for render/portals to draw; the ground under a face wall and a throat's length
 * where none is baked are read on its first draw (`measured`), as a chunk builds only once the
 * tiles it reads are in.
 *
 * @module render/mouths
 */
import { Ops } from "@typeonce/ritmo-math"

import type { Layer } from "../../sim/map/format/tile-file.ts"
import { ROAD_LIFT, terrainZ } from "../../sim/map/ground.ts"
import {
  type Building,
  MAP,
  type MouthEntry,
  outlineDistance,
  RAIL_LIFT,
  type Road,
  roadClassOf,
} from "../../sim/map/index.ts"
import { boreOf, isBored } from "../bores.ts"
import { clearance, type Footprint, nearMouth } from "./clear.ts"
import {
  CORNICE,
  crownUnder,
  headWall,
  leastCover,
  leastWall,
  overThroat,
  type Portal,
  portalRound,
  RAIL_PORTAL,
  THICK,
  THROAT,
} from "./shapes.ts"
import {
  groundOver,
  housed,
  housesNear,
  inFrom,
  linesIn,
  measure,
  tunnelsOf,
} from "./tunnel-lines.ts"

export { leastWall } from "./shapes.ts"

/** A tunnel's mouth faces along its line over this chord, m. */
const CHORD = 5
/** A road portal stands back at most this far into its tunnel, m, to keep off the roads at its mouth. */
const SETBACK = 40

/** A line in a tunnel: its points and their elevations. */
interface Line {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/**
 * The mouths of `lines` that `mouthy` keeps: each end that no other line in a tunnel (`tunnel`)
 * ends at, off the play area's edge (farther than 0.5 m from its outline, where a line runs on past
 * it), with its vertex and the heading out along the line over CHORD m.
 */
const mouthsOf = <L extends Line>(
  lines: ReadonlyArray<L>,
  tunnel: (line: L) => boolean,
  mouthy: (line: L) => boolean,
): Array<{
  readonly line: number
  readonly end: number
  readonly x: number
  readonly y: number
  readonly angle: number
}> => {
  const ends = new Map<string, number>()
  for (const line of lines)
    if (tunnel(line))
      for (const k of [0, line.z.length - 1]) {
        const key = `${line.pts[2 * k]},${line.pts[2 * k + 1]}`
        ends.set(key, (ends.get(key) ?? 0) + 1)
      }
  return lines.flatMap((line, i) => {
    if (!mouthy(line)) return []
    const n = line.z.length
    return [0, n - 1].flatMap((end) => {
      const x = line.pts[2 * end]!,
        y = line.pts[2 * end + 1]!
      if (ends.get(`${x},${y}`) !== 1 || outlineDistance(x, y) <= 0.5) return []
      // Into the tunnel along the line, over CHORD m.
      const step = end === 0 ? 1 : -1
      let k = end + step
      while (
        k > 0 &&
        k < n - 1 &&
        Math.hypot(line.pts[2 * k]! - x, line.pts[2 * k + 1]! - y) < CHORD
      )
        k += step
      return [
        {
          line: i,
          end,
          x,
          y,
          angle: Ops.atan2(y - line.pts[2 * k + 1]!, x - line.pts[2 * k]!),
        },
      ]
    })
  })
}

/** The lower of the terrain's heights (m a.s.l.) under the ends of a face wall `half` m either side of (x, y), across the heading (ux, uy). */
const sidesLow = (x: number, y: number, ux: number, uy: number, half: number): number =>
  Math.min(terrainZ(x - uy * half, y + ux * half), terrainZ(x + uy * half, y - ux * half))

/**
 * How far (m) the throat of a portal at (x, y), heading out (ux, uy), runs into the hill: from
 * THROAT.shortest on, a metre at a time, until the hill over its centreline stands at `top` (m
 * a.s.l.), at most `most` m.
 */
const throatOf = (
  x: number,
  y: number,
  ux: number,
  uy: number,
  top: number,
  most: number,
): number => {
  let deep = Math.min(THROAT.shortest, most)
  while (deep < most && terrainZ(x - ux * (THICK + deep), y - uy * (THICK + deep)) < top) deep++
  return deep
}

/**
 * A portal or a head wall where it stands: map x, y, the floor (m a.s.l.: the rail head, or the
 * road's surface), the heading out of the hill (rad), its shape, the road tunnel's road (its index
 * in the whole map's roads; none for the railway's), and how far its throat runs in, m, where the
 * build baked it.
 */
export interface Standing {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly portal: Portal
  readonly road?: number
  readonly throat?: number
}

/** What stands at the road tunnel's mouth `mouth`: its portal or its head wall, or nothing at an open mouth. */
const standOf = (mouth: MouthEntry): Standing | undefined => {
  if ("open" in mouth) return undefined
  const bore = boreOf(MAP.roads[mouth.road]!)
  return {
    x: mouth.x,
    y: mouth.y,
    z: mouth.z,
    angle: mouth.angle,
    portal: "head" in mouth ? headWall(bore) : portalRound(bore, mouth.crown),
    road: mouth.road,
    throat: mouth.throat,
  }
}

/** A portal at each railway tunnel mouth, then a portal or a head wall at each road tunnel mouth the build baked one at (`MAP.derived.mouths`). Reads no map tile. */
export const standing = (): Array<Standing> => [
  ...mouthsOf(
    MAP.rail,
    (rail) => rail.tunnel === true,
    (rail) => rail.tunnel === true,
  ).map(({ line, end, x, y, angle }) => ({
    x,
    y,
    z: MAP.rail[line]!.z[end]! + RAIL_LIFT,
    angle,
    portal: RAIL_PORTAL,
  })),
  ...MAP.derived.mouths.flatMap((mouth) => standOf(mouth) ?? []),
]

/**
 * What a portal or a head wall standing at `at` reads of the ground, on its first draw: the lower
 * of the terrain's heights under its face wall's ends (m a.s.l.), and how far its throat runs in
 * (as baked, else until the hill stands over it).
 */
export const measured = (at: Standing): { readonly low: number; readonly throat: number } => {
  const ux = Ops.cos(at.angle),
    uy = Ops.sin(at.angle)
  return {
    low: sidesLow(at.x, at.y, ux, uy, at.portal.half),
    throat: at.throat ?? throatOf(at.x, at.y, ux, uy, overThroat(at.z, at.portal), THROAT.longest),
  }
}

/**
 * Every road tunnel's mouth of `roads` (the whole map's, `ids` their indices) under `buildings`
 * (the whole map's): an end of a road in a tunnel, not a building passage, that no other road in a
 * tunnel goes on from, inside the play area. Its end of the tunnel is its road's line from there,
 * run on along the roads of its tunnel that go on from it (`linesIn`), THROAT.longest m in, short
 * of the tunnel's middle; where a house stands over the way there at its level, the ground under
 * its lowest corner less than the bore's clear height over the road (a covered way, which the house
 * hides as it hides a building passage), the mouth is open.
 * - A portal stands there where the ground over its tunnel (the roads in a tunnel joined end to end
 *   with it) rises somewhere along it to `leastCover` over the road: its arch rises as the
 *   railway's, or as far under that ground as its face wall leaves room for. Its throat runs in
 *   until the hill stands over it. Where its face wall would stand on another road (the mouth at a
 *   junction, a road crossing just in front of the hill) it stands back into the tunnel along its
 *   line, a metre at a time, until it stands clear, short of the tunnel's middle.
 * - Else an underpass's head wall stands at the mouth where the ground over its end rises to
 *   `leastWall`: its box runs in until the hill stands that high over the road, and must get there,
 *   so its top never stands over the bank it meets. It never stands back: in a bank lower than a
 *   portal's, the road in front of it would run under the ground.
 * A throat or a box never runs past the tunnel's middle nor onto a road or the track (`clearance`).
 * Elsewhere the mouth is open: the ground over its end lower than a head wall (a road under a
 * bridge, or under a cover the map's ground does not hold), or no room for either. The build bakes
 * them (src/tools/bake.ts): a mouth's tunnel, and the roads and the houses round it, reach past the
 * tiles round it.
 */
export const bakeMouths = (
  { ids, items }: Layer<Road>,
  buildings: ReadonlyArray<Building>,
): Array<MouthEntry> => {
  const tunnels = tunnelsOf(items),
    houses = housesNear(buildings)
  return mouthsOf(items, (road) => road.tunnel === true, isBored).map(
    ({ line, end, x, y, angle }) => {
      const road = items[line]!,
        bore = boreOf(road),
        lift = ROAD_LIFT[roadClassOf(road)],
        open = { road: ids[line]!, x, y, z: road.z[end]! + lift, angle, open: true as const }
      const tunnel = tunnels.get(line)!,
        { length, cover } = measure(items, tunnel),
        span = Math.min(THROAT.longest, length / 2),
        lines = linesIn(items, tunnel, line, end, span)
      if (housed(lines, span, bore.clear, houses(x, y, span))) return open
      // The first spot, from the road's end up to `setback` m in, where `shape` stands clear of the
      // roads round it and its throat runs `box` m in (at (x, y) heading out (ux, uy) on the floor
      // `floor`, m a.s.l., at most `most` m; undefined where it cannot stand there): the entry,
      // `kind` its own fields.
      const stand = <K extends object>(
        shape: Portal,
        kind: K,
        setback: number,
        box: (
          x: number,
          y: number,
          ux: number,
          uy: number,
          floor: number,
          most: number,
        ) => number | undefined,
      ) => {
        const print: Footprint = {
            face: {
              from: -CORNICE.proud,
              to: THICK + CORNICE.proud,
              half: shape.half + CORNICE.proud,
              top: shape.high + CORNICE.high,
            },
            throat: { from: THICK, half: shape.throat.half, top: shape.throat.high },
            arch: bore.half,
          },
          near = nearMouth(
            items,
            tunnel,
            x,
            y,
            Ops.cos(angle),
            Ops.sin(angle),
            // As far as one stood back its most, its throat and its face wall's side reach.
            setback + THICK + THROAT.longest + shape.half + 10,
          )
        const own = measure(items, [line]).length
        for (
          let back = 0;
          back === 0 || back <= Math.min(setback, own - 1, length / 2 - THICK - 1);
          back++
        ) {
          // Stood back, it faces out along the line over the CHORD m behind it.
          const at = inFrom(road, end, back),
            behind = inFrom(road, end, back + CHORD),
            heading = back === 0 ? angle : Ops.atan2(at.y - behind.y, at.x - behind.x),
            ux = Ops.cos(heading),
            uy = Ops.sin(heading),
            z = at.z + lift,
            most = Math.max(1, Math.min(THROAT.longest, Math.floor(length / 2 - THICK - back))),
            foot = Math.min(sidesLow(at.x, at.y, ux, uy, shape.half), z) - 0.5,
            clear = clearance(near, at.x, at.y, z, ux, uy, foot, print)
          if (clear === undefined || clear < Math.min(THROAT.shortest, most)) continue
          const throat = box(at.x, at.y, ux, uy, z, Math.min(most, Math.floor(clear)))
          if (throat === undefined) continue
          return { road: ids[line]!, x: at.x, y: at.y, z, angle: heading, ...kind, throat, back }
        }
        return undefined
      }
      if (cover >= leastCover(road)) {
        const crown = crownUnder(bore, cover),
          portal = portalRound(bore, crown),
          placed = stand(portal, { crown }, SETBACK, (px, py, ux, uy, floor, most) =>
            throatOf(px, py, ux, uy, overThroat(floor, portal), most),
          )
        if (placed !== undefined) return placed
      }
      // A head wall's box runs in until the hill stands `leastWall` over the floor, and must get
      // there; it stands at the mouth or not at all. The bank is asked over the road's surface (its
      // profile and lift), the floor the box measures from.
      const least = leastWall(road)
      if (groundOver(lines, span) - lift >= least) {
        const placed = stand(
          headWall(bore),
          { head: true as const },
          0,
          (px, py, ux, uy, floor, most) => {
            const deep = throatOf(px, py, ux, uy, floor + least, most)
            return terrainZ(px - ux * (THICK + deep), py - uy * (THICK + deep)) >= floor + least
              ? deep
              : undefined
          },
        )
        if (placed !== undefined) return placed
      }
      return open
    },
  )
}

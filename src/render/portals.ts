/**
 * Tunnel portals, drawn chunk by chunk, each whole in its chunk: a face wall and its cornice, the
 * dark mouth, and a lined throat into the hill. One stands at each mouth of the railway's tunnels
 * (an end of a tunnel piece of `MAP.rail` that no other tunnel piece carries on, inside the play
 * area), in old stone round a single track, and at each road tunnel's mouth the hill stands over
 * (`MAP.derived.mouths`, which the build bakes: `bakeMouths`), sized to the road's bore
 * (render/bores), coloured like its bridges (`bridgeHex`) and clear of the roads and the track round
 * it (render/portal-clear); under a bank too low for one, an underpass's head wall in the same
 * pieces, over a flat-lintelled opening. A train or a car passing a mouth vanishes behind its dark
 * face; the throat hides it where the hill over the tunnel is too low to.
 *
 * @module render/portals
 */
import { Ops } from "@typeonce/ritmo-math"

import { ROAD_LIFT, terrainZ } from "../sim/map/ground.ts"
import {
  type Building,
  MAP,
  type MouthEntry,
  outlineDistance,
  RAIL_LIFT,
  type Road,
  type RoadInfo,
  roadClassOf,
} from "../sim/map/index.ts"
import type { Layer } from "../sim/map/packed.ts"
import { type Bore, boreOf, isBored, UNDER } from "./bores.ts"
import type { Piece } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { bridgeHex } from "./lines.ts"
import { PALETTE } from "./palette.ts"
import { clearance, type Footprint, nearMouth } from "./portal-clear.ts"
import { block } from "./ribbons.ts"
import { groundOver, housed, housesNear, inFrom, measure, tunnelsOf } from "./tunnel-lines.ts"

/**
 * A portal's shape, m: the face wall's half width and height over the floor; the lined throat's
 * half width and height over the floor; and the dark mouth as steps of an arch (half width, top
 * over the floor).
 */
interface Portal {
  readonly half: number
  readonly high: number
  readonly throat: { readonly half: number; readonly high: number }
  readonly mouth: ReadonlyArray<readonly [number, number]>
}

/** How far the face wall stands past the mouth's sides and over its crown, m; the throat, past its sides and over its crown. */
const FACE = { side: 2.6, over: 1.7 } as const
const LINING = { side: 0.8, over: 0.4 } as const
/** The cornice on the face wall, m: how far it stands proud of the wall all round, and its height. */
const CORNICE = { proud: 0.2, high: 0.3 } as const

/**
 * The portal round a tunnel's cross-section: an arch springing at `spring` and rising in three
 * steps to `crown` (half of `half` over the springing, as the railway's, unless given lower), the
 * face wall and the throat round it (FACE, LINING).
 */
const portalRound = (
  { half, spring }: Pick<Bore, "half" | "spring">,
  crown = spring + half / 2,
): Portal => {
  const rise = crown - spring
  return {
    half: half + FACE.side,
    high: crown + FACE.over,
    throat: { half: half + LINING.side, high: crown + LINING.over },
    mouth: [
      [half, spring],
      [(half * 19) / 24, spring + (rise * 2) / 3],
      [(half * 11) / 24, crown],
    ],
  }
}

/** A single-track tunnel's portal: its mouth 4.8 m wide, springing 4.6 m over the rail head, 5.8 m to its crown. */
const RAIL_PORTAL = portalRound({ half: 2.4, spring: 4.6 })

/**
 * An underpass's head wall, m: how far it stands past its opening's sides (over the box's lining,
 * LINING, and as far again as a cornice stands proud), and its flat lintel over the opening, as
 * high as the bore's headroom, so it reaches where a portal's arch would spring.
 */
const HEAD = { side: 1, lintel: 0.5 } as const

/**
 * The head wall round a tunnel's cross-section, where the hill is too low for a portal's arch (an
 * underpass under an embankment): a plain wall over a flat-lintelled opening as wide as the bore
 * and as high as its clear height, under a coping (the portals' cornice), and the box behind it
 * lined round the opening as a portal's throat.
 */
const headWall = ({ half, clear }: Bore): Portal => ({
  half: half + HEAD.side,
  high: clear + HEAD.lintel,
  throat: { half: half + LINING.side, high: clear + LINING.over },
  mouth: [[half, clear]],
})
/** The face wall's thickness, m. */
const THICK = 1
/** The throat runs into the hill at least this far, at most this far, m, until the hill stands over it. */
const THROAT = { shortest: 3, longest: 40 } as const
/** A tunnel's mouth faces along its line over this chord, m. */
const CHORD = 5

/** What a portal is built of: its face wall, cornice and throat. */
interface Stone {
  readonly face: number
  readonly cornice: number
  readonly throat: number
}
/** The railway's portals, and the small roads', tracks' and paths': old stone. */
const OLD_STONE: Stone = {
  face: PALETTE.stoneMid,
  cornice: PALETTE.stoneLight,
  throat: PALETTE.stoneDark,
}
/** The main, provincial and unclassified roads' portals: concrete. */
const CONCRETE: Stone = {
  face: PALETTE.plasterGrey,
  cornice: PALETTE.limestone,
  throat: PALETTE.stoneDark,
}

/** A three-space point. */
type Point3 = readonly [number, number, number]

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

/** The height (render y) the hill must stand at over the end of `portal`'s throat, its floor `floor`: 0.5 m over the throat's top. */
const overThroat = (floor: number, portal: Portal): number => floor + portal.throat.high + 0.5

/**
 * How far (m) the throat of a portal at (x, y), heading out (ux, uy), runs into the hill: from
 * THROAT.shortest on, a metre at a time, until the hill over its centreline stands at `top` (render
 * y), at most `most` m.
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
  while (deep < most && terrainY(x - ux * (THICK + deep), y - uy * (THICK + deep)) < top) deep++
  return deep
}

/** The portal `portal` in `stone` at the mouth (x, y), its floor `floor` (render y), heading out `angle`, its throat `throat` m into the hill (else as `throatOf` finds it). */
const portalPiece = (
  x: number,
  y: number,
  floor: number,
  angle: number,
  portal: Portal,
  stone: Stone,
  throat?: number,
): Piece => ({
  pts: [x, y],
  draw: (at) => {
    const tris = at(x, y).solid,
      ux = Ops.cos(angle),
      uy = Ops.sin(angle),
      top = floor + portal.high
    // A point `a` m out of the hill along the line and `b` m to its left, three space.
    const p = (a: number, b: number, h: number): Point3 => [
      x + ux * a - uy * b,
      h,
      -(y + uy * a + ux * b),
    ]
    const foot = Math.min(yOf(sidesLow(x, y, ux, uy, portal.half)), floor) - 0.5
    const centre = (a: number) => [x + ux * a, -(y + uy * a)] as const
    const [wx, wz] = centre(-THICK / 2)
    block(
      tris,
      wx,
      (foot + top) / 2,
      wz,
      ux,
      -uy,
      THICK / 2,
      (top - foot) / 2,
      portal.half,
      stone.face,
    )
    block(
      tris,
      wx,
      top + CORNICE.high / 2,
      wz,
      ux,
      -uy,
      THICK / 2 + CORNICE.proud,
      CORNICE.high / 2,
      portal.half + CORNICE.proud,
      stone.cornice,
    )
    // The throat runs into the hill until the hill stands over it (a lined cut and cover where the map's ground is low).
    const deep = throat ?? throatOf(x, y, ux, uy, overThroat(floor, portal), THROAT.longest),
      { half, high } = portal.throat
    const [tx, tz] = centre(-THICK - deep / 2)
    block(
      tris,
      tx,
      (foot + floor + high) / 2,
      tz,
      ux,
      -uy,
      deep / 2,
      (floor + high - foot) / 2,
      half,
      stone.throat,
    )
    let bottom = floor - 0.3
    for (const [w, step] of portal.mouth) {
      tris.face(
        p(0.02, -w, bottom),
        p(0.02, w, bottom),
        p(0.02, w, floor + step),
        p(0.02, -w, floor + step),
        [ux, 0, -uy],
        PALETTE.tunnelDark,
      )
      bottom = floor + step
    }
  },
})

/** What road `road`'s portals are built of: concrete or old stone, as its bridges (`bridgeHex`). */
const stoneOf = (road: RoadInfo): Stone =>
  bridgeHex(road) === PALETTE.plasterGrey ? CONCRETE : OLD_STONE

/**
 * The least height (m over the road) the ground over road `road`'s tunnel must rise to somewhere
 * along it for a portal to stand at its mouth: the face wall over a flat arch at the springing.
 */
const leastCover = (road: RoadInfo): number => boreOf(road).spring + FACE.over

/**
 * The least height (m over the road) the ground over the end of road `road`'s tunnel by a mouth
 * must rise to for a head wall to stand there: its coping's top (the clear height, the lintel and
 * the coping: 4.8 m untagged) and the margin the bore's walls keep under the terrain (UNDER), so a
 * head wall never stands out of its bank.
 */
export const leastWall = (road: RoadInfo): number =>
  headWall(boreOf(road)).high + CORNICE.high + UNDER

/** A portal at each railway tunnel mouth, then a portal or a head wall at each road tunnel mouth the hill stands over, each whole in its chunk. */
export const portalPieces = (): Array<Piece> => [
  ...mouthsOf(
    MAP.rail,
    (rail) => rail.tunnel === true,
    (rail) => rail.tunnel === true,
  ).map(({ line, end, x, y, angle }) =>
    portalPiece(x, y, yOf(MAP.rail[line]!.z[end]! + RAIL_LIFT), angle, RAIL_PORTAL, OLD_STONE),
  ),
  ...MAP.derived.mouths.flatMap((mouth) => {
    if ("open" in mouth) return []
    const road = MAP.roads[mouth.road]!,
      bore = boreOf(road),
      shape = "head" in mouth ? headWall(bore) : portalRound(bore, mouth.crown)
    return [
      portalPiece(mouth.x, mouth.y, yOf(mouth.z), mouth.angle, shape, stoneOf(road), mouth.throat),
    ]
  }),
]

/** A road portal or head wall stands back at most this far into its tunnel, m, to keep off the roads at its mouth. */
const SETBACK = 40

/**
 * Every road tunnel's mouth of `roads` (the whole map's, `ids` their indices) under `buildings`
 * (the whole map's): an end of a road in a tunnel, not a building passage, that no other road in a
 * tunnel goes on from, inside the play area. Its end of the tunnel is its road's line from there
 * THROAT.longest m in, short of the tunnel's middle; where a house stands over the way there at its
 * level, the ground under its lowest corner less than the bore's clear height over the road (a
 * covered way, which the house hides as it hides a building passage), the mouth is open.
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
        span = Math.min(THROAT.longest, length / 2)
      if (housed(road, end, span, bore.clear, houses(x, y, span))) return open
      // The first spot, from the road's end up to `setback` m in, where `shape` stands clear of the
      // roads round it and its throat runs `box` m in (at (x, y) heading out (ux, uy) on the floor
      // `floor`, render y, at most `most` m; undefined where it cannot stand there): the entry,
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
          const throat = box(at.x, at.y, ux, uy, yOf(z), Math.min(most, Math.floor(clear)))
          if (throat === undefined) continue
          return { road: ids[line]!, x: at.x, y: at.y, z, angle: heading, ...kind, throat, back }
        }
        return undefined
      }
      if (cover >= leastCover(road)) {
        const crown = Math.min(bore.spring + bore.half / 2, cover - FACE.over),
          portal = portalRound(bore, crown),
          placed = stand(portal, { crown }, SETBACK, (px, py, ux, uy, floor, most) =>
            throatOf(px, py, ux, uy, overThroat(floor, portal), most),
          )
        if (placed !== undefined) return placed
      }
      // A head wall's box runs in until the hill stands `leastWall` over the floor, and must get
      // there; it stands at the mouth or not at all.
      const least = leastWall(road)
      if (groundOver(road, end, 0, span) >= least) {
        const placed = stand(
          headWall(bore),
          { head: true as const },
          0,
          (px, py, ux, uy, floor, most) => {
            const deep = throatOf(px, py, ux, uy, floor + least, most)
            return terrainY(px - ux * (THICK + deep), py - uy * (THICK + deep)) >= floor + least
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

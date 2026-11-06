/**
 * Tunnel portals, drawn chunk by chunk, each whole in its chunk: a face wall and its cornice, the
 * dark mouth, and a lined throat into the hill. One stands at each mouth of the railway's tunnels
 * (an end of a tunnel piece of `MAP.rail` that no other tunnel piece carries on, inside the play
 * area), in old stone round a single track, and at each road tunnel's mouth the hill stands over
 * (`MAP.derived.mouths`, which the build bakes: `bakeMouths`), sized to the road's bore
 * (render/bores) and coloured like its bridges (`bridgeHex`). A train or a car passing a mouth
 * vanishes behind its dark face; the throat hides it where the hill over the tunnel is too low to.
 *
 * @module render/portals
 */
import { Ops } from "@typeonce/ritmo-math"

import { ROAD_LIFT, terrainZ } from "../sim/map/ground.ts"
import {
  MAP,
  type MouthEntry,
  outlineDistance,
  RAIL_LIFT,
  type Road,
  type RoadInfo,
  roadClassOf,
} from "../sim/map/index.ts"
import type { Layer } from "../sim/map/packed.ts"
import { type Bore, boreOf, isBored } from "./bores.ts"
import type { Piece } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { bridgeHex } from "./lines.ts"
import { PALETTE } from "./palette.ts"
import { block } from "./ribbons.ts"

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

/**
 * The portal round a tunnel's cross-section: an arch springing at `spring` and rising in three
 * steps to `crown` (half of `half` over the springing, as the railway's, unless given lower), the
 * face wall and the throat round it (FACE, LINING).
 */
const portalRound = ({ half, spring }: Bore, crown = spring + half / 2): Portal => {
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
/** The face wall's thickness, m. */
const THICK = 1
/** The throat runs into the hill at least this far, at most this far, m, until the hill stands over it. */
const THROAT = { shortest: 3, longest: 40 } as const
/** A tunnel's mouth faces along its line over this chord, m. */
const CHORD = 5
/** The ground over a road tunnel is sampled every this many metres along it. */
const SAMPLE = 2

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

/**
 * How far (m) the throat of `portal` at (x, y), heading out (ux, uy), runs into the hill: from
 * THROAT.shortest on, a metre at a time, until the hill over its centreline stands 0.5 m over its
 * top (`floor` + its height, render y), at most `most` m.
 */
const throatOf = (
  x: number,
  y: number,
  ux: number,
  uy: number,
  floor: number,
  portal: Portal,
  most: number,
): number => {
  let deep = Math.min(THROAT.shortest, most)
  while (
    deep < most &&
    terrainY(x - ux * (THICK + deep), y - uy * (THICK + deep)) < floor + portal.throat.high + 0.5
  )
    deep++
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
    const foot =
      Math.min(
        ...[-1, 1].map((side) =>
          terrainY(x - uy * portal.half * side, y + ux * portal.half * side),
        ),
        floor,
      ) - 0.5
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
      top + 0.15,
      wz,
      ux,
      -uy,
      THICK / 2 + 0.2,
      0.15,
      portal.half + 0.2,
      stone.cornice,
    )
    // The throat runs into the hill until the hill stands over it (a lined cut and cover where the map's ground is low).
    const deep = throat ?? throatOf(x, y, ux, uy, floor, portal, THROAT.longest),
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
export const leastCover = (road: RoadInfo): number => boreOf(road).spring + FACE.over

/** A portal at each railway tunnel mouth, then at each road tunnel mouth the hill stands over, each whole in its chunk. */
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
      portal = portalRound(boreOf(road), mouth.crown)
    return [
      portalPiece(mouth.x, mouth.y, yOf(mouth.z), mouth.angle, portal, stoneOf(road), mouth.throat),
    ]
  }),
]

/** The roads in a tunnel joined end to end with each road of `roads` that is in one (each a list of indices into `roads`). */
const tunnelsOf = (roads: ReadonlyArray<Road>): Map<number, Array<number>> => {
  const at = new Map<string, Array<number>>()
  roads.forEach((road, i) => {
    if (road.tunnel !== true) return
    for (const k of [0, road.z.length - 1]) {
      const key = `${road.pts[2 * k]},${road.pts[2 * k + 1]}`
      at.set(key, [...(at.get(key) ?? []), i])
    }
  })
  const tunnels = new Map<number, Array<number>>()
  roads.forEach((road, i) => {
    if (road.tunnel !== true || tunnels.has(i)) return
    const tunnel = [i]
    for (let n = 0; n < tunnel.length; n++) {
      const { pts, z } = roads[tunnel[n]!]!
      for (const k of [0, z.length - 1])
        for (const j of at.get(`${pts[2 * k]},${pts[2 * k + 1]}`)!)
          if (!tunnel.includes(j)) tunnel.push(j)
    }
    for (const j of tunnel) tunnels.set(j, tunnel)
  })
  return tunnels
}

/** How long the roads `tunnel` of `roads` are together, m, and how high the ground stands over them at most (m over the road's profile, every SAMPLE m along them). */
const measure = (
  roads: ReadonlyArray<Road>,
  tunnel: ReadonlyArray<number>,
): { readonly length: number; readonly cover: number } => {
  let length = 0,
    cover = Number.NEGATIVE_INFINITY
  for (const i of tunnel) {
    const { pts, z } = roads[i]!
    for (let k = 0; k + 1 < z.length; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        dx = pts[2 * k + 2]! - ax,
        dy = pts[2 * k + 3]! - ay,
        l = Math.hypot(dx, dy),
        n = Math.max(1, Math.ceil(l / SAMPLE))
      length += l
      for (let j = 0; j <= n; j++)
        cover = Math.max(
          cover,
          terrainZ(ax + (dx * j) / n, ay + (dy * j) / n) - (z[k]! + ((z[k + 1]! - z[k]!) * j) / n),
        )
    }
  }
  return { length, cover }
}

/**
 * Every road tunnel's mouth of `roads` (the whole map's, `ids` their indices): an end of a road in
 * a tunnel, not a building passage, that no other road in a tunnel goes on from, inside the play
 * area. A portal stands there where the ground over its tunnel (the roads in a tunnel joined end to
 * end with it) rises somewhere along it to `leastCover` over the road: its arch rises as the
 * railway's, or as far under that ground as its face wall leaves room for (an underpass under an
 * embankment), and its throat runs in until the hill stands over it, never past the tunnel's
 * middle. Elsewhere the mouth is open (a road under a bridge, or under a cover the map's ground does
 * not hold). The build bakes them (src/tools/bake.ts): a mouth's tunnel reaches past the tiles
 * round it.
 */
export const bakeMouths = ({ ids, items }: Layer<Road>): Array<MouthEntry> => {
  const tunnels = tunnelsOf(items)
  return mouthsOf(items, (road) => road.tunnel === true, isBored).map(
    ({ line, end, x, y, angle }) => {
      const road = items[line]!,
        bore = boreOf(road),
        z = road.z[end]! + ROAD_LIFT[roadClassOf(road)],
        mouth = { road: ids[line]!, x, y, z, angle }
      const { length, cover } = measure(items, tunnels.get(line)!)
      if (cover < leastCover(road)) return { ...mouth, open: true as const }
      const crown = Math.min(bore.spring + bore.half / 2, cover - FACE.over),
        most = Math.max(1, Math.min(THROAT.longest, Math.floor(length / 2 - THICK)))
      return {
        ...mouth,
        crown,
        throat: throatOf(
          x,
          y,
          Ops.cos(angle),
          Ops.sin(angle),
          yOf(z),
          portalRound(bore, crown),
          most,
        ),
      }
    },
  )
}

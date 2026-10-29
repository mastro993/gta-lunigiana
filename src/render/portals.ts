/**
 * Tunnel portals, drawn chunk by chunk: one at each mouth of the railway's tunnels (an end of a
 * tunnel piece of `MAP.rail` that no other tunnel piece carries on, inside the map), each whole in
 * its chunk. A train passing a mouth vanishes behind its dark face; the lined throat behind hides it
 * where the hill over the tunnel is too low to.
 *
 * @module render/portals
 */
import { MAP, RAIL_LIFT } from "../sim/map/index.ts"
import type { Piece } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { block } from "./ribbons.ts"

/**
 * A tunnel portal, m from the mouth: the face wall's half width, height over the rail head and thickness; the lined throat
 * behind it, running into the hill (at least `shortest`, at most `longest`) until the hill stands over it; and the mouth of
 * a single-track tunnel, about 4.8 m wide and 5.8 m to its crown, as three steps of an arch (half width, top over the rail
 * head).
 */
const PORTAL = {
  half: 5,
  high: 7.5,
  thick: 1,
  throat: { half: 3.2, high: 6.2, shortest: 3, longest: 40 },
  mouth: [
    [2.4, 4.6],
    [1.9, 5.4],
    [1.1, 5.8],
  ],
} as const
/** A tunnel's mouth faces along its track over this chord, m. */
const CHORD = 5

/** A three-space point. */
type Point3 = readonly [number, number, number]

const { minX, minY, maxX, maxY } = MAP.bounds
/** Whether (x, y) lies on the map's edge, where a line runs on past it. */
const onEdge = (x: number, y: number): boolean =>
  x <= minX + 0.5 || x >= maxX - 0.5 || y <= minY + 0.5 || y >= maxY - 0.5

/** Each tunnel's mouth: where a tunnel piece ends and no other tunnel piece goes on, inside the map, with its rail head and the heading out of the hill. */
const tunnelMouths = (): Array<{
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
}> =>
  MAP.rail.flatMap((rail, i) => {
    if (rail.tunnel !== true) return []
    const n = rail.z.length
    return [0, n - 1].flatMap((end) => {
      const x = rail.pts[2 * end]!,
        y = rail.pts[2 * end + 1]!
      const goesOn = MAP.rail.some(
        (other, j) =>
          j !== i &&
          other.tunnel === true &&
          [0, other.z.length - 1].some((k) => other.pts[2 * k] === x && other.pts[2 * k + 1] === y),
      )
      if (goesOn || onEdge(x, y)) return []
      // Into the tunnel along the piece, over CHORD m.
      const step = end === 0 ? 1 : -1
      let k = end + step
      while (
        k > 0 &&
        k < n - 1 &&
        Math.hypot(rail.pts[2 * k]! - x, rail.pts[2 * k + 1]! - y) < CHORD
      )
        k += step
      return [
        {
          x,
          y,
          z: rail.z[end]! + RAIL_LIFT,
          angle: Math.atan2(y - rail.pts[2 * k + 1]!, x - rail.pts[2 * k]!),
        },
      ]
    })
  })

/** A portal at each tunnel mouth, whole in its chunk: the stone face wall and its cornice, the dark mouth, the lined throat into the hill. */
export const portalPieces = (): Array<Piece> =>
  tunnelMouths().map(({ x, y, z, angle }) => ({
    pts: [x, y],
    draw: (at) => {
      const tris = at(x, y).solid,
        ux = Math.cos(angle),
        uy = Math.sin(angle)
      const rail = yOf(z),
        top = rail + PORTAL.high
      // A point `a` m out of the hill along the track and `b` m to its left, three space.
      const p = (a: number, b: number, h: number): Point3 => [
        x + ux * a - uy * b,
        h,
        -(y + uy * a + ux * b),
      ]
      const foot =
        Math.min(
          ...[-1, 1].map((side) =>
            terrainY(x - uy * PORTAL.half * side, y + ux * PORTAL.half * side),
          ),
          rail,
        ) - 0.5
      const centre = (a: number) => [x + ux * a, -(y + uy * a)] as const
      const [wx, wz] = centre(-PORTAL.thick / 2)
      block(
        tris,
        wx,
        (foot + top) / 2,
        wz,
        ux,
        -uy,
        PORTAL.thick / 2,
        (top - foot) / 2,
        PORTAL.half,
        PALETTE.stoneMid,
      )
      block(
        tris,
        wx,
        top + 0.15,
        wz,
        ux,
        -uy,
        PORTAL.thick / 2 + 0.2,
        0.15,
        PORTAL.half + 0.2,
        PALETTE.stoneLight,
      )
      // The throat runs into the hill until the hill stands over it (a lined cut and cover where the map's ground is low).
      const { half, high, shortest, longest } = PORTAL.throat
      let deep = shortest
      while (
        deep < longest &&
        terrainY(x - ux * (PORTAL.thick + deep), y - uy * (PORTAL.thick + deep)) < rail + high + 0.5
      )
        deep++
      const [tx, tz] = centre(-PORTAL.thick - deep / 2)
      block(
        tris,
        tx,
        (foot + rail + high) / 2,
        tz,
        ux,
        -uy,
        deep / 2,
        (rail + high - foot) / 2,
        half,
        PALETTE.stoneDark,
      )
      let bottom = rail - 0.3
      for (const [w, step] of PORTAL.mouth) {
        tris.face(
          p(0.02, -w, bottom),
          p(0.02, w, bottom),
          p(0.02, w, rail + step),
          p(0.02, -w, rail + step),
          [ux, 0, -uy],
          PALETTE.tunnelDark,
        )
        bottom = rail + step
      }
    },
  }))

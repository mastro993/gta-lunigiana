/**
 * Tunnel portals, drawn chunk by chunk, each whole in its chunk: a face wall and its cornice, the
 * dark mouth, and a lined throat into the hill, or an underpass's head wall in the same pieces over
 * a flat-lintelled opening, wherever render/mouths stands one (at the railway's tunnel mouths, in old
 * stone round a single track, and at the road tunnels' mouths the build baked one at), coloured like
 * the road's bridges (`bridgeHex`). A train or a car passing a mouth vanishes behind its dark face;
 * the throat hides it where the hill over the tunnel is too low to.
 *
 * @module render/portals
 */
import { Ops } from "@typeonce/ritmo-math"

import { MAP, type RoadInfo } from "../sim/map/index.ts"
import type { Piece } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { bridgeHex } from "./lines.ts"
import { measured, type Standing, standing } from "./mouths/index.ts"
import { PALETTE } from "./palette.ts"
import { block } from "./ribbons.ts"

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

/** The portal or head wall standing at `standing` in `stone`, its face wall's foot and its throat as it reads them of the ground on its first draw (`measured`). */
const portalPiece = (standing: Standing, stone: Stone): Piece => ({
  pts: [standing.x, standing.y],
  draw: (at) => {
    const { x, y, angle, portal } = standing,
      { low, throat: deep } = measured(standing),
      { thick, cornice } = portal,
      floor = yOf(standing.z),
      tris = at(x, y).solid,
      ux = Ops.cos(angle),
      uy = Ops.sin(angle),
      top = floor + portal.high
    // A point `a` m out of the hill along the line and `b` m to its left, three space.
    const p = (a: number, b: number, h: number): Point3 => [
      x + ux * a - uy * b,
      h,
      -(y + uy * a + ux * b),
    ]
    const foot = Math.min(yOf(low), floor) - 0.5
    const centre = (a: number) => [x + ux * a, -(y + uy * a)] as const
    const [wx, wz] = centre(-thick / 2)
    block(
      tris,
      wx,
      (foot + top) / 2,
      wz,
      ux,
      -uy,
      thick / 2,
      (top - foot) / 2,
      portal.half,
      stone.face,
    )
    block(
      tris,
      wx,
      top + cornice.high / 2,
      wz,
      ux,
      -uy,
      thick / 2 + cornice.proud,
      cornice.high / 2,
      portal.half + cornice.proud,
      stone.cornice,
    )
    // The throat runs into the hill until the hill stands over it (a lined cut and cover where the map's ground is low).
    const { half, high } = portal.throat
    const [tx, tz] = centre(-thick - deep / 2)
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

/** A portal at each railway tunnel mouth, then a portal or a head wall at each road tunnel mouth the hill stands over (`standing`), each whole in its chunk. */
export const portalPieces = (): Array<Piece> =>
  standing().map((at) =>
    portalPiece(at, at.road === undefined ? OLD_STONE : stoneOf(MAP.roads[at.road]!)),
  )

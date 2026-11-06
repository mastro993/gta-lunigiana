/**
 * A road tunnel's bore: the cross-section its portals are sized to (render/portals), and its dark
 * walls along the whole tunnel, either side of the road (whose ribbon render/lines draws at the
 * tunnel's floor). The walls stand under the hill, never out of it: the terrain hides them, and the
 * see-through cut, which opens while the hill hides the player, shows the road between them, the
 * wall nearer the camera cut to a stub as a building's are. A building passage has none: its house
 * stands over its road.
 *
 * @module render/bores
 */
import { ROAD_LIFT } from "../sim/map/ground.ts"
import { type Road, type RoadInfo, roadClassOf } from "../sim/map/index.ts"
import type { Piece } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"

/** Room either side of a road tunnel's carriageway, m: its kerbs. */
const KERB = 1
/** A road tunnel's clear height where its way has no `maxheight`, m: the clearance the build keeps under a bridge (src/tools/road-levels.ts). */
const CLEARANCE = 4
/** Headroom between the clear height and where the mouth's arch springs, m. */
const HEADROOM = 0.5
/** The walls reach this far under the road's surface, m, and stop this far under the terrain over them. */
const FOOT = 0.3
const UNDER = 0.25
/** The walls are cut into stretches of at most this length, m, so their tops follow the terrain's 4 m cells. */
const STEP = 2

/** A road tunnel's cross-section, m: half its width from the centreline, and the height over the road its arch springs at. */
export interface Bore {
  readonly half: number
  readonly spring: number
}

/** Whether road `road` has a bore: in a tunnel, and not a building passage. */
export const isBored = (road: RoadInfo): boolean => road.tunnel === true && road.passage !== true

/** Road `road`'s tunnel cross-section: its carriageway and a KERB each side, its clear height (OSM's `maxheight`, else CLEARANCE) and HEADROOM. */
export const boreOf = (road: RoadInfo): Bore => ({
  half: road.w / 2 + KERB,
  spring: (road.maxheight ?? CLEARANCE) + HEADROOM,
})

/**
 * Road `road`'s bore walls, dark, on its cross-section's sides from FOOT under its surface up to
 * the arch's springing, or UNDER the terrain over them where that is lower; none where the hill is
 * lower still, as over a road under a bridge. Each segment's stretches face the road and go into
 * the chunk of their middle on the centreline, so a chunk drawing some of the segments gets the
 * very triangles a whole build gives it.
 */
export const borePiece = (road: Road): Piece => {
  const { half, spring } = boreOf(road),
    lift = ROAD_LIFT[roadClassOf(road)],
    { pts, z } = road
  return {
    pts,
    draw: (at, k0, k1) => {
      for (let k = k0; k <= k1 && k + 1 < z.length; k++) {
        const ax = pts[2 * k]!,
          ay = pts[2 * k + 1]!,
          dx = pts[2 * k + 2]! - ax,
          dy = pts[2 * k + 3]! - ay,
          length = Math.hypot(dx, dy) || 1,
          n = Math.ceil(length / STEP)
        // The left normal, map frame.
        const nx = -dy / length,
          ny = dx / length
        for (const side of [-1, 1]) {
          // A point t of the way along the segment on this side's wall: map x, y, the floor and the wall's top, render y.
          const wall = (t: number) => {
            const x = ax + dx * t + nx * half * side,
              y = ay + dy * t + ny * half * side,
              floor = yOf(z[k]! + (z[k + 1]! - z[k]!) * t + lift)
            return {
              x,
              y,
              bottom: floor - FOOT,
              top: Math.min(floor + spring, terrainY(x, y) - UNDER),
            }
          }
          let a = wall(0)
          for (let j = 1; j <= n; j++) {
            const b = wall(j / n)
            if (a.top > a.bottom && b.top > b.bottom)
              at(ax + (dx * (j - 0.5)) / n, ay + (dy * (j - 0.5)) / n).solid.face(
                [a.x, a.bottom, -a.y],
                [b.x, b.bottom, -b.y],
                [b.x, b.top, -b.y],
                [a.x, a.top, -a.y],
                [-nx * side, 0, ny * side],
                PALETTE.tunnelDark,
              )
            a = b
          }
        }
      }
    },
  }
}

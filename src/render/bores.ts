/**
 * A road tunnel's bore: the cross-section its portals are sized to (render/portals), and its dark
 * walls along the whole tunnel, either side of the road (whose ribbon render/lines draws at the
 * tunnel's floor). The walls stand under the hill, never out of it: the terrain hides them, they cast
 * no shadow (the chunk's `buried` layer), as the hill over them casts none, and the see-through cut, which opens while the hill hides the player, shows the road between them, the
 * wall nearer the camera cut to a stub as a building's are. A building passage has none: its house
 * stands over its road.
 *
 * @module render/bores
 */
import { ROAD_LIFT } from "../sim/map/ground.ts"
import { MAP, type Road, type RoadInfo, roadClassOf } from "../sim/map/index.ts"
import { anchorOf } from "../sim/map/kinds.ts"
import type { Piece, Triangles } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"

/** Room either side of a road tunnel's carriageway, m: its kerbs. */
const KERB = 1
/** A road tunnel's clear height where its way has no `maxheight`, m: the clearance the build keeps under a bridge (src/tools/road-levels.ts). */
const CLEARANCE = 4
/** Headroom between the clear height and where the mouth's arch springs, m. */
const HEADROOM = 0.5
/** The walls reach this far under the road's surface, m. */
const FOOT = 0.3
/** The walls stop this far under the terrain over them, m, as an underpass's head wall does (render/portals). */
export const UNDER = 0.25
/** The walls are cut into stretches of at most this length, m. */
const STEP = 2

/** A road tunnel's cross-section, m: half its width from the centreline, its clear height over the road, and the height its arch springs at. */
export interface Bore {
  readonly half: number
  readonly clear: number
  readonly spring: number
}

/** Whether road `road` has a bore: in a tunnel, and not a building passage. */
export const isBored = (road: RoadInfo): boolean => road.tunnel === true && road.passage !== true

/** Road `road`'s tunnel cross-section: its carriageway and a KERB each side, its clear height (OSM's `maxheight`, else CLEARANCE) and HEADROOM over it. */
export const boreOf = (road: RoadInfo): Bore => {
  const clear = road.maxheight ?? CLEARANCE
  return { half: road.w / 2 + KERB, clear, spring: clear + HEADROOM }
}

/** A three-space point. */
type Point3 = readonly [number, number, number]

const hm = MAP.heightmap,
  { x: AX, y: AY } = anchorOf(hm)

/**
 * Where (as fractions of the way) the line from (x0, y0) to (x1, y1) crosses a fold of the terrain
 * mesh: the 4 m cells' sides and their south-west to north-east diagonals (`terrainZ`), between
 * which the terrain under it is straight.
 */
const foldsAlong = (x0: number, y0: number, x1: number, y1: number): Array<number> => {
  const out: Array<number> = []
  // Where u(t), from u0 to u1 along the line, crosses a whole number of cells.
  const cross = (u0: number, u1: number) => {
    if (u0 === u1) return
    for (let m = Math.ceil(Math.min(u0, u1)); m <= Math.floor(Math.max(u0, u1)); m++)
      out.push((m - u0) / (u1 - u0))
  }
  const i0 = (x0 - AX) / hm.cell,
    j0 = (y0 - AY) / hm.cell,
    i1 = (x1 - AX) / hm.cell,
    j1 = (y1 - AY) / hm.cell
  cross(i0, i1)
  cross(j0, j1)
  cross(i0 - j0, i1 - j1)
  return out
}

/**
 * Road `road`'s bore walls, dark, on its cross-section's sides from FOOT under its surface up to
 * the arch's springing, or UNDER the terrain over them where that is lower; none where the hill is
 * lower still, as over a road under a bridge. Each segment's wall is cut at most every STEP m, and
 * wherever its line crosses a fold of the terrain mesh, its top meets the springing, or it runs out
 * under the ground, so its top runs straight between cuts under ground that is straight there: it
 * never stands out of the hill, between the cuts as at them. The stretches face the road and go into
 * the `buried` layer of the chunk of their middle on the centreline, so a chunk drawing some of the segments gets the
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
          const ox = nx * half * side,
            oy = ny * half * side,
            outward: Point3 = [-nx * side, 0, ny * side]
          // A point t of the way along the segment on this side's wall: map x, y, the floor, how
          // far the terrain stands over the springing and over the wall's foot (UNDER under it), and
          // the wall's foot and top, render y.
          const wall = (t: number) => {
            const x = ax + dx * t + ox,
              y = ay + dy * t + oy,
              floor = yOf(z[k]! + (z[k + 1]! - z[k]!) * t + lift),
              ground = terrainY(x, y) - UNDER
            return {
              t,
              x,
              y,
              over: ground - floor - spring,
              room: ground - floor + FOOT,
              bottom: floor - FOOT,
              top: Math.min(floor + spring, ground),
            }
          }
          const cuts = [
            ...Array.from({ length: n + 1 }, (_, j) => j / n),
            ...foldsAlong(ax + ox, ay + oy, ax + dx + ox, ay + dy + oy),
          ].sort((p, q) => p - q)
          let a = wall(0)
          for (const t of cuts) {
            if (t - a.t < 1e-9) continue
            const b = wall(t)
            // Between a and b the ground and the floor are straight: cut where the top meets the
            // springing or the wall runs out under the ground.
            const mids = [
              ...(a.over * b.over < 0 ? [a.t + ((b.t - a.t) * a.over) / (a.over - b.over)] : []),
              ...(a.room * b.room < 0 ? [a.t + ((b.t - a.t) * a.room) / (a.room - b.room)] : []),
            ].sort((p, q) => p - q)
            for (const c of [...mids.map(wall), b]) {
              const sink = at(ax + (dx * (a.t + c.t)) / 2, ay + (dy * (a.t + c.t)) / 2).buried,
                upA = a.top - a.bottom > 1e-6,
                upC = c.top - c.bottom > 1e-6
              const pa: Point3 = [a.x, a.bottom, -a.y],
                pc: Point3 = [c.x, c.bottom, -c.y],
                ta: Point3 = [a.x, a.top, -a.y],
                tc: Point3 = [c.x, c.top, -c.y]
              if (upA && upC) sink.face(pa, pc, tc, ta, outward, PALETTE.tunnelDark)
              else if (upA) facing(sink, pa, pc, ta, outward)
              else if (upC) facing(sink, pa, pc, tc, outward)
              a = c
            }
          }
        }
      }
    },
  }
}

/** The dark triangle a-b-c, wound so its front faces `outward` (as `Triangles.face` winds a quad). */
const facing = (tris: Triangles, a: Point3, b: Point3, c: Point3, outward: Point3): void => {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    front =
      (uy * vz - uz * vy) * outward[0] +
        (uz * vx - ux * vz) * outward[1] +
        (ux * vy - uy * vx) * outward[2] >=
      0,
    [p, q] = front ? [b, c] : [c, b]
  tris.tri(a[0], a[1], a[2], p[0], p[1], p[2], q[0], q[1], q[2], PALETTE.tunnelDark)
}

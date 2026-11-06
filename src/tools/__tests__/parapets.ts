// The check parapets.test.ts runs on made-up roads and parapets.map-test.ts on every built map:
// along every drivable bridge's parapets, a car on the deck meets a wall wherever no road on the
// deck's level reaches the parapet, and a car on any road meets no parapet in its carriageway.
import { isDrivable, isRoadClass, ONE_LEVEL, ROAD_LIFT } from "../../sim/map/kinds.ts"
import { segIndex } from "../geometry.ts"

/** A road as shipped: its class, width, whether it is a bridge, and its line. */
export interface ShippedRoad {
  readonly id: number
  readonly cls: string
  readonly w: number
  readonly bridge?: boolean
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/** The drive walls as shipped: flat (ax, ay, bx, by) and each one's level, NaN for none. */
interface DriveWalls {
  readonly drive: ArrayLike<number>
  readonly levels: { readonly drive: ArrayLike<number> }
}

/** Where a bridge's parapets stand past half its carriageway, m (`lines.ts` draws them there). */
const PARAPET = 0.25
/** How far apart the check reads the parapet line, m: the build's own step (`OPEN_STEP` in walls.ts). */
const STEP = 0.25
/** A wall this near a point of the parapet line stands on it, m: the walls lie on 0.1 m, and a deck's line on 0.1 m tilts a short segment's parapet a little. */
const ON = 0.3
/** A carriageway reaches a point within this margin of it, m: the build opens a parapet at its samples, this far apart and rounded. */
const MARGIN = 0.5
/** And a surface is on a deck's level within this margin of ONE_LEVEL, m: the profiles are stored to 0.1 m. */
const LEVEL_MARGIN = 0.15

/**
 * Where a parapet of `roads`' drivable bridges fails, read every STEP m along each deck segment's two
 * parapet lines (w/2 + PARAPET off its centreline):
 * - an opening, where a car on the deck meets no wall (none, or only one with a level ONE_LEVEL or
 *   more off the deck's top), that no road on the deck's own level reaches (issue #91);
 * - a parapet (a wall with a level) that a car on a drivable road well inside it there meets, its
 *   level within ONE_LEVEL of that road's surface: a junction on the deck closed, or a road under it
 *   walled off (a path is for people on foot, whom no drive wall stops);
 * - a wall with no level, which stops any car, over a drivable road passing under or over the deck.
 * One line per bridge, at its first failure; empty when every parapet holds where it should and only
 * there.
 */
export const parapetFaults = (
  roads: ReadonlyArray<ShippedRoad>,
  walls: DriveWalls,
): Array<string> => {
  const surface = (r: ShippedRoad, k: number, t: number) =>
    r.z[k]! + (r.z[k + 1]! - r.z[k]!) * t + ROAD_LIFT[isRoadClass(r.cls) ? r.cls : "path"]
  const ways = segIndex<{ readonly road: ShippedRoad; readonly k: number }>()
  for (const road of roads)
    for (let k = 0; k + 1 < road.z.length; k++)
      ways.add(
        road.pts[2 * k]!,
        road.pts[2 * k + 1]!,
        road.pts[2 * k + 2]!,
        road.pts[2 * k + 3]!,
        road.w / 2 + MARGIN,
        { road, k },
      )
  const near = segIndex<number>()
  const { drive, levels } = walls
  for (let w = 0; 4 * w + 3 < drive.length; w++)
    near.add(
      drive[4 * w]!,
      drive[4 * w + 1]!,
      drive[4 * w + 2]!,
      drive[4 * w + 3]!,
      ON,
      levels.drive[w]!,
    )
  return roads.flatMap((r) => {
    if (r.bridge !== true || !isDrivable(r.cls)) return []
    for (let k = 0; k + 1 < r.z.length; k++) {
      const ax = r.pts[2 * k]!,
        ay = r.pts[2 * k + 1]!,
        bx = r.pts[2 * k + 2]!,
        by = r.pts[2 * k + 3]!,
        len = Math.hypot(bx - ax, by - ay)
      if (len === 0) continue
      const n = Math.ceil(len / STEP)
      for (const side of [-1, 1])
        for (let s = 0; s <= n; s++) {
          const o = side * (r.w / 2 + PARAPET),
            x = ax + ((bx - ax) * s) / n - ((by - ay) / len) * o,
            y = ay + ((by - ay) * s) / n + ((bx - ax) / len) * o,
            top = surface(r, k, s / n)
          // The roads whose carriageway reaches the point (but the segment it stands by): whether one
          // is on the deck's level, and those that reach well inside it, with their surface there.
          let reached = false
          const inside: Array<{ readonly id: number; readonly z: number }> = []
          ways.within(x, y, ({ data: { road, k: j } }, d2, t) => {
            if (road === r && j === k) return
            const z = surface(road, j, t)
            if (Math.abs(z - top) < ONE_LEVEL + LEVEL_MARGIN) reached = true
            if (Math.sqrt(d2) < road.w / 2 - MARGIN && isDrivable(road.cls))
              inside.push({ id: road.id, z })
          })
          let closed = false,
            stops: string | undefined
          near.within(x, y, ({ data: wall }) => {
            const none = Number.isNaN(wall)
            if (none || Math.abs(wall - top) < ONE_LEVEL) closed = true
            for (const { id, z } of inside)
              if (
                none
                  ? Math.abs(z - top) >= ONE_LEVEL + LEVEL_MARGIN
                  : Math.abs(wall - z) < ONE_LEVEL - LEVEL_MARGIN
              )
                stops ??= `${none ? "a wall with no level" : `its parapet at ${wall.toFixed(1)} m`} stops a car on road ${id} at ${z.toFixed(2)} m`
          })
          const at = `at (${x.toFixed(1)}, ${y.toFixed(1)}), its deck's top ${top.toFixed(2)} m`
          if (stops !== undefined) return [`${r.cls} bridge ${r.id}: ${stops}, ${at}`]
          if (!closed && !reached)
            return [`${r.cls} bridge ${r.id}: open where no road on its level reaches it, ${at}`]
        }
    }
    return []
  })
}

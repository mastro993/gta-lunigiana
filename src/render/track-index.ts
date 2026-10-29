/**
 * Where the railway lies, for the static builders: a grid over every rail piece's segments outside
 * the tunnels (`trackNear`), and each level crossing's box, its road's carriageway near the crossing,
 * bucketed by where it reaches (`boxAt`). A chunk's thousands of tests then ask only what is near
 * them, so a build costs the same however much railway the map holds.
 *
 * @module render/track-index
 */
import { segDist2, staticGrid } from "../sim/collide.ts"
import { MAP, type Rail } from "../sim/map/index.ts"

/** How far from a crossing's middle its box can reach, m (an oblique road over two tracks). */
export const BOX_REACH = 16
/** A crossing's panel across the track, m. */
export const PANEL = 2.6
/** The grids' cells, m. */
const CELL = 32

/** One segment of a rail piece outside a tunnel: its piece and its ends. */
export interface TrackSegment {
  readonly rail: Rail
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
}

const SEGMENTS: ReadonlyArray<TrackSegment> = MAP.rail.flatMap((rail) =>
  rail.tunnel === true
    ? []
    : Array.from({ length: rail.pts.length / 2 - 1 }, (_, k) => ({
        rail,
        ax: rail.pts[2 * k]!,
        ay: rail.pts[2 * k + 1]!,
        bx: rail.pts[2 * k + 2]!,
        by: rail.pts[2 * k + 3]!,
      })),
)
const segmentGrid = staticGrid(
  SEGMENTS.length,
  (i) => {
    const s = SEGMENTS[i]!
    return [Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by)]
  },
  CELL,
)

/** Every track segment (tunnels left out) passing within `reach` m of (x, y), in the order of `MAP.rail` and along each piece. */
export const trackNear = (x: number, y: number, reach: number): Array<TrackSegment> => {
  const found: Array<number> = []
  segmentGrid(x - reach, y - reach, x + reach, y + reach, (i) => {
    const s = SEGMENTS[i]!
    if (segDist2(x, y, s.ax, s.ay, s.bx, s.by).d2 < reach * reach) found.push(i)
  })
  return found.sort((a, b) => a - b).map((i) => SEGMENTS[i]!)
}

/** Each level crossing's road near it: its carriageway's half width and its centreline's segments within `BOX_REACH` m, flat (ax, ay, bx, by). */
export const BOXES = MAP.railway.crossings.map((crossing) => {
  const road = MAP.roads[crossing.road]!,
    segments: Array<number> = []
  for (let k = 0; k + 3 < road.pts.length; k += 2) {
    const [ax, ay, bx, by] = [road.pts[k]!, road.pts[k + 1]!, road.pts[k + 2]!, road.pts[k + 3]!]
    if (segDist2(crossing.x, crossing.y, ax, ay, bx, by).d2 < BOX_REACH ** 2)
      segments.push(ax, ay, bx, by)
  }
  return { x: crossing.x, y: crossing.y, half: road.w / 2, segments }
})
const boxGrid = staticGrid(
  BOXES.length,
  (i) => {
    const { x, y } = BOXES[i]!
    return [x - BOX_REACH, y - BOX_REACH, x + BOX_REACH, y + BOX_REACH]
  },
  CELL,
)

/** The crossing (index into `MAP.railway.crossings`) whose carriageway, widened `margin` m a side, holds map point (x, y); −1 for none. */
export const boxAt = (x: number, y: number, margin: number): number => {
  let found = -1
  boxGrid(x, y, x, y, (b) => {
    if (found >= 0 && found < b) return
    const box = BOXES[b]!
    if ((x - box.x) ** 2 + (y - box.y) ** 2 > BOX_REACH ** 2) return
    const s = box.segments
    for (let k = 0; k + 3 < s.length; k += 4)
      if (segDist2(x, y, s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!).d2 < (box.half + margin) ** 2) {
        found = b
        return
      }
  })
  return found
}

/**
 * Whether (x, y) lies under a crossing's panels, or a road's centre dash there would poke through them: in a box, within half a
 * panel and a dash's metre-long piece of the centreline of track at grade.
 */
export const underPanel = (x: number, y: number): boolean =>
  boxAt(x, y, 0) >= 0 && trackNear(x, y, PANEL / 2 + 1).some((s) => s.rail.bridge !== true)

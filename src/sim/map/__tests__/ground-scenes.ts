// Hand-made scenes for the ground model's tests: terrain from a function on a 4 m lattice anchored
// at the origin, and roads and platforms laid out in a few lines, read through `wholeGround` with no
// map loaded.
import { type GroundPlatform, type GroundRoad, wholeGround } from "../ground-model.ts"
import { ROAD_LIFT, type RoadClass } from "../kinds.ts"

/** A road from (ax, ay) to (bx, by), `w` m wide, its profile `za` to `zb` m a.s.l. */
interface Way {
  readonly cls?: RoadClass
  readonly w?: number
  readonly from: readonly [number, number]
  readonly to: readonly [number, number]
  readonly z: readonly [number, number]
  readonly bridge?: boolean
  readonly tunnel?: boolean
}

/** A straight road of `way`, a secondary 6 m wide unless it says otherwise. */
export const road = ({ cls = "secondary", w = 6, from, to, z, bridge, tunnel }: Way) =>
  ({ pts: [...from, ...to], z, cls, w, bridge, tunnel }) satisfies Omit<GroundRoad, "index">

/** How far a secondary road's surface stands over its profile, m. */
export const LIFT = ROAD_LIFT.secondary

/**
 * The ground of a scene: the terrain at each node `terrain` of its place (m a.s.l., to the
 * decimetre, as the map ships it), and `roads` (index by place) and `platforms` as given.
 */
export const scene = ({
  terrain = () => 100,
  roads = [],
  platforms = [],
}: {
  readonly terrain?: (x: number, y: number) => number
  readonly roads?: ReadonlyArray<Omit<GroundRoad, "index">>
  readonly platforms?: ReadonlyArray<GroundPlatform>
}) =>
  wholeGround({
    anchor: { x: 0, y: 0 },
    cell: 4,
    corners: (fi, fj, out) => {
      for (let k = 0; k < 4; k++)
        out[k] = Math.round(terrain(4 * (fi + (k & 1)), 4 * (fj + (k >> 1))) * 10)
    },
    roads,
    platforms,
  })

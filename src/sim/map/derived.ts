/**
 * The global file's `derived` table (`MonzoneMap.derived`): what the build works out from the
 * vectors, which live in the tiles, for the readers far from the player. Types only.
 *
 * @module map/derived
 */
import type { Area, Building, RoadLine } from "./index.ts"

/** A bell the build found (`bellsOf` in src/tools/bells.ts): its tower's id and box centre, the top of its walls (m a.s.l.) and its height (m). */
export interface BellEntry {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly h: number
}

/**
 * A road tunnel's mouth the build found (`bakeMouths` in src/render/portals.ts): an end of a road in
 * a tunnel (not a building passage) that no other road in a tunnel goes on from, inside the play
 * area. A portal stands there, its arch's crown `crown` m over the road and its lined throat
 * `throat` m into the hill, `back` m into the tunnel from the road's end where it would otherwise
 * stand on another road, unless the ground over the tunnel never rises high enough for one or no
 * spot is clear of the roads round it (`open`: a road under a bridge, or under a cover the map's
 * ground does not hold).
 */
export type MouthEntry = {
  /** The tunnel's road: its index in the whole map's roads. */
  readonly road: number
  /** Where the portal stands on the road's line (the end of the line, or `back` m in), or the open mouth (the end). */
  readonly x: number
  readonly y: number
  /** The road's surface there (its profile and `ROAD_LIFT`), m a.s.l. */
  readonly z: number
  /** The heading out of the hill, rad. */
  readonly angle: number
} & (
  | { readonly crown: number; readonly throat: number; readonly back: number }
  | { readonly open: true }
)

/**
 * What the build works out from the vectors for the readers far from the player, where the tiles
 * holding them need not be in memory (src/tools/bake.ts; `bake.map-test.ts` checks it is current):
 * copies of the geometry the railway points at, and tables the game's own code bakes.
 */
export interface Derived {
  /** Per level crossing (`railway.crossings` order), its road's line: the trains and the crossings read it anywhere. */
  readonly crossings: ReadonlyArray<RoadLine>
  /** Per platform (`railway.platforms` order), its area's rings: the trains' look-out reads them anywhere. */
  readonly platforms: ReadonlyArray<Area["rings"]>
  /** Per station (`railway.stations` order), the first station building of its name, or null: its canopy's wall. */
  readonly stations: ReadonlyArray<Building | null>
  /** The tallest church or tower of every district that has one: heard all over the map. */
  readonly bells: ReadonlyArray<BellEntry>
  /** Per walk edge (`graph.walk` order), the residents of the homes round its midpoint (`residentsAlong` in src/sim/population/density.ts). */
  readonly residents: ReadonlyArray<number>
  /** Per farm (`farms` order), its building's centre, flat x, y (`buildingCentre`). */
  readonly farms: ReadonlyArray<number>
  /** Every road tunnel's mouth, by road and then the road's first end first: where the portals stand. */
  readonly mouths: ReadonlyArray<MouthEntry>
}

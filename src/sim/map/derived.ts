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
}

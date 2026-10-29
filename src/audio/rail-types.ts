/**
 * The railway as the audio host hears it, plain data in `Heard` (audio/types): each train with its
 * cars, and each road's level crossing with its bell.
 *
 * @module audio/rail-types
 */
import type { TrainModel } from "../sim/rail/models.ts"

/** One car of a train: its middle (x, y, the rail head's z under it), its heading toward the train's front (rad), its length (m), its middle's s along the line, and whether it stands in a tunnel. */
export interface HeardCar {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly length: number
  readonly s: number
  readonly tunnel: boolean
}

/** A train, heard whether it runs or stands (its engines idle): every train on the map. */
export interface HeardTrain {
  /** Entity id: stable while the train exists, the key of its voices. */
  readonly id: number
  readonly model: TrainModel
  /** Its line (index into `LINES`), its active cab's nose there (s, m), its speed toward +s (m/s) and the way that cab faces. */
  readonly line: number
  readonly s: number
  readonly v: number
  readonly facing: 1 | -1
  /** Its cars from the active cab back (`carsOf`). */
  readonly cars: ReadonlyArray<HeardCar>
  /** Its power packs' revs and load (0…1), one engine under each end car (`trainRevs`). */
  readonly rpm: number
  readonly load: number
  /** Its brakes, 0…1 of the emergency rate. */
  readonly brake: number
  /** The rail head's z at the active cab's driver's place (`cabOf`): where the player sits. */
  readonly cab: number
  /** The player drives it. */
  readonly mine: boolean
}

/** A level crossing (a road's; foot crossings show nothing): its centre, and whether its bell rings (`crossingAt`: from the warning until the arms are down). */
export interface HeardCrossing {
  /** Its index in `CROSSINGS`. */
  readonly id: number
  readonly x: number
  readonly y: number
  /** How far its nearest arm's post, where its bells stand, is from its centre, m. */
  readonly posts: number
  readonly ringing: boolean
}

/**
 * Where each car of a train stands on its line: every car is a rigid body on two pivots on the track,
 * the outer bogies `bogie` m in from the noses and the Jacobs bogies at the joints, so neighbouring
 * cars share the pivot between them, as articulated units do. The sim, the render and the audio all
 * place a train's cars from here.
 *
 * @module rail/consist
 */
import { Ops } from "@typeonce/ritmo-math"

import { type Line, pointAt } from "./lines.ts"
import { TRAINS, type TrainModel, trainLength } from "./models.ts"

/** One car: its middle on the track (x, y and the rail head's z under it), its heading toward the train's front and its pitch (nose up +, rad), its length and width, m. */
export interface CarPose {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly pitch: number
  readonly length: number
  readonly width: number
}

/** Each car's pivots, m back from the active cab's nose, and its front end's distance ahead of its front pivot. */
const pivotsOf = (model: TrainModel) => {
  const { cars, bogie } = TRAINS[model],
    length = trainLength(model)
  let joint = 0
  return cars.map((car, k) => {
    const front = k === 0 ? bogie : joint,
      rear = k === cars.length - 1 ? length - bogie : joint + car
    const ahead = front - joint
    joint += car
    return { front, rear, ahead, car, first: k === 0, last: k === cars.length - 1 }
  })
}

/** Rounds of the search for a pivot its spacing on from the last along the chord: a crossover's 7° kink needs two. */
const CHORD_ROUNDS = 4

/**
 * The cars of a `model` train with its active cab's nose at s on `line`, the cab facing `facing`, from that cab back. On a curve
 * a car's body is the chord between its pivots, so each end car hangs from the joint it shares and a middle car sits midway; each
 * pivot stands its spacing on from the last along the chord, not the arc, so the cars meet at the joints however sharp the bend
 * (a crossover's kink at Vezzano Ligure, which the Parma–La Spezia trains take, left them 2.6 cm apart placed by arc length).
 */
export const carsOf = (
  line: Line,
  s: number,
  facing: 1 | -1,
  model: TrainModel,
): ReadonlyArray<CarPose> => {
  const pivots = pivotsOf(model)
  // The pivots' arc lengths: the first its offset from the nose, each next its spacing on from the last along the chord.
  const at = [s - facing * pivots[0]!.front]
  for (const { front, rear } of pivots) {
    const from = at.at(-1)!,
      p = pointAt(line, from),
      spacing = rear - front
    let to = from - facing * spacing
    for (let round = 0; round < CHORD_ROUNDS; round++) {
      const q = pointAt(line, to)
      to -= facing * (spacing - Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2))
    }
    at.push(to)
  }
  return pivots.map(({ front, rear, ahead, car, first, last }, k) => {
    const a = pointAt(line, at[k]!),
      b = pointAt(line, at[k + 1]!)
    const dx = a.x - b.x,
      dy = a.y - b.y,
      span = Math.sqrt(dx * dx + dy * dy) || 1
    // How far from the front pivot toward the rear one the car's middle lies, as a share of the chord.
    const t =
      first && !last
        ? 1 - car / 2 / span
        : last && !first
          ? car / 2 / span
          : (car / 2 - ahead) / (rear - front)
    return {
      x: a.x - dx * t,
      y: a.y - dy * t,
      z: a.z + (b.z - a.z) * t,
      angle: Ops.atan2(dy, dx),
      pitch: Ops.atan2(a.z - b.z, span),
      length: car,
      width: TRAINS[model].width,
    }
  })
}

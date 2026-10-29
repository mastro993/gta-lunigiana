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

/**
 * The cars of a `model` train with its active cab's nose at s on `line`, the cab facing `facing`, from that cab back. On a curve
 * a car's body is the chord between its pivots, so each end car hangs from the joint it shares and a middle car sits midway: the
 * cars meet at the joints.
 */
export const carsOf = (
  line: Line,
  s: number,
  facing: 1 | -1,
  model: TrainModel,
): ReadonlyArray<CarPose> =>
  pivotsOf(model).map(({ front, rear, ahead, car, first, last }) => {
    const a = pointAt(line, s - facing * front),
      b = pointAt(line, s - facing * rear)
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

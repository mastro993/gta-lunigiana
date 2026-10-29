import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { carsOf } from "../consist.ts"
import { curvatureAt, LINES, linesNear, makeLine, pointAt } from "../lines.ts"
import { TRAINS, trainLength } from "../models.ts"

const { cars, bogie, width } = TRAINS.atr220

/** A car's front and rear ends, from its middle along its heading. */
const endsOf = (car: ReturnType<typeof carsOf>[number]) => ({
  front: {
    x: car.x + (Ops.cos(car.angle) * car.length) / 2,
    y: car.y + (Ops.sin(car.angle) * car.length) / 2,
  },
  rear: {
    x: car.x - (Ops.cos(car.angle) * car.length) / 2,
    y: car.y - (Ops.sin(car.angle) * car.length) / 2,
  },
})

test("consist: an ATR 220 is three cars over 55.57 m, end to end along a straight track from the cab, either way it faces", () => {
  assert.ok(Math.abs(trainLength("atr220") - 55.57) < 1e-9)
  const line = makeLine(0, [{ pts: [0, 0, 500, 0], z: [100, 105] }])
  const ahead = carsOf(line, 200, 1, "atr220")
  assert.deepEqual(
    ahead.map((car) => [car.length, car.width]),
    cars.map((length) => [length, width]),
  )
  let nose = 200
  for (const car of ahead) {
    assert.ok(Math.abs(car.x - (nose - car.length / 2)) < 1e-9 && car.y === 0 && car.angle === 0)
    assert.ok(Math.abs(car.pitch - Ops.atan2(5, 500)) < 1e-9, "pitched with the 1% climb")
    nose -= car.length
  }
  // Facing −s the cab leads toward −s and the train lies on the +s side of it, the cars turned round.
  const back = carsOf(line, 200, -1, "atr220")
  assert.ok(Math.abs(back[0]!.x - (200 + cars[0] / 2)) < 1e-9)
  assert.ok(Math.abs(Math.abs(back[0]!.angle) - Math.PI) < 1e-9)
  assert.ok(back[0]!.pitch < 0, "the cab end down the climb")
})

test("consist: on each line's sharpest curve each car stands on its two pivots, its outer bogies 2.5 m in, and neighbours meet at the joint", () => {
  const length = trainLength("atr220")
  let tightest = Number.MAX_VALUE
  for (const line of LINES) {
    let sharpest = 0,
      at = 0
    for (let s = length; s < line.length; s += 5) {
      const k = Math.abs(curvatureAt(line, s))
      if (k > sharpest) [sharpest, at] = [k, s]
    }
    tightest = Math.min(tightest, 1 / sharpest)
    for (const facing of [1, -1] as const) {
      const train = carsOf(line, at + (facing * length) / 2, facing, "atr220")
      for (const [k, car] of train.entries()) {
        const { front, rear } = endsOf(car)
        // Each pivot on the track: the outer bogies 2.5 m in from the noses, the Jacobs bogies at the joints.
        const pivots = [
          k === 0
            ? { x: front.x - Ops.cos(car.angle) * bogie, y: front.y - Ops.sin(car.angle) * bogie }
            : front,
          k === train.length - 1
            ? { x: rear.x + Ops.cos(car.angle) * bogie, y: rear.y + Ops.sin(car.angle) * bogie }
            : rear,
        ]
        const on = (p: { readonly x: number; readonly y: number }, reach: number) =>
          linesNear(p.x, p.y, reach).find((near) => near.line === line.index)!
        for (const pivot of pivots) assert.ok(on(pivot, 1).distance < 0.01)
        if (k > 0) {
          const joint = endsOf(train[k - 1]!).rear
          assert.ok(Ops.hypot(joint.x - front.x, joint.y - front.y) < 0.01, "a shared Jacobs bogie")
        }
        // The rail head under the car's middle, between its pivots' heights.
        const under = pointAt(line, on(car, 2).s).z
        assert.ok(Math.abs(car.z - under) < 0.05)
      }
    }
  }
  assert.ok(tightest < 300, `a curve under 300 m radius (${tightest.toFixed(0)} m)`)
})

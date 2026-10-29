import assert from "node:assert/strict"
import { test } from "node:test"

import { type BufferGeometry, Triangle, Vector3 } from "three"

import { TRAINS } from "../../sim/rail/models.ts"
import { ATR220 } from "../atr220.ts"

const { cars } = TRAINS.atr220

/** The triangles of `geometry`'s face looking out of the car's right side (+Z, at its greatest z). */
const sideFace = (geometry: BufferGeometry): Array<Triangle> => {
  const at = geometry.getAttribute("position")
  let top = -Infinity
  for (let i = 0; i < at.count; i++) top = Math.max(top, at.getZ(i))
  const face: Array<Triangle> = []
  for (let i = 0; i + 2 < at.count; i += 3) {
    const t = new Triangle(
      new Vector3().fromBufferAttribute(at, i),
      new Vector3().fromBufferAttribute(at, i + 1),
      new Vector3().fromBufferAttribute(at, i + 2),
    )
    if ([t.a, t.b, t.c].every((v) => Math.abs(v.z - top) < 1e-6) && t.getArea() > 1e-9) face.push(t)
  }
  return face
}

/** Whether (x, y) lies strictly inside `t` (flat in z), `margin` m in from its edges. */
const inside = (t: Triangle, x: number, y: number, margin: number): boolean => {
  const edges = [
    [t.a, t.b],
    [t.b, t.c],
    [t.c, t.a],
  ] as const
  const sign = Math.sign((t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.b.y - t.a.y) * (t.c.x - t.a.x))
  return edges.every(([p, q]) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y)
    return (sign * ((q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x))) / l > margin
  })
}

// Regression: the blue swoosh's outline crossed itself, so its triangles overlapped at the yellow's
// depth, most of the blue arc was not filled and the two bands z-fought in a sawtooth on both cab cars.
test("no piece of an ATR 220 car's side, its livery patches included, is painted twice over itself", () => {
  for (const [what, pieces] of [
    ["cab car", ATR220.cab(cars[0])],
    ["middle car", ATR220.middle(cars[1])],
  ] as const)
    for (const [k, piece] of pieces.entries()) {
      const face = sideFace(piece)
      if (face.length < 3) continue
      const xs = face.flatMap((t) => [t.a.x, t.b.x, t.c.x]),
        ys = face.flatMap((t) => [t.a.y, t.b.y, t.c.y])
      const step = 0.013
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
        for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
          const covers = face.filter((t) => inside(t, x, y, 1e-4)).length
          assert.ok(
            covers <= 1,
            `${what} piece ${k}: (${x.toFixed(2)}, ${y.toFixed(2)}) painted ${covers}×`,
          )
        }
    }
})

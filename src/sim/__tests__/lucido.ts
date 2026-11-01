/**
 * The Lucido by Monzone and the spate scene the water tests swim in, shared by `water.test.ts` and `water.long-test.ts`.
 *
 * @module sim/__tests__/lucido
 */
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { waterNear } from "../map/__tests__/vectors-near.ts"
import { deckNear } from "../map/ground.ts"
import { walkIndex } from "../route.ts"
import { animal, parkedCar, pedestrian } from "../spawning.ts"
import { LOOK, type Timeline } from "../testing.ts"
import { screenAxes } from "../view.ts"

/**
 * The Torrente Lucido below Monzone station, found by geometry: the vertex of its river part nearest the station with no bridge
 * within 30 m, the way it flows there, and the way across from its north bank to its south one.
 */
export const LUCIDO = (() => {
  let best: { d: number; x: number; y: number; ux: number; uy: number } | undefined
  for (const w of waterNear(-493.8, 436.9, 1500).filter(
    (o) => o.name === "Torrente Lucido" && o.kind === "river",
  ))
    for (let i = 1; i + 1 < w.pts.length / 2; i++) {
      const x = w.pts[2 * i]!,
        y = w.pts[2 * i + 1]!,
        d = Ops.hypot(x + 493.8, y - 436.9)
      if (best !== undefined && d >= best.d) continue
      let bridge = false
      for (let k = -30; k <= 30 && !bridge; k += 2)
        for (let j = -30; j <= 30 && !bridge; j += 2)
          bridge = deckNear(x + k, y + j, 1) !== undefined
      if (bridge) continue
      const ex = w.pts[2 * i + 2]! - w.pts[2 * i - 2]!,
        ey = w.pts[2 * i + 3]! - w.pts[2 * i - 1]!,
        l = Ops.hypot(ex, ey)
      best = { d, x, y, ux: ex / l, uy: ey / l }
    }
  assert.ok(best !== undefined)
  // Across: square to the flow, toward whichever bank the home view's up key walks to.
  const { up } = screenAxes(0),
    side = up.x * -best.uy + up.y * best.ux > 0 ? 1 : -1
  return { ...best, ax: -best.uy * side, ay: best.ux * side }
})()

/** `across` m from the Lucido's middle toward the bank the up key walks to (negative: the far side), and `down` m downstream. */
export const atLucido = (across: number, down = 0, angle = 0) => ({
  x: LUCIDO.x + LUCIDO.ax * across + LUCIDO.ux * down,
  y: LUCIDO.y + LUCIDO.ay * across + LUCIDO.uy * down,
  angle,
})

/** A spate scene: the player swimming across the Lucido, a walker and a dog in the water, a parked Panda floating off. */
export const SWIM: Timeline = [
  { frame: 30, press: ["up"] },
  { frame: 200, press: ["sprint"] },
  { frame: 400, release: ["up", "sprint"], press: ["left"] },
]

/** The staging of `SWIM`: the player by the Lucido, a walker and a dog in the water, a parked Panda floating off. */
export const swimCast = () =>
  [
    atLucido(0, -6),
    {
      cars: [parkedCar("panda", 0xb8312b, atLucido(-2, 6))],
      peds: [
        pedestrian(
          LOOK,
          atLucido(1),
          { edge: walkIndex.nearest(LUCIDO.x, LUCIDO.y), forward: true, side: 1 },
          { mood: "walk", until: 0, fx: 0, fy: 0 },
        ),
      ],
      animals: [
        animal({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }, atLucido(-1, 2)),
      ],
    },
  ] as const

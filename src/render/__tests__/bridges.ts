// The check ground.test.ts (the bridges by Monzone) and ground.map-test.ts (every bridge of the map) share: a car's
// wheels and a walker crossing a drivable bridge stay on its deck.
import assert from "node:assert/strict"

import { groundZ, ROAD_LIFT } from "../../sim/map/ground.ts"
import { isDrivable, type Road, roadClassOf } from "../../sim/map/index.ts"
import { VEHICLES } from "../../sim/vehicles.ts"
import { groundY, yOf } from "../ground.ts"

/**
 * Asserts that a car's wheels and a walker crossing each drivable bridge of `roads`, both ways, from 12 m before it,
 * stay on the deck, but from the mouth of a tunnel of `around` (the roads round them); returns how many crossings it
 * made. The car's wheels are the sim's: each keeps to the level of its previous contact, as the drive physics does;
 * walkers stand where the renderer puts them.
 */
export const assertBridgesCarry = (
  roads: ReadonlyArray<Road>,
  around: ReadonlyArray<Road>,
): number => {
  const { wheels } = VEHICLES.carabinieri
  // The straight approach out of a tunnel runs through the hillside (the old marble road up the Solco di Equi bends between its tunnels and bridges).
  const tunnelEnd = (x: number, y: number) =>
    around.some(
      (q) =>
        q.tunnel === true &&
        [0, q.pts.length - 2].some((i) => Math.hypot(q.pts[i]! - x, q.pts[i + 1]! - y) < 0.1),
    )
  let passes = 0
  for (const r of roads) {
    if (r.bridge !== true || !isDrivable(r.cls)) continue
    for (const reverse of [false, true]) {
      const pts = Array.from(
        { length: r.z.length },
        (_, k) => [r.pts[2 * k]!, r.pts[2 * k + 1]!, r.z[k]!] as const,
      )
      if (reverse) pts.reverse()
      const [x0, y0] = pts[0]!,
        [x1, y1] = pts[1]!,
        d = Math.hypot(x1 - x0, y1 - y0),
        ux = (x1 - x0) / d,
        uy = (y1 - y0) / d
      if (tunnelEnd(x0, y0)) continue
      let contacts: ReadonlyArray<number> | undefined, feet: number | undefined
      const place = (x: number, y: number, angle: number) => {
        const c = Math.cos(angle),
          s = Math.sin(angle)
        contacts = wheels.map((w, i) =>
          groundZ(x + w.x * c - w.y * s, y + w.x * s + w.y * c, contacts?.[i]),
        )
        feet = groundY(x, y, feet)
      }
      for (let s = -12; s < 0; s += 0.4) place(x0 + ux * s, y0 + uy * s, Math.atan2(uy, ux))
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay, az] = pts[i]!,
          [bx, by, bz] = pts[i + 1]!,
          len = Math.hypot(bx - ax, by - ay)
        for (let s = 0; s < len; s += 0.4) {
          const x = ax + ((bx - ax) * s) / len,
            y = ay + ((by - ay) * s) / len
          place(x, y, Math.atan2(by - ay, bx - ax))
          const deck = az + ((bz - az) * s) / len + ROAD_LIFT[roadClassOf(r)],
            car = contacts!.reduce((a, b) => a + b) / contacts!.length
          assert.ok(
            Math.abs(car - deck) < 0.5 && Math.abs(feet! - yOf(deck)) < 0.5,
            `road ${r.id} ${reverse ? "b -> a" : "a -> b"} at ${x.toFixed(1)},${y.toFixed(1)}: deck ${deck.toFixed(2)}, wheels ${car.toFixed(2)}, walker ${(feet! - yOf(0)).toFixed(2)} m a.s.l.`,
          )
        }
      }
      passes++
    }
  }
  return passes
}

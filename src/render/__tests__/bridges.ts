// The check ground.test.ts (the bridges by Monzone) and ground.map-test.ts (every bridge of the map) share: a car's
// wheels and a walker crossing a drivable bridge stay on its deck.
import assert from "node:assert/strict"

import { settleFooting } from "../../sim/footing.ts"
import { groundZ, ROAD_LIFT } from "../../sim/map/ground.ts"
import { isDrivable, outlineDistance, type Road, roadClassOf } from "../../sim/map/index.ts"
import { VEHICLES } from "../../sim/vehicles.ts"
import { footY, yOf } from "../ground.ts"

/** How far before a bridge the crossing sets out, m. */
const RUN_UP = 12
/** The sharpest turn from the road leading onto a bridge that still counts as leading straight on (the joints check's). */
const IN_LINE = Math.cos((30 * Math.PI) / 180)

/**
 * The RUN_UP m before (x, y), heading (ux, uy), as [x, y, z] from where it sets out to (x, y), and the road it sets out
 * on: along the pieces of
 * `around` that lead on to it in line (no turn of 30° or more at each joint), on their profiles, then straight on at
 * the last level where none does. Straight on alone, a bridge whose approach bends within 12 m (the Valle's two decks
 * at Aulla's -19501, 10907, 20° apart 3.3 m out) set out off the road, and one whose approach runs under a viaduct
 * (the SP20's carriageway under the A15 at -14347, 8149) set out on the viaduct's deck.
 */
const approachTo = (
  around: ReadonlyArray<Road>,
  from: Road,
  x: number,
  y: number,
  z: number,
  ux: number,
  uy: number,
): { readonly run: ReadonlyArray<readonly [number, number, number]>; readonly road: Road } => {
  const back: Array<readonly [number, number, number]> = [[x, y, z]]
  let left = RUN_UP,
    on = from
  for (;;) {
    const [cx, cy, cz] = back.at(-1)!
    // The piece ending here whose first segment out runs most nearly back along the heading.
    let best: { road: Road; pts: Array<readonly [number, number, number]> } | undefined,
      most = IN_LINE
    for (const q of around) {
      if (q === on || !isDrivable(q.cls)) continue
      const n = q.z.length
      for (const rev of [false, true]) {
        const k = rev ? n - 1 : 0
        if (Math.hypot(q.pts[2 * k]! - cx, q.pts[2 * k + 1]! - cy) >= 0.1) continue
        const pts = Array.from({ length: n }, (_, i) => {
          const j = rev ? n - 1 - i : i
          return [q.pts[2 * j]!, q.pts[2 * j + 1]!, q.z[j]!] as const
        })
        const [nx, ny] = pts[1]!,
          d = Math.hypot(nx - cx, ny - cy),
          onward = -((nx - cx) * ux + (ny - cy) * uy) / d
        if (onward > most) [best, most] = [{ road: q, pts }, onward]
      }
    }
    if (best === undefined) {
      back.push([cx - ux * left, cy - uy * left, cz])
      return { run: back.reverse(), road: on }
    }
    for (let i = 1; i < best.pts.length; i++) {
      const [ax, ay, az] = best.pts[i - 1]!,
        [bx, by, bz] = best.pts[i]!,
        len = Math.hypot(bx - ax, by - ay)
      if (len === 0) continue
      if (len >= left) {
        back.push([
          ax + ((bx - ax) * left) / len,
          ay + ((by - ay) * left) / len,
          az + ((bz - az) * left) / len,
        ])
        return { run: back.reverse(), road: best.road }
      }
      back.push([bx, by, bz])
      left -= len
      ;[ux, uy] = [(ax - bx) / len, (ay - by) / len]
    }
    on = best.road
  }
}

/**
 * Asserts that a car's wheels and a walker crossing each drivable bridge of `roads`, both ways, from 12 m before it,
 * stay on the deck, but from the mouth of a tunnel of `around` (the roads round them) or the play area's edge; returns
 * how many crossings it made. They come on along the road leading onto it (`approachTo`), setting out on its level.
 * The car's wheels are the sim's: each keeps to the level of its previous contact, as the drive physics does;
 * the walker's footing is settled as `FindFooting` settles it (`settleFooting`) and it stands where the renderer draws it on that.
 * Every pass off its deck fails but the `known` ("<id> a -> b" or "<id> b -> a"), each of which must still leave it.
 */
export const assertBridgesCarry = (
  roads: ReadonlyArray<Road>,
  around: ReadonlyArray<Road>,
  known: ReadonlyArray<string> = [],
): number => {
  // Each pass's first point off the deck, by "<id> a -> b" or "<id> b -> a".
  const off = new Map<string, string>()
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
      // A bridge the play area's outline cuts ends there in mid-span, walled by its road-exit cap: nothing comes on from there.
      if (tunnelEnd(x0, y0) || outlineDistance(x0, y0) <= 0.5) continue
      let contacts: ReadonlyArray<number> | undefined,
        footing: number | undefined,
        feet = 0
      const { run, road } = approachTo(around, r, x0, y0, pts[0]![2], ux, uy)
      // It sets out on the level of the road leading onto the bridge where it starts (a viaduct's previous span's deck
      // where the road is one), not on the highest ground there: a viaduct over the road stands higher.
      const start = run[0]![2] + ROAD_LIFT[roadClassOf(road)]
      const place = (x: number, y: number, angle: number) => {
        const c = Math.cos(angle),
          s = Math.sin(angle)
        contacts = wheels.map((w, i) =>
          groundZ(x + w.x * c - w.y * s, y + w.x * s + w.y * c, contacts?.[i] ?? start),
        )
        // Drawn on the footing the sim found where it last stood, which it finds again here for the next step.
        footing ??= groundZ(x, y, start)
        feet = footY(x, y, footing)
        footing = settleFooting(x, y, footing)
      }
      for (let i = 0; i + 1 < run.length; i++) {
        const [ax, ay] = run[i]!,
          [bx, by] = run[i + 1]!,
          len = Math.hypot(bx - ax, by - ay)
        for (let s = 0; s < len; s += 0.4)
          place(
            ax + ((bx - ax) * s) / len,
            ay + ((by - ay) * s) / len,
            Math.atan2(by - ay, bx - ax),
          )
      }
      const pass = `${r.id} ${reverse ? "b -> a" : "a -> b"}`
      for (let i = 0; i + 1 < pts.length && !off.has(pass); i++) {
        const [ax, ay, az] = pts[i]!,
          [bx, by, bz] = pts[i + 1]!,
          len = Math.hypot(bx - ax, by - ay)
        for (let s = 0; s < len && !off.has(pass); s += 0.4) {
          const x = ax + ((bx - ax) * s) / len,
            y = ay + ((by - ay) * s) / len
          place(x, y, Math.atan2(by - ay, bx - ax))
          const deck = az + ((bz - az) * s) / len + ROAD_LIFT[roadClassOf(r)],
            car = contacts!.reduce((a, b) => a + b) / contacts!.length
          if (Math.abs(car - deck) >= 0.5 || Math.abs(feet - yOf(deck)) >= 0.5)
            off.set(
              pass,
              `road ${pass} at ${x.toFixed(1)},${y.toFixed(1)}: deck ${deck.toFixed(2)}, wheels ${car.toFixed(2)}, walker ${(feet - yOf(0)).toFixed(2)} m a.s.l.`,
            )
        }
      }
      passes++
    }
  }
  assert.deepEqual(
    [...off].filter(([pass]) => !known.includes(pass)).map(([, line]) => line),
    [],
  )
  for (const pass of known)
    assert.ok(off.has(pass), `road ${pass} stays on its deck now: drop it from the known passes`)
  return passes
}

import assert from "node:assert/strict"
import { test } from "node:test"

import type { V } from "../geometry.ts"
import { makeProfiler, replayClaims, type Linear } from "../profiles.ts"
import type { Grid } from "../terrain.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
/** A 4 m grid over x −20…620, y −20…20. */
const grid = (): Grid => {
  const cols = 161,
    rows = 11
  return {
    cell: 4,
    cols,
    rows,
    x0: -20,
    y0: -20,
    ax: -20,
    ay: -20,
    z: new Float64Array(cols * rows).fill(100),
  }
}
const SPEC = { w: 4, rank: 1, grade: 0.025, half: 20, tol: 0.03 }

// Regression: the terrain model climbs a hill's face at a tunnel portal (3.6 m over
// the cutting at the Ugliancaldo tunnel's west portal), and the line's grade limit carried that 1.2–1.6
// m for 600 m past it; a bridge end on the slope of what it spans pulled Monzone's line 0.7 m down.
test("profile takes a tunnel portal's and a bridge end's level from the ground just outside them", () => {
  // Flat ground at 100 m. A hill over x 100–200 whose face stands 6 m high at the portals; a gap
  // over x 300–400 whose banks fall 8 m at the bridge's ends.
  const ground = (x: number) => (x >= 100 && x <= 200 ? 106 : x >= 300 && x <= 400 ? 92 : 100)
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(0, 0), v(100, 0, "p0")] },
    { id: 2, tunnel: true, pts: [v(100, 0, "p0"), v(200, 0, "p1")] },
    { id: 3, pts: [v(200, 0, "p1"), v(300, 0, "b0")] },
    { id: 4, bridge: true, pts: [v(300, 0, "b0"), v(400, 0, "b1")] },
    { id: 5, pts: [v(400, 0, "b1"), v(600, 0)] },
  ]
  const { profile, zOf } = makeProfiler((x) => ground(x))
  profile(
    pieces.map((item) => ({ item, rev: false })),
    SPEC,
  )
  for (const p of pieces)
    for (const z of zOf.get(p)!) assert.ok(Math.abs(z - 100) < 1e-6, `piece ${p.id} at ${z}`)
})

// Regression: the Galleria del Lupacino, cut by the play area's outline 1325 m in and split by OSM where its speed limit
// changes, took the hill's surface at the cut and at the joint, and fell 3.7% to its portal.
test("profile runs a tunnel the outline cuts, in two pieces, level from its one portal: no hill's surface at the cut or the joint", () => {
  // A hill 30 m high over x < 200; the bore comes in at the cut x 0 (no id), in two pieces joined at x 100, and leaves its
  // portal at x 200 onto flat ground at 100 m.
  const ground = (x: number) => (x < 200 ? 130 : 100)
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, tunnel: true, pts: [v(0, 0), v(100, 0, "j")] },
    { id: 2, tunnel: true, pts: [v(100, 0, "j"), v(200, 0, "p")] },
    { id: 3, pts: [v(200, 0, "p"), v(600, 0)] },
  ]
  const { profile, zOf } = makeProfiler((x) => ground(x))
  profile(
    pieces.map((item) => ({ item, rev: false })),
    SPEC,
  )
  for (const p of pieces)
    for (const z of zOf.get(p)!) assert.ok(Math.abs(z - 100) < 1e-6, `piece ${p.id} at ${z}`)
})

test("replayClaims writes a window's nodes, its seam with the next included, as it writes the whole grid's", () => {
  // Two crossing roads over a sloping grid: the rank-0 road keeps the junction, the other blends.
  const ground = (x: number, y: number) => 100 + 0.05 * x + 0.1 * y
  const { profile, claims } = makeProfiler(ground)
  profile([{ item: { pts: [v(-10, -5), v(300, 6, "j"), v(610, 2)] }, rev: false }], {
    ...SPEC,
    rank: 0,
  })
  profile([{ item: { pts: [v(300, 6, "j"), v(320, 18)] }, rev: false }], { ...SPEC, rank: 2 })
  const whole = grid()
  whole.z.forEach(
    (_, n) => (whole.z[n] = ground(-20 + 4 * (n % 161), -20 + 4 * Math.floor(n / 161))),
  )
  const base = Float64Array.from(whole.z)
  replayClaims(
    whole,
    claims,
    new Uint8Array(whole.z.length).fill(255),
    new Uint8Array(whole.z.length),
  )
  // The windows meet at column 80 (x 300, the junction), both holding it.
  for (const [i0, cols] of [
    [0, 81],
    [80, 81],
  ] as const) {
    const span = { i0, j0: 0, cols, rows: 11 }
    const part: Grid = {
      ...whole,
      span,
      z: Float64Array.from(
        { length: cols * 11 },
        (_, k) => base[Math.floor(k / cols) * 161 + i0 + (k % cols)]!,
      ),
    }
    replayClaims(
      part,
      claims,
      new Uint8Array(part.z.length).fill(255),
      new Uint8Array(part.z.length),
    )
    part.z.forEach((z, k) => assert.equal(z, whole.z[Math.floor(k / cols) * 161 + i0 + (k % cols)]))
  }
  assert.notDeepEqual(whole.z, base, "the claims wrote the grid")
})

// Regression: a bound inside a tunnel pinned both its portals at its z, so a road crossing over a motorway tunnel climbing 3%,
// 50 m from its low portal, sank the high portal 10.5 m under the hill and the motorway out of it.
test("profile carries a tilted bound inside a tunnel to its portals along the tunnel's slope", () => {
  // A 1 km tunnel climbing 3% from 200 m under 23.5 m of cover; a bound 219.5 m at x 50, as a track
  // over it at its natural level asks (225 − 5.5 m).
  const ground = (x: number, y: number) =>
    200 + 0.03 * x + (x > 20 && x < 980 && Math.abs(y) < 200 ? 23.5 : 0)
  const tunnel = { id: 2, tunnel: true as const, pts: [v(0, 0, "b"), v(1000, 0, "c")] }
  const chain = [
    { id: 1, pts: [v(-300, 0, "a"), v(0, 0, "b")] },
    tunnel,
    { id: 3, pts: [v(1000, 0, "c"), v(1300, 0, "d")] },
  ].map((item) => ({ item, rev: false }))
  const spec = { w: 10, rank: 0, grade: 0.06, half: 100 }
  const portals = (tilt: boolean) => {
    const { profile, zOf } = makeProfiler(ground)
    profile(chain, spec, [{ x: 50, y: 0, z: 219.5, kind: "max", ...(tilt ? { tilt: true } : {}) }])
    return zOf.get(tunnel)!
  }
  const [low, high] = portals(true)
  // The deck under the track keeps the bound, and the high portal its own level (230 m).
  assert.ok(low! + ((high! - low!) * 50) / 1000 <= 219.5 + 1e-6)
  assert.ok(Math.abs(high! - 230) < 0.5, `high portal at ${high}`)
  // Pinned flat, the high portal sank more than 10 m.
  assert.ok(portals(false)[1]! < 220)
})

// Regression: the SS63's bridge over the Rosaro at Soliera is two OSM ways; taken piece by piece,
// their joint fell toward the ground 12 m under it, and the deck sagged 4.9 m there (12 % and 6 %).
test("profile lays a road's bridge of two pieces as one deck, straight from end to end; the rail keeps a deck a piece", () => {
  // Flat ground at 100 m, a gorge 10 m deep over x 300–400 under the bridge, its joint at x 330.
  const ground = (x: number) => (x > 300 && x < 400 ? 90 : 100)
  const halves = [
    { id: 4, bridge: true as const, pts: [v(300, 0, "b0"), v(330, 0, "j")] },
    { id: 5, bridge: true as const, pts: [v(330, 0, "j"), v(400, 0, "b1")] },
  ]
  const chain = [
    { id: 3, pts: [v(0, 0), v(300, 0, "b0")] },
    ...halves,
    { id: 6, pts: [v(400, 0, "b1"), v(700, 0)] },
  ].map((item) => ({ item, rev: false }))
  const joint = (decks: boolean) => {
    const { profile, zOf } = makeProfiler((x) => ground(x))
    profile(chain, { w: 9, rank: 1, grade: 0.1, half: 20, ...(decks ? { decks: true } : {}) })
    return zOf.get(halves[0]!)!.at(-1)!
  }
  assert.ok(Math.abs(joint(true) - 100) < 1e-6, `the joint at ${joint(true)}`)
  assert.ok(joint(false) < 99, `a deck a piece sags at its joint: ${joint(false)}`)
})

import assert from "node:assert/strict"
import { test } from "node:test"

import { chainsOf, insideNodes, type Linear } from "../chains.ts"
import type { RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import { coreHalf, replayClaims } from "../grid-claims.ts"
import { makeProfiler, PATH_PASS, RAIL_PASS, ROAD_PASSES } from "../profiles.ts"
import { HEADING_SPAN, MAX_TURN } from "../rail-graph.ts"
import { roadLevels } from "../road-levels.ts"
import { type Grid, sampleGrid } from "../terrain.ts"

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

// Regression: Liguria's DTM, interpolated from the NC5's heights, sees no cutting before Vezzano
// Ligure's Pontremolese mouths and climbs 14–19 m over the 32 m before them; the mouths took the
// face's ground 4 m out (35.4 and 41.5 m), and the line climbed into them at 2.5% to 28.6 and
// 29.4 m, its grade changing 4.0 and 4.2% over 20 m there.
test("profile takes a rail tunnel's mouth at the foot of the hill's face, however far out the face runs; a road's 4 m out", () => {
  // Flat ground at 100 m, a hill over x 100–200 at 130 m, and on its west side a face falling from
  // the mouth at x 100 to its foot at x 68, 0.45 m a metre (the Vezzano mouths' 0.44–0.47).
  const ground = (x: number) =>
    x >= 100 && x <= 200 ? 130 : x > 68 && x < 100 ? 100 + 0.45 * (x - 68) : 100
  const tunnel = { id: 2, tunnel: true as const, pts: [v(100, 0, "p0"), v(200, 0, "p1")] }
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(-400, 0), v(100, 0, "p0")] },
    tunnel,
    { id: 3, pts: [v(200, 0, "p1"), v(600, 0)] },
  ]
  /** The bore's middle, 50 m from either mouth, profiled with `spec`. */
  const middle = (spec: Parameters<ReturnType<typeof makeProfiler>["profile"]>[1]) => {
    const { profile, zOf } = makeProfiler((x) => ground(x))
    profile(
      pieces.map((item) => ({ item, rev: false })),
      spec,
    )
    return (zOf.get(tunnel)![0]! + zOf.get(tunnel)![1]!) / 2
  }
  const rail = middle({ w: 4, ...RAIL_PASS }),
    road = middle(SPEC)
  assert.ok(Math.abs(rail - 100) < 0.05, `the rail's bore's middle at ${rail.toFixed(2)}`)
  assert.ok(road > 102, `the road's bore's middle at ${road.toFixed(2)}, its mouth 4 m up the face`)
})

test("profile keeps a rail tunnel's mouth over a gully its line crosses on a bank before it: a gully's floor is no cutting's", () => {
  // Flat ground at 100 m, a hill over x 100–200 at 130 m, and before its west mouth a gully 20 m
  // deep over x 40–96, its sides falling 0.71 m a metre to its floor at x 68.
  const ground = (x: number) =>
    x >= 100 && x <= 200 ? 130 : x > 40 && x < 96 ? 80 + (20 * Math.abs(x - 68)) / 28 : 100
  const tunnel = { id: 2, tunnel: true as const, pts: [v(100, 0, "p0"), v(200, 0, "p1")] }
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(-400, 0), v(100, 0, "p0")] },
    tunnel,
    { id: 3, pts: [v(200, 0, "p1"), v(600, 0)] },
  ]
  /** The west mouth's level, profiled with `spec`. */
  const mouth = (spec: Parameters<ReturnType<typeof makeProfiler>["profile"]>[1]) => {
    const { profile, zOf } = makeProfiler((x) => ground(x))
    profile(
      pieces.map((item) => ({ item, rev: false })),
      spec,
    )
    return zOf.get(tunnel)![0]!
  }
  // As the mouth's level read 4 m out, with no face walked: the gully's floor is 20 m under it.
  const { faces: _, ...plain } = RAIL_PASS
  const rail = mouth({ w: 4, ...RAIL_PASS }),
    fourOut = mouth({ w: 4, ...plain })
  assert.ok(
    Math.abs(rail - fourOut) < 1e-6,
    `the mouth at ${rail.toFixed(2)}, not ${fourOut.toFixed(2)}`,
  )
})

// Regression: the Pontremolese's up track at Santo Stefano di Magra runs off its deck 86258947
// straight into its tunnel 54567426: the deck's end read the hill 4 m into the bore and the bore's
// mouth the deck 4 m out of it, and the joint stood at 28.7 m, 4.7 m over the down track's 15 m away.
test("profile lays a bridge and a tunnel joined end to end straight from the bridge's end to the portal: no hill's or valley's ground at their joint", () => {
  // Flat ground at 100 m, a valley 20 m deep under the bridge (x 300–400), a hill 30 m high over the
  // bore (x 400–500), its face standing at the joint.
  const ground = (x: number) => (x > 300 && x < 400 ? 80 : x >= 400 && x <= 500 ? 130 : 100)
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(0, 0), v(300, 0, "b0")] },
    { id: 2, bridge: true, pts: [v(300, 0, "b0"), v(400, 0, "j")] },
    { id: 3, tunnel: true, pts: [v(400, 0, "j"), v(500, 0, "p")] },
    { id: 4, pts: [v(500, 0, "p"), v(800, 0)] },
  ]
  for (const spec of [{ w: 4, ...RAIL_PASS }, SPEC]) {
    const { profile, zOf } = makeProfiler((x) => ground(x))
    profile(
      pieces.map((item) => ({ item, rev: false })),
      spec,
    )
    for (const p of pieces)
      for (const z of zOf.get(p)!) assert.ok(Math.abs(z - 100) < 1e-6, `piece ${p.id} at ${z}`)
  }
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

// Regression: the rail's chains ended at every switch, and each switch took its level from the
// first chain fitted to it, its window cut there: at Vezzano Ligure's west junction the free ends
// of the four tracks coming up from the east stood 1.7–3.8 m under the ground, and the crossovers
// between switches set by different chains changed grade 4–7.5% over 20 m (`railway.map-test.ts`).
test("profile takes a switch's level from the track running through it, on a climb as on the flat", () => {
  // Ground climbing 2% eastward; the through track runs (−800, 0) to (300, 0) through the switch at
  // x 0, and a siding 500 m long diverges from it, so that the line west of the switch is the
  // longest chain when chains end at switches.
  const ground = (x: number) => 100 + 0.02 * x
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(-800, 0), v(0, 0, "s")] },
    { id: 2, pts: [v(0, 0, "s"), v(300, 0)] },
    { id: 3, pts: [v(0, 0, "s"), v(40, 4), v(490, 60)] },
  ]
  const { profile, grown, nodeZ } = makeProfiler((x) => ground(x))
  for (const ch of grown(chainsOf(pieces, { turn: MAX_TURN, span: HEADING_SPAN })))
    profile(ch, { w: 4, ...RAIL_PASS })
  assert.ok(Math.abs(nodeZ.get("s")! - 100) < 0.05, `the switch at ${nodeZ.get("s")!.toFixed(2)}`)
})

// Regression: north of Aulla a switch of the Pontremolese's inside a tunnel took the hill's 114.9 m over the bore and humped
// the line, 99 m there, 5.5 m (its grade changed 4.9% over 20 m); a crossover's switch on the second track's deck over the
// SS665 took the valley's 71.8 m and sagged that track 4.4 m under the line beside it.
test("profile takes no hill's or valley's ground at a junction inside a bore or on a deck: its chains run on at their level", () => {
  // Flat ground at 100 m, a hill 30 m high over x 100–300 within 20 m of y 0 and a valley 8 m deep over x 400–500.
  const ground = (x: number, y: number) =>
    x > 100 && x < 300 && Math.abs(y) < 20 ? 130 : x > 400 && x < 500 ? 92 : 100
  const pieces: Array<Linear & { readonly id: number }> = [
    // The line: into the bore at x 100, a switch "s" in it at x 200, out at x 300; over a deck with a switch "d" at x 450.
    { id: 1, pts: [v(0, 0), v(100, 0, "p0")] },
    { id: 2, tunnel: true, pts: [v(100, 0, "p0"), v(200, 0, "s")] },
    { id: 3, tunnel: true, pts: [v(200, 0, "s"), v(300, 0, "p1")] },
    { id: 4, pts: [v(300, 0, "p1"), v(400, 0, "b0")] },
    { id: 5, bridge: true, pts: [v(400, 0, "b0"), v(450, 0, "d")] },
    { id: 6, bridge: true, pts: [v(450, 0, "d"), v(500, 0, "b1")] },
    { id: 7, pts: [v(500, 0, "b1"), v(700, 0)] },
    // A branch from the bore's switch out of the hill at y 30; a crossover from the deck's switch to a second track's deck.
    { id: 8, tunnel: true, pts: [v(200, 0, "s"), v(260, 30, "q")] },
    { id: 9, pts: [v(260, 30, "q"), v(400, 60)] },
    { id: 10, bridge: true, pts: [v(450, 0, "d"), v(480, 4, "e")] },
    { id: 11, bridge: true, pts: [v(400, 4, "c0"), v(480, 4, "e")] },
    { id: 12, bridge: true, pts: [v(480, 4, "e"), v(500, 4, "c1")] },
    { id: 13, pts: [v(500, 4, "c1"), v(700, 4)] },
    { id: 14, pts: [v(300, 4), v(400, 4, "c0")] },
  ]
  const inside = insideNodes(pieces)
  assert.deepEqual([...inside].sort(), ["d", "e", "s"])
  const { profile, grown, zOf } = makeProfiler(ground)
  for (const ch of grown(chainsOf(pieces))) profile(ch, { ...SPEC, inside: (id) => inside.has(id) })
  for (const p of pieces)
    for (const z of zOf.get(p)!) assert.ok(Math.abs(z - 100) < 1e-6, `piece ${p.id} at ${z}`)
})

test("profile runs a chain on from a start's level: the first vertex at it, a bore from it level to where the box cuts it, and its claims only where they may write", () => {
  // Flat ground at 100 m; a run-out from a terminal at x 0 (no id) whose line stands at 97 m, at grade to x 300.
  const ground = () => 100
  const atGrade = { pts: [v(0, 0), v(150, 0, "n"), v(300, 0)] }
  const { profile, zOf, claims } = makeProfiler(ground)
  const writes = (x: number) => x > 40
  profile([{ item: atGrade, rev: false }], { ...SPEC, start: 97, writes })
  const [z0, z1, z2] = zOf.get(atGrade)!
  assert.equal(z0, 97)
  // It climbs to the ground at the grade limit and stays on it.
  assert.ok(z1! > 99.5 && Math.abs(z2! - 100) < 1e-6, `${z1} then ${z2}`)
  const g = grid()
  replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
  const at = (x: number) => g.z[(20 / 4) * 161 + (x + 20) / 4]!
  assert.equal(at(0), 100, "a node where it may not write")
  assert.ok(at(44) < 100, `a node where it may: ${at(44)}`)
  // A bore from the terminal under a hill 30 m high, cut by the box at x 500: level at the line's level, never the hill's.
  const hill = () => 130
  const bore = { tunnel: true as const, pts: [v(0, 0), v(500, 0)] }
  const bored = (start?: number) => {
    const p = makeProfiler(hill)
    p.profile([{ item: bore, rev: false }], start === undefined ? SPEC : { ...SPEC, start })
    return p.zOf.get(bore)!
  }
  assert.deepEqual(bored(97), [97, 97])
  assert.deepEqual(bored(), [130, 130], "with no start, both ends cut: the hill's")
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

// Regression (review of #19): the A15's Parma carriageway's deck at Calcinara (136414830) kept its
// twin's level only through bounds carried to its ends along its slope before the fit, and sagged
// 7 m beside it; a bound at a deck's end itself was carried to its other end the same way.
test("profile holds a bound at a deck's end there alone: the straight deck keeps it, and its other end its own level", () => {
  // Ground climbing 2% east; a bridge from x 300 to 400 (106 to 108 m), a bound of 107 m at least
  // at its west end.
  const ground = (x: number) => 100 + 0.02 * x
  const deck = { id: 2, bridge: true as const, pts: [v(300, 0, "b0"), v(400, 0, "b1")] }
  const chain = [
    { id: 1, pts: [v(0, 0), v(300, 0, "b0")] },
    deck,
    { id: 3, pts: [v(400, 0, "b1"), v(700, 0)] },
  ].map((item) => ({ item, rev: false }))
  const { profile, zOf } = makeProfiler(ground)
  profile(chain, { w: 10, rank: 0, grade: 0.06, half: 100 }, [
    { x: 300, y: 0, z: 107, kind: "min", tilt: true, on: deck },
  ])
  const [west, east] = zOf.get(deck)!
  assert.ok(west! >= 107 - 1e-6, `west end at ${west}`)
  assert.ok(Math.abs(east! - 108) < 0.05, `east end at ${east}, not lifted with it`)
})

// Regression (#20): the A12's Livorno carriageway leaves its Vara bridge (60208802) on the deck's
// level, 5.5 m over the road under its east end, and runs on at grade beside its twin, which climbs
// to its own deck there: each bound the fit broke was pinned at its own level, the deck's end at
// 29.56 m and the sample 4.2 m on at the twin's level less 1.5 m, 28.06 m, so the line fell 1.5 m
// between them (36%) and 4 m over the next 50 m, past the motorway's 6%.
test("profile holds the bounds it breaks within its grade limit: a deck's end over its approach's lower bounds leaves it down the grade, not in a step", () => {
  // Flat ground at 100 m; a bridge from x 300 to 400, at least 106 m at its east end; past it, at
  // grade, within 1.5 m of a twin climbing 5.7% to 106 m at x 400 (`TWINS` in road-levels.ts).
  const ground = () => 100
  const deck = { id: 2, bridge: true as const, pts: [v(300, 0, "b0"), v(400, 0, "b1")] }
  const after = { id: 3, pts: [v(400, 0, "b1"), v(700, 0)] }
  const chain = [{ id: 1, pts: [v(0, 0), v(300, 0, "b0")] }, deck, after].map((item) => ({
    item,
    rev: false,
  }))
  const twinAt = (x: number) => Math.max(100, 106 - 0.057 * (x - 400))
  const twin = Array.from({ length: 20 }, (_, i) => 404 + 4 * i).map((x) => ({
    x,
    y: 0,
    z: twinAt(x) - 1.5,
    kind: "min" as const,
    on: after,
  }))
  const motorway = ROAD_PASSES[0]
  const { profile, denseOf } = makeProfiler(ground)
  profile(chain, { w: 10, ...motorway }, [
    { x: 400, y: 0, z: 106, kind: "min", tilt: true, on: deck },
    ...twin,
    ...twin.map((b) => ({ ...b, z: twinAt(b.x) + 1.5, kind: "max" as const })),
  ])
  const { pts, z } = denseOf.get(after)!
  assert.ok(z[0]! >= 106 - 1e-6, `the deck's end at ${z[0]}`)
  for (let k = 1; k < z.length; k++) {
    const g = Math.abs(z[k]! - z[k - 1]!) / (pts[k]!.x - pts[k - 1]!.x)
    assert.ok(g <= motorway.grade + 1e-6, `${(g * 100).toFixed(1)}% at x ${pts[k]!.x}`)
  }
  for (const b of twin) {
    const k = pts.findIndex((p) => p.x >= b.x)
    const at =
      z[k - 1]! + ((z[k]! - z[k - 1]!) * (b.x - pts[k - 1]!.x)) / (pts[k]!.x - pts[k - 1]!.x)
    assert.ok(at >= b.z - 1e-6, `${at.toFixed(2)} under ${b.z.toFixed(2)} at x ${b.x}`)
  }
})

// Regression (#20): the SS330's ramp 1388645825 at Albiano runs from a junction pinned at 33.52 m
// (its chain's start) past its twin's bounds, at least 34.25 m 5.7 m on and 40.16 m 17.6 m on: the
// fit broke both, and the first, raised to the reach down from the second, 38.37 m, left the
// junction's 5.6 m link 1250443404 climbing 87%; a bound beside a junction is raised no further than
// the junction's reach.
test("profile moves a broken bound to the reach of the broken bounds beside it, never past a junction's", () => {
  const line = { id: 1, pts: [v(0, 0, "a"), v(5.7, 0), v(17.6, 0), v(40, 0)] }
  const { profile, denseOf } = makeProfiler(() => 38)
  profile([{ item: line, rev: false }], { w: 6, ...ROAD_PASSES[1] }, [
    { x: 0, y: 0, z: 33.52 },
    { x: 5.7, y: 0, z: 34.25, kind: "min" },
    { x: 17.6, y: 0, z: 40.16, kind: "min" },
  ])
  const { pts, z } = denseOf.get(line)!
  const at = (x: number) => z[pts.findIndex((p) => p.x === x)]!
  assert.ok(at(5.7) >= 34.25 - 1e-6 && at(17.6) >= 40.16 - 1e-6, `${at(5.7)}, ${at(17.6)}`)
  const g = (at(5.7) - at(0)) / 5.7
  assert.ok(g <= 1.5 * ROAD_PASSES[1].grade + 1e-6, `${(g * 100).toFixed(1)}% from the junction`)
})

// Regression (#20): the A12's 420870862 is three OSM vertices over 1.4 km, and its fit dips 8 m
// between the last two, to 11.3 m where a track's tunnel passes under it; read on the chord between
// those vertices, 17.6 m there, the tunnel's bound left it 0.9 m under the motorway.
test("profile's zAt reads a fitted line's level on its profile, the bends between its vertices kept, not on the chord between them", () => {
  // Level ground at 100 m but a dip 10 m deep over x 300–500; a motorway of two vertices over it.
  const ground = (x: number) => (x > 300 && x < 500 ? 90 : 100)
  const line = { pts: [v(0, 0, "a"), v(800, 0, "b")] }
  const profiler = makeProfiler((x) => ground(x))
  profiler.profile([{ item: line, rev: false }], { w: 10, ...ROAD_PASSES[0] })
  const { pts, z } = profiler.denseOf.get(line)!
  const k = pts.findIndex((p) => p.x >= 400)
  const fitted =
    z[k - 1]! + ((z[k]! - z[k - 1]!) * (400 - pts[k - 1]!.x)) / (pts[k]!.x - pts[k - 1]!.x)
  assert.ok(fitted < 97, `the fit dips to ${fitted.toFixed(2)} m at x 400`)
  assert.ok(
    Math.abs(profiler.zAt(line, 400) - fitted) < 1e-9,
    `${profiler.zAt(line, 400)} read there`,
  )
})

// Regression (review of #19): the A15's Parma carriageway at Calcinara runs at grade over a dip the
// survey reads 13 m under its twin beside it; its fit, relaxed to stay within 4 m of the ground,
// sagged 6-8 m into it and climbed up to 6.8% over 100 m out of it, past the motorway's 6%.
test("profile keeps a motorway within its grade limit over a dip, where a local road's fit relaxes it", () => {
  // Level ground at 100 m but a dip 40 m deep over x 300–360, the road at grade over it.
  const ground = (x: number) => (x > 300 && x < 360 ? 60 : 100)
  const steepest = (classes: string) => {
    const pass = ROAD_PASSES.find((p) => (p.classes as ReadonlyArray<string>).includes(classes))!
    const line = { pts: [v(0, 0), v(700, 0)] }
    const { profile, denseOf } = makeProfiler((x) => ground(x))
    profile([{ item: line, rev: false }], { w: 10, ...pass })
    const { pts, z } = denseOf.get(line)!
    let g = 0
    for (let k = 1; k < z.length; k++)
      g = Math.max(g, Math.abs(z[k]! - z[k - 1]!) / (pts[k]!.x - pts[k - 1]!.x))
    return g
  }
  const motorway = steepest("motorway"),
    tertiary = steepest("tertiary")
  assert.ok(motorway <= 0.06 + 1e-9, `the motorway at ${(motorway * 100).toFixed(2)}%`)
  assert.ok(tertiary > 0.1 + 1e-3, `the tertiary road at ${(tertiary * 100).toFixed(2)}%`)
})

// Regression: the SS63's bridge over the Rosaro at Soliera is two OSM ways; taken piece by piece,
// their joint fell toward the ground 12 m under it, and the deck sagged 4.9 m there (12 % and 6 %).
// So did the rail's, past the reach of its smoothing: the Pontremolese's second track crosses the
// Magra north of Aulla on two pieces of 175 and 391 m (1045531416, 92904328), and their joint stood
// 5.6 m under the line between the deck's ends, its grade changing 4.5% over 20 m there.
test("profile lays a bridge of two pieces as one deck, straight from end to end, a road's and the rail's", () => {
  /** The joint's z on flat ground at 100 m, a valley 20 m deep under the bridge from x 300 to x 300 + a + b. */
  const joint = (
    a: number,
    b: number,
    spec: Parameters<ReturnType<typeof makeProfiler>["profile"]>[1],
  ) => {
    const ground = (x: number) => (x > 300 && x < 300 + a + b ? 80 : 100)
    const halves = [
      { id: 4, bridge: true as const, pts: [v(300, 0, "b0"), v(300 + a, 0, "j")] },
      { id: 5, bridge: true as const, pts: [v(300 + a, 0, "j"), v(300 + a + b, 0, "b1")] },
    ]
    const chain = [
      { id: 3, pts: [v(0, 0), v(300, 0, "b0")] },
      ...halves,
      { id: 6, pts: [v(300 + a + b, 0, "b1"), v(600 + a + b, 0)] },
    ].map((item) => ({ item, rev: false }))
    const { profile, zOf } = makeProfiler((x) => ground(x))
    profile(chain, spec)
    return zOf.get(halves[0]!)!.at(-1)!
  }
  const road = joint(30, 70, { w: 9, rank: 1, grade: 0.1, half: 20 }),
    rail = joint(175, 391, { w: 4, ...RAIL_PASS })
  assert.ok(Math.abs(road - 100) < 1e-6, `the road's joint at ${road}`)
  assert.ok(Math.abs(rail - 100) < 1e-6, `the rail's joint at ${rail}`)
})

// Regression: at the triangle's north apex by Santo Stefano di Magra the Pontremolese's up track and
// the link's leave one switch side by side on decks 442 and 814 m long (1045531422, 1045531424), one
// climbing 0.6% to fly over and the other falling 0.5%: each deck shipped straight between its ends,
// the bounds of its twin held in the fit and not in the deck shipped, and the two stood 1.00 m apart
// where they part (`rail.map-test.ts`); shipped as fitted, the deck held to its twin and then fell at
// the grade limit, its grade changing 4.18% over 20 m there.
test("profile bends a deck at the twin bound its straight line breaks most, in straight spans, and keeps it straight where none breaks", () => {
  // Flat ground at 100 m and a 400 m deck over it, its twin climbing 1% over its first 100 m beside it.
  const deck = { id: 2, bridge: true as const, pts: [v(0, 0, "a"), v(400, 0, "b")] }
  const chain = [
    { id: 1, pts: [v(-300, 0), v(0, 0, "a")] },
    deck,
    { id: 3, pts: [v(400, 0, "b"), v(700, 0)] },
  ].map((item) => ({ item, rev: false }))
  const twin = (x: number) => 100 + 0.01 * x
  const bounds = (reach: number) =>
    Array.from({ length: reach / 2 + 1 }, (_, n) => 2 * n).flatMap((x) => [
      { x, y: 0, z: twin(x) - 0.1, kind: "min" as const, on: deck, here: true as const },
      { x, y: 0, z: twin(x) + 0.1, kind: "max" as const, on: deck, here: true as const },
    ])
  const { profile, denseOf, zAt } = makeProfiler(() => 100)
  profile(chain, { w: 4, ...RAIL_PASS, tol: 0.03 }, bounds(100))
  for (const x of [20, 50, 80, 100])
    assert.ok(
      Math.abs(zAt(deck, x) - twin(x)) <= 0.1 + 0.03 + 1e-9,
      `the deck at x ${x}: ${zAt(deck, x).toFixed(2)}, its twin at ${twin(x).toFixed(2)}`,
    )
  // One bend, at the twin's last bound, then straight to the deck's far end.
  assert.equal(denseOf.get(deck)!.pts.length, 3)
  // A twin bound the straight deck keeps leaves it straight.
  const flat = makeProfiler(() => 100)
  flat.profile(chain, { w: 4, ...RAIL_PASS, tol: 0.03 }, [
    { x: 50, y: 0, z: 99.95, kind: "min", on: deck, here: true },
    { x: 50, y: 0, z: 100.05, kind: "max", on: deck, here: true },
  ])
  assert.equal(flat.denseOf.get(deck)!.pts.length, 2)
})

// Regression: Pieve San Lorenzo's underpass (road 756577583) under the station's tracks opened under
// neither mouth: Via della Stazione, a tertiary road crossing over it 4.5 m from the south mouth,
// held that mouth's cell 5.8 m over the floor, and Via Bugliatico, at a junction 4.2 m beyond the
// north one, held its cell 1.6 m over (its level there smoothed 1.6 m over the ground's dip).
test("profile: a road tunnel's approaches hold the grid round its mouths at their level, against a road over it and one beside it", () => {
  // Flat ground at 100 m; a tunnel from x 100 to 200 kept 6 m under it (a track's clearance over
  // it); a tertiary road over it 4 m inside its east mouth, and an equal road across its west
  // approach 4.2 m out, both profiled first.
  const ground = () => 100
  const tunnel = { id: 2, tunnel: true as const, pts: [v(100, 0, "m0"), v(200, 0, "m1")] }
  const chain = [
    { id: 1, pts: [v(0, 0), v(100, 0, "m0")] },
    tunnel,
    { id: 3, pts: [v(200, 0, "m1"), v(400, 0)] },
  ].map((item) => ({ item, rev: false }))
  const mouths = (on: boolean) => {
    const { profile, claims, zOf } = makeProfiler(ground)
    profile([{ item: { pts: [v(196, -20), v(196, 20)] }, rev: false }], { ...SPEC, rank: 1 })
    profile([{ item: { pts: [v(95.8, -20), v(95.8, 20)] }, rev: false }], { ...SPEC, rank: 3 })
    profile(chain, { w: 4.5, rank: 3, grade: 0.15, half: 20, ...(on ? { mouths: true } : {}) }, [
      { x: 150, y: 0, z: 94, kind: "max", tilt: true },
    ])
    const g = grid()
    replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
    const at = (x: number, y: number) => g.z[((y + 20) / 4) * 161 + (x + 20) / 4]!
    const [z0, z1] = zOf.get(tunnel)!
    return { banks: [at(100, 0) - z0!, at(200, 0) - z1!], over: at(196, 0), beside: at(96, -16) }
  }
  const { banks, over, beside } = mouths(true)
  for (const bank of banks)
    assert.ok(Math.abs(bank) < 0.5, `a mouth ${bank.toFixed(2)} m under the terrain`)
  // The road over the tunnel keeps its cells over it, behind the mouth; the other away from it.
  assert.equal(over, 100)
  assert.equal(beside, 100)
  // Without: both mouths buried about 6 m.
  for (const bank of mouths(false).banks) assert.ok(bank > 5, `${bank}`)
})

// Regression (#20): the A12 over the underpass 89579488 at Sarzana passes 5.7 m over its floor at its
// north mouth, which lies inside a cell of the grid: the cell's corners behind the mouth kept the
// A12's level, and the terrain mesh lifted the road out of the mouth 2.4 m over its profile within
// 2 m of it (a driver there read a car in the underpass off its level).
test("profile: a road tunnel's mouth inside a cell holds the cell's corners behind it at its floor, a road over it farther in keeps its own", () => {
  // Flat ground at 100 m; a tunnel from x 102 to 202 (its mouths half a cell off the grid's nodes)
  // kept 6 m under it; a road over it 4 m inside its west mouth, profiled first.
  const tunnel = { id: 2, tunnel: true as const, pts: [v(102, 0, "m0"), v(202, 0, "m1")] }
  const approach = { id: 1, pts: [v(0, 0), v(102, 0, "m0")] }
  const chain = [approach, tunnel, { id: 3, pts: [v(202, 0, "m1"), v(400, 0)] }].map((item) => ({
    item,
    rev: false,
  }))
  const { profile, claims, denseOf } = makeProfiler(() => 100)
  profile([{ item: { pts: [v(106, -20), v(106, 20)] }, rev: false }], { ...SPEC, w: 6.5 })
  profile(chain, { w: 4.5, rank: 3, grade: 0.15, half: 20, mouths: true }, [
    { x: 150, y: 0, z: 94, kind: "max", tilt: true },
  ])
  const g = grid()
  replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
  const { pts, z } = denseOf.get(approach)!
  /** The approach's profile at x. */
  const level = (x: number) => {
    const k = pts.findIndex((p) => p.x >= x)
    return z[k - 1]! + ((z[k]! - z[k - 1]!) * (x - pts[k - 1]!.x)) / (pts[k]!.x - pts[k - 1]!.x)
  }
  // The terrain over the approach's last 4 m out of the mouth stands on its profile, as it is drawn,
  // but where the grade bends at the mouth, mid-cell, from the approach's 20% to the bore's level:
  // the cell's straight line between its nodes stands up to 0.2 m over the bend.
  for (let x = 98; x <= 102; x += 0.5)
    assert.ok(
      sampleGrid(g, x, 0) - level(x) < 0.25,
      `the terrain ${(sampleGrid(g, x, 0) - level(x)).toFixed(2)} m over the road at x ${x}`,
    )
  // The road over the tunnel keeps its nodes a cell or more behind the mouth.
  assert.equal(g.z[(20 / 4) * 161 + (108 + 20) / 4], 100)
})

// Regression (review of #20): held as deep behind the mouth as a corner of its cells may lie, across
// the whole core, the 16 m underpass 145347886 under the SS63 at Fivizzano dropped the nodes under
// the SS63's edges over it, 4.3 m behind each mouth, 6–7 m, and the node between them, which the
// junction there holds 0.4 m over the SS63's profile, stood through its ribbon.
test("profile: behind a road tunnel's mouth only the corners of the cells its carriageway runs in are held, a road over it keeps every other node", () => {
  // Flat ground at 100 m; a straight chain heading north-east at 45°, its tunnel's west mouth at
  // (98.34, 0) and kept 6 m under the ground midway; a road at grade over the bore along x 104,
  // profiled first. The node (104, 0) lies 4 m behind the mouth and 4 m off the bore's axis: within
  // the approach's core, but 4.24 m along x from the nearest point of its carriageway ahead of it.
  const at = (s: number) => v(98.34 + s * Math.SQRT1_2, s * Math.SQRT1_2)
  const approach = { id: 1, pts: [at(-100), { ...at(0), id: "m0" }] }
  const chain = [
    approach,
    {
      id: 2,
      tunnel: true as const,
      pts: [
        { ...at(0), id: "m0" },
        { ...at(100), id: "m1" },
      ],
    },
    { id: 3, pts: [{ ...at(100), id: "m1" }, at(200)] },
  ].map((item) => ({ item, rev: false }))
  const { profile, claims, denseOf } = makeProfiler(() => 100)
  profile([{ item: { pts: [v(104, -20), v(104, 20)] }, rev: false }], { ...SPEC, w: 6.5 })
  const mid = at(50)
  profile(chain, { w: 4, rank: 3, grade: 0.15, half: 20, mouths: true }, [
    { x: mid.x, y: mid.y, z: 94, kind: "max", tilt: true },
  ])
  const g = grid()
  replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
  // The approach's last 4 m stand on the terrain at its level, as before.
  const { pts, z } = denseOf.get(approach)!
  /** The approach's profile `s` m along the chain from the mouth (−100 at its start). */
  const level = (s: number) => {
    const k = pts.findIndex((p) => p.x >= at(s).x)
    return (
      z[k - 1]! + ((z[k]! - z[k - 1]!) * (at(s).x - pts[k - 1]!.x)) / (pts[k]!.x - pts[k - 1]!.x)
    )
  }
  for (let s = -4; s <= -0.5; s += 0.5) {
    const p = at(s)
    assert.ok(
      sampleGrid(g, p.x, p.y) - level(s) < 0.25,
      `the terrain ${(sampleGrid(g, p.x, p.y) - level(s)).toFixed(2)} m over the road ${-s} m out`,
    )
  }
  // The road over the bore keeps the node no cell of the approach's carriageway has for a corner.
  assert.equal(g.z[(20 / 4) * 161 + (104 + 20) / 4], 100)
})

// Regression (review of #20): the road out of the east mouth of Fivizzano's 16 m underpass 145347886
// turns 34° there, and its carriageway's inner edge, read ahead of the mouth along its heading,
// reached 1.2 m behind the mouth's face: the corners of its cells under the SS63's edge over the
// bore, held at the floor, left the node between them 0.4 m over the SS63's profile, through its
// ribbon.
test("profile: behind a road tunnel's mouth the corners are those of the cells its carriageway runs in ahead of the mouth's face, a road turning there", () => {
  // Flat ground at 100 m; a tunnel east from (100, 0), on a node of the grid, kept 6 m under it
  // midway; its approach leaves the mouth 40° off the bore's line; a road at grade over the bore
  // along x 104, profiled first. The node (104, 0), 4 m behind the face, is the corner of no cell the
  // carriageway runs in ahead of it, though its inner edge reaches 1.6 m behind it.
  const out = (s: number) => v(100 - s * Math.cos(0.7), -s * Math.sin(0.7))
  const approach = { id: 1, pts: [out(25), { ...out(0), id: "m0" }] }
  const chain = [
    approach,
    { id: 2, tunnel: true as const, pts: [v(100, 0, "m0"), v(200, 0, "m1")] },
    { id: 3, pts: [v(200, 0, "m1"), v(400, 0)] },
  ].map((item) => ({ item, rev: false }))
  const { profile, claims } = makeProfiler(() => 100)
  profile([{ item: { pts: [v(104, -20), v(104, 20)] }, rev: false }], { ...SPEC, w: 6.5 })
  profile(chain, { w: 5, rank: 3, grade: 0.15, half: 20, mouths: true }, [
    { x: 150, y: 0, z: 94, kind: "max", tilt: true },
  ])
  const g = grid()
  replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
  assert.equal(g.z[(20 / 4) * 161 + (104 + 20) / 4], 100)
  // The corners of the cell the mouth opens in, ahead of the face, are held.
  assert.ok(g.z[(20 / 4) * 161 + (100 + 20) / 4]! < 97, `${g.z[5 * 161 + 30]}`)
})

// Regression (review of #20): the service 378473978 climbs out of the underpass 378473973 at
// Sarzana, whose bore climbs in from its mouth too; held at the bore's floor, the corner 2.3 m behind
// the mouth stood 0.4 m over the road there, and the terrain mesh 0.12 m through its ribbon.
test("profile: behind a road tunnel's mouth at the foot of its approach the corners are held no higher than the mouth", () => {
  // Flat ground at 100 m, rising to 112 m 50 m into a tunnel from x 102 to 202, which a bound keeps
  // at 95 m 2 m inside its west mouth: the bore climbs east from there, the approach west.
  const ground = (x: number) => (x < 152 ? 100 : 112)
  const approach = { id: 1, pts: [v(0, 0), v(102, 0, "m0")] }
  const chain = [
    approach,
    { id: 2, tunnel: true as const, pts: [v(102, 0, "m0"), v(202, 0, "m1")] },
    { id: 3, pts: [v(202, 0, "m1"), v(400, 0)] },
  ].map((item) => ({ item, rev: false }))
  const { profile, claims, denseOf } = makeProfiler(ground)
  profile(chain, { w: 4.5, rank: 3, grade: 0.15, half: 20, mouths: true }, [
    { x: 104, y: 0, z: 95, kind: "max", tilt: true },
  ])
  const g = grid()
  for (let k = 0; k < g.z.length; k++) g.z[k] = ground(-20 + 4 * (k % 161))
  replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
  const { pts, z } = denseOf.get(approach)!,
    mouth = z.at(-1)!
  // The node 2 m behind the mouth no higher than the mouth, and the terrain over the approach's last
  // 4 m within the chord of the cell its bend at the mouth lies in.
  assert.ok(
    g.z[(20 / 4) * 161 + (104 + 20) / 4]! <= mouth + 1e-9,
    `${g.z[5 * 161 + 31]} over ${mouth}`,
  )
  for (let x = 98; x <= 102; x += 0.5) {
    const k = pts.findIndex((p) => p.x >= x),
      level = z[k - 1]! + ((z[k]! - z[k - 1]!) * (x - pts[k - 1]!.x)) / (pts[k]!.x - pts[k - 1]!.x)
    assert.ok(
      sampleGrid(g, x, 0) - level < 0.2,
      `${(sampleGrid(g, x, 0) - level).toFixed(2)} m at x ${x}`,
    )
  }
})

// Regression (#20): the footway 1484690678 at Sarzana crosses over the service tunnel 376037643 5.5 m
// behind its east mouth, on the bank 4.4 m over its floor; held at the floor, the mouth's cell under
// its vertex dropped it 2.6 m, 1.7 m over the road in the bore.
test("profile: a road tunnel's mouth leaves the cells of a footway's vertices behind it", () => {
  // As above, a footway at grade crossing over the bore 2.5 m behind its west mouth, on the road
  // over it, or passing beside it.
  const tunnel = { id: 2, tunnel: true as const, pts: [v(102, 0, "m0"), v(202, 0, "m1")] }
  const chain = [
    { id: 1, pts: [v(0, 0), v(102, 0, "m0")] },
    tunnel,
    { id: 3, pts: [v(202, 0, "m1"), v(400, 0)] },
  ].map((item) => ({ item, rev: false }))
  const footway = v(104.5, 1),
    beside = v(104.5, 4.5)
  /** The terrain under the vertex `at` with `footways` at grade. */
  const under = (footways: ReadonlyArray<V>, at = footway) => {
    const { profile, claims } = makeProfiler(
      () => 100,
      [],
      new Set(),
      new Set(),
      (x, y, r) => footways.filter((f) => Math.hypot(f.x - x, f.y - y) <= r),
    )
    profile([{ item: { pts: [v(106, -20), v(106, 20)] }, rev: false }], { ...SPEC, w: 6.5 })
    profile(chain, { w: 4.5, rank: 3, grade: 0.15, half: 20, mouths: true }, [
      { x: 150, y: 0, z: 94, kind: "max", tilt: true },
    ])
    const g = grid()
    replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
    return sampleGrid(g, at.x, at.y)
  }
  assert.equal(under([footway]), 100)
  assert.ok(under([]) < 97, `${under([])}: held at the floor without`)
  // One beside the bore, 4.5 m off its axis (its kerbs 3.25 m), keeps nothing.
  assert.ok(under([beside], beside) < 99, `${under([beside], beside)}: beside the bore`)
})

// Regression (#20): the service tunnel 438625870 at Sarzana opens onto the residential 438625873,
// another pass's chain, and the hill over its bore, 4.5 m over its floor, lifted that road out of
// the mouth 4.6 m within 2 m of it: only the bore's own chain held its mouths.
test("profile: a road ending at grade at another chain's tunnel mouth holds the cells' corners behind it at its level", () => {
  // A hill 6 m high over x 102–202 on flat ground at 100 m and a road on it 4 m in from its west
  // face; a tunnel through it at 100 m, its own chain; a road of another chain leading from its west
  // mouth, half a cell off the grid's nodes.
  const ground = (x: number) => (x > 102 && x < 202 ? 106 : 100)
  const tunnel = { id: 2, tunnel: true as const, pts: [v(102, 0, "m0"), v(202, 0, "m1")] }
  const approach = { id: 1, pts: [v(0, 0), v(102, 0, "m0")] }
  /** The terrain over the approach's last metres out of the mouth, m over its profile at most. */
  const lift = (ends: ReadonlySet<string>) => {
    const { profile, claims } = makeProfiler(ground, [], new Set(), ends)
    profile([{ item: { pts: [v(106, -20), v(106, 20)] }, rev: false }], { ...SPEC, w: 6.5 })
    profile([{ item: tunnel, rev: false }], { ...SPEC, w: 4.5, mouths: true })
    profile([{ item: approach, rev: false }], { ...SPEC, w: 4.5, mouths: true })
    const g = grid()
    for (let k = 0; k < g.z.length; k++) g.z[k] = ground(-20 + 4 * (k % 161))
    replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
    let most = -Infinity
    for (let x = 98; x <= 102; x += 0.5) most = Math.max(most, sampleGrid(g, x, 0) - 100)
    return most
  }
  assert.ok(lift(new Set(["m0", "m1"])) < 0.05, `${lift(new Set(["m0", "m1"]))} m`)
  // Without: the road over the hill keeps the node 2 m behind the mouth, which lifts the road's last
  // 2 m by up to 3 m.
  assert.ok(lift(new Set()) > 2, `${lift(new Set())} m`)
})

// Regression: east of Collegnago a road fitted round a hill, one end pinned, left its free junction
// 3.3 m over the ground, and the 12 m link from there to the junction an earlier fit set, fitted
// last between the two, climbed 53 % where the ground between them climbs 18 %.
test("profile keeps a junction it sets within reach of the short link to a junction set before", () => {
  // Flat ground at 100 m to y 12; then a hill climbing 27 % to 127 m at y 112, falling 10 % to C.
  const ground = (_x: number, y: number) =>
    y <= 12 ? 100 : y <= 112 ? 100 + 0.27 * (y - 12) : 127 - 0.1 * (y - 112)
  const west = { pts: [v(-100, 0), v(0, 0, "A")] }
  const top = { pts: [v(0, 212, "C"), v(100, 212)] }
  const hill = { pts: [v(0, 12, "B"), v(0, 62), v(0, 112), v(0, 162), v(0, 212, "C")] }
  const link = { pts: [v(0, 0, "A"), v(0, 12, "B")] }
  const spec = { w: 5, rank: 3, grade: 0.15, half: 20 }
  const climb = (reach: boolean) => {
    const graded = [west, top, hill, link].map((piece) => ({ piece, grade: 1.5 * spec.grade }))
    const { profile, zOf } = makeProfiler(ground, graded)
    for (const piece of [top, west, hill, link])
      profile([{ item: piece, rev: false }], reach ? { ...spec, reach: true } : spec)
    const [a, b] = zOf.get(link)!
    return (b! - a!) / 12
  }
  assert.ok(climb(true) <= 1.5 * 0.15 + 1e-9, `the link climbs ${climb(true)}`)
  // Unbounded, the hill's fit lifts B and the link climbs far over its grade.
  assert.ok(climb(false) > 0.25, `the link climbs ${climb(false)}`)
})

// Regression: the SR445's loop at Gassano runs under its own bridge, both in one chain; a bound at
// the crossing took the chain's nearest sample, on the loop, so the bridge's lifted the loop to it
// and the bridge stood 1.4 m over it.
test("profile holds each bound on its own piece where a chain crosses itself: a loop clears its own bridge", () => {
  // Flat ground at 100 m: a loop from under the bridge, south and round to W, then the bridge on
  // east from W; they cross at (14, 0), the loop's nearest sample 0.8 m off it, the bridge's 2 m.
  const primary = (id: number, pts: ReadonlyArray<V>, bridge = false): RoadF => ({
    id,
    cls: "primary",
    w: 7,
    surface: "asphalt",
    private: false,
    pts,
    ...(bridge ? { bridge: true } : {}),
  })
  const loop = primary(1, [v(14, 20), v(14, -30), v(0, -60), v(-30, -30), v(0, 0, "W")])
  const bridge = primary(2, [v(0, 0, "W"), v(80, 0, "E")], true)
  const chain = [loop, bridge].map((item) => ({ item, rev: false }))
  const { bounds } = roadLevels({
    roads: [loop, bridge],
    ground: () => 100,
    fitted: () => false,
    zAt: () => 0,
  })
  const { profile, zOf } = makeProfiler(() => 100)
  profile(chain, { w: 7, rank: 1, grade: 0.1, half: 20 }, bounds(chain))
  const [w, e] = zOf.get(bridge)!,
    [l0, l1] = zOf.get(loop)!
  const gap = w! + ((e! - w!) * 14) / 80 - (l0! + ((l1! - l0!) * 20) / 50)
  assert.ok(gap >= 5.5 - 1e-6, `the bridge ${gap.toFixed(2)} m over the loop`)
})

// Regression: build-terrain cored each road chain at its widest piece's width, so Fosdinovo's 8.4 m
// tertiary 519669896 at (−4469, −4510), joined onto the Strada comunale per Campo Cecina's chain,
// widened that chain's core from 5.55 to 6.5 m either side as far east as x −592 and moved 4,878 of
// lucido's nodes 4–16 m off the road, though the road's line and z were unchanged.
test("profile cores each piece at its own width: a wider piece joined on along its chain leaves the grid beside it as it was", () => {
  // A cross slope, so a core's edge shows in the grid; the road runs level along y 0.
  const ground = (_x: number, y: number) => 100 + 0.5 * y
  const base = grid()
  base.z.forEach((_, n) => (base.z[n] = ground(0, -20 + 4 * Math.floor(n / 161))))
  const narrow = { w: 4, pts: [v(0, 0), v(300, 0, "j")] },
    wide = { w: 10, pts: [v(300, 0, "j"), v(600, 0)] }
  const written = (pieces: ReadonlyArray<typeof narrow>) => {
    const { profile, claims } = makeProfiler(ground)
    profile(
      pieces.map((item) => ({ item, rev: false })),
      { ...SPEC, w: (piece) => piece.w },
    )
    const g = { ...base, z: Float64Array.from(base.z) }
    replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
    return g.z
  }
  const alone = written([narrow]),
    joined = written([narrow, wide])
  assert.notDeepEqual(alone, base.z, "the narrow piece wrote the grid")
  // x 0…260, beyond the wide piece's reach (its core and blend, 15.3 m past the joint)
  for (let j = 0; j < 11; j++)
    for (let i = 5; i <= 70; i++)
      assert.equal(joined[j * 161 + i], alone[j * 161 + i], `node (${-20 + 4 * i}, ${-20 + 4 * j})`)
})

test("profile holds a tunnel's mouths at their approach's width, not the bore's", () => {
  // A 10 m bore from x 100 to 200 between a 4 m approach from the west and a 5 m one to the east.
  const chain = [
    { w: 4, pts: [v(0, 0), v(100, 0, "m0")] },
    { w: 10, tunnel: true as const, pts: [v(100, 0, "m0"), v(200, 0, "m1")] },
    { w: 5, pts: [v(200, 0, "m1"), v(400, 0)] },
  ]
  const { profile, claims } = makeProfiler(() => 100)
  profile(
    chain.map((item) => ({ item, rev: false })),
    { ...SPEC, w: (piece) => piece.w, mouths: true },
  )
  // Each mouth's claim (at the mouth's x) and the core half-widths its segments hold.
  const mouths = claims.flatMap((c) =>
    c.ahead === undefined ? [] : [[c.ahead[0], new Set(c.core)]],
  )
  assert.deepEqual(mouths, [
    [100, new Set([coreHalf(4, 4)])],
    [200, new Set([coreHalf(5, 4)])],
  ])
})

// Regression: the A15's approaches at Aulla (rank 0, cores 7.3–9.05 m) held their round ends past
// their decks' ends at the decks' level over the tracks and the SP20 passing under the first spans:
// track 137475085 under 491154909 lay at 78.8 m on a ground of 84.7, and the walkers on it came up
// onto the deck; the SP20 under 85957119 rose 5.5 m within 6 m of it.
test("an approach's core past its bridge's end yields to any other core: a road passing under the deck's first metres keeps its level", () => {
  // A valley 10 m deep over x 201.5–400; a motorway at grade at 100 m onto a bridge over it from
  // x 201.5 to 400, its approach and deck one chain or two (a junction at the deck's end).
  const ground = (x: number) => (x > 201.5 && x < 400 ? 90 : 100)
  const approach = { pts: [v(0, 0), v(201.5, 0, "a")] },
    deck = { bridge: true as const, pts: [v(201.5, 0, "a"), v(400, 0, "b")] }
  const built = (chains: ReadonlyArray<ReadonlyArray<Linear>>, track: boolean) => {
    const { profile, claims } = makeProfiler((x) => ground(x), [], new Set(["a", "b"]))
    for (const chain of chains)
      profile(
        chain.map((item) => ({ item, rev: false })),
        { w: 10, rank: 0, grade: 0.06, half: 100 },
      )
    // A track across the valley floor 1.5 m past the deck's start, written after the motorway.
    if (track)
      profile([{ item: { pts: [v(203, -20), v(203, 20)] }, rev: false }], {
        ...SPEC,
        w: 3,
        rank: 4,
      })
    const g = grid()
    g.z.forEach((_, n) => (g.z[n] = ground(-20 + 4 * (n % 161))))
    replayClaims(g, claims, new Uint8Array(g.z.length).fill(255), new Uint8Array(g.z.length))
    return (x: number) => g.z[(20 / 4) * 161 + (x + 20) / 4]!
  }
  for (const chains of [[[approach, deck]], [[approach], [deck]]]) {
    const under = built(chains, true)
    assert.equal(under(204), 90, "the track's core 2.5 m past the deck's start, in the approach's")
    // 1.5 m behind the end, in the track's core: the approach's carriageway, whose surface would
    // float over the track's level there.
    assert.equal(under(200), 100, "the approach's own core behind the deck's end")
    assert.equal(
      built(chains, false)(204),
      100,
      "with nothing under it, the core reaches on as before",
    )
  }
})

// Regression: a path's or steps' bridge or tunnel ran straight between its ends at the terrain's
// level, whatever it crossed: the sidewalk bridge 1414943238 at Aulla 0.4 m over the track under it,
// the footway's underpass 1311862950 0.5 m over the footway over it.
test("profile with ramps fits a path's deck between its ends' levels over or under what it crosses, at its grade", () => {
  // Flat ground at 100 m; a 60 m footbridge (or underpass) from x 0 to 60, its ends at the ground's
  // level, crossing a way at x 30 that asks it 105.5 m at least (or 96 m at most) within 2 m of it.
  const fit = (tunnel: boolean, ramps: boolean) => {
    const piece = {
      ...(tunnel ? { tunnel: true as const } : { bridge: true as const }),
      pts: [v(0, 0, "a"), v(30, 0), v(60, 0, "b")],
    }
    const { profile, denseOf } = makeProfiler(() => 100)
    profile(
      [{ item: piece, rev: false }],
      { w: 1.5, ...PATH_PASS, ...(ramps ? { ramps: true } : {}), ends: () => 100 },
      [28, 30, 32].map((x) => ({
        x,
        y: 0,
        z: tunnel ? 96 : 105.5,
        kind: tunnel ? ("max" as const) : ("min" as const),
        tilt: true as const,
        on: piece,
      })),
    )
    const { pts, z } = denseOf.get(piece)!
    return { ends: [z[0]!, z.at(-1)!], mid: z[pts.findIndex((p) => p.x === 30)]!, z, pts }
  }
  for (const tunnel of [false, true]) {
    const { ends, mid, z, pts } = fit(tunnel, true)
    assert.deepEqual(ends, [100, 100], "its ends at their levels")
    assert.ok(tunnel ? mid <= 96 + 1e-6 : mid >= 105.5 - 1e-6, `${mid} where it crosses`)
    for (let k = 1; k < z.length; k++)
      assert.ok(
        Math.abs(z[k]! - z[k - 1]!) <= 1.5 * PATH_PASS.grade * (pts[k]!.x - pts[k - 1]!.x) + 1e-6,
      )
    // Straight from end to end between its pinned ends, it stays at their level where it crosses.
    assert.equal(fit(tunnel, false).mid, 100)
  }
})

// Regression: a path's deck end where a path at grade leads on was pinned at the ground's level, so
// the wheelchair ramp 1408285960 out of Aulla Lunigiana station's underpass, 18.4 m long, climbed
// the 6.3 m from the underpass's level to the ground at 34%, past the pass's grade limit.
test("profile with ramps leaves a deck's end with no level to the fit, within its grade", () => {
  // Flat ground at 79 m; a ramp 18.4 m long out of an underpass at 72.9 m.
  const ramp = { tunnel: true as const, pts: [v(0, 0, "u"), v(18.4, 0, "t")] }
  const fit = (top: number | undefined) => {
    const { profile, denseOf } = makeProfiler(() => 79)
    profile([{ item: ramp, rev: false }], {
      w: 1.5,
      ...PATH_PASS,
      ramps: true,
      ends: (p) => (p.id === "u" ? 72.9 : top),
    })
    return denseOf.get(ramp)!
  }
  const { pts, z } = fit(undefined)
  assert.equal(z[0], 72.9)
  for (let k = 1; k < z.length; k++)
    assert.ok(
      Math.abs(z[k]! - z[k - 1]!) <= 1.5 * PATH_PASS.grade * (pts[k]!.x - pts[k - 1]!.x) + 1e-6,
      `${z[k - 1]} to ${z[k]}`,
    )
  // Pinned at the ground's level, it is the straight line up to it, over its grade.
  assert.equal(fit(79).z.at(-1), 79)
})

// Regression: a path's bridge over two ways fitted sample by sample dipped to the ground between
// them: the coast's 153 m cycle footbridge 522153380 fell from 7.7 m over a driveway to 1.8 m and
// climbed back to 6.1 m over a footway, at 25–30%.
test("profile with ramps spans a bridge's deck between the humps over the ways it crosses; a bore still dips", () => {
  // Flat ground at 100 m; a 120 m footbridge (or underpass) from x 0 to 120, its ends at the
  // ground's level, over ways at x 20 and x 100 that ask it 105.5 m at least (or 94 m at most).
  const fit = (tunnel: boolean) => {
    const piece = {
      ...(tunnel ? { tunnel: true as const } : { bridge: true as const }),
      pts: [v(0, 0, "a"), v(20, 0), v(60, 0), v(100, 0), v(120, 0, "b")],
    }
    const { profile, denseOf } = makeProfiler(() => 100)
    profile(
      [{ item: piece, rev: false }],
      { w: 1.5, ...PATH_PASS, ramps: true, ends: () => 100 },
      [20, 100].map((x) => ({
        x,
        y: 0,
        z: tunnel ? 94 : 105.5,
        kind: tunnel ? ("max" as const) : ("min" as const),
        tilt: true as const,
        on: piece,
      })),
    )
    const { pts, z } = denseOf.get(piece)!
    return (x: number) => z[pts.findIndex((p) => p.x === x)]!
  }
  const deck = fit(false)
  assert.ok(deck(60) >= 105.5 - 1e-6, `${deck(60)} between the ways it crosses`)
  assert.deepEqual([deck(0), deck(120)], [100, 100], "its ends at their levels")
  const bore = fit(true)
  assert.ok(bore(60) > 94 + 1, `${bore(60)}: the bore rises back between them`)
})

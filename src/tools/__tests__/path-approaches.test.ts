import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import { replayClaims } from "../grid-claims.ts"
import {
  APPROACH_GRADE,
  type ApproachLine,
  pathApproaches,
  pathsAtGrade,
} from "../path-approaches.ts"
import type { Grid } from "../terrain.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const way = (id: number, cls: RoadF["cls"], pts: ReadonlyArray<V>, tunnel = false): RoadF => ({
  id,
  cls,
  w: 2,
  surface: "paved",
  private: false,
  pts,
  ...(tunnel ? { tunnel: true as const } : {}),
})
/** Flat ground at 100 m. */
const flat = () => 100
/** No way crosses over or under it. */
const open = () => []

// Regression: the paths and steps at grade kept the terrain's level where they lead into a path's
// tunnel: the station's 19.6 m steps at Aulla Lunigiana (1388757323) stood 5.8 m over the underpass
// (1387000572) at their joint with it.
test("pathApproaches climbs a path or steps at grade from the level its deck set to the ground, at its class's grade", () => {
  for (const cls of ["path", "steps"] as const) {
    const bore = way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")], true),
      stair = way(2, cls, [v(0, 0, "u"), v(30, 0, "t")])
    const nodeZ = new Map([
      ["w", 94.2],
      ["u", 94.2],
    ])
    const { lines } = pathApproaches(pathsAtGrade([bore, stair]), ["w", "u"], nodeZ, open, {
      ground: flat,
    })
    const line = lines.get(stair)!
    assert.equal(line.z[0], 94.2, "it meets the bore at its level")
    assert.equal(line.z.at(-1), undefined, "its top keeps the terrain")
    // It climbs at its grade until it meets the ground, and keeps the sample where it does.
    const met = 5.8 / APPROACH_GRADE[cls]
    for (let k = 1; k < line.z.length; k++) {
      const z = line.z[k] ?? 100,
        was = line.z[k - 1] ?? 100,
        run = line.pts[k]!.x - line.pts[k - 1]!.x
      assert.ok(z - was <= APPROACH_GRADE[cls] * run + 1e-6, `${cls}: ${was} to ${z} over ${run}`)
    }
    assert.ok(
      line.pts.some((p, k) => line.z[k] === undefined && Math.abs(p.x - met) <= 4),
      `${cls}: it meets the ground within a sample of ${met.toFixed(1)} m`,
    )
    assert.ok(!nodeZ.has("t"), "the top, on the ground, is set by no fit")
  }
})

test("pathApproaches carries a level it cannot bring to the ground within a way on along the ways at grade from it", () => {
  // A 10 m path from a bore 6 m under the ground reaches 3 m over it at its far end, and the path on
  // from there takes the rest.
  const bore = way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")], true),
    first = way(2, "path", [v(0, 0, "u"), v(10, 0, "m")]),
    next = way(3, "path", [v(10, 0, "m"), v(40, 0, "t")])
  const nodeZ = new Map([
    ["w", 94],
    ["u", 94],
  ])
  const { lines, claims } = pathApproaches(
    pathsAtGrade([bore, first, next]),
    ["w", "u"],
    nodeZ,
    open,
    { ground: flat },
  )
  const high = 94 + 10 * APPROACH_GRADE.path
  assert.ok(Math.abs(nodeZ.get("m")! - high) < 1e-9, `${nodeZ.get("m")} at the joint`)
  assert.equal(lines.get(first)!.z.at(-1), nodeZ.get("m"))
  assert.equal(lines.get(next)!.z[0], nodeZ.get("m"))
  assert.equal(lines.get(next)!.z.at(-1), undefined)
  // Their claims write the grid along their stretches off the ground, and leave it beyond.
  const cols = 21,
    g: Grid = {
      cell: 4,
      cols,
      rows: 11,
      x0: -20,
      y0: -20,
      ax: -20,
      ay: -20,
      z: new Float64Array(cols * 11).fill(100),
    }
  replayClaims(g, claims, new Uint8Array(cols * 11).fill(255), new Uint8Array(cols * 11))
  const at = (x: number) => g.z[5 * cols + (x + 20) / 4]!
  assert.ok(at(0) < 95, `${at(0)} at the bore's end`)
  assert.ok(Math.abs(at(8) - (94 + 8 * APPROACH_GRADE.path)) < 1e-9, `${at(8)} 8 m on`)
  assert.equal(at(40), 100, "the ground past where it meets it")
})

test("pathApproaches leaves a path at grade whose levels are the ground's or a road's on the terrain but where it meets the deck", () => {
  // The bore's end at the ground's level, and a road's junction 1.5 m over it (a road's bank).
  const bore = way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")], true),
    lane = way(2, "path", [v(0, 0, "u"), v(20, 0, "j")])
  const nodeZ = new Map([
    ["w", 100],
    ["u", 100],
    ["j", 101.5],
  ])
  const { lines, claims, mouths } = pathApproaches(
    pathsAtGrade([bore, lane]),
    ["w", "u"],
    nodeZ,
    open,
    { ground: flat, mouthAt: (id) => id === "u" },
  )
  assert.deepEqual(lines.get(lane)!.z, [100, undefined], "the bore's level where it meets it")
  assert.equal(claims.length, 0, "no stretch off the ground")
  // Out of the bore's mouth, its first MOUTH m hold the grid at its level, ahead of the mouth.
  assert.equal(mouths.length, 1)
  assert.ok(mouths[0]!.p.z.every((z) => z === 100))
  assert.deepEqual(mouths[0]!.ahead, [0, 0, mouths[0]!.p.x[1]!, 0])
})

// Regression: an approach climbing at its grade toward a slope steeper than it never caught the
// slope: from a footbridge's end 0.6 m under a 47% hillside (93744740), the path 1121797190 cut 2.4 m
// into it for 40 m.
test("pathApproaches meets a slope steeper than its grade as soon as the flat", () => {
  const slope = (x: number) => 100 + 0.47 * x
  const bridge = way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")]),
    path = way(2, "path", [v(0, 0, "u"), v(40, 0, "t")])
  const { lines } = pathApproaches(
    pathsAtGrade([{ ...bridge, bridge: true }, path]),
    ["u"],
    new Map([["u", 99.4]]),
    open,
    { ground: slope },
  )
  const line = lines.get(path)!
  assert.equal(line.z[0], 99.4)
  // Its offset closes at the path's grade: 2 m on, it is on the ground, and so is the rest.
  const met = 0.6 / APPROACH_GRADE.path
  line.pts.forEach((p, k) => {
    if (p.x > met + 4) assert.equal(line.z[k], undefined, `${p.x} on the terrain`)
  })
})

// Regression: a footbridge's end took the uncarved ground's level while the path at grade on from
// it read the grid a stream's bank carve had dropped 2.5–3.6 m (1125144076, 1062093193, 1308837496,
// 809448798 and 1289055889 by Aulla, 719447156 and 1109549328 on lucido).
test("pathApproaches holds the cell where a path at grade meets a deck at the deck's level", () => {
  const bridge = { ...way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")]), bridge: true as const },
    lane = way(2, "path", [v(0, 0, "u"), v(20, 0, "t")])
  const { claims, mouths } = pathApproaches(
    pathsAtGrade([bridge, lane]),
    ["w", "u"],
    new Map([
      ["w", 100],
      ["u", 100],
    ]),
    open,
    { ground: flat },
  )
  assert.equal(mouths.length, 0, "a deck's end is no bore's mouth")
  // The bank carved 3 m under the deck's end: the cell the path meets it in keeps its level.
  const cols = 21,
    g: Grid = {
      cell: 4,
      cols,
      rows: 11,
      x0: -20,
      y0: -20,
      ax: -20,
      ay: -20,
      z: new Float64Array(cols * 11).fill(97),
    }
  const owner = new Uint8Array(cols * 11).fill(255)
  replayClaims(g, claims, owner, new Uint8Array(cols * 11))
  const at = (x: number) => 5 * cols + (x + 20) / 4
  for (const x of [0, 4]) {
    assert.equal(g.z[at(x)], 100, `${x} m on`)
    assert.notEqual(owner[at(x)], 255, `${x} m on is held against the carve`)
  }
  assert.equal(g.z[at(-8)], 97, "the hold reaches no way back under the deck")
})

// Regression: an approach whose offset alone closed over terrain rising back from a dip under the
// deck's end overshot the deck: the sidewalk 1409723237 rose to 66.7 m on its way down to the
// footbridge 1414943238's end at 63.1 m on the SS62's deck.
test("pathApproaches never climbs past the deck's level over terrain rising back from under its end", () => {
  // The ground 8 m under the deck's end in its first 3 m, then 2 m under it.
  const dip = (x: number) => (x < 3 ? 55 : 61)
  const bridge = { ...way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")]), bridge: true as const },
    path = way(2, "path", [v(0, 0, "u"), v(5, 0), v(10, 0), v(30, 0, "t")])
  const { lines } = pathApproaches(
    pathsAtGrade([bridge, path]),
    ["u"],
    new Map([["u", 63.1]]),
    open,
    { ground: dip },
  )
  const line = lines.get(path)!
  line.pts.forEach((p, k) => {
    const z = line.z[k] ?? dip(p.x)
    assert.ok(z <= 63.1 + 1e-9, `${z} at ${p.x}`)
    assert.ok(z >= dip(p.x) - 1e-9, `${z} under the ground at ${p.x}`)
  })
})

// Regression: an approach crossing over a tunnel sank onto it: Cesena's path 22776463, leading
// out of the Sottopasso Cervese, 2.45 m over the Secante's bore, and Lunigiana's 1311831119 0.4 m
// over the footway tunnel 1311831121 it leads out of.
test("pathApproaches keeps the clearance over a tunnel it crosses", () => {
  // Out of a bore 6 m under flat ground, over a tunnel 8 m on whose top it must clear at 98 m.
  const bore = way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")], true),
    lane = way(2, "path", [v(0, 0, "u"), v(40, 0, "t")])
  const { lines } = pathApproaches(
    pathsAtGrade([bore, lane]),
    ["u"],
    new Map([["u", 94]]),
    () => [{ x: 8, y: 0, z: 98, kind: "min" as const }],
    { ground: flat },
  )
  const line = lines.get(lane)!
  const at = (x: number) => {
    const k = line.pts.findIndex((p) => p.x >= x)
    const a = line.pts[k - 1]!,
      b = line.pts[k]!,
      za = line.z[k - 1] ?? 100,
      zb = line.z[k] ?? 100
    return za + ((zb - za) * (x - a.x)) / (b.x - a.x)
  }
  assert.equal(line.z[0], 94)
  assert.ok(at(8) >= 98 - 1e-9, `${at(8)} over the tunnel`)
})

// Regression: a path fitted before a later approach set the level of a vertex it shares kept the
// ground there: Aulla's path 717897182 stood 1.3 m over the steps 717897183 where they meet, and
// Fosdinovo's 1326730177 0.9 m over 1335936638.
test("pathApproaches fits a path again when a later approach sets the level of a vertex it shares", () => {
  // A footbridge's end 0.5 m over flat ground leads onto the lane, fitted first, which meets the
  // ground before its far end; a bore 8 m under the ground leads onto the ramp, which reaches that
  // end 2 m under the ground.
  const deck = { ...way(1, "path", [v(-10, 0, "w"), v(0, 0, "b")]), bridge: true as const },
    bore = way(2, "path", [v(10, -30, "s"), v(10, -20, "t")], true),
    lane = way(3, "path", [v(0, 0, "b"), v(10, 0, "c")]),
    ramp = way(4, "path", [v(10, -20, "t"), v(10, 0, "c")])
  const nodeZ = new Map([
    ["w", 100.5],
    ["b", 100.5],
    ["s", 92],
    ["t", 92],
  ])
  const { lines } = pathApproaches(
    pathsAtGrade([deck, bore, lane, ramp]),
    ["w", "b", "s", "t"],
    nodeZ,
    open,
    { ground: flat },
  )
  const at = (piece: RoadF) => {
    const line = lines.get(piece)!
    return line.z[line.pts.findIndex((p) => p.id === "c")]
  }
  assert.ok(nodeZ.get("c")! < 99, `${nodeZ.get("c")} where the ramp reaches the lane`)
  assert.equal(at(lane), nodeZ.get("c"), "the lane meets the ramp at its level")
  assert.equal(at(ramp), nodeZ.get("c"))
})

// Regression: an approach's sample under a bridge shipped the finished grid, which the claims of the
// bridge's own ramps raised: Cesena's path 22776463 ran 3.5 m under the footbridge 683510421, its
// clearance 4 m, where the fit kept it 4.5 m under it on the ground.
test("pathApproaches ships its fitted level where it crosses under a bridge, and writes it there", () => {
  const bridge = { ...way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")]), bridge: true as const },
    lane = way(2, "path", [v(0, 0, "u"), v(40, 0, "t")])
  const { lines, claims } = pathApproaches(
    pathsAtGrade([bridge, lane]),
    ["u"],
    new Map([["u", 100]]),
    () => [{ x: 20, y: 0, z: 104, kind: "max" as const }],
    { ground: flat },
  )
  const line = lines.get(lane)!
  assert.equal(line.z[line.pts.findIndex((p) => p.x === 20)], 100, "its level under the deck")
  const cols = 21,
    g: Grid = {
      cell: 4,
      cols,
      rows: 11,
      x0: -20,
      y0: -20,
      ax: -20,
      ay: -20,
      z: new Float64Array(cols * 11).fill(103),
    }
  replayClaims(g, claims, new Uint8Array(cols * 11).fill(255), new Uint8Array(cols * 11))
  assert.equal(g.z[5 * cols + (20 + 20) / 4], 100, "the grid under the deck at its level")
})

// Regression: an approach's core round a footbridge's end held the ground under the deck at the
// deck's level, over the path passing under it 2.2 m on: the ramps 683510420 and 517564087 of
// Cesena's footbridge 683510421 lifted the path 22776463 to 37.6 m beside it, 3.9 m over the ground.
test("pathApproaches yields the ground under a bridge's deck past its end to any other claim", () => {
  const bridge = { ...way(1, "path", [v(-10, 0, "w"), v(0, 0, "u")]), bridge: true as const },
    ramp = way(2, "path", [v(0, 0, "u"), v(40, 0, "t")])
  const { claims } = pathApproaches(
    pathsAtGrade([bridge, ramp]),
    ["u"],
    new Map([["u", 103]]),
    open,
    { ground: flat, deckEndAt: (id) => id === "u" },
  )
  assert.equal(claims[0]!.deckEnds?.[0], 1, "its core past the deck's end is under the deck")
})

// Regression: a path or steps at grade crossing under a bridge no deck of the path pass leads onto
// kept the ground the deck's own approaches held at the deck's level: Via Mazzini (814776126) ran
// level with Sarzana's Via Cittadella arch (814776124) over it, on its natural 20.3 m, and the
// steps 374756566 1.23 m under the A15's deck, on ground 0.6 m under it.
test("pathApproaches fits a path at grade crossing under a bridge from its clearance alone, its claims ahead of every other approach's", () => {
  // A footbridge's end 4 m over flat ground at (20, -2) leads onto a ramp that meets a lane at
  // (32, 0) before it reaches the ground; the lane runs east under a deck at (20, 0), led onto by no
  // deck, its clearance 96 m (dipping 4 m) or 104 m (kept). Fitted first, the lane is fitted again
  // once the ramp sets the level where they meet.
  const deck = { ...way(1, "path", [v(20, -10, "w"), v(20, -2, "u")]), bridge: true as const },
    ramp = way(2, "path", [v(20, -2, "u"), v(32, 0, "m"), v(32, 30, "t")]),
    lane = way(3, "path", [v(0, 0, "a"), v(32, 0, "m"), v(40, 0, "b")])
  const fit = (clear: number) =>
    pathApproaches(
      pathsAtGrade([deck, ramp, lane]),
      ["w", "u"],
      new Map([
        ["w", 104],
        ["u", 104],
      ]),
      (piece) =>
        piece === lane
          ? [18, 20, 22].map((x) => ({ x, y: 0, z: clear, kind: "max" as const }))
          : [],
      { ground: flat },
      [lane],
    )
  const at = (line: ApproachLine, x: number) =>
    line.z[line.pts.findIndex((p) => Math.abs(p.x - x) < 1e-9 && p.y === 0)]
  // Under the deck it dips to its clearance, and its offset closes at its grade either way.
  const dip = fit(96).lines.get(lane)!
  assert.equal(at(dip, 20), 96)
  for (let k = 1; k < dip.pts.length; k++) {
    const rise = Math.abs((dip.z[k] ?? 100) - (dip.z[k - 1] ?? 100)),
      run = dip.pts[k]!.x - dip.pts[k - 1]!.x
    assert.ok(rise <= APPROACH_GRADE.path * run + 1e-6, `${rise} over ${run}`)
  }
  assert.equal(dip.z[0], undefined, "its ends keep the terrain")
  // Where the ground keeps its clearance, it ships its own level there and claims it, ahead of the
  // ramp's hold and stretch at the deck's level.
  const kept = fit(104)
  assert.equal(at(kept.lines.get(lane)!, 20), 100)
  const cols = 21,
    g: Grid = {
      cell: 4,
      cols,
      rows: 11,
      x0: -20,
      y0: -20,
      ax: -20,
      ay: -20,
      z: new Float64Array(cols * 11).fill(100),
    }
  replayClaims(g, kept.claims, new Uint8Array(cols * 11).fill(255), new Uint8Array(cols * 11))
  assert.equal(g.z[5 * cols + (20 + 20) / 4], 100, "the grid under the deck at its level")
})

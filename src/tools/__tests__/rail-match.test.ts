import assert from "node:assert/strict"
import { test } from "node:test"

import type { P, V } from "../geometry.ts"
import {
  insertOn,
  lineOf,
  matchSamples,
  pruneShort,
  simplifyLine,
  type Sample,
} from "../rail-match.ts"
import { smoothRun } from "../rail-smooth.ts"

/** Samples every 2 m along y = f(x) from x0 to x1, heading +x. */
const along = (
  x0: number,
  x1: number,
  f: (x: number) => number,
  free = () => false,
): Array<Sample> =>
  Array.from({ length: (x1 - x0) / 2 + 1 }, (_, k) => {
    const x = x0 + 2 * k
    return { x, y: f(x), tx: 1, ty: 0, free: free() }
  })

test("matchSamples keeps a run on its track past a nearer parallel one, and leaves tunnels and track ends unmatched", () => {
  // The through track at y 0; a loop 4 m north from x 100 to 300 (Gragnola's tracks are 4.3–5 m apart).
  const through = lineOf([
    [0, 0],
    [400, 0],
  ])
  const loop = lineOf([
    [100, 4],
    [300, 4],
  ])
  // OSM drifts 3 m north for 40 m: 1 m from the loop, 3 m from the through track.
  const drift = along(0, 400, (x) => (x >= 180 && x <= 220 ? 3 : 0.5))
  const m = matchSamples(drift, [through, loop])
  assert.ok(
    m.every((s) => s.track === 0),
    "a change to the loop and back (2 × 30) costs more than 21 × 2 m",
  )
  // Over 140 m the loop is cheaper: the run changes track and back.
  const long = matchSamples(
    along(0, 400, (x) => (x >= 130 && x <= 270 ? 3.5 : 0.5)),
    [through, loop],
  )
  assert.ok(long.some((s) => s.track === 1))
  // A track that may not match is never matched (Gragnola's reserved west track).
  assert.ok(
    matchSamples(
      along(0, 400, (x) => (x >= 130 && x <= 270 ? 3.5 : 0.5)),
      [through, loop],
      (k) => k === 0,
    ).every((s) => s.track === 0),
  )
  // Tunnel samples match nothing; past a track's end, nothing matches it.
  const short = lineOf([
    [0, 0],
    [100, 0],
  ])
  const tunnel = matchSamples(
    along(
      0,
      200,
      () => 0,
      () => true,
    ),
    [short],
  )
  assert.ok(tunnel.every((s) => s.track === -1))
  const past = matchSamples(
    along(0, 200, () => 0),
    [short],
  )
  assert.ok(past.every((s, k) => (2 * k <= 100 ? s.track === 0 : s.track === -1)))
  // Ties go to the track listed first.
  assert.ok(
    matchSamples(
      along(0, 100, () => 1),
      [short, short],
    ).every((s) => s.track === 0),
  )
})

test("simplifyLine drops vertices within the tolerance and keeps the ends and the bends", () => {
  const pts: Array<P> = [
    [0, 0],
    [10, 0.03],
    [20, 0],
    [30, 1],
    [40, 2.02],
    [50, 3],
  ]
  assert.deepEqual(simplifyLine(pts, 0.05), [
    [0, 0],
    [20, 0],
    [50, 3],
  ])
})

/** Smallest radius of the circle through three points `k` apart along a polyline's vertices. */
const tightest = (pts: ReadonlyArray<P>, k: number) => {
  let r = Infinity
  for (let i = k; i + k < pts.length; i++) {
    const [a, b, c] = [pts[i - k]!, pts[i]!, pts[i + k]!]
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    if (area2 > 1e-9)
      r = Math.min(
        r,
        (Math.hypot(b[0] - a[0], b[1] - a[1]) *
          Math.hypot(c[0] - b[0], c[1] - b[1]) *
          Math.hypot(c[0] - a[0], c[1] - a[1])) /
          (2 * area2),
      )
  }
  return r
}

test("smoothRun keeps a run's ends and the headings beyond them, and spreads a bend into it", () => {
  // A straight run between straight anchors stays straight.
  const straight = smoothRun(
    [
      [0, 0],
      [100, 0],
    ],
    [
      [-5, 0],
      [-10, 0],
    ],
    [
      [105, 0],
      [110, 0],
    ],
  )
  assert.deepEqual(straight[0], [0, 0])
  assert.deepEqual(straight.at(-1), [100, 0])
  assert.ok(straight.every(([, y]) => Math.abs(y) < 1e-9))
  // The CTR enters 18° off the run's line (at the Terma tunnel's south portal OSM's tunnel is 13°
  // off the CTR): a plain spline bends 239 m over 40 m chords; reweighted, 263 m.
  const off = (18 * Math.PI) / 180
  const into: Array<P> = [5, 10].map((d) => [-d * Math.cos(off), d * Math.sin(off)])
  const run: Array<P> = [
    [0, 0],
    [200, 0],
  ]
  const smooth = smoothRun(run, into, [
    [205, 0],
    [210, 0],
  ])
  assert.deepEqual([smooth[0], smooth.at(-1)], run)
  assert.ok(tightest(smooth, 8) >= 250, `${tightest(smooth, 8).toFixed(0)} m over 40 m chords`)
})

// Regression: Gragnola's stub switch was inserted beside the loop's own vertex
// there, a zero-length segment the render drew at double width.
test("insertOn gives its id to a vertex already there and never repeats one", () => {
  const pts: Array<V> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ]
  assert.equal(insertOn(pts, { x: 10, y: 0, id: "switch" }), 1)
  assert.deepEqual(
    pts.map((v) => v.id),
    [undefined, "switch", undefined],
  )
  assert.throws(() => insertOn(pts, { x: 10, y: 0, id: "crossing" }), /falls on vertex switch/)
  assert.equal(insertOn(pts, { x: 15, y: 0, id: "crossing" }), 2)
  assert.equal(pts.length, 4)
})

// Regression: vertices inserted beside the CTR's left 0.5–1.1 m segments whose
// heading the 0.1 m grid turned 6–9°.
test("pruneShort drops the short segments no id needs, unless that moves the line", () => {
  const line: Array<V> = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5.6, y: 0.02 },
    { x: 10, y: 0, id: "crossing" },
    { x: 11, y: 0.01 },
    { x: 20, y: 0 },
    { x: 21, y: 0.5 },
    { x: 30, y: 0.5 },
  ]
  const kept = (pts: ReadonlyArray<V>) => pts.map((v) => `${v.x},${v.y}`)
  // 5.6 is 0.6 m past 5, 11 is 1 m past the crossing; 21 is 1 m past 20 but 0.45 m off the line without it.
  assert.deepEqual(kept(pruneShort(line, 2)), ["0,0", "5,0", "10,0", "20,0", "21,0.5", "30,0.5"])
  // A vertex the caller needs stays however close it is.
  assert.equal(pruneShort(line, 2, (v) => v.id !== undefined || v.x === 11).length, 7)
})

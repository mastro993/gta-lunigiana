import assert from "node:assert/strict"
import { test } from "node:test"

import { DAY, daysFromCivil, utcFromRome } from "../../sim/sky/calendar.ts"
import { crownsOn } from "../leaves.ts"
import type { TreeKind } from "../trees.ts"

/** 08:00 in Rome on day `n` of 2027 (1 January is 1), as a new game starts. */
const on = (n: number) => utcFromRome((daysFromCivil(2027, 1, 1) + n - 1) * DAY + 8 * 3600)
/** The days of 2027 a tree of `kind` at `z` m wears its leaves, at latitude `lat`. */
const leafyDays = (kind: TreeKind, z: number, lat?: number): Array<number> =>
  Array.from({ length: 365 }, (_, k) => k + 1).filter(
    (n) => crownsOn(on(n), lat)(kind, z) === "leafy",
  )

test("the woods' leaves: beech greens up the slopes about 2 days per 100 m from mid-April and drops its leaves down them from the end of October, as MeteoSwiss's network has it", () => {
  // Leaf-out and leaf fall, day of the year, at the map's latitude: the fits' dates at 0, 500, 1000 and 1500 m.
  for (const [z, out, fall] of [
    [0, 102, 321],
    [500, 113, 315],
    [1000, 123, 309],
    [1500, 134, 303],
  ] as const) {
    const days = leafyDays("beech", z)
    assert.ok(Math.abs(days[0]! - out) <= 2, `beech at ${z} m in leaf from day ${days[0]}`)
    assert.ok(Math.abs(days.at(-1)! + 1 - fall) <= 2, `bare from day ${days.at(-1)! + 1}`)
    // One stretch in leaf a year.
    assert.equal(days.length, days.at(-1)! - days[0]! + 1)
  }
  // The broadleaf (most of it chestnut) greens 6 days after the beech, the oaks 16; both drop their leaves with it.
  const beech = leafyDays("beech", 400)
  assert.equal(leafyDays("broadleaf", 400)[0], beech[0]! + 6)
  assert.equal(leafyDays("oak", 400)[0], beech[0]! + 16)
  assert.equal(leafyDays("broadleaf", 400).at(-1), beech.at(-1))
  // Further south the spring comes earlier: Sicily's coast greens about two weeks before Lunigiana's.
  const south = leafyDays("beech", 0, 38)[0]!
  assert.ok(south < 102 - 7, `day ${south} at 38 N`)
})

test("the woods' leaves: in winter a beech or a broadleaf is bare and an oak holds its dead leaves, at every height; conifers and pines keep theirs all year", () => {
  const january = crownsOn(on(15))
  for (const z of [0, 300, 800, 1200, 1700]) {
    assert.equal(january("beech", z), "bare")
    assert.equal(january("broadleaf", z), "bare")
    assert.equal(january("oak", z), "dead")
    for (const day of [15, 180, 350]) {
      assert.equal(crownsOn(on(day))("conifer", z), "leafy")
      assert.equal(crownsOn(on(day))("pine", z), "leafy")
    }
  }
  // Midsummer: every crown in leaf, up to the map's highest ground.
  const july = crownsOn(on(196))
  for (const kind of ["beech", "broadleaf", "oak"] as const) assert.equal(july(kind, 2054), "leafy")
})

import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF } from "../features.ts"
import type { V } from "../geometry.ts"
import { chainsOf, makeProfiler, RAIL_PASS } from "../profiles.ts"
import { RAIL_TOL } from "../rail-bed.ts"
import { railTwins, REACH, SIDE, TWIN, twinBounds, twinSlack } from "../rail-twins.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const SPEC = { w: 4, ...RAIL_PASS, tol: RAIL_TOL }
/** A double line along x, its second track `gap` m north of the first: at grade, a bridge from x 300 to 866, at grade on. */
const track = (id: number, gap: number): Array<RailF> => [
  { id, pts: [v(0, gap, `${id}a`), v(300, gap, `${id}b`)] },
  { id: id + 1, bridge: true, pts: [v(300, gap, `${id}b`), v(866, gap, `${id}c`)] },
  { id: id + 2, pts: [v(866, gap, `${id}c`), v(1200, gap, `${id}d`)] },
]

// Regression: north of Aulla the Pontremolese's two tracks, 3.9–5.6 m apart on a viaduct over the
// Magra between twin tunnels, were fitted one at a time, each from the ground under it: the viaduct's
// decks stood 1.5 m apart at one end and 2.8 m at the other.
test("profile keeps a track to the level of its twin fitted before it, on its deck too", () => {
  // The ground climbs 2% along the line, falls 0.5 m a metre across it, and 20 m into a valley
  // under the bridges: their decks climb 11.3 m.
  const ground = (x: number, y: number) => (x > 300 && x < 866 ? 80 : 100) + 0.02 * x - 0.5 * y
  const first = track(1, 0),
    second = track(11, 4.5)
  const levels = (twinned: boolean) => {
    const { profile, denseOf, zOf } = makeProfiler(ground)
    const twins = railTwins([...first, ...second])
    for (const ch of chainsOf([...first, ...second]))
      profile(ch, SPEC, twinned ? twinBounds(twins, ch, (l) => denseOf.get(l)) : [])
    // The gap in level at each vertex of each piece.
    return first.flatMap((a, i) =>
      zOf.get(a)!.map((z, k) => Math.abs(zOf.get(second[i]!)![k]! - z)),
    )
  }
  const apart = Math.max(...levels(false)),
    together = Math.max(...levels(true))
  assert.ok(apart > 2, `fitted apart, the tracks stand ${apart.toFixed(2)} m apart`)
  assert.ok(together <= TWIN + 1e-6, `twinned, ${together.toFixed(2)} m`)
})

test("railTwins pairs tracks of one kind side by side, near parallel, and twinBounds binds a chain by its fitted twins alone", () => {
  const [a, deck] = track(1, 0),
    [b, other] = track(11, 4.5)
  // A track crossing the line at grade, and one parting from the first at 10°, 9.5 m from the
  // second where it starts.
  const across = { id: 30, pts: [v(150, -50), v(150, 50)] },
    parting = { id: 31, pts: [v(0, -5), v(300, -5 - 300 * Math.tan(Math.PI / 18))] }
  const twins = railTwins([a!, deck!, b!, other!, across, parting])
  const pairs = new Set(twins.map((t) => `${t.on.id}-${t.other.id}`))
  assert.deepEqual([...pairs].sort(), [
    "1-11",
    "1-31",
    "11-1",
    "11-31",
    "12-2",
    "2-12",
    "31-1",
    "31-11",
  ])
  assert.ok(
    twins.every((t) => t.d <= REACH),
    "none farther apart than REACH",
  )
  const dense = { pts: a!.pts, z: [100, 100] }
  const fitted = (l: RailF) => (l === a ? dense : undefined)
  const bounds = twinBounds(twins, [{ item: b! }], fitted)
  assert.equal(bounds.length, 2 * 151, "a min and a max every 2 m along the 300 m")
  assert.ok(
    bounds.every(
      (x) => Math.abs(Math.abs(x.z - 100) - TWIN) < 1e-9 && x.on === b && x.here === true,
    ),
  )
  assert.deepEqual(twinBounds(twins, [{ item: a! }], fitted), [], "not by a track of its own")
  assert.deepEqual(
    twinBounds(twins, [{ item: other! }], fitted),
    [],
    "not by a twin not fitted yet",
  )
  // Parting, it may stray more from the twin's level the farther it is.
  const part = twinBounds(twins, [{ item: parting }], fitted).filter((x) => x.kind === "max")
  assert.ok(part.at(-1)!.z > part[0]!.z)
  assert.equal(twinSlack(SIDE), TWIN)
  assert.ok(twinSlack(SIDE + 3) > TWIN + 1.9)
})

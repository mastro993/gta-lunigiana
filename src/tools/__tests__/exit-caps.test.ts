import assert from "node:assert/strict"
import { test } from "node:test"

import { exitCaps } from "../exit-caps.ts"
import type { RoadF } from "../features.ts"
import { segDist2 } from "../geometry.ts"

/** A road from its points, the last of them cut by the outline (no id) where `cut`. */
const road = (
  id: number,
  cls: RoadF["cls"],
  w: number,
  pts: ReadonlyArray<readonly [number, number]>,
  cut = true,
): RoadF => ({
  id,
  cls,
  w,
  surface: "asphalt",
  private: false,
  pts: pts.map(([x, y], i) =>
    cut && i === pts.length - 1 ? { x, y } : { x, y, id: `${id}:${i}` },
  ),
})

/** The least distance from cap `c` to `r`'s centreline, m. */
const gap = (c: readonly [number, number, number, number], r: RoadF) => {
  let d = Infinity
  for (let k = 0; k + 1 < r.pts.length; k++)
    for (let t = 0; t <= 1; t += 0.01) {
      const x = c[0] + (c[2] - c[0]) * t,
        y = c[1] + (c[3] - c[1]) * t
      const { x: ax, y: ay } = r.pts[k]!,
        { x: bx, y: by } = r.pts[k + 1]!
      d = Math.min(d, Math.sqrt(segDist2(x, y, ax, ay, bx, by).d2))
    }
  return d
}

test("a road-exit cap stands across its road 4 m inside its cut end, a metre past its carriageway's edges", () => {
  const caps = exitCaps([
    road(1, "residential", 5, [
      [0, -50],
      [0, 0],
    ]),
  ])
  assert.deepEqual(caps, [[-3.5, -4, 3.5, -4]])
})

// Regression (#20): the A12's two carriageways leave the play area at y 3900 8.5 m apart, their
// carriageways overlapping by 1.5 m, and each one's cap reached 4.3 m into the other's 5 m, 11 m
// inside the outline; a residential stub leaving 4.3 m from its junction with the Via Aurelia at
// Ponte di Arcola capped the Via Aurelia's lanes across.
test("a road-exit cap shuts its own road alone: on no other drivable road's carriageway, a twin's or a junction's", () => {
  const a = road(1, "motorway", 10, [
      [0, -100],
      [0, 0],
    ]),
    b = road(2, "motorway", 10, [
      [8.5, -100],
      [8.5, 0],
    ])
  const caps = exitCaps([a, b])
  assert.equal(caps.length, 2)
  for (const [cap, other] of [
    [caps[0]!, b],
    [caps[1]!, a],
  ] as const)
    assert.ok(gap(cap, other) >= other.w / 2 - 0.1, `${gap(cap, other).toFixed(2)} m`)
  // Each still spans its own carriageway but where the other's overlaps it, and a metre past.
  assert.deepEqual(caps[0], [-6, -4, 3.5, -4])
  // A stub leaving 4.3 m from its junction with a wider road: its cap would stand on that road alone.
  const main = road(
      3,
      "tertiary",
      11.8,
      [
        [-50, 0],
        [50, 0],
      ],
      false,
    ),
    stub = road(4, "residential", 4.5, [
      [0, 0],
      [0, 4.3],
    ])
  assert.deepEqual(exitCaps([main, stub]), [])
})

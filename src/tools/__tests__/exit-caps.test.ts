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

// Regression (review of #20): trimmed against every other drivable piece, a cap lost the pieces on
// its own road's continuation: the L's primary bridge 1551433107, cut 2.3 m from its joint with
// 552595853, had none, and Cesena's 23564329 kept one with a 3.6–5.7 m gap.
test("a road-exit cap stands 4 m in along its road, on through a joint with its continuation, and shuts it whole; a piece of it narrower than a car is dropped", () => {
  const on = road(
      1,
      "primary",
      7,
      [
        [0, -100],
        [0, -2],
      ],
      false,
    ),
    cut = road(2, "primary", 7, [
      [0, -2],
      [0, 0],
    ])
  // The continuation's last vertex is the cut piece's first: one node, no third way at it. Its
  // first segment from there is 1 m: the cap stands on its second, 4 m in from the cut end.
  const joined = {
    ...on,
    pts: [on.pts[0]!, { x: 0, y: -3, id: "1:9" }, { ...on.pts[1]!, id: cut.pts[0]!.id }],
  }
  assert.deepEqual(exitCaps([joined, cut]), [[-4.5, -4, 4.5, -4]])
  // A lane overlapping its carriageway 2 m off its centreline leaves 0.5 m of the cap past it, which
  // no car would pass: that piece is dropped, the rest kept.
  const lane = road(
    3,
    "residential",
    4,
    [
      [-2, -100],
      [-2, 50],
    ],
    false,
  )
  assert.deepEqual(exitCaps([joined, cut, lane]), [[0, -4, 4.5, -4]])
})

// Regression (review of #20): the L's 719407874 leaves 7.4 m from its junction with 175092604, whose
// carriageway reaches 1 m across the middle of its cap; split there into two 3 m pieces, the cap
// shut the road all the same, as no car passes the gap.
test("a road-exit cap is not split where another road's carriageway crosses it narrower than a car", () => {
  const cut = road(1, "unclassified", 5, [
      [0, -50],
      [0, 0],
    ]),
    // Its end 3.36 m short of the cap's middle, its 3.4 m half-width reaching 0.52 m either side.
    side = road(
      2,
      "unclassified",
      6.8,
      [
        [-20, -20],
        [0, -7.36],
      ],
      false,
    )
  assert.deepEqual(exitCaps([cut, side]), [[-3.5, -4, 3.5, -4]])
})

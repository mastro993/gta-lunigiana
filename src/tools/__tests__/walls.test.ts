import assert from "node:assert/strict"
import { test } from "node:test"

import { outlineOf } from "../play-area.ts"
import { pushOutline } from "../walls.ts"
import { segments } from "./wall-segments.ts"

// walls.long-test.ts builds the walls round a staged lake and river polygon (about a second).
test("the outline walls of an L close it: every piece ends where the next starts, 64 m at most", () => {
  const rings = outlineOf([
    { key: "foot", title: "Foot", rects: [[0, 0, 200, 100]] },
    { key: "leg", title: "Leg", rects: [[0, 100, 100, 300]] },
  ])
  const walk: Array<number> = [],
    drive: Array<number> = []
  pushOutline([walk, drive], rings)
  assert.deepEqual(walk, drive)
  const segs = segments(walk)
  segs.forEach(([ax, ay, bx, by], k) => {
    assert.ok(Math.hypot(bx! - ax!, by! - ay!) <= 64, `piece ${k}`)
    const [nx, ny] = segs[(k + 1) % segs.length]!
    assert.deepEqual([bx, by], [nx, ny], `piece ${k} runs on into piece ${k + 1}`)
  })
  assert.deepEqual(segs[0]!.slice(0, 2), [0, 0])
  // round the L's 1000 m outline, with no wall across its seam (y 100, x 0..100)
  assert.equal(
    segs.reduce((s, [ax, ay, bx, by]) => s + Math.hypot(bx! - ax!, by! - ay!), 0),
    1000,
  )
  assert.ok(
    segs.every(([ax, ay, bx, by]) => !(ay === 100 && by === 100 && Math.max(ax!, bx!) <= 100)),
  )
})

test("one rectangle's outline walls are the bounds walls: S, E, N, W in 64 m pieces", () => {
  const out: Array<number> = []
  pushOutline([out], outlineOf([{ key: "box", title: "Box", rects: [[-100, -50, 100, 50]] }]))
  const sides = segments(out).map(([ax, ay, bx, by]) =>
    ay === -50 && by === -50
      ? "S"
      : ax === 100 && bx === 100
        ? "E"
        : ay === 50 && by === 50
          ? "N"
          : "W",
  )
  // 200 m sides in 4 pieces of 50 m, 100 m sides in 2
  assert.equal(sides.join(""), "SSSSEENNNNWW")
  assert.deepEqual(segments(out)[0], [-100, -50, -50, -50])
})

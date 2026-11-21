import assert from "node:assert/strict"
import { test } from "node:test"

import { placeLabels } from "../labels.ts"

/** A 10 px square label box at (x, y). */
const box = (x: number, y = 0) => ({ x0: x, x1: x + 10, y0: y, y1: y + 10 })
/** A label of `rank`, its dot at x = `dot` on a row of its own, its name taking one of `sides`. */
const label = (rank: number, dot: number, ...sides: Array<ReturnType<typeof box>>) => ({
  rank,
  major: false,
  // The player's place (rank -1) and the towns (0) go before the villages (1), as `mapLabels` ranks them.
  first: rank < 1,
  dot: box(dot, 100),
  sides,
})
/** `label`, a major (the player's place, a town or a village). */
const major = (rank: number, dot: number, ...sides: Array<ReturnType<typeof box>>) => ({
  ...label(rank, dot, ...sides),
  major: true,
})

test("labels: ranks in order, each name on its first free side, fewest free sides first", () => {
  // The player's place (rank -1, `mapLabels`), the town, then villages, hamlets and peaks, whatever
  // their order.
  assert.deepEqual(
    placeLabels([
      label(3, 0, box(0)),
      label(2, 20, box(0)),
      label(1, 40, box(0)),
      label(-1, 60, box(0)),
      label(0, 80, box(0)),
    ]),
    [undefined, undefined, undefined, 0, undefined],
  )
  // A name taken on its first side goes on its next; touching boxes do not overlap.
  assert.deepEqual(placeLabels([label(0, 0, box(0)), label(1, 20, box(5), box(20))]), [0, 1])
  assert.deepEqual(placeLabels([label(1, 0, box(0)), label(1, 20, box(10))]), [0, 0])
  // Of two with as many free sides, the earlier wins; one with fewer goes first.
  assert.deepEqual(placeLabels([label(1, 0, box(0)), label(1, 20, box(5))]), [0, undefined])
  assert.deepEqual(placeLabels([label(1, 0, box(0), box(20)), label(1, 20, box(5))]), [1, 0])
  // A fixed box (the north arrow, the scale bar) beats every label.
  assert.deepEqual(placeLabels([label(0, 0, box(0)), label(1, 20, box(20))], [box(0)]), [
    undefined,
    0,
  ])
})

test("labels: a name never covers a dot, and a dot under a name goes with its label", () => {
  // Its own dot, a placed one, and one its rank has still to place are all kept clear.
  assert.deepEqual(placeLabels([label(1, 0, box(0, 100), box(20))]), [1])
  assert.deepEqual(placeLabels([label(0, 0, box(20)), label(1, 40, box(0, 100), box(60))]), [0, 1])
  assert.deepEqual(placeLabels([label(1, 0, box(20, 100), box(40)), label(1, 20, box(60))]), [1, 0])
  // A hamlet's dot under a village's name is left out with its name, though its side is free.
  assert.deepEqual(placeLabels([label(1, 0, box(20, 100)), label(2, 20, box(40))]), [0, undefined])
})

test("labels: the majors are named together, a town's name taking its second side to leave a village its only one", () => {
  // Rank by rank, the town would take its first side and leave the village out.
  assert.deepEqual(placeLabels([label(0, 0, box(0), box(40)), label(1, 20, box(5))]), [
    0,
    undefined,
  ])
  assert.deepEqual(placeLabels([major(0, 0, box(0), box(40)), major(1, 20, box(5))]), [1, 0])
  // Together, a major's name keeps clear of every major's dot, a village's included.
  assert.deepEqual(placeLabels([major(0, 0, box(20, 100), box(40)), major(1, 20, box(60))]), [1, 0])
})

test("labels: when the majors named together leave out a town, they go rank by rank, so the town keeps its name", () => {
  // Together, the village (the earlier of two with one side each) would take the town's only side.
  assert.deepEqual(placeLabels([major(1, 0, box(0)), major(0, 20, box(5))]), [undefined, 0])
})

test("labels: a village or the player's place no order can name leaves the rest of the majors named together", () => {
  // The last village's or player's place's only side is under a fixed box (the north arrow), so
  // rank by rank names no more of the towns and the player's place, and would leave out the
  // village the town makes room for together.
  for (const rank of [1, -1])
    assert.deepEqual(
      placeLabels(
        [major(0, 0, box(0), box(40)), major(1, 20, box(5)), major(rank, 60, box(200))],
        [box(200)],
      ),
      [1, 0, undefined],
      `rank ${rank}`,
    )
})

test("labels: named together, a major takes the free side that leaves the hamlets and peaks the most room", () => {
  // Its first side would take the hamlet's only one; its second, none.
  assert.deepEqual(placeLabels([major(1, 0, box(0), box(40)), label(2, 20, box(5))]), [1, 0])
  // A side over a hamlet's dot takes all of its three sides; one over two of another's, two.
  assert.deepEqual(
    placeLabels([
      major(1, 0, box(60, 100), box(100)),
      label(2, 60, box(200), box(220), box(240)),
      label(2, 80, box(95), box(105)),
    ]),
    [1, 0, undefined],
  )
})

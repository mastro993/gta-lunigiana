import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF } from "../features.ts"
import type { V } from "../geometry.ts"
import { continuations } from "../rail-runouts.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
/** The play area's outline in these tests: the line x = 0, the play area east of it. */
const edge = (x: number) => x === 0
/** Each chain as its pieces' ids and vertices, `x,y` and the id where it has one. */
const shapes = (found: ReturnType<typeof continuations>) =>
  found.map(({ piece, end, chain }) => ({
    piece,
    end,
    chain: chain.map((r) => [r.id, ...r.pts.map((p) => `${p.x},${p.y}${p.id ?? ""}`)]),
  }))

// Regression: past Rometta the play area's grown box left the Lucca–Aulla line's west terminal on an
// inner edge, and its run-out went straight on into the hill, 16.6 m under it at the drawn run's end,
// while OSM's line bends away down the valley.
test("continuations walks a terminal's track on beyond the play area: OSM's way from its cut, then on at shared nodes the straightest way", () => {
  // The line in play ends at its cut (0, 0.6) on the outline (the CTR moved it 0.6 m off OSM's).
  const line: RailF = { id: 7, maxspeed: 85, pts: [v(300, 0, "a"), v(0, 0.6)] }
  const beyond: Array<RailF> = [
    // Its way on beyond the outline, drawn toward the cut, with a node 2.4 m past it: from the terminal, 0.6 m off
    // OSM's line, the track would zig-zag 17° to it and back.
    { id: 7, pts: [v(-200, -60, "n2"), v(-100, -20, "n1"), v(-2.4, 0.2, "n0"), v(0, 0)] },
    // At n2 a branch turning 42° and the way on turning 10°, a bridge; at n3 a way turning 91°, past the walk's 60°.
    { id: 9, pts: [v(-200, -60, "n2"), v(-260, -180)] },
    { id: 8, bridge: true, pts: [v(-200, -60, "n2"), v(-400, -100, "n3")] },
    { id: 10, pts: [v(-400, -100, "n3"), v(-430, 70)] },
    // Another way's cut beside the terminal carries nothing on.
    { id: 11, pts: [v(0, 1), v(-50, 200)] },
  ]
  assert.deepEqual(shapes(continuations([line], beyond, edge)), [
    {
      piece: 0,
      end: 1,
      chain: [
        [7, "0,0.6", "-100,-20n1", "-200,-60n2"],
        [8, "-200,-60n2", "-400,-100n3"],
      ],
    },
  ])
  const { chain } = continuations([line], beyond, edge)[0]!
  assert.deepEqual([chain[0]!.bridge, chain[1]!.bridge], [undefined, true])
})

test("continuations: none for a cut off the outline, nor where no piece of the terminal's way has its cut beside it", () => {
  const line: RailF = { id: 7, pts: [v(0, 0), v(300, 0, "a"), v(600, 0)] }
  const beyond: Array<RailF> = [
    // The way's cut 12 m off the terminal at (0, 0): too far to be its track.
    { id: 7, pts: [v(0, 12), v(-100, 20, "n")] },
    // Another way's cut on the terminal.
    { id: 8, pts: [v(0, 0), v(-100, -20, "m")] },
  ]
  assert.deepEqual(continuations([line], beyond, edge), [])
  // A cut on the outline at x 600 too: the line's east end, which no beyond piece carries on.
  assert.deepEqual(
    continuations([line], beyond, (x) => x === 0 || x === 600),
    [],
  )
})

test("continuations walks through a way the track passes a switch of, cut there as the line's pieces are", () => {
  const line: RailF = { id: 7, pts: [v(300, 0, "a"), v(0, 0)] }
  const beyond: Array<RailF> = [
    { id: 7, pts: [v(0, 0), v(-100, 0, "j")] },
    // The way on runs through j's switch: a siding leaves it there.
    { id: 8, pts: [v(-50, 0, "s"), v(-100, 0, "j"), v(-300, 10, "k")] },
    { id: 12, pts: [v(-100, 0, "j"), v(-150, -40)] },
  ]
  assert.deepEqual(shapes(continuations([line], beyond, edge)), [
    {
      piece: 0,
      end: 1,
      chain: [
        [7, "0,0", "-100,0j"],
        [8, "-100,0j", "-300,10k"],
      ],
    },
  ])
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

import { MAP } from "../../sim/map/index.ts"
import { TILE } from "../../sim/map/kinds.ts"
import {
  chainRoad,
  defaultRoute,
  driveReport,
  driveScript,
  type Frame,
  frameStats,
} from "../playtest-drive.ts"

test("frameStats: slowest and the nearest-rank 99th percentile", () => {
  const deltas = Array.from({ length: 100 }, (_, i) => (i === 7 ? 50 : i === 9 ? 40 : 16))
  assert.deepEqual(frameStats(deltas), { slowest: 50, p99: 40 }) // rank 99 of 100
  assert.deepEqual(frameStats([16, 17]), { slowest: 17, p99: 17 })
  assert.deepEqual(frameStats([]), { slowest: 0, p99: 0 })
})

test("chainRoad: chains pieces through shared end vertices from the free end nearest the start, at a fork toward the goal", () => {
  const pieces = [
    [10, 0, 5, 0, 0, 0], // drawn against the way
    [20, 0, 30, 0],
    [10, 0, 20, 0],
    [20, 0, 20, 10],
    [100, 100, 200, 100], // not joined: never reached
  ]
  // (10, 0) is nearer the start, but two pieces share it: the chain starts at the free end (0, 0).
  assert.deepEqual(
    chainRoad(pieces, { x: 9, y: 1 }, { x: 20, y: 100 }),
    [0, 0, 5, 0, 10, 0, 20, 0, 20, 10],
  )
  assert.deepEqual(
    chainRoad(pieces, { x: 25, y: 12 }, { x: 0, y: 0 }),
    [20, 10, 20, 0, 10, 0, 5, 0, 0, 0],
  )
  // A loop has no free end: it starts at the end nearest the start.
  assert.deepEqual(
    chainRoad(
      [
        [0, 0, 10, 0],
        [10, 0, 0, 0],
      ],
      { x: 9, y: 0 },
      { x: 0, y: 0 },
    ),
    [10, 0, 0, 0, 10, 0],
  )
  assert.throws(() => chainRoad([], { x: 0, y: 0 }, { x: 1, y: 1 }), /no road/)
})

test("defaultRoute: the SP59 from Monzone to Vinca, across the x = 0, y = 0, y = -2000 and x = 2000 seams", () => {
  const route = defaultRoute()
  const [x0, y0] = route,
    [x1, y1] = route.slice(-2)
  const start = MAP.spawns.player,
    vinca = MAP.districts.find((d) => d.name === "Vinca")!
  assert.ok(Math.hypot(x0! - start.x, y0! - start.y) < 600, `starts at ${x0}, ${y0}`)
  assert.ok(Math.hypot(x1! - vinca.x, y1! - vinca.y) < 500, `ends at ${x1}, ${y1}`)
  const seams = new Set<string>()
  for (let k = 2; k < route.length; k += 2)
    for (const [axis, a, b] of [
      ["x", route[k - 2]!, route[k]!],
      ["y", route[k - 1]!, route[k + 1]!],
    ] as const)
      if (Math.floor(a / TILE) !== Math.floor(b / TILE))
        seams.add(`${axis}${TILE * Math.max(Math.floor(a / TILE), Math.floor(b / TILE))}`)
  for (const seam of ["x0", "y0", "y-2000", "x2000"]) assert.ok(seams.has(seam), seam)
})

test("driveScript: teleports along the route at the speed each frame and records each frame's delta, player and tile count", async () => {
  const teleports: Array<[number, number, number]> = [],
    frames: Array<(t: number) => void> = []
  let pose: { x: number; y: number } | undefined
  const gta = {
    player: () => (pose === undefined ? undefined : { pose }),
    tiles: () => (pose === undefined ? ["0_0"] : ["0_0", "1_0"]),
    teleport: (x: number, y: number, angle: number) => {
      teleports.push([x, y, Math.round(angle * 1000) / 1000])
      pose = { x, y }
    },
  }
  const done = runInNewContext(driveScript([0, 0, 100, 0, 100, 50], 40, 4), {
    gta,
    requestAnimationFrame: (tick: (t: number) => void) => frames.push(tick),
    setTimeout: () => 0,
  }) as Promise<Array<Frame>>
  for (let t = 1000; frames.length > 0; t += 500) frames.shift()!(t)
  const right = 1.571
  assert.deepEqual(teleports, [
    [0, 0, 0],
    [20, 0, 0],
    [40, 0, 0],
    [60, 0, 0],
    [80, 0, 0],
    [100, 0, 0],
    [100, 20, right],
    [100, 40, right],
    [100, 50, right], // held at the end
  ])
  // Each frame after the first: ms since the first, its delta, where the player was, the tiles held.
  const recorded = JSON.parse(JSON.stringify(await done)) as Array<Frame>
  assert.deepEqual(recorded.slice(0, 2), [
    [500, 500, 0, 0, 2],
    [1000, 500, 20, 0, 2],
  ])
  assert.deepEqual(recorded.at(-1), [4000, 500, 100, 40, 2])
  assert.equal(recorded.length, 8)

  // Without a player the position is null.
  pose = undefined
  const none = runInNewContext(driveScript([0, 0, 1, 0], 1, 0.5), {
    gta: { ...gta, player: () => undefined, teleport: () => undefined },
    requestAnimationFrame: (tick: (t: number) => void) => frames.push(tick),
    setTimeout: () => 0,
  }) as Promise<Array<Frame>>
  for (let t = 0; frames.length > 0; t += 500) frames.shift()!(t)
  assert.deepEqual(JSON.parse(JSON.stringify(await none)), [[500, 500, null, null, 1]])
})

test("driveReport: the slowest frame within 1 s of each seam crossing, the frames over 30 ms, the frame stats and the most tiles held", () => {
  const frames: Array<Frame> = [
    [100, 16, 1990, -10, 4],
    [200, 40, 1995, -5, 5], // 0.8 s before the crossing
    [1000, 16, 2001, 1, 6], // crosses x = 2000 and y = 0
    [2100, 50, 2002, 2, 6], // 1.1 s after it
    [2200, 16, null, null, 9], // no player
    [2300, 16, -1, 3, 7], // crosses x = 0 and x = 2000 back from the last known x
  ]
  assert.deepEqual(driveReport(frames), {
    slowest: 50,
    p99: 50,
    maxTiles: 9,
    seams: [
      { axis: "x", at: 2000, t: 1000, slowest: 40 },
      { axis: "y", at: 0, t: 1000, slowest: 40 },
      { axis: "x", at: 0, t: 2300, slowest: 50 },
      { axis: "x", at: 2000, t: 2300, slowest: 50 },
    ],
    slow: [
      { t: 200, x: 1995, y: -5, dt: 40 },
      { t: 2100, x: 2002, y: 2, dt: 50 },
    ],
  })
  assert.deepEqual(driveReport([]), { slowest: 0, p99: 0, maxTiles: 0, seams: [], slow: [] })
})

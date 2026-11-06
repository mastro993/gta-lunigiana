import assert from "node:assert/strict"
import { test } from "node:test"

import { type MapPen, overviewRoad, paintLayers } from "../map-style.ts"
import { PALETTE } from "../palette.ts"

const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1]

test("paintLayers fills the areas in the land cover's order, whatever their order in the map: a park over the residential land round it, OSM's scrub over a UCS pasture, the woods first", () => {
  const fills: Array<number> = []
  const pen: MapPen = { clip: () => {}, fill: (_rings, hex) => fills.push(hex), stroke: () => {} }
  // As the build lists them: OSM's ways (the park, the scrub), its relations (the residential land),
  // then the UCS's (a pasture, a wood).
  paintLayers(
    pen,
    {
      outline: [square(0, 0, 100, 100)],
      areas: [
        { kind: "park", rings: [square(10, 10, 20, 20)] },
        { kind: "scrub", rings: [square(60, 60, 70, 70)] },
        { kind: "residential", rings: [square(0, 0, 40, 40)] },
        { kind: "grassland", rings: [square(50, 50, 90, 90)] },
        { kind: "forest", rings: [square(0, 0, 100, 100)] },
      ],
      water: [],
      rail: [],
      roads: [],
      buildings: [],
    },
    1,
    overviewRoad,
  )
  // The play area's grass, the wood, the pasture, the scrub over it, the residential land, the park over that.
  assert.deepEqual(fills, [
    PALETTE.grass,
    PALETTE.forest,
    PALETTE.grass,
    PALETTE.forestLight,
    PALETTE.grass,
    PALETTE.forestLight,
  ])
})

test("paintLayers strokes every stream and river in one opaque water colour, at least 1 px wide, so crossings never darken", () => {
  const strokes: Array<{ readonly width: number; readonly hex: number; readonly alpha: number }> =
    []
  const pen: MapPen = {
    clip: () => {},
    fill: () => {},
    stroke: (_pts, width, hex, alpha) => strokes.push({ width, hex, alpha }),
  }
  paintLayers(
    pen,
    {
      outline: [square(0, 0, 100, 100)],
      areas: [],
      water: [
        { w: 0.5, pts: [0, 50, 100, 50] },
        { w: 2, pts: [50, 0, 50, 100] },
        { w: 30, pts: [0, 0, 100, 100] },
      ],
      rail: [],
      roads: [],
      buildings: [],
    },
    0.1,
    overviewRoad,
  )
  assert.deepEqual(strokes, [
    { width: 1, hex: PALETTE.waterShallow, alpha: 1 },
    { width: 1, hex: PALETTE.waterShallow, alpha: 1 },
    { width: 3, hex: PALETTE.waterShallow, alpha: 1 },
  ])
})

test("paintLayers strokes a road in a tunnel dashed in its own look along its whole line, and leaves out a path in a tunnel", () => {
  const strokes: Array<{
    readonly pts: ReadonlyArray<number>
    readonly width: number
    readonly hex: number
    readonly alpha: number
  }> = []
  const pen: MapPen = {
    clip: () => {},
    fill: () => {},
    stroke: (pts, width, hex, alpha) => strokes.push({ pts, width, hex, alpha }),
  }
  // A primary road's 172 m tunnel bent in the middle, and a path's tunnel beside it.
  const tunnel = { cls: "primary", w: 7, tunnel: true, pts: [0, 0, 100, 0, 172, 72] }
  paintLayers(
    pen,
    {
      outline: [square(-100, -100, 300, 300)],
      areas: [],
      water: [],
      rail: [],
      roads: [tunnel, { cls: "path", w: 1.5, tunnel: true, pts: [0, 20, 100, 20] }],
      buildings: [],
    },
    0.5,
    overviewRoad,
  )
  const look = overviewRoad(tunnel, "primary", 0.5)
  assert.ok(strokes.length >= 3, `${strokes.length} dashes`)
  const length = (pts: ReadonlyArray<number>) => {
    let l = 0
    for (let k = 2; k < pts.length; k += 2)
      l += Math.hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!)
    return l
  }
  for (const { pts, ...rest } of strokes) {
    assert.deepEqual(rest, look, "the road's own look")
    assert.ok(length(pts) > 0)
  }
  // From the tunnel's start, every other stretch of the line, each as long as the gap after it.
  assert.deepEqual(strokes[0]!.pts.slice(0, 2), [0, 0])
  const drawn = strokes.reduce((sum, { pts }) => sum + length(pts), 0),
    whole = length(tunnel.pts)
  assert.ok(
    drawn > 0.4 * whole && drawn < 0.6 * whole,
    `${drawn.toFixed(1)} of ${whole.toFixed(1)} m dashed`,
  )
  assert.ok(
    strokes.every(({ pts }) => pts.every((v, k) => k % 2 === 1 || v <= 172.001)),
    "along the line",
  )
})

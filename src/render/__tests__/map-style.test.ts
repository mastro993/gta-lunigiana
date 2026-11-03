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

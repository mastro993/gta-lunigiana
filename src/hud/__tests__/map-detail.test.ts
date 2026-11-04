import assert from "node:assert/strict"
import { test } from "node:test"

import { overviewRoad } from "../../render/map-style.ts"
import { residentAround } from "../../render/testing.ts"
import { MAP, roadClassOf } from "../../sim/map/index.ts"
import { residentTile } from "../../sim/map/tiles.ts"
import { detailed, tilesUnder } from "../map-detail.ts"
import { fitMap, wholeMap } from "../map-view.ts"
import { tileLayers } from "../minimap.ts"

test("the detail paints the listed tiles under the frame, and none past the map", () => {
  // A box inside one tile, one across a seam, and one past the map's corner.
  assert.deepEqual(
    tilesUnder(100, 100, 300, 300).map((t) => t.key),
    ["0_0"],
  )
  assert.deepEqual(
    tilesUnder(-100, 100, 100, 300).map((t) => t.key),
    ["-1_0", "0_0"],
  )
  assert.deepEqual(tilesUnder(1e7, 1e7, 1e7 + 10, 1e7 + 10), [])
})

test("zoomed in, a road is painted about as wide as it is, not as wide as the overview bakes it", () => {
  // The overview paints every road at least 7.5 px of its own, about 35 m at its 0.21 px/m; the
  // detail paints each at most the overview's least width in screen px, or 1.6 times its width.
  // The tiles round the start, Monzone's station.
  const start = MAP.spawns.player
  residentAround([start], 200)
  const tiles = tilesUnder(start.x - 200, start.y - 200, start.x + 200, start.y + 200)
  assert.ok(tiles.length > 0)
  for (const { key, i, j } of tiles)
    for (const road of tileLayers(residentTile(key)!.vectors, i, j).roads)
      for (const scale of [0.058, 0.107, 0.5, 2]) {
        const metres = overviewRoad(road, roadClassOf(road), scale).width / scale
        assert.ok(
          metres <= Math.max(3 / scale, 1.6 * road.w) + 1e-9,
          `${road.cls} ${road.w} m painted ${metres} m at ${scale} px/m`,
        )
        if (scale >= 0.5) assert.ok(metres < 20, `${road.cls} at ${scale} px/m`)
      }
})

test("the detail is painted once the frame shows 64 km² or less: further in on a small screen than on a big one", () => {
  for (const [width, height, from] of [
    [1280, 720, 0.107],
    [844, 390, 0.058],
    [1920, 1080, 0.167],
  ] as const) {
    const screen = { bounds: MAP.bounds, width, height },
      whole = fitMap(screen).scale,
      at = (scale: number) => fitMap(screen, { ...wholeMap(MAP.bounds), zoom: scale / whole })
    assert.equal(detailed(fitMap(screen)), false, `the whole map at ${width}x${height}`)
    assert.equal(detailed(at(from * 0.99)), false, `just out at ${width}x${height}`)
    assert.equal(detailed(at(from * 1.01)), true, `just in at ${width}x${height}`)
  }
})

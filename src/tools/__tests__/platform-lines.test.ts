import assert from "node:assert/strict"
import { test } from "node:test"

import { pointInRing, signedArea, type P } from "../geometry.ts"
import type { Osm } from "../osm.ts"
import { band, PLATFORM_HALF, platformLines } from "../platform-lines.ts"

const ringPts = (ring: ReadonlyArray<number>): Array<P> =>
  Array.from({ length: ring.length / 2 }, (_, k) => [ring[2 * k]!, ring[2 * k + 1]!] as const)

test("band runs a line's width either side of it, counter-clockwise, its bend mitred", () => {
  const ring = band(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 20 },
    ],
    3,
  )!
  assert.ok(signedArea(ringPts(ring)) > 0, "counter-clockwise")
  assert.ok(
    pointInRing(50, 2.9, ring) && pointInRing(50, -2.9, ring) && !pointInRing(50, 3.2, ring),
  )
  assert.ok(pointInRing(150, 10, ring) && pointInRing(100, 2.9, ring))
  // 6 m by the line's 202 m, less what rounding to the 0.1 m grid takes off its 400 m rim.
  assert.ok(Math.abs(signedArea(ringPts(ring)) - 6 * (100 + Math.hypot(100, 20))) < 12)
})

// Regression: OSM draws Sarzana's platforms as lines but for its island's shelter roof (way 309025357, 60 m), and the build,
// which cut platforms from areas alone, called its trains at that roof: a station 59.5 m long, its middle off any platform.
test("platformLines makes a band of each platform OSM draws as a line, by its width tag, and of no area or bus stop", () => {
  const nodes = new Map(
    [
      ["a", 44.1, 10.0],
      ["b", 44.1, 10.002],
      ["c", 44.1001, 10.0],
      ["d", 44.1001, 10.002],
    ].map(([id, lat, lon]) => [
      id as string,
      { id: id as string, lat: lat as number, lon: lon as number, tags: {} },
    ]),
  )
  const way = (id: string, nds: ReadonlyArray<string>, tags: Record<string, string>) =>
    [id, { id, nds, tags }] as const
  const osm: Osm = {
    nodes,
    ways: new Map([
      way("1", ["a", "b"], { railway: "platform", public_transport: "platform" }),
      way("2", ["c", "d"], { railway: "platform", width: "8" }),
      way("3", ["a", "b", "d", "c", "a"], { railway: "platform" }), // an area: extractAreas takes it
      way("4", ["c", "d"], { public_transport: "platform", bus: "yes" }), // a bus stop's
    ]),
    relations: new Map(),
  }
  const bands = platformLines(osm, [])
  assert.equal(bands.length, 2)
  // A line along a platform OSM maps as an area too (Aulla Lunigiana's) is that platform: none.
  const [x0, y0, x1, y1] = [-1e5, -1e5, 1e5, 1e5]
  assert.equal(platformLines(osm, [[[x0, y0, x1, y0, x1, y1, x0, y1]]]).length, 0)
  const width = (rings: ReadonlyArray<ReadonlyArray<number>>) => {
    const ys = rings[0]!.filter((_, k) => k % 2 === 1)
    return Math.max(...ys) - Math.min(...ys)
  }
  assert.ok(Math.abs(width(bands[0]!) - 2 * PLATFORM_HALF) < 0.11)
  assert.ok(Math.abs(width(bands[1]!) - 8) < 0.11)
})

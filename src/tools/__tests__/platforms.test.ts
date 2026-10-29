import assert from "node:assert/strict"
import { test } from "node:test"

import { pointInRing, segDist2 } from "../geometry.ts"
import { buildPlatforms, type PlatformInput } from "../platforms.ts"

/** A counter-clockwise box as a flat ring. */
const box = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1]
/** A line along y = 0 from x -50 to 150, its bed at 100 m rising to 102 m; the terrain lies level with it. */
const line = { pts: [-50, 0, 50, 0, 150, 0], z: [100, 101, 102] }
const bed = (x: number) => 100 + (x + 50) / 100
const base: Omit<PlatformInput, "polygons"> = {
  tracks: [{ pts: line.pts, group: 0 }],
  lines: [line],
  roads: [],
  crossings: [],
  stops: [{ name: "Stazione", x: 20, y: 30 }],
  terrain: (x) => bed(x),
}
/** Least distance from a ring's edges (sampled every 0.05 m) to the line y = `y`. */
const gapTo = (ring: ReadonlyArray<number>, ax: number, ay: number, bx: number, by: number) => {
  let d2 = Number.MAX_VALUE
  for (let k = 0; k < ring.length; k += 2) {
    const j = (k + 2) % ring.length,
      n = Math.ceil(Math.hypot(ring[j]! - ring[k]!, ring[j + 1]! - ring[k + 1]!) / 0.05)
    for (let q = 0; q <= n; q++)
      d2 = Math.min(
        d2,
        segDist2(
          ring[k]! + ((ring[j]! - ring[k]!) * q) / n,
          ring[k + 1]! + ((ring[j + 1]! - ring[k + 1]!) * q) / n,
          ax,
          ay,
          bx,
          by,
        ).d2,
      )
  }
  return Math.sqrt(d2)
}

test("buildPlatforms clips a platform 1.6 m off the track, off the road and out of the level crossing, its top 0.37 m over the bed", () => {
  const [p, ...rest] = buildPlatforms({
    ...base,
    // A platform drawn into the track's clearance, under the road at y 10 (4 m wide) and across a crossing at x 30–40.
    polygons: [{ src: "test", rings: [box(0, 0.5, 40, 9)] }],
    roads: [{ pts: [-50, 10, 150, 10], w: 4 }],
    crossings: [[box(30, -5, 45, 12)]],
  })
  assert.equal(rest.length, 0)
  assert.equal(p!.walkway, false)
  assert.equal(p!.name, "Stazione")
  const ring = p!.rings[0]!
  const gap = gapTo(ring, -50, 0, 150, 0)
  assert.ok(gap >= 1.55 && gap < 1.75, `${gap.toFixed(2)} m from the track`)
  assert.ok(gapTo(ring, -50, 10, 150, 10) >= 2.5, "0.5 m off the carriageway's edge")
  assert.ok(Math.max(...ring.filter((_, k) => k % 2 === 0)) <= 30, "out of the crossing")
  // 30 m by 1.6–7.5 m, less the raster's 0.105 m margin on both clipped sides.
  assert.ok(Math.abs(p!.area - 30 * 5.69) < 1.5, `${p!.area.toFixed(1)} m²`)
  // The axis runs along the line from 1 m before the platform to 1 m past it, its top the bed + 0.12 + 0.25.
  const [ax, ay, bx, by] = p!.axis
  assert.equal(p!.axis.length, 4)
  assert.ok(
    Math.abs(ax! + 1) < 0.11 && ay === 0 && Math.abs(bx! - 31) < 0.21 && by === 0,
    `${p!.axis}`,
  )
  for (let k = 0; k < p!.top.length; k++)
    assert.ok(Math.abs(p!.top[k]! - bed(p!.axis[2 * k]!) - 0.37) < 0.006, `top ${p!.top[k]}`)
})

test("buildPlatforms makes a strip between two close tracks, or one under 1.2 m wide, a walkway at the rails' level", () => {
  const two = buildPlatforms({
    ...base,
    // A second track 5 m off: the strip between them is 1.6 m once clipped, wide enough, but between tracks.
    tracks: [...base.tracks, { pts: [-50, 5, 150, 5], group: 1 }],
    polygons: [{ src: "between", rings: [box(0, 0.6, 40, 4.4)] }],
  })
  assert.equal(two.length, 1)
  assert.equal(two[0]!.walkway, true)
  assert.ok(two[0]!.width > 1.2 && two[0]!.between > 0.9, `${two[0]!.width.toFixed(2)} m wide`)
  assert.ok(Math.abs(two[0]!.top[0]! - bed(two[0]!.axis[0]!) - 0.14) < 0.006)
  const narrow = buildPlatforms({
    ...base,
    polygons: [{ src: "narrow", rings: [box(0, 1, 40, 2.6)] }],
  })
  assert.equal(narrow[0]!.walkway, true, `${narrow[0]!.width.toFixed(2)} m wide`)
  const wide = buildPlatforms({ ...base, polygons: [{ src: "wide", rings: [box(0, 1, 40, 4)] }] })
  assert.equal(wide[0]!.walkway, false, `${wide[0]!.width.toFixed(2)} m wide`)
})

test("buildPlatforms leaves out ground more than 1 m under the platform's top, and pieces under 4 m²", () => {
  const out = buildPlatforms({
    ...base,
    // The back of the platform, past y 6, drops to a forecourt 2 m down; a 1.5 m² corner stands apart.
    polygons: [
      { src: "forecourt", rings: [box(0, 1, 40, 10)] },
      { src: "corner", rings: [box(60, 2, 61, 3.5)] },
    ],
    terrain: (x, y) => bed(x) - (y > 6 ? 2 : 0),
  })
  assert.deepEqual(
    out.map((p) => p.src),
    ["forecourt"],
  )
  const ring = out[0]!.rings[0]!
  assert.ok(Math.max(...ring.filter((_, k) => k % 2 === 1)) <= 6.1)
  assert.ok(pointInRing(20, 4, ring) && !pointInRing(20, 7, ring))
})

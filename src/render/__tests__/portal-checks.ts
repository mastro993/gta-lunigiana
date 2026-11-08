// The checks of road tunnels' portals and head walls as drawn that tunnels.test.ts and the tunnels
// map tests share (through tunnel-checks.ts): a dark mouth facing out of the hill, crowned over the
// road's clear height, or a head wall's opening at the bore's width and clear height, in the road
// bridges' colour, its top where its shape puts it; or no portal at all. Where they stand, and why
// none stands, are render/mouths' (src/render/mouths/__tests__/mouth-checks.ts).
import assert from "node:assert/strict"

import { segDist2 } from "../../sim/collide.ts"
import { ROAD_LIFT } from "../../sim/map/ground.ts"
import { type Road, roadClassOf } from "../../sim/map/index.ts"
import { boreOf } from "../bores.ts"
import { emptySink, type Piece, type Sink } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { type Mouth, standingAt } from "../mouths/__tests__/mouth-checks.ts"
import { PALETTE } from "../palette.ts"
import { portalPieces } from "../portals.ts"
import { type Tri, trianglesOf } from "./rail-checks.ts"

/** `piece` drawn whole into one sink. */
export const drawn = (piece: Piece): Sink => {
  const all = emptySink()
  piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
  return all
}

/** Road `road`'s profile (m a.s.l.) where its line passes nearest map point (x, y). */
const profileAt = (road: Road, x: number, y: number): number => {
  let best = Number.POSITIVE_INFINITY,
    z = road.z[0]!
  for (let k = 0; k + 1 < road.z.length; k++) {
    const { d2, t } = segDist2(
      x,
      y,
      road.pts[2 * k]!,
      road.pts[2 * k + 1]!,
      road.pts[2 * k + 2]!,
      road.pts[2 * k + 3]!,
    )
    if (d2 < best) [best, z] = [d2, road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t]
  }
  return z
}

/** The portal or head wall standing at map point (x, y). */
const portalAt = (x: number, y: number): Piece => {
  const piece = portalPieces().find(({ pts }) => pts[0] === x && pts[1] === y)
  assert.ok(piece !== undefined, `no portal at (${x}, ${y})`)
  return piece
}

/** The dark triangles of `solid` within reach of road `road`'s carriageway at `mouth`, each facing out of the hill (its normal across within 37° of the heading out). */
const darkMouth = (solid: Sink["solid"], road: Road, mouth: Mouth): Array<Tri> => {
  const reach = road.w / 2 + 2,
    dark = trianglesOf(solid, PALETTE.tunnelDark).filter((tri) =>
      tri.every(([px, , pz]) => Math.hypot(px - mouth.x, -pz - mouth.y) < reach),
    )
  const ox = Math.cos(mouth.angle),
    oy = Math.sin(mouth.angle)
  for (const [a, b, c] of dark) {
    // The triangle's normal across (x, z of three space) against the way out (map ox, oy is three ox, −oy).
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    assert.ok((nx * ox - nz * oy) / Math.hypot(nx, nz) > 0.8, "facing out of the hill")
  }
  return dark
}

/** The top of `solid` (what stands at `mouth`, drawn) where its shape puts it: its cornice's, over the floor it stands on (`standingAt`). */
const checkTop = (solid: Sink["solid"], mouth: Mouth): void => {
  const { z, portal } = standingAt(mouth.x, mouth.y)
  let top = Number.NEGATIVE_INFINITY
  for (let t = 1; t < solid.position.length; t += 3) top = Math.max(top, solid.position[t]!)
  assert.ok(
    Math.abs(top - (yOf(z) + portal.high + portal.cornice.high)) < 1e-6,
    `the portal at (${mouth.x.toFixed(1)}, ${mouth.y.toFixed(1)}): its top ${(top - yOf(z)).toFixed(2)} m over its floor, its shape's ${(portal.high + portal.cornice.high).toFixed(2)} m`,
  )
}

/**
 * The portal at `mouth` of road `road` (where it stands: the road's end, or stood back into the
 * tunnel): a dark mouth of 6 triangles or more facing out of the hill, its crown over the road's
 * clearance (OSM's `maxheight`, 4 m untagged), and a face in `face`'s colour (concrete on the main,
 * provincial and unclassified roads, old stone on the rest), its top where its shape puts it.
 */
export const checkPortal = (road: Road, mouth: Mouth, face: number): void => {
  const { solid } = drawn(portalAt(mouth.x, mouth.y)),
    dark = darkMouth(solid, road, mouth)
  assert.ok(dark.length >= 6, `the mouth at ${mouth.x}, ${mouth.y}: ${dark.length} dark triangles`)
  const floor = yOf(profileAt(road, mouth.x, mouth.y))
  assert.ok(
    dark.some((tri) => tri.some(([, h]) => h > floor + (road.maxheight ?? 4))),
    "a crown over the road's clearance",
  )
  assert.ok(trianglesOf(solid, face).length >= 6, "its face in the road bridges' colour")
  checkTop(solid, mouth)
}

/**
 * The head wall at `mouth`, the end of road `road`: a dark opening facing out of the hill, as wide
 * as the bore and flat at its clear height (OSM's `maxheight`, 4 m untagged) over the road's
 * surface; a face in `face`'s colour (concrete on the main, provincial and unclassified roads, old
 * stone on the rest); and its top where its shape puts it.
 */
export const checkHeadWall = (road: Road, mouth: Mouth, face: number): void => {
  const { solid } = drawn(portalAt(mouth.x, mouth.y)),
    dark = darkMouth(solid, road, mouth),
    { half, clear } = boreOf(road),
    floor = yOf(profileAt(road, mouth.x, mouth.y) + ROAD_LIFT[roadClassOf(road)]),
    where = `the head wall at (${mouth.x.toFixed(1)}, ${mouth.y.toFixed(1)})`
  assert.ok(dark.length >= 2, `${where}: ${dark.length} dark triangles`)
  const ux = Math.cos(mouth.angle),
    uy = Math.sin(mouth.angle),
    corners = dark.flat(),
    tops = corners.map(([, h]) => h - floor),
    across = corners.map(([px, , pz]) => Math.abs((-pz - mouth.y) * ux - (px - mouth.x) * uy))
  assert.ok(
    Math.abs(Math.max(...tops) - clear) < 1e-6,
    `${where}: its opening ${Math.max(...tops).toFixed(2)} m high, not ${clear} m`,
  )
  assert.ok(
    Math.abs(Math.max(...across) - half) < 1e-6,
    `${where}: its opening ${Math.max(...across).toFixed(2)} m either side, not the bore's ${half} m`,
  )
  assert.ok(trianglesOf(solid, face).length >= 6, `${where}: its face in the road bridges' colour`)
  checkTop(solid, mouth)
}

/** No portal stands within 5 m of map point (x, y). */
export const checkNoPortal = (x: number, y: number): void => {
  const near = portalPieces().filter(({ pts }) => Math.hypot(pts[0]! - x, pts[1]! - y) < 5)
  assert.equal(near.length, 0, `a portal by (${x}, ${y})`)
}

import assert from "node:assert/strict"
import { test } from "node:test"

import { terrainZ } from "../../sim/map/ground.ts"
import { MAP } from "../../sim/map/index.ts"
import { type Corner, drape, DRAPE_POKE, drawn, layOver } from "../drape.ts"
import { Triangles } from "../geometry.ts"
import { terrainNodeY, terrainY, yOf } from "../ground.ts"
import { residentAround, vectorsAround } from "../testing.ts"
import { heightIn, type Tri } from "./rail-checks.ts"
import { checkLaid } from "./tunnel-checks.ts"

/** The triangles of `tris`. */
const all = (tris: Triangles): Array<Tri> =>
  Array.from({ length: tris.position.length / 9 }, (_, t) => {
    const p = tris.position
    return [0, 1, 2].map((k) => [
      p[9 * t + 3 * k]!,
      p[9 * t + 3 * k + 1]!,
      p[9 * t + 3 * k + 2]!,
    ]) as unknown as Tri
  })

/** The highest of `tris` over map (x, y), render y, if any covers it. */
const topOf = (tris: ReadonlyArray<Tri>, x: number, y: number): number | undefined => {
  const hs = tris.flatMap((tri) => heightIn(tri, x, y) ?? [])
  return hs.length === 0 ? undefined : Math.max(...hs)
}

/** Points every 0.1 m inside triangle abc (map x, y), its rim left out. */
const inside = (a: Corner, b: Corner, c: Corner): Array<readonly [number, number]> => {
  const out: Array<readonly [number, number]> = []
  for (let s = 0.01; s < 1; s += 0.02)
    for (let t = 0.01; s + t < 0.99; t += 0.02)
      out.push([
        a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * t,
      ])
  return out
}

/** A road's surface at grade from its profile `z` and a 0.1 m lift, render y (`surfaceY`). */
const surface = (x: number, y: number, z: number) => yOf(Math.max(z, terrainZ(x, y)) + 0.1)

/**
 * The nodes of the terrain mesh within 40 m of (x, y), row by row from the south-west, each with how
 * far it stands over the mean of its four neighbours (a peak of the mesh where that is large).
 */
const nodesNear = (x: number, y: number): Array<readonly [x: number, y: number, rise: number]> => {
  const { x0, y0, cell } = MAP.heightmap,
    i0 = Math.round((x - x0) / cell),
    j0 = Math.round((y - y0) / cell),
    out: Array<readonly [number, number, number]> = []
  for (let j = j0 - 10; j <= j0 + 10; j++)
    for (let i = i0 - 10; i <= i0 + 10; i++)
      out.push([
        x0 + i * cell,
        y0 + j * cell,
        terrainNodeY(i, j) -
          (terrainNodeY(i - 1, j) +
            terrainNodeY(i + 1, j) +
            terrainNodeY(i, j - 1) +
            terrainNodeY(i, j + 1)) /
            4,
      ])
  return out
}

/** The node of the terrain mesh within 40 m of (x, y) standing highest over the mean of its four neighbours: a peak of the mesh. */
const peakNear = (x: number, y: number): readonly [number, number] => {
  const [px, py] = nodesNear(x, y).reduce((best, node) => (node[2] > best[2] ? node : best))
  return [px, py]
}

/** The most two triangles drawn across side pq (map x, y), `inner` on its left, `outer` on its right, differ by along it: a crack. */
const stepAlong = (
  inner: ReadonlyArray<Tri>,
  outer: ReadonlyArray<Tri>,
  p: Corner,
  q: Corner,
): number => {
  const ex = q[0] - p[0],
    ey = q[1] - p[1],
    // A hair off the side, to its left.
    nx = -ey * 1e-6,
    ny = ex * 1e-6
  let step = 0
  for (let t = 0.005; t < 1; t += 0.01) {
    const x = p[0] + ex * t,
      y = p[1] + ey * t
    step = Math.max(step, Math.abs(topOf(inner, x + nx, y + ny)! - topOf(outer, x - nx, y - ny)!))
  }
  return step
}

test("drape: a ribbon's triangle whose corners stand on the road's surface over the terrain everywhere between them is drawn whole, as its corners put it", () => {
  residentAround([{ x: -1036, y: 7381 }], 40)
  // Its profile 5 m over the mesh: the road's surface is the profile's plane.
  const z = terrainZ(-1036, 7381) + 5
  const a: Corner = [-1040, 7378, z],
    b: Corner = [-1032, 7379, z + 0.3],
    c: Corner = [-1036, 7385, z + 0.1]
  const tris = new Triangles()
  drape(tris, a, b, c, surface, 0)
  assert.deepEqual(
    all(tris),
    [[a, b, c].map(([x, y, h]) => [x, surface(x, y, h), -y])],
    "one triangle, its corners on the surface",
  )
})

test("drape: a ribbon's triangle over a peak of the terrain mesh is cut along the mesh's folds, the peak on the road's surface and the mesh nowhere through it, and the triangle across a side meets it there", () => {
  // Near Sarzana's service tunnel 376037643, its profile far under the mesh: the road's surface is
  // the terrain's, lifted, and a plane through three corners round a peak stands under the peak.
  residentAround([{ x: -14490, y: -4827 }], 80)
  const [px, py] = peakNear(-14490, -4827),
    z = 0
  const a: Corner = [px - 2.6, py - 1.9, z],
    b: Corner = [px + 2.7, py - 1.4, z],
    c: Corner = [px - 0.3, py + 2.8, z]
  const tris = new Triangles()
  drape(tris, a, b, c, surface, 0)
  const drawnTris = all(tris)
  assert.ok(drawnTris.length > 4, `${drawnTris.length} pieces`)
  assert.ok(
    Math.abs(topOf(drawnTris, px, py)! - surface(px, py, z)) < 1e-6,
    "the peak on the surface",
  )
  for (const [x, y] of inside(a, b, c)) {
    const h = topOf(drawnTris, x, y)
    assert.ok(
      h !== undefined && terrainY(x, y) <= h + DRAPE_POKE + 1e-9,
      `(${x}, ${y}): the terrain ${terrainY(x, y) - h!} m over it`,
    )
  }
  // Each triangle across one of its sides, mirrored over it, draws that side as it does: no crack.
  for (const [p, q, r] of [
    [a, b, c],
    [b, c, a],
    [c, a, b],
  ] as const) {
    const ex = q[0] - p[0],
      ey = q[1] - p[1],
      s = ((r[0] - p[0]) * ex + (r[1] - p[1]) * ey) / (ex * ex + ey * ey),
      mirror: Corner = [2 * (p[0] + ex * s) - r[0], 2 * (p[1] + ey * s) - r[1], z]
    const across = new Triangles()
    drape(across, q, p, mirror, surface, 0)
    const step = stepAlong(drawnTris, all(across), p, q)
    assert.ok(step < 1e-4, `a crack of ${step} m along the side from (${p[0]}, ${p[1]})`)
  }
})

test("drape: a triangle cut over a peak beside one drawn whole keeps their side straight, as the whole one draws it", () => {
  // Near Sarzana's service tunnel 376037643: round a node a little over its neighbours, A and C on
  // the terrain and B on a profile 0.5 m over it, so the surface along AB folds under the plane
  // through its ends where the profile meets the terrain; the triangle BAD across it, on the terrain
  // from D, stands nowhere under the mesh and is drawn whole.
  residentAround([{ x: -14490, y: -4827 }], 80)
  const cases = nodesNear(-14490, -4827).flatMap(([px, py, rise]) => {
    if (rise < 0.15 || rise > 0.6) return []
    const a: Corner = [px - 2.6, py - 1.9, 0],
      b: Corner = [px + 2.7, py - 1.4, terrainZ(px + 2.7, py - 1.4) + 0.5],
      c: Corner = [px - 0.3, py + 2.8, 0],
      d: Corner = [px + 0.2, py - 5.5, 0]
    const cut = new Triangles(),
      whole = new Triangles()
    drape(cut, a, b, c, surface, 0)
    drape(whole, b, a, d, surface, 0)
    return all(cut).length > 1 && all(whole).length === 1 ? [{ a, b, cut, whole }] : []
  })
  assert.ok(cases.length > 0, "a peak with a triangle cut over it beside one drawn whole")
  const { a, b, cut, whole } = cases[0]!
  const step = stepAlong(all(cut), all(whole), a, b)
  assert.ok(step < 1e-4, `a crack of ${step} m along their side`)
})

test("layOver: a painted line over its ribbon's fold lies 2 cm over it on both sides, cut along the fold; over one plane it lies whole", () => {
  // A ribbon 4 m square, folded up along its diagonal from (0, 0) to (4, 4): a ridge 0.4 m high.
  const ribbon = new Triangles()
  ribbon.tri(0, 0, -0, 4, 0, -0, 4, 0.4, -4, 0)
  ribbon.tri(0, 0, -0, 4, 0.4, -4, 0, 0, -4, 0)
  const under = drawn(ribbon),
    laid = (x: number, y: number): Corner => [x, y, under.heightAt(x, y)! + 0.02]
  // Across the ridge, its corners each 2 cm over the ribbon: the plane through them sags under it.
  const across = new Triangles()
  layOver(across, laid(1.5, 2.5), laid(2.5, 1.4), laid(2.6, 1.6), under, 0.02, 0)
  assert.ok(all(across).length > 1)
  for (const [x, y] of inside(laid(1.5, 2.5), laid(2.5, 1.4), laid(2.6, 1.6))) {
    const h = topOf(all(across), x, y)
    assert.ok(h !== undefined && Math.abs(h - under.heightAt(x, y)! - 0.02) < 1e-9, `(${x}, ${y})`)
  }
  // Within the south-east half alone: one triangle, as its corners put it.
  const within = new Triangles()
  layOver(within, laid(2, 0.5), laid(3.5, 0.5), laid(3.5, 1.5), under, 0.02, 0)
  assert.equal(all(within).length, 1)
})

// Regressions (#20, round 3): the ground behind a road tunnel's mouth is held at the bore's floor
// (`mouthClaim`), as much as 7 m under the roads over a shallow bore, and a ribbon read its road's
// surface at its corners alone. Found by geometry: the mouths nearest the points.

/** Checks the roads at grade round the road tunnel's mouth the build baked nearest map point `at` (within 5 m) lie over the terrain, their lines over them (`checkLaid`). */
const laidRound = (at: { readonly x: number; readonly y: number }): number => {
  const mouth = MAP.derived.mouths.find((m) => Math.hypot(m.x - at.x, m.y - at.y) < 5)
  assert.ok(mouth !== undefined, `a road tunnel's mouth by (${at.x}, ${at.y})`)
  residentAround([mouth], 80)
  return checkLaid(vectorsAround([mouth], 30).roads.items, mouth.x, mouth.y, 12)
}

// By the west mouth of Fivizzano's 16 m underpass under the SS63 (145347886) the corners 3.7 m
// behind it tilted the SS63's ribbon across its junction's Y, 0.13 m over the surface its centre
// line read there, and the line sank under it.
test("round the west mouth of Fivizzano's underpass under the SS63, the SS63's centre lines lie over its ribbon", () => {
  assert.ok(laidRound({ x: -1036, y: 7381 }) > 1000)
})

// By the west mouth of Sarzana's service tunnel 376037643, a node held at the floor beside nodes
// not held folded the mesh into a ridge along a cell's diagonal across the footway 1462688623,
// 0.56 m through its ribbon.
test("round the west mouth of Sarzana's service tunnel 376037643, no terrain stands through the footway beside it", () => {
  assert.ok(laidRound({ x: -14490, y: -4827 }) > 1000)
})

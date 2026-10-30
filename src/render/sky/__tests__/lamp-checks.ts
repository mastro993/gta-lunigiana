// The checks lamps.test.ts (the lamps by Monzone) and lamps.map-test.ts (every lamp of the map) share, each over the
// lamps it is handed (indices into `streetLamps()`).
import assert from "node:assert/strict"

import { pointInRing } from "../../../sim/collide.ts"
import {
  buildingsIn,
  buildingStyleOf,
  MAP,
  type Road,
  roadClassOf,
} from "../../../sim/map/index.ts"
import { eaveOf, windowCount } from "../../buildings.ts"
import { type Sink, Triangles, WaterTriangles } from "../../geometry.ts"
import { terrainY } from "../../ground.ts"
import { lampPieces, streetLamps } from "../lamps.ts"

type Lamp = ReturnType<typeof streetLamps>[number]

/** The road classes that get street lamps. */
const LIT = new Set(["tertiary", "unclassified", "residential", "service"])

/** The wall (building and edge) the lamp's bracket meets: the outer edge through its mount point with its outward normal. */
const wallOf = (lamp: Lamp) => {
  const wx = lamp.x - lamp.nx * 0.6,
    wy = lamp.y - lamp.ny * 0.6
  let found: { building: number; len: number; along: number } | undefined
  buildingsIn(wx - 1, wy - 1, wx + 1, wy + 1, (i) => {
    const ring = MAP.buildings[i]!.outer
    for (let k = 0; k < ring.length; k += 2) {
      const ax = ring[k]!,
        ay = ring[k + 1]!,
        bx = ring[(k + 2) % ring.length]!,
        by = ring[(k + 3) % ring.length]!
      const len = Math.hypot(bx - ax, by - ay),
        tx = (bx - ax) / len,
        ty = (by - ay) / len
      const along = (wx - ax) * tx + (wy - ay) * ty,
        off = (wx - ax) * ty - (wy - ay) * tx
      if (
        Math.abs(off) < 0.01 &&
        along >= 0 &&
        along <= len &&
        Math.abs(lamp.nx - ty) < 1e-9 &&
        Math.abs(lamp.ny + tx) < 1e-9
      )
        found = { building: i, len, along }
    }
  })
  return found
}

/** Asserts that each of the wall lanterns `walls` hangs 0.6 m out from a house wall between its windows, 2.7–4.2 m over the street, under the eaves, outside every house. */
export const assertOnWalls = (walls: ReadonlyArray<Lamp>): void => {
  for (const lamp of walls) {
    const wall = wallOf(lamp)
    assert.ok(
      wall !== undefined,
      `lamp at ${lamp.x.toFixed(1)}, ${lamp.y.toFixed(1)}: no wall behind it`,
    )
    const b = MAP.buildings[wall.building]!
    assert.notEqual(buildingStyleOf(b), "ruin")
    const count = windowCount(wall.len)
    for (let w = 0; w < count; w++)
      assert.ok(
        Math.abs(wall.along - ((w + 0.5) * wall.len) / count) >= 0.65,
        "clear of the windows",
      )
    const ground = terrainY(lamp.x - lamp.nx * 0.6 + lamp.nx, lamp.y - lamp.ny * 0.6 + lamp.ny),
      up = lamp.h - ground
    assert.ok(up >= 2.69 && up <= 4.21, `lantern ${up.toFixed(2)} m up`)
    assert.ok(lamp.h + 0.3 < eaveOf(b), "the bracket under the eaves")
    buildingsIn(lamp.x, lamp.y, lamp.x, lamp.y, (i) =>
      assert.ok(!pointInRing(lamp.x, lamp.y, MAP.buildings[i]!.outer), "the lantern hangs outside"),
    )
  }
}

/** The lit streets among `roads`: those out of tunnels whose class gets lamps. */
export const litOf = (roads: ReadonlyArray<Road>): Array<Road> =>
  roads.filter((r) => r.tunnel !== true && LIT.has(roadClassOf(r)))

/** Asserts that each of the wall lanterns `walls` stands by a lit carriageway of `lit` in a village, and no two of them within 18 m. */
export const assertOnLitStreets = (walls: ReadonlyArray<Lamp>, lit: ReadonlyArray<Road>): void => {
  for (const lamp of walls) {
    let road = Number.MAX_VALUE
    for (const r of lit)
      for (let k = 0; k + 3 < r.pts.length; k += 2) {
        const ax = r.pts[k]!,
          ay = r.pts[k + 1]!,
          dx = r.pts[k + 2]! - ax,
          dy = r.pts[k + 3]! - ay,
          l2 = dx * dx + dy * dy || 1
        const t = Math.min(1, Math.max(0, ((lamp.x - ax) * dx + (lamp.y - ay) * dy) / l2))
        road = Math.min(road, Math.hypot(ax + dx * t - lamp.x, ay + dy * t - lamp.y) - r.w / 2)
      }
    assert.ok(road < 6.6, `lamp ${road.toFixed(1)} m from the nearest lit carriageway`)
    let near = 0
    buildingsIn(lamp.x - 40, lamp.y - 40, lamp.x + 40, lamp.y + 40, () => near++)
    assert.ok(near >= 4, "in a village")
  }
  const sorted = [...walls].sort((a, b) => a.x - b.x)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]!.x - sorted[i]!.x < 18; j++) {
      assert.ok(
        Math.hypot(sorted[j]!.x - sorted[i]!.x, sorted[j]!.y - sorted[i]!.y) >= 18,
        "18 m apart",
      )
    }
  }
}

/** The boxes (36 vertices each) of `tris`, in a lamp's own frame: out from the wall (u), up (y) and across (v), each as [min, max]. */
export const boxesOf = (tris: Triangles, lamp: Lamp) => {
  const p = tris.position,
    found: Array<{ u: [number, number]; y: [number, number]; v: [number, number] }> = []
  for (let b = 0; b < p.length; b += 36 * 3) {
    const box: { u: [number, number]; y: [number, number]; v: [number, number] } = {
      u: [Infinity, -Infinity],
      y: [Infinity, -Infinity],
      v: [Infinity, -Infinity],
    }
    for (let i = b; i < b + 36 * 3; i += 3) {
      const dx = p[i]! - lamp.x,
        dz = p[i + 2]! + lamp.y,
        u = dx * lamp.nx - dz * lamp.ny,
        v = dx * lamp.ny + dz * lamp.nx
      for (const [k, value] of [
        ["u", u],
        ["y", p[i + 1]!],
        ["v", v],
      ] as const)
        box[k] = [Math.min(box[k][0], value), Math.max(box[k][1], value)]
    }
    found.push(box)
  }
  return found
}

/** Lamp `i`'s piece drawn into a sink of its own. */
export const drawnLamp = (pieces: ReturnType<typeof lampPieces>, i: number): Sink => {
  const sink: Sink = {
    solid: new Triangles(),
    decal: new Triangles(),
    water: new WaterTriangles(),
    glow: new Triangles(),
    pieces: [],
  }
  pieces[i]!.draw(() => sink, 0, 0)
  return sink
}

/** Asserts that each lantern of `indices` (into `streetLamps()`) is whole by day: solid from its foot to its cap on its axis, all of it inside the glass lit at night. */
export const assertLanternsWhole = (indices: Iterable<number>): void => {
  const lamps = streetLamps(),
    pieces = lampPieces()
  assert.equal(pieces.length, lamps.length)
  for (const i of indices) {
    const lamp = lamps[i]!,
      sink = drawnLamp(pieces, i)
    const solid = boxesOf(sink.solid, lamp),
      [glass] = boxesOf(sink.glow, lamp)
    assert.ok(glass !== undefined && sink.glow.position.length === 36 * 3, "one glass box")
    const axis = solid.filter((b) => b.u[0] < 0 && b.u[1] > 0 && b.v[0] < 0 && b.v[1] > 0)
    const foot = Math.min(...axis.map((b) => b.y[0])),
      cap = Math.max(...axis.filter((b) => b.y[0] < glass.y[1] + 0.01).map((b) => b.y[1]))
    assert.ok(foot < glass.y[0] && cap > glass.y[1], "foot under the glass, cap over it")
    for (let y = foot; y <= cap; y += 0.01)
      assert.ok(
        axis.some((b) => b.y[0] <= y + 1e-6 && b.y[1] >= y - 1e-6),
        `lamp ${i}: solid at ${(y - lamp.h).toFixed(2)} m from its centre`,
      )
    for (const b of solid.filter((b) => b.y[0] > glass.y[0] - 1e-6 && b.y[1] < glass.y[1] + 1e-6)) {
      for (const k of ["u", "v"] as const)
        assert.ok(
          b[k][0] >= glass[k][0] + 0.01 && b[k][1] <= glass[k][1] - 0.01,
          `lamp ${i}: the body 1 cm or more inside the glass (${k})`,
        )
    }
  }
}

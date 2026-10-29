import assert from "node:assert/strict"
import { test } from "node:test"

import { segDist2 } from "../../sim/collide.ts"
import { MAP } from "../../sim/map/index.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import { chunkOf } from "../chunks.ts"
import { BARRIER, ROAD_LIGHT } from "../crossings.ts"
import { linear, Triangles, type Piece, type Sink, WaterTriangles } from "../geometry.ts"
import { atGradeY, terrainY, yOf } from "../ground.ts"
import { linePieces } from "../lines.ts"
import { PALETTE } from "../palette.ts"
import { railPieces } from "../rail.ts"
import { stationPieces } from "../stations.ts"
import { bucketPieces } from "../world.ts"

const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})
const pieces = railPieces(linePieces())
/** Every piece drawn whole into one sink. */
const whole = (list: ReadonlyArray<Piece>): Sink => {
  const all = sink()
  for (const piece of list) piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
  return all
}
const all = whole(pieces)
type P3 = readonly [number, number, number]
/** A triangle's three corners, three space. */
type Tri = readonly [P3, P3, P3]
/** Triangle `t` (its first value's index) of `tris`. */
const triAt = (tris: Triangles, t: number): Tri => {
  const p = tris.position
  return [
    [p[t]!, p[t + 1]!, p[t + 2]!],
    [p[t + 3]!, p[t + 4]!, p[t + 5]!],
    [p[t + 6]!, p[t + 7]!, p[t + 8]!],
  ]
}
/** The triangles of `tris` in colour `hex`. */
const trianglesOf = (tris: Triangles, hex: number): Array<Tri> => {
  const [r, g, b] = linear(hex),
    found: Array<Tri> = []
  for (let t = 0; t < tris.position.length; t += 9)
    if (tris.color[t] === r && tris.color[t + 1] === g && tris.color[t + 2] === b)
      found.push(triAt(tris, t))
  return found
}
/** The render height of triangle `tri` over map (x, y), if it covers it (seen from above). */
const heightIn = ([a, b, c]: Tri, x: number, y: number): number | undefined => {
  const z = -y,
    d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
  if (Math.abs(d) < 1e-12) return undefined
  const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d,
    l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d,
    l3 = 1 - l1 - l2
  return l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9 ? l1 * a[1] + l2 * b[1] + l3 * c[1] : undefined
}
/** How far map point (x, y) lies from crossing `b`'s road centreline near the box, and its half width. */
const offRoad = (b: number, x: number, y: number) => {
  const crossing = MAP.railway.crossings[b]!,
    road = MAP.roads[crossing.road]!
  let d2 = Number.MAX_VALUE
  for (let k = 0; k + 3 < road.pts.length; k += 2)
    if (
      segDist2(
        crossing.x,
        crossing.y,
        road.pts[k]!,
        road.pts[k + 1]!,
        road.pts[k + 2]!,
        road.pts[k + 3]!,
      ).d2 <
      16 ** 2
    )
      d2 = Math.min(
        d2,
        segDist2(x, y, road.pts[k]!, road.pts[k + 1]!, road.pts[k + 2]!, road.pts[k + 3]!).d2,
      )
  return {
    off: Math.sqrt(d2),
    half: road.w / 2,
    near: Math.hypot(x - crossing.x, y - crossing.y) < 16,
  }
}

test("rail and stations: a chunk build keeps exactly its cut of the whole-map build", () => {
  for (const list of [pieces, stationPieces()]) {
    // The whole map drawn once, each triangle into the chunk `at` sends it to.
    const cut = new Map<number, Sink>()
    for (const piece of list)
      piece.draw(
        (x, y) => {
          const key = chunkOf(x, y)
          let s = cut.get(key)
          if (s === undefined) cut.set(key, (s = sink()))
          return s
        },
        0,
        Math.max(0, piece.pts.length / 2 - 2),
      )
    const byChunk = bucketPieces(list)
    let built = 0
    for (const [key, entries] of byChunk.entries()) {
      if (entries.length === 0) continue
      const mine = sink(),
        elsewhere = sink()
      for (let n = 0; n < entries.length; n += 3)
        list[entries[n]!]!.draw(
          (x, y) => (chunkOf(x, y) === key ? mine : elsewhere),
          entries[n + 1]!,
          entries[n + 2]!,
        )
      const expected = cut.get(key) ?? sink()
      for (const layer of ["solid", "decal", "glow"] as const) {
        assert.deepEqual(mine[layer].position, expected[layer].position, `chunk ${key} ${layer}`)
        assert.deepEqual(mine[layer].color, expected[layer].color, `chunk ${key} ${layer} colours`)
      }
      built++
    }
    assert.ok(built >= 5, `${built} chunks hold some`)
    assert.equal(
      [...cut.keys()].filter((key) => byChunk[key]!.length === 0).length,
      0,
      "nothing lands in a chunk that does not build it",
    )
  }
})

test("rail: nothing 3D stands in a crossing's carriageway (0.3 m in from its edges, which bend), and the ballast bed stops a metre short of it", () => {
  const solid = all.solid,
    ballast = linear(PALETTE.ballast)
  for (let t = 0; t < solid.position.length; t += 9) {
    const x = (solid.position[t]! + solid.position[t + 3]! + solid.position[t + 6]!) / 3,
      y = -(solid.position[t + 2]! + solid.position[t + 5]! + solid.position[t + 8]!) / 3
    const isBallast =
      solid.color[t] === ballast[0] &&
      solid.color[t + 1] === ballast[1] &&
      solid.color[t + 2] === ballast[2]
    for (const b of MAP.railway.crossings.keys()) {
      const { off, half, near } = offRoad(b, x, y)
      if (!near) continue
      assert.ok(
        off >= half - 0.3,
        `crossing ${b}: a solid triangle ${off.toFixed(2)} m from the road's centreline`,
      )
      if (isBallast)
        assert.ok(
          off >= half + 0.9,
          `crossing ${b}: ballast ${(off - half).toFixed(2)} m from the carriageway`,
        )
    }
  }
})

test("rail: at every crossing the panel, its rails and the stop lines lie over the road ribbon drawn there", () => {
  const roads = linePieces(),
    byChunk = bucketPieces(roads)
  for (const [b, crossing] of MAP.railway.crossings.entries()) {
    const key = chunkOf(crossing.x, crossing.y),
      chunk = sink(),
      elsewhere = sink()
    const entries = byChunk[key]!
    for (let n = 0; n < entries.length; n += 3)
      roads[entries[n]!]!.draw(
        (x, y) => (chunkOf(x, y) === key ? chunk : elsewhere),
        entries[n + 1]!,
        entries[n + 2]!,
      )
    const ribbon: Array<Tri> = []
    for (let t = 0; t < chunk.decal.position.length; t += 9) ribbon.push(triAt(chunk.decal, t))
    let over = 0
    for (const hex of [PALETTE.crossingPanel, PALETTE.railHead, PALETTE.marbleWhite])
      for (const tri of trianglesOf(all.decal, hex)) {
        // The middle and the corners pulled 5 cm toward it: what of this triangle shows.
        const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3,
          my = -(tri[0][2] + tri[1][2] + tri[2][2]) / 3
        if (Math.hypot(mx - crossing.x, my - crossing.y) > 16) continue
        for (const [px, , pz] of tri) {
          const l = Math.hypot(mx - px, my + pz) || 1,
            x = px + ((mx - px) / l) * 0.05,
            y = -pz + ((my + pz) / l) * 0.05,
            h = heightIn(tri, x, y)!
          const road = Math.max(...ribbon.map((r) => heightIn(r, x, y) ?? -Infinity))
          if (road === -Infinity) continue
          assert.ok(h > road + 0.005, `crossing ${b}: ${(h - road).toFixed(3)} m over the road`)
          over++
        }
      }
    assert.ok(over >= 24, `crossing ${b}: ${over} corners checked over its road`)
  }
})

// Regression: a tertiary road's centre dashes lay as high as the panels, so they cut through them.
test("rail: no road's centre dash lies under a crossing's panels", () => {
  const roads = whole(linePieces())
  const dashes = trianglesOf(roads.decal, PALETTE.marbleWhite).filter(([a]) =>
    MAP.railway.crossings.some((c) => Math.hypot(a[0] - c.x, -a[2] - c.y) < 20),
  )
  assert.ok(dashes.length > 0, "dashes near the crossings")
  const panels = trianglesOf(all.decal, PALETTE.crossingPanel)
  for (const [a, b, c] of dashes) {
    const x = (a[0] + b[0] + c[0]) / 3,
      y = -(a[2] + b[2] + c[2]) / 3
    assert.ok(
      panels.every((p) => heightIn(p, x, y) === undefined),
      `a dash under a panel at ${x.toFixed(1)}, ${y.toFixed(1)}`,
    )
  }
})

test("rail: drawn at reading widths, a 0.6 m sleeper every 1.2 m and 0.24 m rails on the bed", () => {
  // The longest straight at-grade segment of a running track.
  let best = { length: 0, ax: 0, ay: 0, bx: 0, by: 0 }
  for (const rail of MAP.rail) {
    if (rail.kind !== undefined || rail.bridge === true || rail.tunnel === true) continue
    for (let k = 0; k + 3 < rail.pts.length; k += 2) {
      const [ax, ay, bx, by] = [rail.pts[k]!, rail.pts[k + 1]!, rail.pts[k + 2]!, rail.pts[k + 3]!]
      if (Math.hypot(bx - ax, by - ay) > best.length)
        best = { length: Math.hypot(bx - ax, by - ay), ax, ay, bx, by }
    }
  }
  assert.ok(best.length > 20, `a ${best.length.toFixed(1)} m straight`)
  const { ax, ay, bx, by, length } = best,
    tx = (bx - ax) / length,
    ty = (by - ay) / length
  const near = (hex: number) =>
    trianglesOf(all.decal, hex).filter((tri) =>
      tri.every(([x, , z]) => segDist2(x, -z, ax, ay, bx, by).d2 < 9),
    )
  const sleepers = near(PALETTE.sleeperConcrete),
    rails = near(PALETTE.railSteel)
  const covered = (tris: typeof sleepers, x: number, y: number) =>
    tris.some((tri) => heightIn(tri, x, y) !== undefined)
  // Along the centreline in 5 cm steps: runs of sleeper and of gap.
  const runs: Array<number> = []
  let last: boolean | undefined
  for (let s = 2; s < length - 2; s += 0.05) {
    const on = covered(sleepers, ax + tx * s, ay + ty * s)
    if (on === last) runs.push(runs.pop()! + 0.05)
    else runs.push(0.05)
    last = on
  }
  const inner = runs.slice(1, -1)
  assert.ok(inner.length >= 10, `${inner.length} sleepers and gaps`)
  for (const run of inner) assert.ok(Math.abs(run - 0.6) < 0.11, `a run of ${run.toFixed(2)} m`)
  // Across the track at its middle: each rail 0.24 m wide, 1.2 texels at the driving zoom's 5 a metre (at 0.18 they crawled).
  const mx = (ax + bx) / 2,
    my = (ay + by) / 2
  let width = 0
  for (let d = -1.5; d <= 1.5; d += 0.01)
    if (covered(rails, mx - ty * d, my + tx * d)) width += 0.01
  assert.ok(Math.abs(width - 0.48) < 0.03, `${width.toFixed(2)} m of rail across the track`)
})

test("rail: people walk over the bed: its top stands 0.15 m or less over the terrain on 90 % of the line at grade", () => {
  const over: Array<number> = []
  for (const tri of trianglesOf(all.solid, PALETTE.ballast)) {
    const level = tri.every(([, y]) => Math.abs(y - tri[0][1]) < 0.1)
    if (!level) continue
    for (const [x, y, z] of tri)
      if (
        x > MAP.bounds.minX &&
        x < MAP.bounds.maxX &&
        -z > MAP.bounds.minY &&
        -z < MAP.bounds.maxY
      )
        over.push(y - terrainY(x, -z))
  }
  over.sort((a, b) => a - b)
  assert.ok(over.length > 10_000, `${over.length} corners of the bed's top`)
  const p90 = over[Math.floor(over.length * 0.9)]!
  assert.ok(p90 <= 0.15, `90 % of the top within ${p90.toFixed(3)} m over the terrain`)
})

test("rail: a portal at every tunnel mouth inside the map, its dark mouth facing out of the hill", () => {
  const dark = trianglesOf(all.solid, PALETTE.tunnelDark)
  let mouths = 0
  for (const [i, rail] of MAP.rail.entries()) {
    if (rail.tunnel !== true) continue
    for (const end of [0, rail.z.length - 1]) {
      const x = rail.pts[2 * end]!,
        y = rail.pts[2 * end + 1]!
      const shared = MAP.rail.some(
        (o, j) =>
          j !== i &&
          o.tunnel === true &&
          [0, o.z.length - 1].some((k) => o.pts[2 * k] === x && o.pts[2 * k + 1] === y),
      )
      const { minX, minY, maxX, maxY } = MAP.bounds
      if (shared || x <= minX + 0.5 || x >= maxX - 0.5 || y <= minY + 0.5 || y >= maxY - 0.5)
        continue
      mouths++
      const inner = end === 0 ? 1 : rail.z.length - 2,
        ox = x - rail.pts[2 * inner]!,
        oy = y - rail.pts[2 * inner + 1]!,
        l = Math.hypot(ox, oy)
      const mouth = dark.filter((tri) => tri.every(([px, , pz]) => Math.hypot(px - x, -pz - y) < 3))
      assert.ok(mouth.length >= 6, `the mouth at ${x}, ${y}: ${mouth.length} dark triangles`)
      const rail0 = yOf(rail.z[end]!)
      assert.ok(
        mouth.some((tri) => tri.some(([, h]) => h > rail0 + 5)),
        "a crown over the train",
      )
      // Its face looks out along the track (the dark is drawn on the outer face only).
      for (const [a, b, c] of mouth) {
        // The triangle's normal across (x, z of three space) against the way out (map ox, oy is three ox, −oy).
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
          nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        assert.ok((nx * ox - nz * oy) / l / Math.hypot(nx, nz) > 0.8, "facing out of the hill")
      }
    }
  }
  assert.ok(mouths >= 2, `${mouths} mouths`)
})

test("crossings: each arm hinged on its housing's face, the road light's black plate behind its lens, all clear of the trains", () => {
  const housings = trianglesOf(all.solid, PALETTE.barrierWhite),
    plates = trianglesOf(all.solid, PALETTE.signalBlack)
  let approaches = 0
  for (const crossing of CROSSINGS)
    for (const { pivot, entry, heading } of crossing.approaches) {
      approaches++
      const ux = Math.cos(heading),
        uy = Math.sin(heading)
      // Along the road from the pivot (into the box +) and right of the approach, for a three-space corner.
      const along = ([x, , z]: P3) => (x - pivot.x) * ux + (-z - pivot.y) * uy,
        right = ([x, , z]: P3) => (x - pivot.x) * uy - (-z - pivot.y) * ux
      const face = housings.filter((tri) =>
        tri.every(
          (p) =>
            Math.abs(along(p) + BARRIER.thick / 2 + 0.02) < 1e-6 &&
            right(p) > -1e-6 &&
            right(p) < 0.61,
        ),
      )
      assert.ok(face.length >= 2, "the housing's face 2 cm from the arm's, on the traffic's side")
      const road = atGradeY(entry.x, entry.y)
      assert.ok(
        face.some((tri) => tri.some(([, y]) => y < road + BARRIER.pivot)) &&
          face.some((tri) => tri.some(([, y]) => y > road + BARRIER.pivot)),
        "up past the pivot",
      )
      const plate = plates.filter((tri) =>
        tri.every(
          (p) =>
            along(p) < -BARRIER.thick / 2 &&
            along(p) > -(ROAD_LIGHT.proud - ROAD_LIGHT.deep / 2) &&
            Math.abs(right(p)) < 0.3,
        ),
      )
      const ys = plate.flatMap((tri) => tri.map(([, y]) => y))
      assert.ok(plate.length >= 2, "a plate between the arm and the lens")
      assert.ok(
        Math.min(...ys) < road + ROAD_LIGHT.up - ROAD_LIGHT.size / 2 &&
          Math.max(...ys) > road + ROAD_LIGHT.up + ROAD_LIGHT.size / 2,
        "as tall as the lens",
      )
    }
  assert.ok(approaches >= 2, `${approaches} approaches`)
  // Every fixed part stands clear of a train: its half width and 0.15 m off every track centreline.
  const clear = TRAINS.atr220.width / 2 + 0.15
  for (const hex of [
    PALETTE.barrierWhite,
    PALETTE.signalBlack,
    PALETTE.signalPole,
    PALETTE.cabinetGrey,
  ])
    for (const tri of trianglesOf(all.solid, hex))
      for (const [x, , z] of tri)
        for (const rail of MAP.rail)
          for (let k = 0; k + 3 < rail.pts.length; k += 2)
            assert.ok(
              segDist2(x, -z, rail.pts[k]!, rail.pts[k + 1]!, rail.pts[k + 2]!, rail.pts[k + 3]!)
                .d2 >=
                clear ** 2,
            )
})

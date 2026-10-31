// The checks rail.test.ts (the railway within 4 km of Monzone station) and rail.map-test.ts (the
// whole map's) share: the track, the level crossings' fixed parts and the tunnel portals as drawn.
import assert from "node:assert/strict"

import { segDist2 } from "../../sim/collide.ts"
import { MAP } from "../../sim/map/index.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import { chunkOf } from "../chunks.ts"
import { BARRIER, ROAD_LIGHT } from "../crossings.ts"
import { boxOver, linear, type Piece, type Sink, Triangles, WaterTriangles } from "../geometry.ts"
import { atGradeY, terrainY, yOf } from "../ground.ts"
import { linePieces } from "../lines.ts"
import { PALETTE } from "../palette.ts"
import { railPieces } from "../rail.ts"
import { bucketPieces } from "../world.ts"

const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})
/** The map's road and river pieces. */
export const lines = linePieces()
/** The map's rail pieces: the track, the crossings' fixed parts (over `lines`) and the portals. */
export const pieces = railPieces(lines)
/** Every piece of `list` drawn whole into one sink. */
const whole = (list: ReadonlyArray<Piece>): Sink => {
  const all = sink()
  for (const piece of list) piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
  return all
}
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

/** How much farther than its crossings and tunnel mouths a part of the railway draws its pieces, m: past every part a crossing or a portal stands. */
const MARGIN = 100

/** A part of the map's railway, drawn: what the checks below visit. */
export interface Railway {
  /** The rail pieces within `MARGIN` of its crossings and mouths, drawn whole into one sink. */
  readonly all: Sink
  /** Its level crossings: indices into `MAP.railway.crossings` and `CROSSINGS`. */
  readonly crossings: ReadonlyArray<number>
  /** The track within `MARGIN` of it: indices into `MAP.rail`. */
  readonly rail: ReadonlyArray<number>
  /** Whether a crossing or a tunnel mouth at (x, y) is its. */
  readonly holds: (x: number, y: number) => boolean
}

/**
 * The railway whose crossings and tunnel mouths lie within `reach` m of `spot` (all of the map's
 * with no spot): drawing only the pieces within `MARGIN` farther, a check of it reads only the
 * tiles round it.
 */
export const railwayNear = (
  spot?: { readonly x: number; readonly y: number },
  reach = Infinity,
): Railway => {
  const holds = (x: number, y: number) =>
    spot === undefined || Math.hypot(x - spot.x, y - spot.y) <= reach
  const reaches = (pts: ReadonlyArray<number>) => {
    if (spot === undefined) return true
    const [minX, minY, maxX, maxY] = boxOver(pts)
    return (
      Math.hypot(
        Math.max(minX - spot.x, 0, spot.x - maxX),
        Math.max(minY - spot.y, 0, spot.y - maxY),
      ) <=
      reach + MARGIN
    )
  }
  return {
    all: whole(pieces.filter((piece) => reaches(piece.pts))),
    crossings: [...MAP.railway.crossings.keys()].filter((b) =>
      holds(MAP.railway.crossings[b]!.x, MAP.railway.crossings[b]!.y),
    ),
    rail: [...MAP.rail.keys()].filter((i) => reaches(MAP.rail[i]!.pts)),
    holds,
  }
}

/** Nothing 3D stands in a crossing's carriageway (0.3 m in from its edges, which bend), and the ballast bed stops a metre short of it. */
export const checkCarriageways = ({ all, crossings }: Railway): void => {
  const solid = all.solid,
    ballast = linear(PALETTE.ballast)
  for (let t = 0; t < solid.position.length; t += 9) {
    const x = (solid.position[t]! + solid.position[t + 3]! + solid.position[t + 6]!) / 3,
      y = -(solid.position[t + 2]! + solid.position[t + 5]! + solid.position[t + 8]!) / 3
    const isBallast =
      solid.color[t] === ballast[0] &&
      solid.color[t + 1] === ballast[1] &&
      solid.color[t + 2] === ballast[2]
    for (const b of crossings) {
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
}

/** At each crossing the panel, its rails and the stop lines lie over the road ribbon drawn there. */
export const checkPanelsOverRoads = ({ all, crossings }: Railway): void => {
  const byChunk = bucketPieces(lines)
  for (const b of crossings) {
    const crossing = MAP.railway.crossings[b]!,
      key = chunkOf(crossing.x, crossing.y),
      chunk = sink(),
      elsewhere = sink()
    const entries = byChunk[key]!
    for (let n = 0; n < entries.length; n += 3)
      lines[entries[n]!]!.draw(
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
}

/** How far from a crossing a road's centre dash is looked for, m. */
const DASHES = 20

/**
 * No road's centre dash within `DASHES` m of a crossing lies under its panels; the roads drawn are
 * those whose points come within 25 m of one, where any such dash lies.
 */
export const checkDashes = ({ all, crossings }: Railway): void => {
  const boxes = crossings.map((b) => MAP.railway.crossings[b]!)
  const near = lines.filter((piece) => {
    const [minX, minY, maxX, maxY] = boxOver(piece.pts)
    return boxes.some(
      ({ x, y }) => x >= minX - 25 && x <= maxX + 25 && y >= minY - 25 && y <= maxY + 25,
    )
  })
  const dashes = trianglesOf(whole(near).decal, PALETTE.marbleWhite).filter(([a]) =>
    boxes.some((c) => Math.hypot(a[0] - c.x, -a[2] - c.y) < DASHES),
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
}

/** On the longest straight at-grade segment of running track, a 0.6 m sleeper every 1.2 m and two 0.24 m rails. */
export const checkReadingWidths = ({ all, rail: track }: Railway): void => {
  let best = { length: 0, ax: 0, ay: 0, bx: 0, by: 0 }
  for (const i of track) {
    const rail = MAP.rail[i]!
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
}

/** People walk over the bed: its top stands 0.15 m or less over the terrain on 90 % of the line at grade, over more than `least` corners. */
export const checkBed = ({ all }: Railway, least: number): void => {
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
  assert.ok(over.length > least, `${over.length} corners of the bed's top`)
  const p90 = over[Math.floor(over.length * 0.9)]!
  assert.ok(p90 <= 0.15, `90 % of the top within ${p90.toFixed(3)} m over the terrain`)
}

/** A portal at each of its tunnel mouths inside the map (at least `least`), its dark mouth facing out of the hill. */
export const checkPortals = ({ all, rail: track, holds }: Railway, least: number): void => {
  const dark = trianglesOf(all.solid, PALETTE.tunnelDark),
    tunnels = track.filter((i) => MAP.rail[i]!.tunnel === true)
  let mouths = 0
  for (const i of tunnels) {
    const rail = MAP.rail[i]!
    for (const end of [0, rail.z.length - 1]) {
      const x = rail.pts[2 * end]!,
        y = rail.pts[2 * end + 1]!
      // A tunnel piece sharing the end lies as near as this one.
      const shared = tunnels.some((j) => {
        const o = MAP.rail[j]!
        return (
          j !== i && [0, o.z.length - 1].some((k) => o.pts[2 * k] === x && o.pts[2 * k + 1] === y)
        )
      })
      const { minX, minY, maxX, maxY } = MAP.bounds
      if (
        !holds(x, y) ||
        shared ||
        x <= minX + 0.5 ||
        x >= maxX - 0.5 ||
        y <= minY + 0.5 ||
        y >= maxY - 0.5
      )
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
  assert.ok(mouths >= least, `${mouths} mouths`)
}

/**
 * At its crossings (at least `least` approaches) each arm hinged on its housing's face and the road
 * light's black plate behind its lens, and every fixed part drawn clear of a train on its track.
 */
export const checkArms = ({ all, crossings, rail: track }: Railway, least: number): void => {
  const housings = trianglesOf(all.solid, PALETTE.barrierWhite),
    plates = trianglesOf(all.solid, PALETTE.signalBlack)
  let approaches = 0
  for (const b of crossings)
    for (const { pivot, entry, heading } of CROSSINGS[b]!.approaches) {
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
  assert.ok(approaches >= least, `${approaches} approaches`)
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
        for (const i of track) {
          const rail = MAP.rail[i]!
          for (let k = 0; k + 3 < rail.pts.length; k += 2)
            assert.ok(
              segDist2(x, -z, rail.pts[k]!, rail.pts[k + 1]!, rail.pts[k + 2]!, rail.pts[k + 3]!)
                .d2 >=
                clear ** 2,
            )
        }
}

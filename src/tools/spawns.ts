// The clearance checks against walls and trunks, the station and Carabinieri POIs, the player's start
// and spawn, and parked-car spots.
import { staticGrid } from "../sim/collide.ts"
import type { Area, Poi, Spawn } from "../sim/map/index.ts"
import { pushTrunk, TRUNK } from "../sim/map/kinds.ts"
import type { BuildingF, RoadF } from "./features.ts"
import {
  arcLengths,
  centroid,
  hash01,
  pointAt,
  pointInRing,
  r1,
  ringBox,
  segDist2,
  segIndex,
} from "./geometry.ts"
import { inPlay } from "./play-area.ts"
import type { Region } from "./region.ts"

/** Segments farther than this from a clearance query are ignored, m (every caller asks less). */
const REACH = 3

/**
 * Clearance checks against flat (ax, ay, bx, by) `walls` plus the TRUNK square of every tree in
 * flat (x, y, scale) `trees`. Trees are indexed as points and their squares made on query, as
 * `wallsNear` does in the game: a segment per trunk edge would take gigabytes at a million trees.
 */
export const clearance = (walls: ReadonlyArray<number>, trees: ArrayLike<number>) => {
  const idx = segIndex<null>()
  for (let i = 0; i + 3 < walls.length; i += 4)
    idx.add(walls[i]!, walls[i + 1]!, walls[i + 2]!, walls[i + 3]!, REACH, null)
  const treesIn = staticGrid(
    trees.length / 3,
    (i) => [trees[3 * i]!, trees[3 * i + 1]!, trees[3 * i]!, trees[3 * i + 1]!],
    16,
  )
  const trunk: Array<number> = [],
    edge = { ax: 0, ay: 0, bx: 0, by: 0 }
  /** Calls `visit` for every wall and trunk edge within REACH of (x, y), with its squared distance. */
  const near = (
    x: number,
    y: number,
    visit: (
      seg: { readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number },
      d2: number,
    ) => void,
  ) => {
    idx.within(x, y, visit)
    const r = REACH + TRUNK
    treesIn(x - r, y - r, x + r, y + r, (i) => {
      trunk.length = 0
      pushTrunk(trunk, trees[3 * i]!, trees[3 * i + 1]!)
      for (let k = 0; k < trunk.length; k += 4) {
        ;[edge.ax, edge.ay, edge.bx, edge.by] = [
          trunk[k]!,
          trunk[k + 1]!,
          trunk[k + 2]!,
          trunk[k + 3]!,
        ]
        const { d2 } = segDist2(x, y, edge.ax, edge.ay, edge.bx, edge.by)
        if (d2 < REACH * REACH) visit(edge, d2)
      }
    })
  }
  const circle = (x: number, y: number, r: number) => {
    let ok = true
    near(x, y, (_, d2) => (ok &&= d2 >= r * r))
    return ok
  }
  /** No segment crosses or lies inside the oriented box (half-length hl along `angle`, half-width hw). */
  const box = (x: number, y: number, angle: number, hl: number, hw: number) => {
    const c = Math.cos(angle),
      s = Math.sin(angle)
    let ok = true
    near(x, y, (seg) => {
      const ax = (seg.ax - x) * c + (seg.ay - y) * s,
        ay = -(seg.ax - x) * s + (seg.ay - y) * c
      const dx = (seg.bx - x) * c + (seg.by - y) * s - ax,
        dy = -(seg.bx - x) * s + (seg.by - y) * c - ay
      let t0 = 0,
        t1 = 1
      for (const [p, q] of [
        [-dx, ax + hl],
        [dx, hl - ax],
        [-dy, ay + hw],
        [dy, hw - ay],
      ] as const) {
        if (p === 0) {
          if (q < 0) return
          continue
        }
        const r = q / p
        if (p < 0) t0 = Math.max(t0, r)
        else t1 = Math.min(t1, r)
      }
      if (t1 >= t0) ok = false
    })
    return ok
  }
  return { circle, box }
}
type Clearance = ReturnType<typeof clearance>

const CAR_HL = 3.7 / 2,
  CAR_HW = 1.7 / 2,
  CAR_GAP = 0.3,
  SPAWN_R = 1.3 // 1.2 m (map.map-test.ts) + rounding margin

/** POI `id` of `pois`: a test region may leave it out of play (undefined), while a shipped map without it has lost it from OSM and throws. */
export const regionPoi = (
  pois: ReadonlyArray<Poi>,
  id: number,
  { test }: Pick<Region, "test">,
): Poi | undefined => {
  const p = pois.find((q) => q.id === id)
  if (p === undefined && !test) throw new Error(`poi ${id} missing`)
  return p
}

/** Where the player's spawn is sought (`playerSpawn`'s target), and on which road. */
interface Start {
  readonly at: { readonly x: number; readonly y: number }
  readonly road?: RoadF
}

/**
 * Where the player's spawn is sought: by `police` (Lunigiana's Carabinieri) when given, else by the
 * traffic node nearest the origin, on its road (Cesena, and a test region that leaves the
 * Carabinieri out); undefined when the graph has no traffic edge.
 */
export const startNear = (
  graph: {
    readonly xy: ReadonlyArray<number>
    readonly edges: ReadonlyArray<number>
    readonly traffic: ReadonlyArray<number>
  },
  roads: ReadonlyArray<RoadF>,
  police: Start["at"] | undefined,
): Start | undefined => {
  if (police !== undefined) return { at: police }
  let start: Start | undefined,
    least = Infinity
  for (const edge of graph.traffic) {
    const node = graph.edges[3 * edge]!,
      x = graph.xy[2 * node]!,
      y = graph.xy[2 * node + 1]!,
      d = Math.hypot(x, y)
    if (d < least) [start, least] = [{ at: { x, y }, road: roads[graph.edges[3 * edge + 2]!]! }, d]
  }
  return start
}

/** A clear sidewalk spot outside building footprints, with an open walking route to the street. */
export const playerSpawn = (
  roads: ReadonlyArray<RoadF>,
  walk: Clearance,
  drive: Clearance,
  target: { readonly x: number; readonly y: number },
  buildings: ReadonlyArray<BuildingF>,
  preferred?: RoadF,
): Spawn => {
  const road = preferred ?? roads.find((r) => r.name === "Via Cesare Battisti")
  if (road === undefined) throw new Error("Player spawn road not found")
  const s = arcLengths(road.pts)
  let at = 0,
    best = Number.MAX_VALUE
  for (let d = 0; d <= s.at(-1)!; d += 0.5) {
    const p = pointAt(road.pts, s, d),
      dd = Math.hypot(p.x - target.x, p.y - target.y)
    if (dd < best) [at, best] = [d, dd]
  }
  for (let k = 0; k < 80; k++) {
    const d = at + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 1.5
    const p = pointAt(road.pts, s, Math.min(s.at(-1)!, Math.max(0, d)))
    const toward = Math.sign((target.x - p.x) * -p.ty + (target.y - p.y) * p.tx) || 1
    for (const side of [toward, -toward]) {
      const off = side * (road.w / 2 + 1),
        x = r1(p.x - p.ty * off),
        y = r1(p.y + p.tx * off)
      if (!inPlay(x, y, SPAWN_R) || buildings.some((building) => pointInRing(x, y, building.outer)))
        continue
      if (!walk.circle(x, y, SPAWN_R) || !drive.circle(x, y, SPAWN_R)) continue
      const steps = Math.ceil(Math.hypot(x - p.x, y - p.y) / 0.5)
      let connected = true
      for (let step = 0; step <= steps; step++) {
        const fraction = step / steps
        if (!walk.circle(x + (p.x - x) * fraction, y + (p.y - y) * fraction, SPAWN_R)) {
          connected = false
          break
        }
      }
      if (connected) return { x, y, angle: Math.round(Math.atan2(p.ty, p.tx) * 1000) / 1000 }
    }
  }
  throw new Error(`No clear player spawn on ${road.name ?? road.id}`)
}

interface ParkingInput {
  readonly roads: ReadonlyArray<RoadF>
  readonly buildings: ReadonlyArray<BuildingF>
  readonly areas: ReadonlyArray<Area>
  readonly junctions: ReadonlyArray<readonly [number, number]>
  readonly walk: Clearance
  readonly drive: Clearance
  readonly avoid: { readonly x: number; readonly y: number }
  /** The railway station, whose car parks within 150 m get spots; none where the play area leaves it out. */
  readonly station: { readonly x: number; readonly y: number } | undefined
  /** The Carabinieri station: its two nearest kerb spots are always kept (the sim parks their cars there); none where the play area leaves it out. */
  readonly police: { readonly x: number; readonly y: number } | undefined
  /** At-grade rail centrelines (flat x, y), sidings included, and whether trains run on each: no car is parked in a train's way. */
  readonly rail: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly running: boolean }>
  /** Level-crossing nodes: no car is parked near one. */
  readonly crossings: ReadonlyArray<readonly [number, number]>
}

const KERB_CLASSES = new Set(["tertiary", "unclassified", "residential"])
/**
 * A parked car's box keeps this far (m) from a track centreline: from a siding's, the ATR 220's
 * half-width (2.883 m wide) plus 0.5 m; from running track's, the clearance rule's 1.44 + 0.35 + 1
 * (`RAIL_CLEAR` in rail-clear.ts). The box, not its centre: a car whose centre stood 2.87 m from
 * Gragnola's through track had its side 2.02 m from it.
 */
const TRACK_CLEAR = { siding: 1.44 + 0.5, running: 2.8 }
/** No car is parked this near (m, in a straight line, so along any road too) a level crossing: the Codice della Strada (art. 158) bans stopping "in corrispondenza o in prossimità dei passaggi a livello". */
const CROSSING_FREE = 20

/** Distance from segment a–b to the box of half-length `hl` and half-width `hw` centred on (x, y) along `angle` (0 when they touch). */
const boxSegment = (
  x: number,
  y: number,
  angle: number,
  hl: number,
  hw: number,
  seg: { readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number },
): number => {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  const u = (px: number, py: number) =>
    [(px - x) * c + (py - y) * s, -(px - x) * s + (py - y) * c] as const
  const [au, av] = u(seg.ax, seg.ay),
    [bu, bv] = u(seg.bx, seg.by)
  // Liang–Barsky: does the segment enter the box?
  let t0 = 0,
    t1 = 1
  for (const [p, q] of [
    [au - bu, au + hl],
    [bu - au, hl - au],
    [av - bv, av + hw],
    [bv - av, hw - av],
  ] as const) {
    if (p === 0) {
      if (q < 0) t1 = -1
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
  }
  if (t1 >= t0) return 0
  const toBox = (pu: number, pv: number) =>
    Math.hypot(Math.max(0, Math.abs(pu) - hl), Math.max(0, Math.abs(pv) - hw))
  let d = Math.min(toBox(au, av), toBox(bu, bv))
  for (const [cu, cv] of [
    [hl, hw],
    [hl, -hw],
    [-hl, hw],
    [-hl, -hw],
  ] as const)
    d = Math.min(d, Math.sqrt(segDist2(cu, cv, au, av, bu, bv).d2))
  return d
}
/** Kerbside spots kept: one per this many buildings (Monzone's 800 buildings had 100), drawn in hash order so every village gets its share. */
const BUILDINGS_PER_SPOT = 8

/** Kerbside spots in built-up streets (right kerb, >= 9 m apart, >= 12 m from junctions; the two nearest the Carabinieri first) plus a few in the Monzone station car parks. */
export const parkedSpots = ({
  roads,
  buildings,
  areas,
  junctions,
  walk,
  drive,
  avoid,
  station,
  police,
  rail,
  crossings,
}: ParkingInput): Array<Spawn> => {
  // Bucketed lookups: building centroids within 40 m, junctions within 12 m, footprints by bounding box.
  const centroids = segIndex<null>(),
    corners = segIndex<null>()
  for (const b of buildings) {
    const [x, y] = centroid(b.outer)
    centroids.add(x, y, x, y, 40, null)
  }
  for (const [jx, jy] of junctions) corners.add(jx, jy, jx, jy, 12, null)
  const footprints = staticGrid(buildings.length, (i) => ringBox(buildings[i]!.outer), 32)
  const insideBuilding = (x: number, y: number) => {
    let inside = false
    footprints(x, y, x, y, (i) => (inside ||= pointInRing(x, y, buildings[i]!.outer)))
    return inside
  }
  const housesNear = (x: number, y: number) => {
    let n = 0
    centroids.within(x, y, () => n++)
    return n
  }
  const tracks = segIndex<number>()
  for (const { pts, running } of rail) {
    const clear = running ? TRACK_CLEAR.running : TRACK_CLEAR.siding
    tracks.addLine(pts, Math.hypot(CAR_HL, CAR_HW) + clear, clear)
  }
  const offTrack = (x: number, y: number, angle: number) => {
    let ok = crossings.every(([cx, cy]) => Math.hypot(cx - x, cy - y) >= CROSSING_FREE)
    tracks.within(x, y, (seg) => (ok &&= boxSegment(x, y, angle, CAR_HL, CAR_HW, seg) >= seg.data))
    return ok
  }
  const carriage = segIndex<RoadF>(),
    lanes = segIndex<RoadF>()
  for (const r of roads) {
    carriage.addLine(r.pts, r.w / 2 + 0.9, r)
    lanes.addLine(r.pts, r.w / 2, r)
  }
  /** Centre and corners of the car box grown by `gap`. */
  const box = (x: number, y: number, angle: number, gap: number) => {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      l = CAR_HL + gap,
      w = CAR_HW + gap
    return [
      [x, y] as const,
      ...[
        [l, w],
        [l, -w],
        [-l, w],
        [-l, -w],
      ].map(([u, v]) => [x + c * u! - s * v!, y + s * u! + c * v!] as const),
    ]
  }
  const fits = (x: number, y: number, angle: number) =>
    inPlay(x, y, 5) &&
    walk.circle(x, y, SPAWN_R) &&
    drive.circle(x, y, SPAWN_R) &&
    drive.box(x, y, angle, CAR_HL + CAR_GAP, CAR_HW + CAR_GAP) &&
    offTrack(x, y, angle) &&
    !insideBuilding(x, y) &&
    Math.hypot(x - avoid.x, y - avoid.y) > 6
  const candidates: Array<Spawn & { readonly order: number }> = []
  roads.forEach((r, ri) => {
    if (!KERB_CLASSES.has(r.cls) || r.bridge === true || r.tunnel === true) return
    const s = arcLengths(r.pts),
      total = s.at(-1)!
    for (let d = 6; d <= total - 6; d += 3) {
      const p = pointAt(r.pts, s, d),
        off = r.w / 2 + 1,
        x = p.x + p.ty * off,
        y = p.y - p.tx * off,
        angle = Math.atan2(p.ty, p.tx)
      if (corners.covers(p.x, p.y) || housesNear(x, y) < 2) continue
      if (carriage.covers(x, y) || box(x, y, angle, 0).some(([qx, qy]) => lanes.covers(qx, qy)))
        continue // overlaps a carriageway (another road, or this one on a bend)
      if (fits(x, y, angle)) candidates.push({ x, y, angle, order: hash01(ri, Math.round(d), 11) })
    }
  })
  const spots: Array<Spawn> = []
  const take = (list: ReadonlyArray<Spawn>, upTo: number) => {
    for (const c of list) {
      if (spots.length >= upTo) break
      if (spots.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= 9)) spots.push(c)
    }
  }
  if (police !== undefined) {
    const toPolice = (c: Spawn) => Math.hypot(c.x - police.x, c.y - police.y)
    take(
      [...candidates].sort((a, b) => toPolice(a) - toPolice(b)),
      2,
    )
  }
  take(
    candidates.sort((a, b) => a.order - b.order),
    Math.round(buildings.length / BUILDINGS_PER_SPOT),
  )
  // Station car parks: rows across the lot's longest edge, cars nose-in.
  for (const lot of areas.filter((a) => a.kind === "parking")) {
    const ring = lot.rings[0]!
    const n = ring.length / 2
    let cx = 0,
      cy = 0
    for (let i = 0; i < n; i++) [cx, cy] = [cx + ring[2 * i]! / n, cy + ring[2 * i + 1]! / n]
    if (station === undefined || Math.hypot(cx - station.x, cy - station.y) > 150) continue
    let ex = 1,
      ey = 0,
      longest = 0
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        dx = ring[2 * j]! - ring[2 * i]!,
        dy = ring[2 * j + 1]! - ring[2 * i + 1]!,
        l = Math.hypot(dx, dy)
      if (l > longest) [ex, ey, longest] = [dx / l, dy / l, l]
    }
    const angle = Math.atan2(ex, -ey) // facing across the row (perpendicular to the longest edge)
    const lotSpots: Array<Spawn> = []
    const grid: Array<readonly [number, number]> = []
    for (let u = -60; u <= 60; u += 2.7)
      for (let v = -60; v <= 60; v += 6) grid.push([cx + ex * u - ey * v, cy + ey * u + ex * v])
    grid.sort(
      (a, b) =>
        Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy) ||
        a[0] - b[0] ||
        a[1] - b[1],
    )
    for (const [x, y] of grid) {
      if (lotSpots.length >= 6) break
      const pts = box(x, y, angle, CAR_GAP)
      if (!pts.every(([qx, qy]) => pointInRing(qx, qy, ring))) continue
      if (pts.some(([qx, qy]) => carriage.covers(qx, qy))) continue // keep the lot's lanes and through roads free
      if (
        !fits(x, y, angle) ||
        ![...spots, ...lotSpots].every((o) => Math.hypot(o.x - x, o.y - y) >= 2.6)
      )
        continue
      lotSpots.push({ x, y, angle })
    }
    spots.push(...lotSpots)
  }
  return spots.map((p) => ({ x: r1(p.x), y: r1(p.y), angle: Math.round(p.angle * 1000) / 1000 }))
}

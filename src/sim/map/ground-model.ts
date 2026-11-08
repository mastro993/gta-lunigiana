/**
 * The ground model: where the ground is, in metres a.s.l., from ground data. The terrain as the mesh
 * draws it (each 4 m cell split along its south-west to north-east diagonal), station platforms at
 * their tops, at-grade roads floating `ROAD_LIFT` above their profile, and bridge decks and tunnels.
 * It reads no map: an adapter hands it the terrain's nodes, the road buckets holding a point and a
 * road's line near it (`GroundData`), so the game (`./ground.ts`, from the tiles) and the tests
 * (`wholeGround`, from whole data) read the same rules, and answer to the bit alike for the same data
 * (docs/adr/0003-ground-model.md). The map build still keeps its own copies (`meshZ`, `groundOf`,
 * `surfaceAt` in src/tools) until it moves onto the model (issue #113).
 *
 * @module map/ground-model
 */
import { pointInRing, segDist2 } from "../collide.ts"
import { type FacingAt, LEVEL } from "../sky/local.ts"
import { addToBuckets, bucketItems, type Buckets, emptyBuckets } from "./buckets.ts"
import { footReach, HALO, ON_DECK, ROAD_LIFT, ROAD_PAD, roadClassOf } from "./kinds.ts"

/** A road as the ground reads it: its index in the map's road list, its line (flat points, its profile per vertex) and what its class, width and kind make of it. */
export interface GroundRoad {
  readonly index: number
  readonly pts: ArrayLike<number>
  readonly z: ArrayLike<number>
  readonly cls: string
  readonly w: number
  /** Where people walk, m from the centreline (else `vergeOf`, `footReach`). */
  readonly verge?: number
  readonly bridge?: boolean
  readonly tunnel?: boolean
}

/** A station platform or rail-level walkway: its rings (outer, then holes) and its top along its axis, m a.s.l. */
export interface GroundPlatform {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  readonly axis: ReadonlyArray<number>
  readonly top: ReadonlyArray<number>
}

interface RoadSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly za: number
  readonly zb: number
  readonly half: number
  readonly lift: number
  /** Bridge or tunnel: the surface is the profile, never the terrain. */
  readonly lifted: boolean
  /** A bridge's or a tunnel's reach either side of its centreline to its walkers' verge (m): within it, someone on foot is on the deck or in the tunnel; 0 for a road at grade. */
  readonly foot: number
}

/** Road segments in the ground model's buckets, made by `groundBuckets` only. */
export type RoadBuckets = Buckets<RoadSegment>

/** Bucket side, m: 125 buckets to a tile's side, so a bucket lies in one tile. */
const BUCKET = 16

/**
 * Roads' segments in 16 m buckets by their carriageway's box, or a bridge's or tunnel's out to its
 * walkers' verges, by road then vertex: a bucket lists them in the order the ground blends them.
 * `roads` come in ascending `index`; it throws on any other order, which would change the blend's bits.
 */
export const groundBuckets = (roads: ReadonlyArray<GroundRoad>): RoadBuckets => {
  const out = emptyBuckets<RoadSegment>(BUCKET)
  let last = -1
  for (const road of roads) {
    if (road.index <= last) throw new Error(`ground: road ${road.index} after ${last}`)
    last = road.index
    const { pts, z } = road
    const lifted = road.bridge === true || road.tunnel === true
    const lift = ROAD_LIFT[roadClassOf(road)],
      verge = footReach(roadClassOf(road), road.w, road.verge)
    for (let k = 0; k + 1 < z.length; k++) {
      const s: RoadSegment = {
        ax: pts[2 * k]!,
        ay: pts[2 * k + 1]!,
        bx: pts[2 * k + 2]!,
        by: pts[2 * k + 3]!,
        za: z[k]!,
        zb: z[k + 1]!,
        half: road.w / 2 + ROAD_PAD,
        lift,
        lifted,
        foot: lifted ? verge : 0,
      }
      const reach = Math.max(s.half, s.foot)
      addToBuckets(
        out,
        s,
        Math.min(s.ax, s.bx) - reach,
        Math.min(s.ay, s.by) - reach,
        Math.max(s.ax, s.bx) + reach,
        Math.max(s.ay, s.by) + reach,
      )
    }
  }
  return out
}

/** What the ground model reads: the port each adapter fills. */
export interface GroundData {
  /** The terrain node cells are counted from, m, and the cells' side, m. */
  readonly anchor: { readonly x: number; readonly y: number }
  readonly cell: number
  /**
   * Writes the nodes of cell (fi, fj), counted from `anchor`, in whole decimetres into `out` as
   * south-west, south-east, north-west, north-east; any (fi, fj), the nodes past the grid's edge
   * the edge's (the apron beyond the map continues the landscape).
   */
  readonly corners: (fi: number, fj: number, out: Int32Array) => void
  /** The road buckets (`groundBuckets`) that hold every road reaching the 16 m bucket whose middle is (x, y). */
  readonly roadsAt: (x: number, y: number) => RoadBuckets
  /** Road `index`, its line whole, wherever (x, y) lies within `HALO` of it; else undefined or the road. */
  readonly road: (index: number, x: number, y: number) => GroundRoad | undefined
  /** Every platform, in the map's order. */
  readonly platforms: ReadonlyArray<GroundPlatform>
}

/** A platform's rings, its box and its top along its axis. */
interface PlatformShape {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  readonly box: readonly [number, number, number, number]
  readonly axis: ReadonlyArray<number>
  readonly top: ReadonlyArray<number>
}

/** How far apart `rolledTo` reads the ground along its way, m: a deck or a ramp rises less than ON_DECK over it up to a 50% grade. */
const STRIDE = 1

/** Ground within this of the terrain mesh is the terrain, m: under the lowest road's lift (`ROAD_LIFT.path`). */
const ON_TERRAIN = 0.01

/** How far over a wheel's ground (m) `drawnZ` looks for the surface drawn there: junction and hairpin ribbons stand up to 2.9 m over it. */
const DRAWN_REACH = 3

/** The ground's lookups over `data`. */
export const groundModel = (data: GroundData) => {
  const { x: AX, y: AY } = data.anchor,
    CELL = data.cell,
    readCorners = data.corners,
    roadsAt = data.roadsAt,
    roadOf = data.road

  /** Scratch for the four nodes of a cell. */
  const corners = new Int32Array(4)

  /**
   * Terrain elevation under (x, y) on the drawn mesh: each cell is split along its south-west to
   * north-east diagonal. The cell is measured from the anchor.
   */
  const terrainZ = (x: number, y: number): number => {
    const fx = (x - AX) / CELL,
      fy = (y - AY) / CELL
    const fi = Math.floor(fx),
      fj = Math.floor(fy)
    const u = fx - fi,
      v = fy - fj
    readCorners(fi, fj, corners)
    const sw = corners[0]! / 10,
      se = corners[1]! / 10,
      nw = corners[2]! / 10,
      ne = corners[3]! / 10
    return u >= v ? sw + (se - sw) * u + (ne - se) * v : sw + (ne - nw) * u + (nw - sw) * v
  }

  /**
   * The road segments reaching into bucket (bx, by) (the one holding (x, y) is (⌊x / 16⌋, ⌊y / 16⌋)), by road then vertex, as the
   * buckets holding the bucket's middle have them: a box lookup crossing a seam reads each bucket from its own tile.
   */
  const segmentsIn = (bx: number, by: number): ReadonlyArray<RoadSegment> =>
    bucketItems(roadsAt(BUCKET * bx + BUCKET / 2, BUCKET * by + BUCKET / 2), bx, by)

  /** Every platform in 16 m buckets by its box, in `data.platforms` order. */
  const platforms = emptyBuckets<PlatformShape>(BUCKET)
  for (const { rings, axis, top } of data.platforms) {
    const outer = rings[0]!
    let x0 = outer[0]!,
      y0 = outer[1]!,
      x1 = x0,
      y1 = y0
    for (let k = 2; k + 1 < outer.length; k += 2)
      [x0, y0, x1, y1] = [
        Math.min(x0, outer[k]!),
        Math.min(y0, outer[k + 1]!),
        Math.max(x1, outer[k]!),
        Math.max(y1, outer[k + 1]!),
      ]
    addToBuckets(platforms, { rings, box: [x0, y0, x1, y1], axis, top }, x0, y0, x1, y1)
  }

  /**
   * The top of the station platform or rail-level walkway at (x, y), m a.s.l.: its top at the
   * nearest point of its axis; undefined off every platform.
   */
  const platformTop = (x: number, y: number): number | undefined => {
    for (const p of bucketItems(platforms, Math.floor(x / BUCKET), Math.floor(y / BUCKET))) {
      const [x0, y0, x1, y1] = p.box
      if (x < x0 || x > x1 || y < y0 || y > y1 || !pointInRing(x, y, p.rings[0]!)) continue
      if (p.rings.some((hole, i) => i > 0 && pointInRing(x, y, hole))) continue
      let best = Number.MAX_VALUE,
        top = p.top[0]!
      for (let k = 0; k + 1 < p.top.length; k++) {
        const { d2, t } = segDist2(
          x,
          y,
          p.axis[2 * k]!,
          p.axis[2 * k + 1]!,
          p.axis[2 * k + 2]!,
          p.axis[2 * k + 3]!,
        )
        if (d2 < best) [best, top] = [d2, p.top[k]! + (p.top[k + 1]! - p.top[k]!) * t]
      }
      return top
    }
    return undefined
  }

  /** Surface elevation of a road whose profile is `z` (m a.s.l.) at (x, y): at-grade roads never dip under the terrain mesh. */
  const roadZ = (z: number, x: number, y: number, lift: number, lifted: boolean): number =>
    (lifted ? z : Math.max(z, terrainZ(x, y))) + lift

  /** Surface elevation of segment `s` at (x, y), or undefined when (x, y) lies farther than `reach` m off it. */
  const onSegment = (s: RoadSegment, x: number, y: number, reach = s.half): number | undefined => {
    const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
    return d2 > reach * reach ? undefined : roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, s.lifted)
  }

  /**
   * Surface elevation of bridge or tunnel segment `s` at (x, y) for someone on foot, or undefined beyond its walkers' verges: within
   * `foot` m of it, and past its ends no farther along it than its carriageway's `half` (a wheel's reach), so the verges at a span's
   * end do not hold a walker on its level over the next span rising from there (consecutive bridge ways), where a wheel goes on.
   */
  const onVerge = (s: RoadSegment, x: number, y: number): number | undefined => {
    const ex = s.bx - s.ax,
      ey = s.by - s.ay,
      l2 = ex * ex + ey * ey,
      u = l2 > 0 ? ((x - s.ax) * ex + (y - s.ay) * ey) / l2 : 0,
      past = Math.max(0, -u, u - 1)
    return past * past * l2 > s.half * s.half ? undefined : onSegment(s, x, y, s.foot)
  }

  /**
   * Where an actor at (x, y) stands, m a.s.l. On a platform the ground is its top (`platformTop`), or
   * the terrain where that stands higher (the back of Monzone's north platform rises to the street);
   * elsewhere the terrain. At-grade roads are part of the ground: where several overlap (a junction),
   * their surfaces blend, each weighted by the square of how deep inside its carriageway the point is,
   * so the ground stays continuous where their profiles disagree (by up to a few metres); then the
   * higher of that and the platform or terrain. Bridge decks and tunnels compete with that
   * ground for the one nearest `near`, the actor's previous elevation, so it stays on the level it
   * was on; without `near`, the highest wins. A deck within ON_DECK of `near` wins outright: on a ramp
   * over a gully the ground below can be nearer than the climbing deck, and the actor must not drop
   * onto it. With `verges`, for someone on foot, a deck or a tunnel reaches out to its walkers' verges.
   */
  const groundZ = (x: number, y: number, near?: number, verges = false): number => {
    const segments = segmentsIn(Math.floor(x / BUCKET), Math.floor(y / BUCKET))
    const terrain = terrainZ(x, y)
    let best = Math.max(terrain, platformTop(x, y) ?? terrain),
      sum = 0,
      weights = 0
    for (const s of segments) {
      if (s.lifted) continue
      const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
      if (d2 > s.half * s.half) continue
      const depth = s.half - Math.sqrt(d2),
        weight = depth * depth + 1e-9
      sum += weight * roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, false)
      weights += weight
    }
    if (weights > 0) best = Math.max(best, sum / weights)
    let score = near === undefined ? -best : Math.abs(best - near)
    for (const s of segments) {
      if (!s.lifted) continue
      const h = verges ? onVerge(s, x, y) : onSegment(s, x, y)
      if (h === undefined) continue
      const off = near === undefined ? 0 : Math.abs(h - near)
      const sc = near === undefined ? -h : off < ON_DECK ? off - ON_DECK : off
      if (sc < score) [best, score] = [h, sc]
    }
    return best
  }

  /**
   * The ground a wheel standing on ground at `z` (m a.s.l.) at (x0, y0) comes to rolling straight to (x1, y1), m a.s.l.: read every
   * STRIDE along the way, each the level nearest the last (`surface`, by default `groundZ` with the decks and tunnels out to their
   * walkers' verges), as a wheel finds its ground, so it keeps to the deck or the road it rolls on through a sag onto a deck or over
   * a crest into a tunnel, and drops off a deck's side. Where a vehicle's way comes to someone or something, it is on their level
   * when this stands within `LEVEL` of theirs.
   */
  const rolledTo = (
    x0: number,
    y0: number,
    z: number,
    x1: number,
    y1: number,
    surface: (x: number, y: number, near: number) => number = (x, y, near) =>
      groundZ(x, y, near, true),
  ): number => {
    const dx = x1 - x0,
      dy = y1 - y0,
      strides = Math.ceil(Math.sqrt(dx * dx + dy * dy) / STRIDE)
    let level = z
    for (let k = 1; k <= strides; k++)
      level = surface(x0 + (dx * k) / strides, y0 + (dy * k) / strides, level)
    return level
  }

  /**
   * Which way the ground at (x, y) on the level nearest `near` (m a.s.l., as `groundZ`) faces: where that ground is the terrain, its
   * triangle's (split as `terrainZ` splits the cell, the faces the renderer draws); on a road, a deck, a platform or in a tunnel,
   * `LEVEL`. The snow reads it (`groundAt`, src/sim/sky/local.ts): north faces hold it lower, steep ones none.
   */
  const facingAt: FacingAt = (x, y, near) => {
    if (Math.abs(groundZ(x, y, near) - terrainZ(x, y)) > ON_TERRAIN) return LEVEL
    const fx = (x - AX) / CELL,
      fy = (y - AY) / CELL
    const fi = Math.floor(fx),
      fj = Math.floor(fy)
    readCorners(fi, fj, corners)
    const sw = corners[0]!,
      se = corners[1]!,
      nw = corners[2]!,
      ne = corners[3]!
    // The slope east and north, m a metre, from the nodes in decimetres.
    const lower = fx - fi >= fy - fj,
      gx = (lower ? se - sw : ne - nw) / (10 * CELL),
      gy = (lower ? ne - se : nw - sw) / (10 * CELL),
      length = Math.sqrt(1 + gx * gx + gy * gy)
    return { north: -gy / length, up: 1 / length }
  }

  /**
   * The highest bridge deck within `pad` m past its edge at (x, y), m a.s.l., or undefined: someone on a bridge's verge (half a
   * metre past its carriageway, as the walkers keep to it) is on the bridge, not on the bank or in the river under it.
   */
  const deckNear = (x: number, y: number, pad: number): number | undefined => {
    let top: number | undefined
    const terrain = terrainZ(x, y)
    // Buckets hold segments by their carriageway's box: look in every bucket the pad reaches.
    for (let bx = Math.floor((x - pad) / BUCKET); bx <= Math.floor((x + pad) / BUCKET); bx++)
      for (let by = Math.floor((y - pad) / BUCKET); by <= Math.floor((y + pad) / BUCKET); by++)
        for (const s of segmentsIn(bx, by)) {
          if (!s.lifted) continue
          const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
          if (d2 > (s.half + pad) * (s.half + pad)) continue
          const h = roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, true)
          // A tunnel's floor under the hill is no deck.
          if (h >= terrain && (top === undefined || h > top)) top = h
        }
    return top
  }

  /**
   * Where someone on foot at (x, y) stands, m a.s.l.: keeping to the level nearest `near`, their last (`groundZ` with the decks and
   * tunnels out to their verges); with no previous height to go by, within a road bridge's or tunnel's reach to its verges, its deck
   * or its floor (people walk the road over or through, not the ground under the deck nor the bank over the tunnel), else the
   * highest ground there.
   */
  const footZ = (x: number, y: number, near?: number): number => {
    if (near !== undefined) return groundZ(x, y, near, true)
    for (const s of segmentsIn(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) {
      if (s.foot === 0) continue
      const h = onVerge(s, x, y)
      if (h !== undefined) return h
    }
    return groundZ(x, y)
  }

  /**
   * The surface elevation of road `road` (index into the map's roads) at the point of it nearest (x, y), m a.s.l., where (x, y) lies
   * within `HALO` of it: where a vehicle on that road stands, whatever is above or below. Undefined farther off, where nothing
   * stands on it.
   */
  const roadLevel = (road: number, x: number, y: number): number | undefined => {
    const info = roadOf(road, x, y)
    if (info === undefined) return undefined
    const { pts, z } = info
    let best = Number.MAX_VALUE,
      level = z[0]!
    for (let k = 0; k + 1 < z.length; k++) {
      const { d2, t } = segDist2(
        x,
        y,
        pts[2 * k]!,
        pts[2 * k + 1]!,
        pts[2 * k + 2]!,
        pts[2 * k + 3]!,
      )
      if (d2 < best) [best, level] = [d2, z[k]! + (z[k + 1]! - z[k]!) * t]
    }
    if (best > HALO * HALO) return undefined
    return roadZ(
      level,
      x,
      y,
      ROAD_LIFT[roadClassOf(info)],
      info.bridge === true || info.tunnel === true,
    )
  }

  /** The ground at (x, y) on the level of the terrain there: a road at grade, never a deck above or a tunnel below. */
  const atGrade = (x: number, y: number): number => groundZ(x, y, terrainZ(x, y))

  /**
   * What shows on top over ground `near` at (x, y): the highest at-grade road ribbon as it is drawn (each at its own profile), or the
   * terrain, within DRAWN_REACH over it, where the blended `groundZ` sits under a junction's or a hairpin's higher ribbon; else `near`
   * (a deck, or a tunnel's floor under the hill). Tyre marks lie on it.
   */
  const drawnZ = (x: number, y: number, near: number): number => {
    let top = near
    const over = (h: number) => h > top && h <= near + DRAWN_REACH
    if (over(terrainZ(x, y))) top = terrainZ(x, y)
    for (const s of segmentsIn(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) {
      const h = s.lifted ? undefined : onSegment(s, x, y)
      if (h !== undefined && over(h)) top = h
    }
    return top
  }

  return {
    terrainZ,
    platformTop,
    roadZ,
    groundZ,
    rolledTo,
    facingAt,
    deckNear,
    footZ,
    roadLevel,
    atGrade,
    drawnZ,
  }
}

/** The ground's lookups (`groundModel`). */
export type Ground = ReturnType<typeof groundModel>

/** Whole ground data: the terrain's nodes, every road (its index its place in `roads`) and every platform. */
export interface WholeGround {
  readonly anchor: GroundData["anchor"]
  readonly cell: number
  readonly corners: GroundData["corners"]
  readonly roads: ReadonlyArray<Omit<GroundRoad, "index">>
  readonly platforms: ReadonlyArray<GroundPlatform>
}

/** The ground over whole data, every road in one set of buckets: the whole-map check's and the tests' scenes. */
export const wholeGround = ({ anchor, cell, corners, roads, platforms }: WholeGround): Ground => {
  const all = roads.map((road, index): GroundRoad => ({ ...road, index }))
  const buckets = groundBuckets(all)
  return groundModel({
    anchor,
    cell,
    corners,
    roadsAt: () => buckets,
    road: (index) => all[index],
    platforms,
  })
}

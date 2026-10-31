// Collision walls: outlines of the blocked 4 m cells in the play area (steep ground, and apart the
// water's edge: the lines' beds and the lakes' and river polygons' cells; marching squares,
// simplified, <= 16 m pieces) plus building edges, barriers, the play area's outline and road-exit
// caps. Flat (ax, ay, bx, by) arrays.
import { fillPolygon, staticGrid } from "../sim/collide.ts"
import type { Area, Barrier } from "../sim/map/index.ts"
import { isDrivable, isMotorRoad, isWaterArea } from "../sim/map/kinds.ts"
import type { Rings } from "../sim/map/outline.ts"
import type { BuildingF, RoadF, WaterF } from "./features.ts"
import { flatRing, pointInRing, r1, ringBox, segDist2, segIndex, signedArea } from "./geometry.ts"
import { gridTiles } from "./grid-tiles.ts"
import { simplifyLoop, traceLoops } from "./loops.ts"
import { inPlay, OUTLINE } from "./play-area.ts"
import { anchorNode, cellSlope, type Grid } from "./terrain.ts"

const RUN = 16 // max wall segment length, m
const WALK_SLOPE = 35,
  DRIVE_SLOPE = 25
/** Wall simplification tolerance, m; road buffers below are widened by it so walls never reach w/2. */
const SLACK = 1.5

/** Pushes a-b as pieces no longer than `run`. */
const pushSplit = (
  out: Array<number>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  run = RUN,
) => {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / run))
  for (let k = 0; k < n; k++)
    out.push(
      r1(ax + ((bx - ax) * k) / n),
      r1(ay + ((by - ay) * k) / n),
      r1(ax + ((bx - ax) * (k + 1)) / n),
      r1(ay + ((by - ay) * (k + 1)) / n),
    )
}
/**
 * The play area's outline into every list in `outs`: each ring's edges in ring order, as pieces of
 * at most 64 m (so `walls.reach`, how far a wall sticks out of its midpoint, is 33 m). A rectangle
 * runs S, E, N, W from its south-west corner.
 */
export const pushOutline = (outs: ReadonlyArray<Array<number>>, rings: Rings): void => {
  for (const out of outs)
    for (const ring of rings)
      for (let i = 0, n = ring.length / 2; i < n; i++) {
        const j = (i + 1) % n
        pushSplit(out, ring[2 * i]!, ring[2 * i + 1]!, ring[2 * j]!, ring[2 * j + 1]!, 64)
      }
}
const pushPolyline = (out: Array<number>, pts: ReadonlyArray<number>, closed: boolean) => {
  const n = pts.length / 2
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n
    pushSplit(out, pts[2 * i]!, pts[2 * i + 1]!, pts[2 * j]!, pts[2 * j + 1]!)
  }
}

/** Walls around the blocked cells: traced loops, simplified within `tol` m, split into <= RUN m segments, into every list in `outs`. */
const boundary = (
  g: Pick<Grid, "cell" | "cols" | "rows" | "x0" | "y0">,
  blocked: Uint8Array,
  outs: ReadonlyArray<Array<number>>,
  tol = SLACK,
) => {
  for (const loop of traceLoops(g, blocked)) {
    const pts = simplifyLoop(loop, tol)
    for (let i = 0; i + 1 < pts.length; i++)
      for (const out of outs) pushSplit(out, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])
  }
}

/** Half-width of the corridor kept open where a road centreline runs through or along a footprint. */
const ARCH = 1.2
/** Raster cell for footprints cut by such a corridor, m. */
const FOOTPRINT_RES = 0.2
/** Smallest piece of a clipped footprint kept, m². */
const MIN_PIECE = 4

/**
 * Roads that clip the footprints they cross (`clipBuildings`): drivable, not tunnels. OSM and the
 * CTR disagree by a metre or two, and none of these is tagged as a passage, so the house gives way.
 * The rest (tunnels, paths and steps under arches) only open a corridor in the walls.
 */
const clips = (r: RoadF) => isDrivable(r.cls) && r.tunnel !== true

/** A centreline segment (ax, ay, bx, by) and its corridor half-width. */
type Cut = readonly [number, number, number, number, number]

/** The corridor of every centreline segment of `roads`, min(w/2, ARCH) m half-width (a motor road's whole w/2: no arch spans a motorway's or trunk road's tunnel), indexed by its box. */
const corridors = (roads: ReadonlyArray<RoadF>) => {
  const cuts: Array<Cut> = []
  for (const r of roads)
    for (let i = 0; i + 1 < r.pts.length; i++)
      cuts.push([
        r.pts[i]!.x,
        r.pts[i]!.y,
        r.pts[i + 1]!.x,
        r.pts[i + 1]!.y,
        isMotorRoad(r) ? r.w / 2 : Math.min(r.w / 2, ARCH),
      ])
  const index = staticGrid(
    cuts.length,
    (k) => {
      const [ax, ay, bx, by, h] = cuts[k]!
      return [
        Math.min(ax, bx) - h,
        Math.min(ay, by) - h,
        Math.max(ax, bx) + h,
        Math.max(ay, by) + h,
      ]
    },
    32,
  )
  /** The corridors that reach into the box. */
  return (x0: number, y0: number, x1: number, y1: number): Array<Cut> => {
    const out: Array<Cut> = []
    index(x0, y0, x1, y1, (k) => {
      const [ax, ay, bx, by, h] = cuts[k]!
      if (
        Math.max(ax, bx) > x0 - h &&
        Math.min(ax, bx) < x1 + h &&
        Math.max(ay, by) > y0 - h &&
        Math.min(ay, by) < y1 + h
      )
        out.push(cuts[k]!)
    })
    return out
  }
}
type Corridors = ReturnType<typeof corridors>

/**
 * Footprint `b` rasterised at FOOTPRINT_RES m minus the `roads` corridors that reach inside it, or
 * undefined when none does.
 */
const carved = (b: BuildingF, roads: Corridors) => {
  const [x0, y0, x1, y1] = ringBox(b.outer)
  const cuts = roads(x0, y0, x1, y1)
  if (cuts.length === 0) return
  const res = FOOTPRINT_RES,
    gx = x0 - res,
    gy = y0 - res
  const cw = Math.ceil((x1 - x0) / res) + 2,
    ch = Math.ceil((y1 - y0) / res) + 2
  const blocked = new Uint8Array(cw * ch)
  let cut = false
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const x = gx + (i + 0.5) * res,
        y = gy + (j + 0.5) * res
      if (!pointInRing(x, y, b.outer) || (b.holes ?? []).some((h) => pointInRing(x, y, h))) continue
      if (cuts.some(([ax, ay, bx, by, h]) => segDist2(x, y, ax, ay, bx, by).d2 < h * h)) cut = true
      else blocked[j * cw + i] = 1
    }
  return cut
    ? { grid: { cell: res, cols: cw + 1, rows: ch + 1, x0: gx, y0: gy }, blocked }
    : undefined
}

/**
 * Buildings with every corridor of a road that `clips` cut out of the footprint: one building per
 * piece left (same id, style and height; slivers under MIN_PIECE m² dropped), traced like the
 * walls, so the house drawn and the house collided with are one outline.
 */
export const clipBuildings = (
  buildings: ReadonlyArray<BuildingF>,
  roads: ReadonlyArray<RoadF>,
): Array<BuildingF> => {
  const clipping = corridors(roads.filter(clips))
  return buildings.flatMap((b) => {
    const c = carved(b, clipping)
    if (c === undefined) return [b]
    const rings = Array.from(traceLoops(c.grid, c.blocked), (loop) =>
      simplifyLoop(loop, 0.15).slice(0, -1),
    )
    const holes = rings
      .filter((r) => signedArea(r) < 0)
      .map((r) => flatRing(r, false))
      .filter((r) => r !== undefined)
    const { holes: _, ...rest } = b
    return rings.flatMap((r) => {
      const outer = signedArea(r) >= MIN_PIECE ? flatRing(r, true) : undefined
      if (outer === undefined) return []
      const inside = holes.filter((h) => pointInRing(h[0]!, h[1]!, outer))
      return [{ ...rest, outer, ...(inside.length > 0 ? { holes: inside } : {}) }]
    })
  })
}

/** Sample spacing along a barrier when looking for roads through it, m. */
const OPEN_STEP = 0.25

/**
 * Cliffs and walls with an opening wherever a road (not a tunnel) comes within w/2 of them. OSM
 * draws cliffs across the paths that climb through them and garden walls up to the road's
 * centreline; the way itself is open (a gap, a gate, steps cut in the rock). Original vertices are
 * kept; each opening ends at the last free sample. Guard rails run along their road and stay whole.
 * Tunnels open nothing (a bridge's parapets do open where the road runs on into one).
 */
export const openBarriers = (
  barriers: ReadonlyArray<Barrier>,
  roads: ReadonlyArray<RoadF>,
): Array<Barrier> => {
  const ways = segIndex<null>()
  for (const r of roads) if (r.tunnel !== true) ways.addLine(r.pts, r.w / 2, null)
  return opened(barriers, (x, y) => ways.covers(x, y))
}

/** `barriers` cut open wherever `open(x, y)` (a way passes) at OPEN_STEP m samples, as `openBarriers` says. */
const opened = (
  barriers: ReadonlyArray<Barrier>,
  open: (x: number, y: number) => boolean,
): Array<Barrier> =>
  barriers.flatMap((b) => {
    if (b.kind === "guard_rail") return [b]
    const out: Array<Barrier> = []
    let cur: Array<number> = [],
      last: readonly [number, number] | undefined
    const push = (x: number, y: number) => {
      if (cur.length === 0 || cur.at(-2) !== x || cur.at(-1) !== y) cur.push(x, y)
    }
    for (let i = 0; i + 3 < b.pts.length; i += 2) {
      const ax = b.pts[i]!,
        ay = b.pts[i + 1]!,
        bx = b.pts[i + 2]!,
        by = b.pts[i + 3]!
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / OPEN_STEP))
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const x = r1(ax + ((bx - ax) * k) / n),
          y = r1(ay + ((by - ay) * k) / n)
        if (open(x, y)) {
          if (last !== undefined) push(...last)
          if (cur.length >= 4) out.push({ kind: b.kind, pts: cur })
          cur = []
          last = undefined
        } else if (k === n || cur.length === 0) {
          push(x, y)
          last = undefined
        } else last = [x, y]
      }
    }
    if (cur.length >= 4) out.push({ kind: b.kind, pts: cur })
    return out
  })

/** A bridge's parapets stand this far beyond half its carriageway, m: where `lines.ts` draws them. */
const PARAPET = 0.25

/**
 * The parapets along both sides of every drivable bridge deck, as walls for the cars: one piece per
 * deck segment and side, opened (`openBarriers`) where any other road crosses under the bridge or
 * joins or carries on from its deck, tunnels and other pieces of the same bridge included (OSM
 * splits bridges). Walkers keep their verge across.
 */
const parapets = (roads: ReadonlyArray<RoadF>): Array<Barrier> => {
  const ways = segIndex<RoadF>()
  for (const r of roads) ways.addLine(r.pts, r.w / 2, r)
  return roads
    .filter((r) => r.bridge === true && isDrivable(r.cls))
    .flatMap((r) =>
      opened(
        r.pts.slice(1).flatMap((b, i) => {
          const a = r.pts[i]!,
            len = Math.hypot(b.x - a.x, b.y - a.y) || 1,
            nx = -(b.y - a.y) / len,
            ny = (b.x - a.x) / len
          return [-1, 1].map((side): Barrier => {
            const o = side * (r.w / 2 + PARAPET)
            return {
              kind: "wall",
              pts: [r1(a.x + nx * o), r1(a.y + ny * o), r1(b.x + nx * o), r1(b.y + ny * o)],
            }
          })
        }),
        (x, y) => ways.covers(x, y, (q) => q !== r),
      ),
    )
}

/**
 * Building edges into every list in `outs`. Where a tunnel, path or steps centreline comes within
 * min(w/2, ARCH) of the footprint, the walls are instead the outline of the footprint minus those
 * corridors: passages and steps under arches stay open, the interior stays closed.
 */
const pushBuilding = (outs: ReadonlyArray<Array<number>>, b: BuildingF, arches: Corridors) => {
  const c = carved(b, arches)
  if (c !== undefined) return boundary(c.grid, c.blocked, outs, 0.15)
  for (const ring of [b.outer, ...(b.holes ?? [])])
    for (const out of outs) pushPolyline(out, ring, true)
}

interface Walls {
  /** What stops anyone on foot: buildings, steep ground, barriers, the play area's outline. */
  readonly walk: Array<number>
  /** The water's edge (the lines' beds, the lakes and river polygons), which people and animals keep to by choice (none where a road crosses). */
  readonly shore: Array<number>
  /** What stops a vehicle: `walk`'s plus slopes over 25°, guard rails, parapets and road-exit caps; water is no wall. */
  readonly drive: Array<number>
  /** The water's edge for `drive` (open where a drivable road crosses): kept clear by traffic's dead ends and the spawns, never stored. */
  readonly driveShore: Array<number>
  readonly walkCells: number
  readonly shoreCells: number
  readonly driveCells: number
}

export const buildWalls = (
  g: Grid,
  roads: ReadonlyArray<RoadF>,
  water: ReadonlyArray<WaterF>,
  buildings: ReadonlyArray<BuildingF>,
  barriers: ReadonlyArray<Barrier>,
  areas: ReadonlyArray<Area>,
): Walls => {
  // The lakes' and river polygons' cells are water too: those whose centre each fills, as the
  // land cover paints them.
  const pools = areas
    .filter((a) => isWaterArea(a.kind))
    .map((a) => ({ rings: a.rings, box: ringBox(a.rings[0]!) }))
  const [ai, aj] = anchorNode(g)
  const wet = segIndex<null>(),
    banks = segIndex<null>()
  for (const w of water) {
    wet.addLine(w.pts, Math.max(w.w / 2, 2), null)
    // Carved banks of the larger streams are steep by construction and stay open: the way out of the water.
    if (w.w >= 4) banks.addLine(w.pts, w.bed + 2 * g.cell, null)
  }
  // So are a river polygon's, carved to its river's floor; a lake's bed only shelves, as does a
  // river polygon's whose river the map does not hold (still water).
  for (const a of areas)
    if (a.waters !== undefined)
      for (const ring of a.rings) banks.addLine([...ring, ring[0]!, ring[1]!], 2 * g.cell, null)
  // Road buffers are measured from cell centres; walls sit midway between centres (half a cell) and may
  // move SLACK when simplified, so pad the buffers by both to keep every wall at least w/2 from the centreline.
  const pad = g.cell / 2 + SLACK
  const near = segIndex<RoadF>()
  for (const r of roads) near.addLine(r.pts, Math.max(r.w / 2, 1.5) + 1.5 + pad, r) // tunnels too: they are short underpasses here
  const cw = g.cols - 1,
    ch = g.rows - 1
  const walkBlocked = new Uint8Array(cw * ch),
    shoreBlocked = new Uint8Array(cw * ch),
    driveBlocked = new Uint8Array(cw * ch),
    driveShoreBlocked = new Uint8Array(cw * ch)
  // Tile by tile: a tile's cells, and the ring of cells around them that the majority filter reads.
  for (const { span } of gridTiles(g)) {
    const ci0 = span.i0,
      ci1 = span.i0 + span.cols - 1,
      cj0 = span.j0,
      cj1 = span.j0 + span.rows - 1
    const ri0 = Math.max(0, ci0 - 1),
      rj0 = Math.max(0, cj0 - 1),
      rw = Math.min(cw, ci1 + 1) - ri0,
      rh = Math.min(ch, cj1 + 1) - rj0
    // Steep cells (bit 1 over WALK_SLOPE, bit 2 over DRIVE_SLOPE), but the carved banks.
    const raw = new Uint8Array(rw * rh)
    for (let j = rj0; j < rj0 + rh; j++)
      for (let i = ri0; i < ri0 + rw; i++) {
        const slope = cellSlope(g, i, j)
        if (
          slope > DRIVE_SLOPE &&
          !banks.covers(g.x0 + (i + 0.5) * g.cell, g.y0 + (j + 0.5) * g.cell)
        )
          raw[(j - rj0) * rw + i - ri0] = (slope > WALK_SLOPE ? 1 : 0) | 2
      }
    const inArea = new Uint8Array((ci1 - ci0) * (cj1 - cj0))
    for (const { rings, box } of pools)
      if (
        box[2] >= g.x0 + ci0 * g.cell &&
        box[0] <= g.x0 + ci1 * g.cell &&
        box[3] >= g.y0 + cj0 * g.cell &&
        box[1] <= g.y0 + cj1 * g.cell
      )
        fillPolygon(
          rings,
          g.ax,
          g.ay,
          g.cell,
          { c0: ci0 - ai, r0: cj0 - aj, cols: ci1 - ci0, rows: cj1 - cj0 },
          (k) => (inArea[k] = 1),
        )
    for (let j = cj0; j < cj1; j++)
      for (let i = ci0; i < ci1; i++) {
        // Majority-filtered (3x3, clamped to the grid) so the walls follow slopes, not single-cell bumps.
        let walkN = 0,
          driveN = 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const v =
              raw[
                (Math.min(ch - 1, Math.max(0, j + dj)) - rj0) * rw +
                  Math.min(cw - 1, Math.max(0, i + di)) -
                  ri0
              ]!
            walkN += v & 1
            driveN += v >> 1
          }
        const steepWalk = walkN >= 5,
          steepDrive = driveN >= 5
        const k = j * cw + i,
          x = g.x0 + (i + 0.5) * g.cell,
          y = g.y0 + (j + 0.5) * g.cell
        const water = wet.covers(x, y) || inArea[(j - cj0) * (ci1 - ci0) + i - ci0] === 1
        // Outside the play area the outline walls stop everyone: its cells stay open.
        if ((!water && !steepDrive && !steepWalk) || !inPlay(x, y)) continue
        let walkRoad = false,
          driveRoad = false,
          driveCrossing = false
        near.within(x, y, (s, d2) => {
          const d = Math.sqrt(d2),
            r = s.data
          if (d < Math.max(r.w / 2, 1.5) + pad) walkRoad = true // every class is walkable; paths keep >= 1.5 m
          if (isDrivable(r.cls)) {
            if (d < r.w / 2 + 1.5 + pad) driveRoad = true
            if (d < r.w / 2 + pad) driveCrossing = true // bridge deck or ford
          }
        })
        walkBlocked[k] = !walkRoad && steepWalk ? 1 : 0
        shoreBlocked[k] = !walkRoad && water && walkBlocked[k] === 0 ? 1 : 0
        driveBlocked[k] = steepDrive && !driveRoad ? 1 : 0
        driveShoreBlocked[k] = water && !driveCrossing && driveBlocked[k] === 0 ? 1 : 0
      }
  }
  const walk: Array<number> = [],
    shore: Array<number> = [],
    drive: Array<number> = [],
    driveShore: Array<number> = []
  boundary(g, walkBlocked, [walk])
  boundary(g, shoreBlocked, [shore])
  boundary(g, driveBlocked, [drive])
  boundary(g, driveShoreBlocked, [driveShore])
  const arches = corridors(roads.filter((r) => !clips(r)))
  for (const b of buildings) pushBuilding([walk, drive], b, arches)
  for (const b of barriers) {
    if (b.kind !== "guard_rail") pushPolyline(walk, b.pts, false)
    pushPolyline(drive, b.pts, false)
  }
  for (const p of parapets(roads)) pushPolyline(drive, p.pts, false)
  pushOutline([walk, drive], OUTLINE)
  // Road-block caps a few metres inside the outline where drivable roads leave the play area (their
  // cut ends, which have no id).
  for (const r of roads) {
    if (!isDrivable(r.cls)) continue
    for (const [end, prev] of [
      [r.pts[0]!, r.pts[1]!],
      [r.pts.at(-1)!, r.pts.at(-2)!],
    ] as const) {
      if (end.id !== undefined) continue
      const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1
      const tx = (end.x - prev.x) / len,
        ty = (end.y - prev.y) / len,
        cx = end.x - tx * 4,
        cy = end.y - ty * 4,
        h = r.w / 2 + 1
      pushSplit(drive, cx - ty * h, cy + tx * h, cx + ty * h, cy - tx * h)
    }
  }
  return {
    walk,
    shore,
    drive,
    driveShore,
    walkCells: walkBlocked.reduce((s, v) => s + v, 0),
    shoreCells: shoreBlocked.reduce((s, v) => s + v, 0),
    driveCells: driveBlocked.reduce((s, v) => s + v, 0),
  }
}

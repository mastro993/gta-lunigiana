// Collision walls: outlines of the blocked 4 m cells in the play area (steep ground, and apart the
// water's edge: the lines' beds and the lakes', river polygons' and the sea's cells; marching
// squares, simplified, <= 16 m pieces) plus building edges, barriers, the play area's outline and
// road-exit caps. Flat (ax, ay, bx, by) arrays.
import { fillPolygon } from "../sim/collide.ts"
import type { Area, Barrier } from "../sim/map/index.ts"
import { isDrivable, isWaterArea, UNDERPASS } from "../sim/map/kinds.ts"
import { exitCaps } from "./exit-caps.ts"
import type { BuildingF, RoadF, WaterF } from "./features.ts"
import { ringBox } from "./geometry.ts"
import { gridTiles } from "./grid-tiles.ts"
import { ARCH, houseArches, houseWalls, KERB, type Level, levelled } from "./house-walls.ts"
import { inPlay, OUTLINE } from "./play-area.ts"
import { segIndex } from "./spatial-index.ts"
import { anchorNode, cellSlope, type DmGrid } from "./terrain.ts"
import {
  append,
  boundary,
  opened,
  pushOutline,
  pushPolyline,
  pushSplit,
  runs,
} from "./wall-pieces.ts"

/** The steepest ground (°) a walker climbs off a road: a steeper cell is a `walk` wall. */
export const WALK_SLOPE = 35
const DRIVE_SLOPE = 25
/** Wall simplification tolerance, m; road buffers below are widened by it so walls never reach w/2. */
const SLACK = 1.5

/**
 * The barriers that stop vehicles alone: a guard rail, which a walker steps over, and a breakwater's
 * or a groyne's outline (shore.ts), its rocks too steep to drive up and walkable.
 */
const DRIVE_ONLY: ReadonlySet<string> = new Set(["guard_rail", "breakwater"])

/**
 * Cliffs and walls with an opening wherever a road (not a tunnel) comes within w/2 of them. OSM
 * draws cliffs across the paths that climb through them and garden walls up to the road's
 * centreline; the way itself is open (a gap, a gate, steps cut in the rock). Original vertices are
 * kept; each opening ends at the last free sample. A guard rail runs along its road, often inside
 * its w/2 as OSM draws it, so it opens only where a drivable road's middle min(w/2, ARCH) reaches
 * it: a track OSM draws leaving its road past the rail's end, which stops 0.7 m short of the
 * track's centreline; so does a breakwater's outline, which a path onto it leaves walled for
 * vehicles. Tunnels open nothing here: a bore opens them only at its level, as `barrierWalls`
 * reads the ground they stand on (a bridge's parapets do open where the road runs on into one:
 * parapets.ts).
 */
export const openBarriers = (
  barriers: ReadonlyArray<Barrier>,
  roads: ReadonlyArray<RoadF>,
): Array<Barrier> => {
  const ways = segIndex<null>(),
    lanes = segIndex<null>()
  for (const r of roads)
    if (r.tunnel !== true) {
      ways.addLine(r.pts, r.w / 2, null)
      if (isDrivable(r.cls)) lanes.addLine(r.pts, Math.min(r.w / 2, ARCH), null)
    }
  const way = (x: number, y: number) => ways.covers(x, y),
    lane = (x: number, y: number) => lanes.covers(x, y)
  return barriers.flatMap((b) => opened([b], DRIVE_ONLY.has(b.kind) ? lane : way))
}

/**
 * A road tunnel's bore as the barriers meet it: its road's index in the map's roads, the half-width
 * of its carriageway and of the middle a vehicle keeps to (min(w/2, ARCH), 0 on a way no vehicle
 * drives), m, and its clear height, m (its `maxheight`, else UNDERPASS).
 */
interface Bore {
  readonly road: number
  readonly half: number
  readonly lane: number
  readonly clear: number
}

/** The road tunnels' bores (no building passage) of `roads`, each segment reaching its carriageway and a KERB either side, where its traffic goes. */
export const boresOf = (roads: ReadonlyArray<RoadF>) => {
  const bores = segIndex<Bore>()
  roads.forEach((r, road) => {
    if (r.tunnel === true && r.passage !== true)
      bores.addLine(r.pts, r.w / 2 + KERB, {
        road,
        half: r.w / 2,
        lane: isDrivable(r.cls) ? Math.min(r.w / 2, ARCH) : 0,
        clear: r.maxheight ?? UNDERPASS,
      })
  })
  return bores
}

/**
 * Barrier `barrier`'s walls, flat (ax, ay, bx, by) in pieces of at most 16 m, and each one's level,
 * m a.s.l. (NaN for one that stands at every level), as the road tunnels' `bores` meet it: where a
 * bore passes at the level of the `terrain` the barrier stands on (under the bore's clear height over
 * its road, `level`), it opens the barrier as a road at grade does (`openBarriers`: a wall or a cliff
 * over its w/2, a guard rail or a breakwater over its middle min(w/2, ARCH) on a drivable way only);
 * where one passes the clear height or more under that terrain, the barrier within its carriageway
 * and a KERB, where its traffic goes, takes the terrain's level along it (`levelled`), as a house's
 * walls over a bore deep under it do (`houseWalls`), so it stops anyone on the ground there and
 * nothing in the bore; the rest stands at every level. Walled at every level, the jersey barrier
 * 887066016 between the underpasses of Via Alcide De Gasperi and the container terminal's service
 * road at (−17097, −1238) stopped the traffic in the unclassified road's bore 1352409570 5.3 m
 * under it, and the concrete wall 887046364, drawn from 2.4 m inside that bore's north mouth on its
 * floor up the cutting, stood 0.95 m off its centreline. Opened over the bore's middle 1.2 m alone,
 * that wall's end stood 1.37 m off it, in the northbound lane; levelled along its whole 16 m piece
 * over the bore, the jersey barrier took the railway embankment's 18.1 m 10.6 m off the bore, over
 * the underpass roads at 16.0 and 16.3 m beside it.
 */
export const barrierWalls = (
  barrier: Barrier,
  bores: ReturnType<typeof boresOf>,
  level: Level,
  terrain: (x: number, y: number) => number,
): { readonly walls: Array<number>; readonly levels: Array<number> } => {
  const driveOnly = DRIVE_ONLY.has(barrier.kind)
  /** -1 where a bore on the barrier's level opens it at (x, y), 1 where one passes deep under it, else 0. */
  const classOf = (x: number, y: number): number => {
    let open = false,
      deep = false,
      ground = Number.NaN
    bores.within(x, y, ({ data }, d2) => {
      if (Number.isNaN(ground)) ground = terrain(x, y)
      const opens = driveOnly ? data.lane : data.half
      if (ground - level(data.road, x, y) >= data.clear) deep = true
      else if (d2 < opens * opens) open = true
    })
    return open ? -1 : deep ? 1 : 0
  }
  const walls: Array<number> = [],
    levels: Array<number> = []
  for (const { cls, pts } of runs(barrier.pts, classOf)) {
    const pieces: Array<number> = []
    pushPolyline(pieces, pts, false)
    for (let w = 0; w < pieces.length; w += 4) {
      const [ax, ay, bx, by] = [pieces[w]!, pieces[w + 1]!, pieces[w + 2]!, pieces[w + 3]!]
      for (const [px, py, qx, qy, z] of cls === 1
        ? levelled(ax, ay, bx, by, terrain)
        : [[ax, ay, bx, by, Number.NaN] as const]) {
        walls.push(px, py, qx, qy)
        levels.push(z)
      }
    }
  }
  return { walls, levels }
}

interface Walls {
  /** What stops anyone on foot: buildings, steep ground, barriers, the play area's outline. */
  readonly walk: Array<number>
  /** The water's edge (the lines' beds, the lakes, river polygons and the sea), which people and animals keep to by choice (none where a road crosses). */
  readonly shore: Array<number>
  /** What stops a vehicle: `walk`'s plus slopes over 25°, guard rails, breakwaters, parapets and road-exit caps; water is no wall. */
  readonly drive: Array<number>
  /** The water's edge for `drive` (open where a drivable road crosses): kept clear by traffic's dead ends and the spawns, never stored. */
  readonly driveShore: Array<number>
  /**
   * Each walk and drive wall's level, m a.s.l.: a parapet's is its deck's top, a wall under a deck's
   * and a house's or a barrier's over a bore deep under it the ground's there, and it stops only a body whose
   * ground stands within ONE_LEVEL of it; NaN for every other wall, which stops anyone.
   */
  readonly levels: { readonly walk: Array<number>; readonly drive: Array<number> }
  readonly walkCells: number
  readonly shoreCells: number
  readonly driveCells: number
}

/** Walls with a level: flat (ax, ay, bx, by) pieces and each one's level, m a.s.l. */
export interface Levelled {
  readonly walls: ReadonlyArray<number>
  readonly levels: ReadonlyArray<number>
}

/**
 * The walls on grid `g` (`Walls`): the bridges' `parapets` (parapets.ts) among the drive walls, and
 * the walls `under` the decks (deck-walls.ts) last of the walk and the drive walls.
 */
export const buildWalls = (
  g: DmGrid,
  roads: ReadonlyArray<RoadF>,
  water: ReadonlyArray<WaterF>,
  buildings: ReadonlyArray<BuildingF>,
  barriers: ReadonlyArray<Barrier>,
  areas: ReadonlyArray<Area>,
  parapets: Levelled,
  under: { readonly walk: Levelled; readonly drive: Levelled },
  heights: {
    /** Each building's floor, m a.s.l. (`floorsOf` in floors.ts). */
    readonly floors: ReadonlyArray<number>
    /** Road `road`'s level at its point nearest (x, y), m a.s.l. (`levelOn` in build-ground.ts). */
    readonly level: (road: number, x: number, y: number) => number
    /** The terrain's level at (x, y), m a.s.l. */
    readonly terrain: (x: number, y: number) => number
  },
): Walls => {
  // The lakes' and river polygons' cells are water too: those whose centre each fills, as the
  // land cover paints them; and the sea's, but where the ground at a cell's centre stands over its
  // level: a breakwater or a pier's deck raised in it (shore.ts) is dry land.
  const pools = areas
    .filter((a) => isWaterArea(a.kind))
    .map((a) => ({
      rings: a.rings,
      box: ringBox(a.rings[0]!),
      dryOver: a.kind === "sea" ? a.level : undefined,
    }))
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
  // The listed tiles alone: an unlisted one's cells lie outside the play area, where none is
  // blocked, and its nodes, which the ring and the slopes beside it read, are the edge's
  // (`extendEdges` in grid-tiles.ts).
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
    /** The ground at the centre of the block's cell k, m: on the diagonal the terrain splits it along. */
    const centreZ = (k: number) => {
      const i = ci0 + (k % (ci1 - ci0)),
        j = cj0 + Math.floor(k / (ci1 - ci0))
      return (g.dm[j * g.cols + i]! / 10 + g.dm[(j + 1) * g.cols + i + 1]! / 10) / 2
    }
    for (const { rings, box, dryOver } of pools)
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
          (k) => {
            if (dryOver === undefined || centreZ(k) <= dryOver) inArea[k] = 1
          },
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
  boundary(g, walkBlocked, [walk], SLACK)
  boundary(g, shoreBlocked, [shore], SLACK)
  boundary(g, driveBlocked, [drive], SLACK)
  boundary(g, driveShoreBlocked, [driveShore], SLACK)
  // The houses' walls, and the levels of those over a bore deep under them, by wall.
  const arches = houseArches(roads)
  const walkLevels = new Map<number, number>(),
    driveLevels = new Map<number, number>()
  buildings.forEach((b, i) => {
    const { walls, levels } = houseWalls(
      b,
      arches,
      heights.floors[i] ?? Number.NaN,
      heights.level,
      heights.terrain,
    )
    for (const [out, by] of [
      [walk, walkLevels],
      [drive, driveLevels],
    ] as const) {
      levels.forEach((z, w) => {
        if (!Number.isNaN(z)) by.set(out.length / 4 + w, z)
      })
      append(out, walls)
    }
  })
  // The barriers' walls, and the levels of those over a bore deep under them.
  const bores = boresOf(roads)
  for (const b of barriers) {
    const { walls, levels } = barrierWalls(b, bores, heights.level, heights.terrain)
    for (const [out, by] of DRIVE_ONLY.has(b.kind)
      ? ([[drive, driveLevels]] as const)
      : ([
          [walk, walkLevels],
          [drive, driveLevels],
        ] as const)) {
      levels.forEach((z, w) => {
        if (!Number.isNaN(z)) by.set(out.length / 4 + w, z)
      })
      append(out, walls)
    }
  }
  const first = drive.length / 4
  append(drive, parapets.walls)
  pushOutline([walk, drive], OUTLINE)
  // Road-block caps a few metres inside the outline where drivable roads leave the play area.
  for (const cap of exitCaps(roads)) pushSplit(drive, ...cap)
  // The parapets' levels, and the walls under the decks' after every other; every other wall
  // stands at every level.
  const levels = {
    walk: [
      ...Array.from({ length: walk.length / 4 }, (_, w) => walkLevels.get(w) ?? NaN),
      ...under.walk.levels,
    ],
    drive: [
      ...Array.from(
        { length: drive.length / 4 },
        (_, w) => parapets.levels[w - first] ?? driveLevels.get(w) ?? NaN,
      ),
      ...under.drive.levels,
    ],
  }
  append(walk, under.walk.walls)
  append(drive, under.drive.walls)
  return {
    walk,
    shore,
    drive,
    driveShore,
    levels,
    walkCells: walkBlocked.reduce((s, v) => s + v, 0),
    shoreCells: shoreBlocked.reduce((s, v) => s + v, 0),
    driveCells: driveBlocked.reduce((s, v) => s + v, 0),
  }
}

/**
 * Running water as heard from a point: rivers and streams as incoherent line sources (`lineLevel`),
 * fountains and the Cascata di Equi as point sources. Loudness per reach comes from the water's
 * width (a stand-in for discharge) and its grade smoothed over ±40 m (rapids against calm reaches),
 * calibrated at 2 m from the bank: the Torrente Lucido ≈ 70 dB(A) in rapids and ≈ 62 on calm
 * reaches, the 8 m torrents ≈ 64, the 4 m named streams ≈ 55, the unnamed 2 m gullies ≈ 40. The
 * reaches come from the water pieces of the tiles in memory, each whole in every tile round it,
 * and are heard in the whole map's order, so the levels sum as one broad phase over every reach
 * of the map summed them.
 *
 * @module audio/places/water
 */
import { MAP, type Water } from "../../sim/map/index.ts"
import { WATER_VERTICES } from "../../sim/map/kinds.ts"
import { cellBox, type CellGrid, cellGrid, queryCells } from "../../sim/map/lattice.ts"
import { derived, residentTile, type Tile, tilesOver } from "../../sim/map/tiles.ts"
import { channelOf } from "../../sim/water/channel.ts"
import { segDist2 } from "../../tools/geometry.ts"
import { lineLevel, NIGHT_DB, spreading, type LineSegment } from "../acoustics.ts"
import { smoothstep } from "../buffers.ts"
import { terrainAt } from "../ground.ts"

/** A body of water heard from a point: its nearest point (z the water surface) and level there, dB(A). */
export interface WaterHeard {
  /** Stable per body: the river's name (its pieces merged), or the piece's or fountain's id. */
  readonly key: string
  readonly body: "fountain" | "stream" | "river"
  /** 0 (trickle) … 1 (the Lucido in rapids). */
  readonly flow: number
  readonly level: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/** A straight reach of one body: its line-source power, and what the synth needs at its nearest point. */
interface Reach extends LineSegment {
  readonly key: string
  readonly river: boolean
  readonly flow: number
  readonly az: number
  readonly bz: number
}

/** Sound power Lw′ (dB per metre) by width (m), midway between calm and rapids: the calibration above. */
const POWER: ReadonlyArray<readonly [number, number]> = [
  [2, 47],
  [4, 63],
  [8, 81],
  [14, 81.5],
]
/** Grades from calm (1 %) to rapids (6 %) move the power from −4 to +4 dB. */
const CALM = 0.01,
  RAPIDS = 0.06,
  RAPIDS_DB = 8
/** Flow is the width relative to the Lucido's, `CALM_FLOW` of it on calm reaches. */
const WIDEST = 14,
  CALM_FLOW = 0.4
/** Fountains, taps and the lavoir, dB(A) at 1 m. */
const FOUNTAIN_DB = 65
/** The Cascata di Equi on the Torrente Fagli, dB(A) at 1 m: hard-coded, only the raw OSM has it. */
const CASCATA = { key: "water:Cascata di Equi", x: 1835, y: 530, z: 259, level: 80 } as const
/** Bodies fainter than this at the listener are left out: the hard cull of the masking rule at its stillest, a still night's floor. */
const FLOOR = NIGHT_DB - 15
/** The farthest a body is looked for, m. */
const FARTHEST = 400

/** `POWER` at width `w`, linear between the rows. */
const powerOf = (w: number): number => {
  if (w <= POWER[0]![0]) return POWER[0]![1]
  const i = POWER.findIndex(([width]) => width >= w)
  if (i < 0) return POWER.at(-1)![1]
  const [w0, p0] = POWER[i - 1]!,
    [w1, p1] = POWER[i]!
  return p0 + ((p1 - p0) * (w - w0)) / (w1 - w0)
}

/** The reaches of one water piece, with their grade-dependent power and flow (the grade over ±40 m, `channelOf`'s). */
const reachesOf = (water: Water): Array<Reach> => {
  const { pts, z, w } = water,
    n = pts.length / 2
  const { grade } = channelOf(water)
  const key = `water:${water.name ?? water.id}`,
    river = water.kind === "river" || w >= 8
  const out: Array<Reach> = []
  for (let i = 0; i + 1 < n; i++) {
    const rapids = smoothstep(CALM, RAPIDS, (grade[i]! + grade[i + 1]!) / 2)
    out.push({
      key,
      river,
      ax: pts[2 * i]!,
      ay: pts[2 * i + 1]!,
      bx: pts[2 * i + 2]!,
      by: pts[2 * i + 3]!,
      az: z[i]!,
      bz: z[i + 1]!,
      lw: powerOf(w) + RAPIDS_DB * (rapids - 0.5),
      flow: Math.min(1, w / WIDEST) * (CALM_FLOW + (1 - CALM_FLOW) * rapids),
    })
  }
  return out
}

/** Cell side of the reaches' broad phase, m, on the rivers' lattice (`MAP.vectors.lattice.water`). */
const CELL = 32

/** A tile's reaches, and their ids (`WATER_VERTICES` × the piece's index in the whole map's water, plus the reach's first vertex), gridded. */
interface Reaches {
  readonly reaches: ReadonlyArray<Reach>
  readonly grid: CellGrid
}

/** The reaches of every water piece a tile holds (whole: the grade reads the piece end to end), gridded on first use. */
const reachesOfTile = derived((tile: Tile): Reaches => {
  const { ids, items } = tile.vectors.water,
    reaches: Array<Reach> = [],
    keys: Array<number> = []
  items.forEach((water, k) => {
    reachesOf(water).forEach((reach, i) => {
      reaches.push(reach)
      keys.push(ids[k]! * WATER_VERTICES + i)
    })
  })
  const boxOf = (i: number) => {
    const { ax, ay, bx, by } = reaches[i]!
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)] as const
  }
  return {
    reaches,
    grid: cellGrid(reaches.length, boxOf, keys, MAP.vectors.lattice.water, CELL),
  }
})

/** Scratch for a query's tiles' reaches and grids. */
const held: Array<Reaches> = [],
  grids: Array<CellGrid> = []

/**
 * Host only: calls `visit` with the id and the reach of every reach whose box may overlap the
 * query box (run the exact test), in the whole map's order (32 m cells south to north, west to
 * east, each cell's reaches by id), each once, though every tile round it holds its piece. Visits
 * none and answers false when a tile the query reads is not in memory: none is ever read.
 */
export const reachesIn = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (id: number, reach: Reach) => void,
): boolean => {
  const at = MAP.vectors.lattice.water
  held.length = 0
  grids.length = 0
  for (const key of tilesOver(...cellBox(at, CELL, minX, minY, maxX, maxY))) {
    const tile = residentTile(key)
    if (tile === undefined) return false
    const inTile = reachesOfTile(tile)
    if (inTile.reaches.length === 0) continue
    held.push(inTile)
    grids.push(inTile.grid)
  }
  // A grid marks what it has given, but a reach the tiles round a seam all hold comes once from each: the first is kept.
  const seen = new Set<number>()
  queryCells(grids, at, CELL, minX, minY, maxX, maxY, (g, k) => {
    const id = grids[g]!.ids[k]!
    if (seen.has(id)) return
    seen.add(id)
    visit(id, held[g]!.reaches[k]!)
  })
  return true
}

/** Drinking fountains, taps and the Fontana di Aiola lavoir (more water: higher flow). */
const fountains = MAP.pois.filter(
  (p) =>
    p.kind === "amenity=drinking_water" ||
    p.kind === "man_made=water_tap" ||
    p.kind === "area:lavoir",
)

/**
 * The bodies of water heard at (x, y) within `radius` m (at most 400), loudest first: rivers and
 * streams (pieces merged by name) at their nearest point, fountains and the waterfall as points.
 * Bodies under 20 dB(A) at (x, y) are left out. The rivers and streams are heard only while every
 * tile under the disc is in memory (always, within 400 m of the player); a fountain off them stands
 * on the coarse terrain (`terrainAt`).
 */
export const waterNear = (x: number, y: number, radius: number): ReadonlyArray<WaterHeard> => {
  const r = Math.min(radius, FARTHEST),
    out: Array<WaterHeard> = []
  const bodies = new Map<
    string,
    { readonly reaches: Array<Reach>; nearest: Reach; d2: number; t: number }
  >()
  reachesIn(x - r, y - r, x + r, y + r, (_, reach) => {
    const { d2, t } = segDist2(x, y, reach.ax, reach.ay, reach.bx, reach.by)
    if (d2 > r * r) return
    const body = bodies.get(reach.key)
    if (body === undefined) bodies.set(reach.key, { reaches: [reach], nearest: reach, d2, t })
    else {
      body.reaches.push(reach)
      if (d2 < body.d2) [body.nearest, body.d2, body.t] = [reach, d2, t]
    }
  })
  for (const [key, { reaches: line, nearest: n, t }] of bodies) {
    out.push({
      key,
      body: n.river ? "river" : "stream",
      flow: n.flow,
      level: lineLevel(line, x, y).level,
      x: n.ax + (n.bx - n.ax) * t,
      y: n.ay + (n.by - n.ay) * t,
      z: n.az + (n.bz - n.az) * t,
    })
  }
  for (const f of fountains) {
    const d = Math.hypot(f.x - x, f.y - y)
    if (d > r) continue
    out.push({
      key: `fountain:${f.id}`,
      body: "fountain",
      flow: f.kind === "area:lavoir" ? 0.5 : 0.2,
      level: FOUNTAIN_DB - spreading(d, 1),
      x: f.x,
      y: f.y,
      z: terrainAt(f.x, f.y) + 0.8,
    })
  }
  const d = Math.hypot(CASCATA.x - x, CASCATA.y - y)
  if (d <= r)
    out.push({
      key: CASCATA.key,
      body: "river",
      flow: 1,
      level: CASCATA.level - spreading(d, 1),
      x: CASCATA.x,
      y: CASCATA.y,
      z: CASCATA.z,
    })
  return out.filter((w) => w.level >= FLOOR).sort((a, b) => b.level - a.level)
}

// The map build's terrain phase: the water's surfaces, the road and rail profiles (their claims on
// the grid recorded), the water kept under the decks, then the grid built tile by tile
// (build-grid.ts), the catchments on it and the perched water dropped. It returns the finished grid
// and the lines read from it, so the profiles go out of scope here, and the DTM when the function
// in build-map.ts that holds it returns.
import type { Water } from "../sim/map/index.ts"
import { tileByTile } from "./build-grid.ts"
import type { Sources } from "./build-sources.ts"
import { catchments, type Inflow } from "./catchment.ts"
import { railSlab, roadSlab } from "./deck-ground.ts"
import type { Dem } from "./dtm.ts"
import type { RoadF } from "./features.ts"
import {
  BOUNDS,
  along,
  arcLengths,
  boxesMeet,
  crossings,
  flatLine,
  lineBox,
  r1,
  type V,
} from "./geometry.ts"
import {
  chainsOf,
  EXTRA_RANK,
  lifted,
  makeProfiler,
  RAIL_PASS,
  ROAD_PASSES,
  type Linear,
} from "./profiles.ts"
import { extraLevels, RAIL_TOL } from "./rail-bed.ts"
import { railLevels } from "./rail-levels.ts"
import { roadLevels } from "./road-levels.ts"
import { type Profile, RELAX, resample, sampleGrid } from "./terrain.ts"
import { stillLevel, waterAreas } from "./water-areas.ts"
import { capUnderDecks, dropPerched, waterLine, waterProfiles, type Crossed } from "./water.ts"

/**
 * Catchments beyond the map's box that drain into it, km², each at the point on the box's edge
 * where its stream comes in. The box holds the Torrente Aulella's basin down to the Soliera gauge,
 * 4 km below Gragnola and below the Torrente Rosaro's mouth, but the heads of the streams that come
 * down from north of y 13000 under the Cerreto pass: 14.7 km², by a D8 on the MS 10 m DTM, all of
 * which reach the Rosaro above Fivizzano, 13.1 of them down the Rosaro's own head and 1.6 down
 * rivulets west of it, so the Rosaro brings them all. The Bardine and the land south-west of the
 * box join the Aulella below the gauge.
 */
const OFF_MAP: ReadonlyArray<{
  readonly name: string
  readonly at: readonly [number, number]
  readonly km2: number
}> = [{ name: "Torrente Rosaro", at: [3528, 13000], km2: 14.7 }]

/**
 * Where each OFF_MAP stream's area comes in: the sample of its water nearest its point, at least
 * INSET m inside the box (D8 drains no edge node), none where the map holds no such water.
 */
const inflowsOf = (
  water: ReadonlyArray<{ readonly name?: string }>,
  wp: ReadonlyArray<Profile>,
  box: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  },
): Array<Inflow> =>
  OFF_MAP.flatMap(({ name, at: [ax, ay], km2 }) => {
    let best: Inflow | undefined,
      least = Infinity
    water.forEach((w, i) => {
      if (w.name !== name) return
      const p = wp[i]!
      for (let k = 0; k < p.x.length; k++) {
        const x = p.x[k]!,
          y = p.y[k]!
        if (Math.min(x - box.minX, box.maxX - x, y - box.minY, box.maxY - y) < INSET) continue
        const d = Math.hypot(x - ax, y - ay)
        if (d < least) [best, least] = [{ x, y, km2 }, d]
      }
    })
    return best === undefined ? [] : [best]
  })
/** How far inside the box an inflow's node lies, m: past the edge nodes, which drain off the grid. */
const INSET = 12

/** The finished terrain and what is read from it. */
export type Terrain = ReturnType<typeof buildTerrain>

/** Builds the terrain of `src` on `dem` (the uncarved DTM); `lap` marks the end of each stage. */
export const buildTerrain = (src: Sources, dem: Dem, lap: (label: string) => void) => {
  const { rail, extra, allRail, roads, water } = src
  const ground = dem.at
  // ---- the vectors: water surfaces, road and rail profiles (their claims on the grid recorded),
  // the water kept under the decks; then the grid, one tile at a time ----
  const wp = waterProfiles(water, ground)
  // The water as first settled: the beds are carved under it and the catchments read along it.
  const wp0 = wp.map((p) => ({ ...p, z: Float64Array.from(p.z) }))
  // The lakes' levels and the river polygons' waterways, into the areas in their places (a
  // platform's area is its index there).
  const wet = waterAreas(src.areas, water, wp0, dem)
  wet.areas.forEach((a, i) => (src.areas[i] = a))
  // Every road a pass profiles, at the steepest grade its fit draws: a junction keeps within reach
  // of the junctions set before along the roads not yet fitted (junction-reach.ts).
  const links = ROAD_PASSES.flatMap(({ classes, grade }) =>
    roads
      .filter((r) => (classes as ReadonlyArray<string>).includes(r.cls))
      .map((piece) => ({ piece, grade: RELAX * grade })),
  )
  const { profile, claim, claims, grown, nodeZ, zOf, denseOf } = makeProfiler(ground, links)
  const zAt = (l: Linear, s: number) => along(arcLengths(l.pts), zOf.get(l)!, s)

  const { railRoad, levels, roadBounds, railBounds } = railLevels({
    allRail,
    roads,
    water,
    wp,
    ground,
    zAt,
  })
  const widest = (chain: ReadonlyArray<{ readonly item: RoadF }>) =>
    Math.max(...chain.map((m) => m.item.w))
  const ofClass = (cls: ReadonlyArray<string>) => roads.filter((r) => cls.includes(r.cls))
  // The rail goes first (its grade limit is the strictest; roads dip under it and meet it at level
  // crossings), then roads by class (ROAD_PASSES). Ranks decide grid cells: the main roads beat
  // the rail, and the rail beats the rest.
  for (const ch of grown(chainsOf(rail)))
    profile(ch, { w: 4, ...RAIL_PASS, tol: RAIL_TOL }, railBounds(ch))
  // The tracks only the CTR has lie level with the line; a road crossing one is pinned to it there.
  const extraZ = extraLevels(
    extra,
    rail.map((piece) => ({ piece, dense: denseOf.get(piece)! })),
    nodeZ,
  )
  for (const [piece, { z, dense }] of extraZ) {
    zOf.set(piece, z)
    denseOf.set(piece, dense)
  }
  // A road crossing another on two levels keeps the clearance under it (road-levels.ts).
  const overpasses = roadLevels({ roads, ground, fitted: (l) => zOf.has(l), zAt })
  for (const { classes, rank, grade, half } of ROAD_PASSES)
    for (const ch of grown(chainsOf(ofClass(classes))))
      profile(ch, { w: widest(ch), rank, grade, half, decks: true, mouths: true, reach: true }, [
        ...roadBounds(ch),
        ...overpasses.bounds(ch),
      ])
  // The extra tracks take only the cells no road took.
  for (const [piece, { profile: p }] of extraZ)
    if (piece.bridge !== true) claim(p, 4, EXTRA_RANK, () => false)
  lap("roads")

  /**
   * A bridge or tunnel no profiled chain covers (paths, steps): the line between its ends, from the
   * uncarved ground. Under the rail both ends keep the road's clearance, as in a profiled tunnel.
   */
  const lone = (l: Linear): Array<number> => {
    const cap = Math.min(
      ...railRoad.filter((x) => x.rd === l).map((x) => zAt(x.rl, x.c.sa) - x.clear),
    )
    const end = (v: V) =>
      Math.min(cap, (v.id === undefined ? undefined : nodeZ.get(v.id)) ?? ground(v.x, v.y))
    const za = end(l.pts[0]!),
      zb = end(l.pts.at(-1)!),
      s = arcLengths(l.pts)
    return s.map((d) => za + ((zb - za) * d) / (s.at(-1)! || 1))
  }
  const deckZ = (l: Linear) => zOf.get(l) ?? lone(l)
  const crossed: Array<Crossed> = []
  const waterBox = water.map((w) => lineBox(w.pts))
  for (const [l, lw] of [
    ...roads.map((r) => [r, r.w] as const),
    ...allRail.map((r) => [r, 4] as const),
  ]) {
    if (l.tunnel === true || (!lifted(l) && !zOf.has(l))) continue // tunnels pass under; paths follow the terrain
    const z = deckZ(l),
      s = arcLengths(l.pts),
      box = lineBox(l.pts)
    water.forEach((w, wi) => {
      if (!boxesMeet(waterBox[wi]!, box)) return
      for (const c of crossings(w.pts, l.pts))
        crossed.push({
          water: wi,
          at: c.sa,
          half: lw / 2 + (l.bridge === true ? 2 : 1),
          deck: along(s, z, c.sb),
          bridge: l.bridge === true,
        })
    })
  }
  capUnderDecks(water, wp, crossed)
  lap("decks")

  /** Per-vertex elevation: the profile, a lone bridge's line between its ends, or `terrain` (paths). */
  const zLine = (l: Linear, terrain: (x: number, y: number) => number): Array<number> =>
    (zOf.get(l) ?? (lifted(l) ? lone(l) : l.pts.map((v) => terrain(v.x, v.y)))).map(r1)
  /** Output polyline and z: profiled pieces carry their extra bend samples. */
  const lineOut = (l: Linear, terrain: (x: number, y: number) => number) => {
    const d = denseOf.get(l)
    return d === undefined
      ? { pts: flatLine(l.pts), z: zLine(l, terrain) }
      : { pts: flatLine(d.pts), z: d.z.map(r1) }
  }
  // Every rail piece is profiled, so its line reads no terrain; nor does a bridge, profiled or lone.
  const unread = (what: string) => () => {
    throw new Error(`${what} has no profile`)
  }
  const railLines = allRail.map((r) => ({ r, ...lineOut(r, unread(`rail ${r.id}`)) }))
  const grid = tileByTile({
    dem,
    water,
    wp0,
    wp,
    areas: wet.carved,
    claims,
    // Under a deck: its carriageway and a metre either side.
    decks: roads.filter((r) => r.bridge === true).map((r) => ({ pts: r.pts, half: r.w / 2 + 1 })),
    // The ground under every deck's slab, as shipped.
    slabs: [
      ...roads
        .filter((r) => r.bridge === true)
        .map((r) => roadSlab(r, lineOut(r, unread(`bridge ${r.id}`)))),
      ...railLines.filter(({ r }) => r.bridge === true).map(railSlab),
    ],
    // The rail bed: no terrain over an at-grade rail centreline, except at the level crossings.
    rail: railLines.filter(({ r }) => !lifted(r)),
    levels: levels.map(({ v }) => [v.x, v.y] as const),
  })
  lap("grid")
  const drained = catchments(
    grid.uncarved,
    wp0,
    water.map((w) => w.pts.map((v) => v.id)),
    grid.listed,
    inflowsOf(water, wp0, BOUNDS),
    // The water beyond the play area runs on from where its outline cuts the play area's: burned,
    // never read. Unsettled: the running minimum would carry a notch's drawn-on edge downstream.
    src.beyond.water.map((w) => resample(w.pts, 2, (x, y) => ground(x, y) - w.depth / 2)),
  )
  dropPerched(water, wp, crossed, grid.perched, stillLevel(wet.carved))
  lap("water")
  // Everything below reads the finished grid.
  const at = (x: number, y: number) => sampleGrid(grid.grid, x, y)
  const pieceOf = new Map(allRail.map((r, i) => [r, i])),
    roadOf = new Map(roads.map((r, i) => [r, i]))
  return {
    grid: grid.grid,
    railLines,
    roadLines: roads.map((r) => lineOut(r, at)),
    bed: grid.bed,
    decks: grid.decks,
    /** The level crossings: the road and rail piece sharing a vertex (with its index in the piece's output polyline). */
    levels: levels.map(({ rl, rd, v }) => ({
      road: roadOf.get(rd)!,
      piece: pieceOf.get(rl)!,
      v,
      vertex: (denseOf.get(rl)?.pts ?? rl.pts).findIndex((u) => u.id === v.id),
    })),
    water: water.map((w, i): Omit<Water, "floor"> => {
      const line = waterLine(w.pts, wp[i]!)
      return {
        id: w.id,
        kind: w.kind,
        ...(w.name === undefined ? {} : { name: w.name }),
        w: w.w,
        bed: w.bed,
        depth: w.depth,
        pts: flatLine(line.pts),
        z: line.z.map(r1),
        area: line.keep.map((k) => Math.round(drained[i]![k]! * 100) / 100),
      }
    }),
  }
}

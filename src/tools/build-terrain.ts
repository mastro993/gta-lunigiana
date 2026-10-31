// The map build's terrain phase: the water's surfaces, the road and rail profiles (their claims on
// the grid recorded), the water kept under the decks, then the grid built tile by tile
// (build-grid.ts), the catchments on it and the perched water dropped. It returns the finished grid
// and the lines read from it, so the profiles go out of scope here, and the DTM when the function
// in build-map.ts that holds it returns.
import type { Water } from "../sim/map/index.ts"
import { tileByTile } from "./build-grid.ts"
import type { Sources } from "./build-sources.ts"
import { catchments } from "./catchment.ts"
import type { Dem } from "./dtm.ts"
import type { RoadF } from "./features.ts"
import {
  along,
  arcLengths,
  boxesMeet,
  crossings,
  flatLine,
  lineBox,
  r1,
  type V,
} from "./geometry.ts"
import { chainsOf, lifted, makeProfiler, type Linear } from "./profiles.ts"
import { extraLevels, RAIL_TOL } from "./rail-bed.ts"
import { railLevels } from "./rail-levels.ts"
import { sampleGrid } from "./terrain.ts"
import { capUnderDecks, dropPerched, waterLine, waterProfiles, type Crossed } from "./water.ts"

/**
 * Catchment of the Torrente Aulella beyond the map, km²: the bounds hold only its left bank, so
 * the D8 areas miss nearly all of it. The Soliera gauge, 4 km below Gragnola, drains 208 km²
 * (ARPAL, Annali Idrologici 2017, part II); less the Lucido's 47 km² at its mouth (D8), the Aulella
 * brings 161 km² to Gragnola. The few km² between Gragnola and the gauge count to it.
 */
const AULELLA_OFF_MAP = 161

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
  const { profile, claim, claims, grown, nodeZ, zOf, denseOf } = makeProfiler(ground)
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
  const ofClass = (...cls: ReadonlyArray<string>) => roads.filter((r) => cls.includes(r.cls))
  // The rail goes first (its grade limit is the strictest; roads dip under it and meet it at level
  // crossings), then roads by class. Ranks decide grid cells: tertiary 0 beats rail 1 beats the rest.
  for (const ch of grown(chainsOf(rail)))
    profile(ch, { w: 4, rank: 1, grade: 0.025, half: 100, tol: RAIL_TOL }, railBounds(ch))
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
  for (const ch of grown(chainsOf(ofClass("tertiary"))))
    profile(ch, { w: widest(ch), rank: 0, grade: 0.1, half: 20 }, roadBounds(ch))
  for (const ch of grown(chainsOf(ofClass("unclassified", "residential"))))
    profile(ch, { w: widest(ch), rank: 2, grade: 0.15, half: 20 }, roadBounds(ch))
  for (const ch of grown(chainsOf(ofClass("service", "track"))))
    profile(ch, { w: widest(ch), rank: 3, grade: 0.2, half: 20 }, roadBounds(ch))
  // The extra tracks take only the cells no road took (rank 4).
  for (const [piece, { profile: p }] of extraZ)
    if (piece.bridge !== true) claim(p, 4, 4, () => false)
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
  // Every rail piece is profiled, so its line reads no terrain.
  const railLines = allRail.map((r) => ({
    r,
    ...lineOut(r, () => {
      throw new Error(`rail ${r.id} has no profile`)
    }),
  }))
  const grid = tileByTile({
    dem,
    water,
    wp0,
    wp,
    claims,
    // The rail bed: no terrain over an at-grade rail centreline, except at the level crossings.
    rail: railLines.filter(({ r }) => !lifted(r)),
    levels: levels.map(({ v }) => [v.x, v.y] as const),
  })
  lap("grid")
  const drained = catchments(
    grid.uncarved,
    wp0,
    water.map((w) => w.pts.map((v) => v.id)),
  )
  dropPerched(water, wp, crossed, grid.perched)
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
    /** The level crossings: the road and rail piece sharing a vertex (with its index in the piece's output polyline). */
    levels: levels.map(({ rl, rd, v }) => ({
      road: roadOf.get(rd)!,
      piece: pieceOf.get(rl)!,
      v,
      vertex: (denseOf.get(rl)?.pts ?? rl.pts).findIndex((u) => u.id === v.id),
    })),
    water: water.map((w, i): Omit<Water, "floor"> => {
      const line = waterLine(w.pts, wp[i]!),
        off = w.name === "Torrente Aulella" ? AULELLA_OFF_MAP : 0
      return {
        id: w.id,
        kind: w.kind,
        ...(w.name === undefined ? {} : { name: w.name }),
        w: w.w,
        bed: w.bed,
        depth: w.depth,
        pts: flatLine(line.pts),
        z: line.z.map(r1),
        area: line.keep.map((k) => Math.round((off + drained[i]![k]!) * 100) / 100),
      }
    }),
  }
}

// The map build's terrain phase: the LiDAR on the 4 m grid, the water's surfaces and catchments,
// the beds carved, the road and rail profiles written in, the water kept under the decks, the grid
// rounded to 0.1 m and the rail bed levelled. It returns the finished grid and the lines read from
// it, so the profiles and the DTM go out of scope here.
import type { Water } from "../sim/map/index.ts"
import type { Sources } from "./build-sources.ts"
import { catchments } from "./catchment.ts"
import type { RoadF } from "./features.ts"
import {
  along,
  arcLengths,
  boxesMeet,
  crossings,
  flatLine,
  lineBox,
  r1,
  segIndex,
  type V,
} from "./geometry.ts"
import { chainsOf, lifted, makeProfiler, type Linear } from "./profiles.ts"
import { extraLevels, RAIL_TOL, railBed } from "./rail-bed.ts"
import { railLevels } from "./rail-levels.ts"
import { makeGrid, sampleGrid } from "./terrain.ts"
import { carveAll, fitUnderDecks, waterLine, waterProfiles, type Crossed } from "./water.ts"

/**
 * Catchment of the Torrente Aulella beyond the map, km²: the bounds hold only its left bank, so
 * the D8 areas miss nearly all of it. The Soliera gauge, 4 km below Gragnola, drains 208 km²
 * (ARPAL, Annali Idrologici 2017, part II); less the Lucido's 47 km² at its mouth (D8), the Aulella
 * brings 161 km² to Gragnola. The few km² between Gragnola and the gauge count to it.
 */
const AULELLA_OFF_MAP = 161

/** The finished terrain and what is read from it. */
export type Terrain = ReturnType<typeof buildTerrain>

/** Builds the terrain of `src` on `ground` (the uncarved DTM); `lap` marks the end of each stage. */
export const buildTerrain = (
  src: Sources,
  ground: (x: number, y: number) => number,
  lap: (label: string) => void,
) => {
  const { rail, extra, allRail, roads, water } = src
  // ---- LiDAR -> 4 m grid -> carved water -> roads and rail -> water kept under the decks ----
  const grid = makeGrid(ground)
  const at = (x: number, y: number) => sampleGrid(grid, x, y)
  const wp = waterProfiles(water, ground)
  const drained = catchments(
    grid,
    wp,
    water.map((w) => w.pts.map((v) => v.id)),
  )
  carveAll(grid, water, wp)
  lap("water")

  // Roads may claim river banks but never the water itself.
  const protect = new Uint8Array(grid.cols * grid.rows)
  const owner = new Uint8Array(grid.cols * grid.rows).fill(255)
  {
    const wet = segIndex<null>()
    for (const w of water) if (w.w >= 4) wet.addLine(w.pts, w.w / 2 + 1, null)
    for (let k = 0; k < protect.length; k++)
      protect[k] = wet.covers(
        grid.x0 + (k % grid.cols) * grid.cell,
        grid.y0 + Math.floor(k / grid.cols) * grid.cell,
      )
        ? 1
        : 0
  }
  const { profile, claim, grown, nodeZ, zOf, denseOf } = makeProfiler(grid, ground, owner, protect)
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
  fitUnderDecks(grid, water, wp, crossed, (n) => owner[n] !== 255, at)
  for (let k = 0; k < grid.z.length; k++) grid.z[k] = Math.round(grid.z[k]! * 10) / 10
  lap("decks")

  /** Per-vertex elevation: the profile, a lone bridge's line between its ends, or the terrain (paths). */
  const zLine = (l: Linear): Array<number> =>
    (zOf.get(l) ?? (lifted(l) ? lone(l) : l.pts.map((v) => at(v.x, v.y)))).map(r1)
  /** Output polyline and z: profiled pieces carry their extra bend samples. */
  const lineOut = (l: Linear) => {
    const d = denseOf.get(l)
    return d === undefined
      ? { pts: flatLine(l.pts), z: zLine(l) }
      : { pts: flatLine(d.pts), z: d.z.map(r1) }
  }
  // The rail bed: no terrain over an at-grade rail centreline, except at the level crossings.
  const railLines = allRail.map((r) => ({ r, ...lineOut(r) }))
  const atGradeRail = railLines.filter(({ r }) => !lifted(r))
  // A road's core (ranks 0, 2, 3) and a wide stream's bed keep their level; the rail's and the
  // extra tracks' cells (1, 4) and open ground may be raised.
  const bed = railBed(
    grid,
    atGradeRail,
    levels.map(({ v }) => [v.x, v.y] as const),
    (n) => protect[n] === 1 || owner[n] === 0 || owner[n] === 2 || owner[n] === 3,
  )
  // Everything below reads the finished grid.
  const pieceOf = new Map(allRail.map((r, i) => [r, i])),
    roadOf = new Map(roads.map((r, i) => [r, i]))
  return {
    grid,
    railLines,
    roadLines: roads.map(lineOut),
    bed,
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

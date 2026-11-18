// The map build's terrain phase, in two steps. `profileTerrain`, the one that reads the DTM: the
// water's surfaces, the road and rail profiles (their claims on the grid recorded), the water kept
// under the decks, the lines on them and the uncarved grid; the profiles go out of scope when it
// returns, and the DTM when the function in build-map.ts that holds it returns. `finishTerrain`: the
// grid built tile by tile (build-grid.ts), the paths on it, the catchments on the uncarved grid and
// the perched water dropped.
import type { Water } from "../sim/map/index.ts"
import { tileByTile, uncarvedGrid } from "./build-grid.ts"
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
  ringBox,
  type V,
} from "./geometry.ts"
import { pathApproaches, pathsAtGrade } from "./path-approaches.ts"
import { inPlay, onOutline } from "./play-area.ts"
import {
  chainsOf,
  EXTRA_RANK,
  insideNodes,
  lifted,
  makeProfiler,
  PATH_PASS,
  RAIL_PASS,
  ROAD_PASSES,
  type Bound,
  type Linear,
} from "./profiles.ts"
import { extraLevels, RAIL_TOL } from "./rail-bed.ts"
import { railLevels } from "./rail-levels.ts"
import { continuations } from "./rail-runouts.ts"
import { railTwins, twinBounds } from "./rail-twins.ts"
import { roadLevels } from "./road-levels.ts"
import { PIER_DECK, pierDeck } from "./shore.ts"
import { type Profile, resample, sampleGrid } from "./terrain.ts"
import { inAreas, stillLevel, waterAreas, waterLevel } from "./water-areas.ts"
import {
  BRIDGE_CLEAR,
  capUnderDecks,
  dropPerched,
  waterLine,
  waterProfiles,
  type Crossed,
} from "./water.ts"

/**
 * Catchments beyond the map's box that drain into it, km², each at the point on the box's north
 * edge (y 13000) where its stream comes in: the ground north of the edge whose flow crosses it there,
 * by a D8 on the MS 10 m DTM. Of the 522.0 km² that come in, the Torrente Aulella's heads under the
 * Cerreto pass are 14.7, all of which reach the Torrente Rosaro above Fivizzano, 13.1 down the
 * Rosaro's own head and 1.6 down rivulets west of it, so the Rosaro brings them all. The Fiume Magra
 * brings 420.9 of its upper valley and the Torrente Taverone 69.1, each at its own crossing, 15 and
 * 8 m from OSM's; the Torrente Civiglia, which joins the Taverone 84 m above its mouth, 4.5, and the
 * Canale Torchio di Bacco and the Canale della Ghiaia, which join the Civiglia, 3.8 and 3.0. Each
 * crosses the edge 3.7 to 5.6 km west of the Taverone, and D8 sends each node across it at one point
 * alone, so none of the three is in the Taverone's 69.1. The Canale Cravareccia, which joins the
 * Taverone 113 m down its line, brings 1.1. The other 4.9 km² come down rivulets under 1 km² each
 * (the Fosso della Predella's 0.7 the most) and are left out. The 10 m DTM's D8 gives the Magra 930.5
 * km² where it leaves the play area at y 3900.
 */
const OFF_MAP: ReadonlyArray<{
  readonly name: string
  readonly at: readonly [number, number]
  readonly km2: number
}> = [
  { name: "Torrente Rosaro", at: [3528, 13000], km2: 14.7 },
  { name: "Fiume Magra", at: [-14312, 13000], km2: 420.9 },
  { name: "Torrente Taverone", at: [-5548, 13000], km2: 69.1 },
  { name: "Torrente Civiglia", at: [-9205, 13000], km2: 4.5 },
  { name: "Canale Torchio di Bacco", at: [-10417, 13000], km2: 3.8 },
  { name: "Canale della Ghiaia", at: [-11105, 13000], km2: 3.0 },
  { name: "Canale Cravareccia", at: [-5874, 13000], km2: 1.1 },
]

/**
 * Where each OFF_MAP stream's area comes in: the sample of its water nearest its point, at least
 * INSET m inside the box (D8 drains no edge node), none where the map holds no such water or the
 * point is not on the box's edge (another region's box: the coast's holds the Magra's mouth, which
 * took the 420.9 km² of its upper valley at its first sample past the coast box's north edge).
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
    const inside = ax >= box.minX && ax <= box.maxX && ay >= box.minY && ay <= box.maxY
    if (!inside || Math.min(ax - box.minX, box.maxX - ax, ay - box.minY, box.maxY - ay) > 0)
      return []
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
export type Terrain = ReturnType<typeof finishTerrain>

/** Everything of the terrain that reads the DTM: the profiles, the lines on them and the uncarved grid. */
export type Profiled = ReturnType<typeof profileTerrain>

/** Whether a node lies beyond the play area, off its outline: where a run-out may write the grid. */
const beyond = (x: number, y: number) => !inPlay(x, y)

/**
 * Profiles the lines of `src` on `dem` (the uncarved DTM) and samples the uncarved grid from it;
 * `lap` marks the end of each stage. What it returns holds no reference to `dem`, so the DTM can go
 * before the tile pass.
 */
export const profileTerrain = (src: Sources, dem: Dem, lap: (label: string) => void) => {
  const { rail, extra, allRail, roads, water } = src
  const ground = dem.at
  // ---- the vectors: water surfaces, road and rail profiles (their claims on the grid recorded),
  // the water kept under the decks; then the grid, one tile at a time ----
  // No water stands under the sea, and the rivers reaching it meet it at its level.
  const wp = waterProfiles(
    water,
    ground,
    inAreas(src.areas, (k) => k === "sea"),
  )
  // The water as first settled: the beds are carved under it and the catchments read along it.
  const wp0 = wp.map((p) => ({ ...p, z: Float64Array.from(p.z) }))
  // The lakes' levels and the river polygons' waterways, into the areas in their places (a
  // platform's area is its index there), and the sea on its floor.
  const wet = waterAreas(src.areas, water, wp0, dem, src.seaFloor)
  wet.areas.forEach((a, i) => (src.areas[i] = a))
  // Every road a pass profiles, at the steepest grade its fit draws: a junction keeps within reach
  // of the junctions set before along the roads not yet fitted (junction-reach.ts).
  const links = ROAD_PASSES.flatMap(({ classes, grade, relax }) =>
    roads
      .filter((r) => (classes as ReadonlyArray<string>).includes(r.cls))
      .map((piece) => ({ piece, grade: relax * grade })),
  )
  // Where each road and rail bridge's deck ends: a line meeting it there runs on under it.
  const bridgeEnds = new Set(
    [...roads, ...allRail].flatMap((l) =>
      l.bridge === true ? [l.pts[0]!.id, l.pts.at(-1)!.id].filter((id) => id !== undefined) : [],
    ),
  )
  const { profile, claim, mouth, claims, grown, nodeZ, zOf, denseOf } = makeProfiler(
    ground,
    links,
    bridgeEnds,
  )
  const zAt = (l: Linear, s: number) => along(arcLengths(l.pts), zOf.get(l)!, s)

  const { railRoad, levels, roadBounds, railBounds } = railLevels({
    allRail,
    roads,
    water,
    wp,
    ground,
    zAt,
  })
  const ofClass = (cls: ReadonlyArray<string>) => roads.filter((r) => cls.includes(r.cls))
  // The rail goes first (its grade limit is the strictest; roads dip under it and meet it at level
  // crossings), then roads by class (ROAD_PASSES). Ranks decide grid cells: the main roads beat
  // the rail, and the rail beats the rest.
  // A switch in a tunnel or on a bridge is no portal or abutment: its chains run on at their level.
  // A track beside one fitted before it keeps to its level (rail-twins.ts).
  const inside = insideNodes(rail),
    twins = railTwins(rail)
  for (const ch of grown(chainsOf(rail)))
    profile(ch, { w: 4, ...RAIL_PASS, tol: RAIL_TOL, inside: (id) => inside.has(id) }, [
      ...railBounds(ch),
      ...twinBounds(twins, ch, (l) => denseOf.get(l)),
    ])
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
  // Each terminal's track on beyond the play area (rail-runouts.ts), profiled as the rail is from
  // the terminal's level as shipped; it writes the grid beyond the play area alone, which keeps what
  // its own lines wrote.
  const runOuts = continuations(allRail, src.beyond.rail, (x, y) => onOutline(x, y)).map(
    ({ piece, end, chain }) => {
      const z = zOf.get(allRail[piece]!)!
      profile(
        chain.map((item) => ({ item, rev: false })),
        {
          w: 4,
          ...RAIL_PASS,
          tol: RAIL_TOL,
          start: r1(end === 0 ? z[0]! : z.at(-1)!),
          writes: beyond,
        },
      )
      const at = chain[0]!.pts[0]!
      return {
        at: `${r1(at.x)},${r1(at.y)}`,
        pieces: chain.map((item) => {
          const d = denseOf.get(item)!
          return {
            pts: flatLine(d.pts),
            z: d.z.map(r1),
            ...(item.bridge ? { bridge: true as const } : {}),
            ...(item.tunnel ? { tunnel: true as const } : {}),
          }
        }),
      }
    },
  )
  // A road crossing another on two levels keeps the clearance under it (road-levels.ts).
  const overpasses = roadLevels({ roads, ground, fitted: (l) => zOf.has(l), zAt })
  for (const { classes, rank, grade, half, relax } of ROAD_PASSES)
    for (const ch of grown(chainsOf(ofClass(classes))))
      profile(ch, { w: (r) => r.w, rank, grade, half, relax, mouths: true, reach: true }, [
        ...roadBounds(ch),
        ...overpasses.bounds(ch),
      ])
  // The paths and steps at grade, by the nodes they pass through: a deck's end they lead on from is
  // its approaches' to fit.
  const leads = pathsAtGrade(roads)
  /**
   * The level a path's or steps' bridge or tunnel ends at, `v` an end of `piece`: that of a way
   * fitted before it there, else of the road deck of its OSM level it stands on (`deckUnder`: the
   * sidewalk 1414943238, drawn as its own bridge along the SS62's 92904169 at Aulla, ends on that
   * deck 11 m short of its end, over a track 8 m under it); else, where a path or steps at grade
   * leads on from it, none: the fit sets it and its approach climbs or dips from there to the ground
   * (pinned at the ground's level, the ramp 1408285960 out of Aulla Lunigiana station's underpass
   * climbed 6.3 m in its 18.4 m, 34%, past its grade limit); else the uncarved ground's. Under the rail, no
   * higher than the road's clearance under it, as in a profiled tunnel (the pedestrian underpass at
   * Equi Terme station).
   */
  const endLevel = (v: V, piece: RoadF) => {
    const at =
      nodeZ.get(v.id!) ??
      overpasses.deckUnder(v, piece) ??
      (leads.has(v.id!) ? undefined : ground(v.x, v.y))
    return at === undefined
      ? undefined
      : Math.min(
          ...railRoad.filter((x) => x.rd === piece).map((x) => zAt(x.rl, x.c.sa) - x.clear),
          at,
        )
  }
  // The paths' and steps' bridges and tunnels, after every road (PATH_PASS): each from its ends'
  // levels over or under the ways it crosses; then the paths and steps at grade that lead from their
  // nodes, from those levels to the ground.
  const pathDecks = roads.filter(
    (r) =>
      lifted(r) && r.pier !== true && (PATH_PASS.classes as ReadonlyArray<string>).includes(r.cls),
  )
  for (const ch of grown(chainsOf(pathDecks)))
    profile(ch, { w: (r) => r.w, ...PATH_PASS, ramps: true, ends: endLevel }, [
      ...roadBounds(ch),
      ...overpasses.bounds(ch),
    ])
  // A bore's mouth: the end of a path's or steps' tunnel that no other way in a tunnel passes.
  const bores = new Map<string, number>()
  for (const r of roads)
    if (r.tunnel === true)
      for (const v of r.pts) if (v.id !== undefined) bores.set(v.id, (bores.get(v.id) ?? 0) + 1)
  const mouths = new Set(
    pathDecks.flatMap((r) =>
      r.tunnel === true
        ? [r.pts[0]!.id, r.pts.at(-1)!.id].filter((id) => id !== undefined && bores.get(id) === 1)
        : [],
    ),
  )
  // A pier's deck stands over its water vertex by vertex (`pierDeck`), never fitted: the path pass
  // would lay it straight from its ends' levels. Where a path at grade leads on from its end (the
  // pier's own way cut at the water's edge, `splitPiers`), that end's level is its approach's to
  // meet, as a deck's: the piece on dry ground took the finished grid, 0.2–0.4 m under the deck's end
  // at the coast's piers 1382979298, 1382979299 and 1382979302.
  const levelAt = waterLevel(wet.carved, water, wp0)
  const pierZ = new Map(
    roads
      .filter((r) => r.pier === true)
      .map((r) => [
        r as Linear,
        pierDeck(
          r.pts,
          (v) => (v.id === undefined ? undefined : nodeZ.get(v.id)) ?? ground(v.x, v.y),
          levelAt,
        ),
      ]),
  )
  const pierEnds: Array<string> = []
  for (const [l, z] of pierZ)
    for (const k of [0, l.pts.length - 1]) {
      const id = l.pts[k]!.id
      if (id === undefined || !leads.has(id) || nodeZ.has(id)) continue
      nodeZ.set(id, z[k]!)
      pierEnds.push(id)
    }
  const approaches = pathApproaches(
    leads,
    [
      ...new Set(
        pathDecks.flatMap((r) => r.pts.flatMap((v) => (v.id === undefined ? [] : [v.id]))),
      ),
      ...pierEnds,
    ],
    nodeZ,
    // Over a fitted tunnel or under a fitted bridge, the clearance between them (road-levels.ts).
    (piece) =>
      overpasses.over.flatMap(({ up, down, c, clear }): Array<Bound> =>
        up === piece && down.tunnel === true && zOf.has(down)
          ? [{ x: c.x, y: c.y, z: zAt(down, c.sb) + clear, kind: "min" }]
          : down === piece && up.bridge === true && zOf.has(up)
            ? [{ x: c.x, y: c.y, z: zAt(up, c.sa) - clear, kind: "max" }]
            : [],
      ),
    {
      ground,
      mouthAt: (id) => mouths.has(id),
      deckEndAt: (id) => bridgeEnds.has(id),
    },
  )
  claims.push(...approaches.claims)
  for (const m of approaches.mouths) mouth(m)
  // The extra tracks take only the cells no road took.
  for (const [piece, { profile: p }] of extraZ)
    if (piece.bridge !== true) claim(p, 4, EXTRA_RANK, () => false)
  lap("roads")

  /** A deck's z at its vertices or dense samples: its profile, or a pier's. */
  const deckZ = (l: Linear) => zOf.get(l) ?? pierZ.get(l)!
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
          // A pier's deck stands PIER_DECK over its water's level (`pierDeck`): capped a bridge's
          // BRIDGE_CLEAR under it, the water would fall 1.5 m under that level, and on downstream.
          ...(l.bridge === true ? { clear: pierZ.has(l) ? PIER_DECK : BRIDGE_CLEAR } : {}),
        })
    })
  }
  capUnderDecks(water, wp, crossed)
  lap("decks")

  /** Per-vertex elevation: the profile, a pier's deck, or `terrain` (paths and steps at grade). */
  const zLine = (l: Linear, terrain: (x: number, y: number) => number): Array<number> =>
    (zOf.get(l) ?? pierZ.get(l) ?? l.pts.map((v) => terrain(v.x, v.y))).map(r1)
  /** Output polyline and z: profiled pieces carry their extra bend samples. */
  const lineOut = (l: Linear, terrain: (x: number, y: number) => number) => {
    const d = denseOf.get(l)
    return d === undefined
      ? { pts: flatLine(l.pts), z: zLine(l, terrain) }
      : { pts: flatLine(d.pts), z: d.z.map(r1) }
  }
  // Every rail piece is profiled, so its line reads no terrain; nor does any bridge.
  const unread = (what: string) => () => {
    throw new Error(`${what} has no profile`)
  }
  const railLines = allRail.map((r) => ({ r, ...lineOut(r, unread(`rail ${r.id}`)) }))
  const pieceOf = new Map(allRail.map((r, i) => [r, i])),
    roadOf = new Map(roads.map((r, i) => [r, i]))
  const uncarved = uncarvedGrid(dem)
  return {
    uncarved,
    /** What the tile pass reads besides the uncarved grid (build-grid.ts). */
    input: {
      water,
      wp0,
      wp,
      areas: wet.carved,
      raised: src.raised.map((r) => ({ ...r, box: ringBox(r.rings[0]!) })),
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
      // The rail bed: no terrain over an at-grade rail centreline, except at the level crossings; a
      // run-out's beyond the play area.
      rail: [
        ...railLines.filter(({ r }) => !lifted(r)),
        ...runOuts.flatMap((o) =>
          o.pieces.flatMap((p) =>
            p.bridge || p.tunnel ? [] : [{ pts: p.pts, z: p.z, writes: beyond }],
          ),
        ),
      ],
      levels: levels.map(({ v }) => [v.x, v.y] as const),
    },
    crossed,
    still: stillLevel(wet.carved),
    inflows: inflowsOf(water, wp0, BOUNDS),
    // The water beyond the play area runs on from where its outline cuts the play area's: burned,
    // never read. Unsettled: the running minimum would carry a notch's drawn-on edge downstream.
    beyond: src.beyond.water.map((w) => resample(w.pts, 2, (x, y) => ground(x, y) - w.depth / 2)),
    railLines,
    /** Each terminal's run-out by its point (`x,y` as shipped), walked away from it. */
    runOuts: new Map(runOuts.map((o) => [o.at, o.pieces])),
    /** Each road's line, but a path's on the ground (no profile, not lifted), which the finished grid gives. */
    roadLines: roads.map((r) =>
      denseOf.has(r) || zOf.has(r) || lifted(r) ? lineOut(r, unread(`road ${r.id}`)) : undefined,
    ),
    /** The approaches' lines by road (path-approaches.ts), their z undefined where the finished grid gives it. */
    approaches: approaches.lines,
    /** The level crossings: the road and rail piece sharing a vertex (with its index in the piece's output polyline). */
    levels: levels.map(({ rl, rd, v }) => ({
      road: roadOf.get(rd)!,
      piece: pieceOf.get(rl)!,
      v,
      vertex: (denseOf.get(rl)?.pts ?? rl.pts).findIndex((u) => u.id === v.id),
    })),
  }
}

/**
 * The terrain of `src` finished on `profiled` (`profileTerrain`): the grid built tile by tile, the
 * paths on it, the catchments on the uncarved grid (which they overwrite) and the perched water
 * dropped; `lap` marks the end of each stage.
 */
export const finishTerrain = (src: Sources, profiled: Profiled, lap: (label: string) => void) => {
  const { water, roads } = src
  const { uncarved, input, crossed } = profiled
  const grid = tileByTile(uncarved, input)
  lap("grid")
  const drained = catchments(
    uncarved,
    input.wp0,
    water.map((w) => w.pts.map((v) => v.id)),
    // The sea's nodes are outlets, as a notch's are: the rivers and the canals drain into it.
    Uint8Array.from(grid.listed, (on, n) => (grid.sea[n] === 1 ? 0 : on)),
    profiled.inflows,
    profiled.beyond,
  )
  dropPerched(water, input.wp, crossed, grid.perched, profiled.still)
  lap("water")
  return {
    grid: grid.grid,
    railLines: profiled.railLines,
    runOuts: profiled.runOuts,
    roadLines: profiled.roadLines.map((line, i) => {
      const onGrid = (v: V) => r1(sampleGrid(grid.grid, v.x, v.y))
      const a = profiled.approaches.get(roads[i]!)
      if (a !== undefined)
        return { pts: flatLine(a.pts), z: a.pts.map((v, k) => r1(a.z[k] ?? onGrid(v))) }
      return line ?? { pts: flatLine(roads[i]!.pts), z: roads[i]!.pts.map(onGrid) }
    }),
    bed: grid.bed,
    decks: grid.decks,
    levels: profiled.levels,
    water: water.map((w, i): Omit<Water, "floor"> => {
      const line = waterLine(w.pts, input.wp[i]!)
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

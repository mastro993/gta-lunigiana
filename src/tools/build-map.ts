// Builds src/sim/map/monzone.bin from data/raw: OSM (fetch-osm.ts) and the Regione
// Toscana CTR 1:2000, LiDAR DTM and land cover (data/raw/rt, written by fetch-rt.ts).
// Run: node src/tools/build-map.ts  (pnpm map), from any directory. Output is deterministic:
// gunzipped, the same bytes everywhere; gzipped, the same file with the same Node build (another
// zlib or OS writes other compressed bytes).
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

import type { MonzoneMap } from "../sim/map/index.ts"
import { isDrivable, ORIGIN } from "../sim/map/kinds.ts"
import { MAP_VERSION } from "../sim/map/packed.ts"
import { catchments } from "./catchment.ts"
import { conflateRail } from "./conflate.ts"
import { readCtrRail } from "./ctr-rail.ts"
import { fitRoads, readCtr } from "./ctr.ts"
import { fitDistricts } from "./districts.ts"
import {
  extractAreas,
  extractBarriers,
  extractBuildings,
  extractPois,
  extractRail,
  extractRoads,
  extractWater,
  nameFromAddresses,
  type RoadF,
} from "./features.ts"
import {
  along,
  arcLengths,
  BOUNDS,
  crossings,
  flatLine,
  M_PER_DEG,
  pointInRing,
  r1,
  segIndex,
  type V,
} from "./geometry.ts"
import { buildGraph } from "./graph.ts"
import { readOsm } from "./osm.ts"
import { packMap } from "./pack.ts"
import { chainsOf, lifted, makeProfiler, type Linear } from "./profiles.ts"
import { extraLevels, RAIL_TOL, railBed } from "./rail-bed.ts"
import { clearVerges } from "./rail-clear.ts"
import { railLevels } from "./rail-levels.ts"
import { printRail, railSummary } from "./rail-report.ts"
import { crossingBoxes, layRailway, toRailLines } from "./railway.ts"
import { clearance, parkedSpots, playerSpawn, scatterTrees } from "./spawns.ts"
import { loadDtm, makeGrid, sampleGrid } from "./terrain.ts"
import { readUcs } from "./ucs.ts"
import { buildWalls, clipBuildings, openBarriers } from "./walls.ts"
import { carveAll, fitUnderDecks, waterLine, waterProfiles, type Crossed } from "./water.ts"

const ROOT = join(import.meta.dirname, "../..")
const OUT = join(ROOT, "src/sim/map/monzone.bin")
const t0 = performance.now()
const lap = (label: string) =>
  console.log(`${label.padEnd(10)} ${((performance.now() - t0) / 1000).toFixed(2)} s`)

const osm = readOsm(join(ROOT, "data/raw/lunigiana.osm.gz"))
const ctr = readCtr(join(ROOT, "data/raw/rt/ctr"))
const ground = loadDtm(join(ROOT, "data/raw/rt")) // the untouched 1 m terrain every profile samples
const ctrRail = readCtrRail(join(ROOT, "data/raw/rt/ctr"))
// OSM's rail on the CTR's surveyed tracks, plus the tracks only the CTR has; level-crossing nodes
// slide along their roads with it, and what its bridges span stays under them (water widths
// depend on the way's mean ground, so the terrain is loaded first).
const {
  rail,
  extra,
  roads,
  water,
  moves,
  report: railReport,
} = conflateRail(extractRail(osm), extractRoads(osm), extractWater(osm, ground), ctrRail)
const allRail = [...rail, ...extra]
lap("rail")
fitRoads(roads, ctr.roadAreas, ctr.mapped)
nameFromAddresses(osm, roads)
const buildings = clipBuildings(extractBuildings(osm, ctr), roads),
  barriers = openBarriers(extractBarriers(osm), roads),
  // Stops and the Equi foot crossing stand where the rail took their nodes.
  pois = extractPois(osm).map((p) => {
    const to = p.kind.startsWith("area:") ? undefined : moves.get(String(p.id))
    return to === undefined ? p : { ...p, x: r1(to.x), y: r1(to.y) }
  })
const osmAreas = extractAreas(osm)
const areas = [
  ...osmAreas.filter((a) => a.kind !== "platform"),
  ...readUcs(join(ROOT, "data/raw/rt/ucs.json.gz")), // rock, pastures and quarries OSM lacks above the woods
  ...ctr.roadAreas.filter((a) => a.paved).map((a) => ({ kind: "paved", rings: a.rings })), // squares, lay-bys
]
lap("features")

// ---- terrain: LiDAR -> 4 m grid -> carved water -> roads and rail -> water kept under the decks ----
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
for (const [piece, { profile: p }] of extraZ) if (piece.bridge !== true) claim(p, 4, 4, () => false)
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
for (const [l, lw] of [
  ...roads.map((r) => [r, r.w] as const),
  ...allRail.map((r) => [r, 4] as const),
]) {
  if (l.tunnel === true || (!lifted(l) && !zOf.has(l))) continue // tunnels pass under; paths follow the terrain
  const z = deckZ(l),
    s = arcLengths(l.pts)
  water.forEach((w, wi) => {
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

// ---- the railway: lines over the running track, the platforms beside them (the CTR's where its
// sheets map the ground, OSM's elsewhere), the stations ----
const inCtr = (ring: ReadonlyArray<number>) =>
  ctr.mapped.some((m) => pointInRing(ring[0]!, ring[1]!, m))
/** A line's terminal: a dead end on the map's edge, where the track runs on beyond it. */
const onEdge = (x: number, y: number) =>
  Math.min(
    Math.abs(x - BOUNDS.minX),
    Math.abs(x - BOUNDS.maxX),
    Math.abs(y - BOUNDS.minY),
    Math.abs(y - BOUNDS.maxY),
  ) < 0.06
const { shipped, lines, kinds, platforms, stations } = layRailway(
  railLines,
  onEdge,
  {
    polygons: [
      ...ctrRail.platforms,
      ...osmAreas
        .filter((a) => a.kind === "platform" && !inCtr(a.rings[0]!))
        .map((a, i) => ({ src: `OSM platform ${i}`, rings: a.rings })),
    ],
    roads: roads.flatMap((r) =>
      isDrivable(r.cls) && !lifted(r) ? [{ pts: flatLine(r.pts), w: r.w }] : [],
    ),
    crossings: ctrRail.crossings.map((c) => c.rings),
    terrain: at,
  },
  pois,
)
const platformAreas = platforms.map((p) => {
  areas.push({ kind: p.walkway ? "paved" : "platform", rings: p.rings }) // a walkway is a paved strip
  return areas.length - 1
})
lap("railway")

// ---- collision, graph, trees, spawns ----
const walls = buildWalls(grid, roads, water, buildings, barriers)
lap("walls")
const trees = scatterTrees(areas, roads, buildings, water, allRail)
lap("trees")
// Spawns and traffic's dead ends keep off the water as well.
const walkClear = clearance([...walls.walk, ...walls.shore], trees),
  driveClear = clearance([...walls.drive, ...walls.driveShore], trees)
/** Room for a car to stop and turn (map.test.ts asks the same of every traffic dead end). */
const TURN = 2.3
const graph = buildGraph(roads, (x, y) => driveClear.circle(x, y, TURN))
// Level crossings: boxes of crossing nodes on one road; then no verge or lane beside the running track.
const crossingNodes = levels.map(({ rl, rd, v }) => {
  const piece = allRail.indexOf(rl)
  return {
    road: roads.indexOf(rd),
    node: graph.ids.get(v.id!)!,
    x: r1(v.x),
    y: r1(v.y),
    piece,
    vertex: (denseOf.get(rl)?.pts ?? rl.pts).findIndex((u) => u.id === v.id),
  }
})
const levelCrossings = crossingBoxes(crossingNodes, lines, shipped)
const roadLines = roads.map(lineOut)
const { verges, report: clearReport } = clearVerges({
  graph,
  roads: roads.map((r, i) => ({ cls: r.cls, w: r.w, ...roadLines[i]! })),
  track: railLines.flatMap(({ r, pts, z }, i) =>
    kinds[i] === undefined && !lifted(r) ? [{ pts, z }] : [],
  ),
  boxes: levelCrossings.map((c) => ({
    road: c.road,
    at: c.nodes.map((n) => [graph.xy[2 * n]!, graph.xy[2 * n + 1]!] as const),
  })),
  platforms: platforms.map((p) => p.rings),
})
const poi = (id: number) => {
  const p = pois.find((q) => q.id === id)
  if (p === undefined) throw new Error(`poi ${id} missing`)
  return p
}
const station = poi(1813987803),
  carabinieri = poi(14183344901)
const player = playerSpawn(roads, walkClear, driveClear, carabinieri)
const junctions = graph.degree.flatMap((d, n) =>
  d >= 3 ? [[graph.xy[2 * n]!, graph.xy[2 * n + 1]!] as const] : [],
)
const parked = parkedSpots({
  roads,
  buildings,
  areas,
  junctions,
  walk: walkClear,
  drive: driveClear,
  avoid: player,
  station,
  police: carabinieri,
  rail: railLines.flatMap(({ r, pts }, i) =>
    lifted(r) ? [] : [{ pts, running: kinds[i] === undefined }],
  ),
  crossings: crossingNodes.map(({ x, y }) => [x, y] as const),
})
lap("spawns")

const districts = fitDistricts(osm, buildings)

/**
 * Catchment of the Torrente Aulella beyond the map, km²: the bounds hold only its left bank, so
 * the D8 areas miss nearly all of it. The Soliera gauge, 4 km below Gragnola, drains 208 km²
 * (ARPAL, Annali Idrologici 2017, part II); less the Lucido's 47 km² at its mouth (D8), the Aulella
 * brings 161 km² to Gragnola. The few km² between Gragnola and the gauge count to it.
 */
const AULELLA_OFF_MAP = 161
/** Surveyed eave over a building's lowest ground, m, outside which the eave is a survey slip and the default height stands. */
const EAVE = { min: 1.5, max: 45 }
const roadOut = (r: RoadF, i: number) => ({
  id: r.id,
  cls: r.cls,
  ...(r.name === undefined ? {} : { name: r.name }),
  ...(r.ref === undefined ? {} : { ref: r.ref }),
  w: r.w,
  surface: r.surface,
  ...(r.oneway ? { oneway: true } : {}),
  ...(r.bridge ? { bridge: true } : {}),
  ...(r.tunnel ? { tunnel: true } : {}),
  ...(r.layer === undefined ? {} : { layer: r.layer }),
  ...(verges.has(i) ? { verge: verges.get(i)! } : {}),
  ...roadLines[i]!,
})
const map: MonzoneMap = {
  version: MAP_VERSION,
  origin: ORIGIN,
  mPerDeg: M_PER_DEG,
  bounds: BOUNDS,
  heightmap: {
    cell: grid.cell,
    cols: grid.cols,
    rows: grid.rows,
    x0: grid.x0,
    y0: grid.y0,
    data: Array.from(grid.z, (z) => Math.round(z * 10)),
  },
  roads: roads.map(roadOut),
  buildings: buildings.map((b) => {
    let z0 = Number.MAX_VALUE
    for (const ring of [b.outer, ...(b.holes ?? [])])
      for (let i = 0; i < ring.length; i += 2) z0 = Math.min(z0, at(ring[i]!, ring[i + 1]!))
    const { id, kind, name, eave, style, ruins, tint, outer, holes } = b
    const rise = eave === undefined ? Number.NaN : eave - z0
    const h = rise >= EAVE.min && rise <= EAVE.max ? rise : b.h
    return {
      id,
      kind,
      ...(name === undefined ? {} : { name }),
      h: r1(h),
      z0: r1(z0),
      style,
      ...(ruins ? { ruins } : {}),
      tint,
      outer,
      ...(holes ? { holes } : {}),
    }
  }),
  water: water.map((w, i) => {
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
  rail: railLines.map(({ r, pts, z }, i) => ({
    id: r.id,
    ...(kinds[i] === undefined ? {} : { kind: kinds[i] }),
    ...(r.bridge ? { bridge: true } : {}),
    ...(r.tunnel ? { tunnel: true } : {}),
    pts,
    z,
  })),
  railway: {
    lines: toRailLines(lines, shipped),
    stations,
    crossings: levelCrossings,
    platforms: platforms.map((p, i) => ({
      area: platformAreas[i]!,
      ...(p.walkway ? { walkway: true } : {}),
      ...(p.name === undefined ? {} : { name: p.name }),
      axis: p.axis,
      top: p.top,
    })),
  },
  areas,
  barriers,
  pois,
  districts,
  graph: { xy: graph.xy, edges: graph.edges, traffic: graph.traffic, walk: graph.walk },
  walls: { walk: walls.walk, shore: walls.shore, drive: walls.drive },
  trees,
  spawns: { player, parked },
}
const { file, sizes } = packMap(map)
const gz = gzipSync(file, { level: 9 })
writeFileSync(OUT, gz)
lap("write")

printRail(railReport, platforms)

/** Steepest vertex-to-vertex grade per road class (bridges included), over steps of >= 4 m. */
const grades: Record<string, string> = {}
for (const r of map.roads)
  for (let i = 1, j = 0; i < r.z.length; i++) {
    const ds = Math.hypot(r.pts[2 * i]! - r.pts[2 * j]!, r.pts[2 * i + 1]! - r.pts[2 * j + 1]!)
    if (ds < 4) continue
    const g = Math.abs(r.z[i]! - r.z[j]!) / ds
    if (g > parseFloat(grades[r.cls] ?? "0") / 100)
      grades[r.cls] = `${(g * 100).toFixed(1)}% (${r.id})`
    j = i
  }
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`,
  jsonKb = (v: unknown) => kb(JSON.stringify(v).length)
console.log({
  bytes: gz.length,
  roads: map.roads.length,
  buildings: map.buildings.length,
  water: map.water.length,
  rail: map.rail.length,
  ...railSummary({
    report: railReport,
    running: rail.length,
    extra: extra.length,
    bed,
    lines,
    stations,
    crossings: levelCrossings,
    verges: clearReport,
    roadName: (i) => roads[i]!.name ?? String(roads[i]!.id),
    roadId: (i) => roads[i]!.id,
  }),
  areas: areas.length,
  wallsWalk: walls.walk.length / 4,
  wallsShore: walls.shore.length / 4,
  wallsDrive: walls.drive.length / 4,
  blockedCells: { walk: walls.walkCells, shore: walls.shoreCells, drive: walls.driveCells },
  nodes: graph.xy.length / 2,
  edges: graph.edges.length / 3,
  traffic: graph.traffic.length,
  walk: graph.walk.length,
  trees: trees.length / 3,
  parked: parked.length,
  player,
  grades,
  // the file's parts before gzip (the JSON line, then the packed sections), and the JSON line's biggest fields
  sizes: {
    ...Object.fromEntries(Object.entries(sizes).map(([part, n]) => [part, kb(n)])),
    graph: jsonKb(map.graph),
    roads: jsonKb(map.roads),
    buildings: jsonKb(map.buildings),
    areas: jsonKb(areas),
  },
})

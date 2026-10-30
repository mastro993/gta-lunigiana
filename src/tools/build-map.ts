// Builds src/sim/map/monzone.bin and its tiles (src/sim/map/monzone/<i>_<j>.bin) from data/raw:
// OSM (fetch-osm.ts) and the Regione Toscana CTR 1:2000, LiDAR DTM and land cover (data/raw/rt,
// written by fetch-rt.ts). Run: node src/tools/build-map.ts  (pnpm map), from any directory. Output
// is deterministic on one CPU architecture: gunzipped, the same bytes on every machine of it, and
// the same build hash; gzipped, the same files with the same Node build (another zlib or OS writes
// other compressed bytes). V8's trigonometry rounds differently on arm64 and x64 (docs/map.md).
//
// The phases (docs/map.md, "Pipeline") run one after another, each a function whose intermediates
// go out of scope when it returns: the sources (build-sources.ts), the terrain (build-terrain.ts),
// the railway, walls, trees, graph and spawns on it (build-world.ts), then the map put together,
// cut into tiles, baked and written (build-output.ts).
import { join } from "node:path"

import { assembleMap, writeMap } from "./build-output.ts"
import { readSources } from "./build-sources.ts"
import { buildTerrain } from "./build-terrain.ts"
import { buildWorld } from "./build-world.ts"
import { printRail, railSummary } from "./rail-report.ts"
import { REGION } from "./region.ts"
import { cutMap } from "./tile-map.ts"

const ROOT = join(import.meta.dirname, "../..")
const t0 = performance.now()
const lap = (label: string) =>
  console.log(`${label.padEnd(10)} ${((performance.now() - t0) / 1000).toFixed(2)} s`)

/** The map cut into tiles, and what the report prints about the build; every other intermediate is gone once it returns. */
const cutBuilt = async () => {
  const { ground, ...src } = await readSources(ROOT, lap)
  const terrain = buildTerrain(src, ground, lap)
  const world = buildWorld(src, terrain, lap)
  const built = assembleMap(src, terrain, world)
  lap("cover")
  return {
    cut: cutMap(built, REGION.file),
    report: {
      rail: src.railReport,
      running: src.rail.length,
      extra: src.extra.length,
      bed: terrain.bed,
      lines: world.lines,
      platforms: world.platforms,
      clear: world.clearReport,
      blockedCells: world.blockedCells,
      shoreWalls: built.walls.shore.length / 4,
      trees: built.trees.length / 3,
    },
  }
}

const { cut, report } = await cutBuilt()
const written = await writeMap(
  cut,
  join(ROOT, `src/sim/map/${REGION.file}.bin`),
  join(ROOT, `src/sim/map/${REGION.file}`),
  lap,
)
const map = written.global

printRail(report.rail, report.platforms)

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
  hash: map.hash,
  tiles: written.tiles,
  bytes: written.bytes,
  largestTile: written.largest,
  roads: map.roads.length,
  buildings: map.buildings.length,
  water: map.water.length,
  rail: map.rail.length,
  ...railSummary({
    report: report.rail,
    running: report.running,
    extra: report.extra,
    bed: report.bed,
    lines: report.lines,
    stations: map.railway.stations,
    crossings: map.railway.crossings,
    verges: report.clear,
    roadName: (i) => map.roads[i]!.name ?? String(map.roads[i]!.id),
    roadId: (i) => map.roads[i]!.id,
  }),
  areas: map.areas.length,
  wallsWalk: map.walls.counts.walk,
  wallsShore: report.shoreWalls,
  wallsDrive: map.walls.counts.drive,
  blockedCells: report.blockedCells,
  nodes: map.graph.xy.length / 2,
  edges: map.graph.edges.length / 3,
  traffic: map.graph.traffic.length,
  walk: map.graph.walk.length,
  trees: report.trees,
  parked: map.spawns.parked.length,
  player: map.spawns.player,
  grades,
  // the files' parts before gzip (the global JSON line and coarse grid, the tiles' sections summed), and the JSON line's biggest fields
  sizes: {
    ...Object.fromEntries(Object.entries(written.sizes).map(([part, n]) => [part, kb(n)])),
    graph: jsonKb(map.graph),
    roads: jsonKb(map.roads),
    buildings: jsonKb(map.buildings),
    areas: jsonKb(map.areas),
  },
})

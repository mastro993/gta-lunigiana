// The map build's phase on the finished terrain: the railway (lines, platforms, stations), the
// collision walls, the trees, the road graph, the level-crossing boxes and verges, and the spawns.
// The clearance indexes the spawns and the graph's dead ends are checked against go out of scope
// here.
import { isDrivable } from "../sim/map/kinds.ts"
import type { Sources } from "./build-sources.ts"
import type { Terrain } from "./build-terrain.ts"
import { flatLine, r1 } from "./geometry.ts"
import { buildGraph } from "./graph.ts"
import { onOutline } from "./play-area.ts"
import { lifted } from "./profiles.ts"
import { clearVerges } from "./rail-clear.ts"
import { crossingBoxes, layRailway, toRailLines } from "./railway.ts"
import { REGION } from "./region.ts"
import { clearance, parkedSpots, playerSpawn } from "./spawns.ts"
import { sampleGrid } from "./terrain.ts"
import { scatterTrees } from "./trees.ts"
import { buildWalls } from "./walls.ts"

/** Room for a car to stop and turn (map.map-test.ts asks the same of every traffic dead end). */
const TURN = 2.3

/** The railway, walls, trees, graph and spawns on `terrain`; `lap` marks the end of each stage. */
export const buildWorld = (src: Sources, terrain: Terrain, lap: (label: string) => void) => {
  const { allRail, roads, water, buildings, barriers, pois, areas } = src
  const { grid, railLines, roadLines, levels } = terrain
  const at = (x: number, y: number) => sampleGrid(grid, x, y)
  // ---- the railway: lines over the running track, the platforms beside them, the stations ----
  // A line's terminal: a dead end on the play area's outline, where the track runs on beyond it.
  const { shipped, lines, kinds, platforms, stations } = layRailway(
    railLines,
    (x, y) => onOutline(x, y),
    {
      polygons: src.platforms,
      roads: roads.flatMap((r) =>
        isDrivable(r.cls) && !lifted(r) ? [{ pts: flatLine(r.pts), w: r.w }] : [],
      ),
      crossings: src.railCrossings,
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
  const graph = buildGraph(roads, (x, y) => driveClear.circle(x, y, TURN))
  // Level crossings: boxes of crossing nodes on one road; then no verge or lane beside the running track.
  const crossingNodes = levels.map(({ road, piece, v, vertex }) => ({
    road,
    node: graph.ids.get(v.id!)!,
    x: r1(v.x),
    y: r1(v.y),
    piece,
    vertex,
  }))
  const levelCrossings = crossingBoxes(crossingNodes, lines, shipped)
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
  const station = poi(REGION.id === "lunigiana" ? 1813987803 : 827592490),
    carabinieri = poi(REGION.id === "lunigiana" ? 14183344901 : 806564311)
  const central =
    REGION.id === "lunigiana"
      ? []
      : graph.traffic
          .map((edge) => {
            const node = graph.edges[3 * edge]!,
              road = graph.edges[3 * edge + 2]!
            const x = graph.xy[2 * node]!,
              y = graph.xy[2 * node + 1]!
            return { road: roads[road]!, x, y, distance: Math.hypot(x, y) }
          })
          .sort((a, b) => a.distance - b.distance)
  const start = central[0]
  if (REGION.id === "cesena" && start === undefined)
    throw new Error("Cesena has no connected traffic roads")
  const player = playerSpawn(
    roads,
    walkClear,
    driveClear,
    start ?? carabinieri,
    buildings,
    start?.road,
  )
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
  return {
    walls: { walk: walls.walk, shore: walls.shore, drive: walls.drive },
    blockedCells: { walk: walls.walkCells, shore: walls.shoreCells, drive: walls.driveCells },
    trees,
    graph: { xy: graph.xy, edges: graph.edges, traffic: graph.traffic, walk: graph.walk },
    verges,
    clearReport,
    spawns: { player, parked },
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
    /** Each rail piece's kind (none on a line). */
    kinds,
    /** The lines and platforms as laid, for the build's report. */
    lines,
    platforms,
  }
}

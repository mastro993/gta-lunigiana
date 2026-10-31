// The map build's first phase: the pinned inputs in data/raw (OSM, the CTR, the DTM, the land
// cover) read into features, the rail conflated onto the CTR, and the districts fitted, so the OSM
// and the CTR go out of scope before the terrain is built.
import { join } from "node:path"

import type { Area, Barrier, District } from "../sim/map/index.ts"
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
} from "./features.ts"
import { pointInRing, r1 } from "./geometry.ts"
import { readOsm } from "./osm.ts"
import { clipBeyond, heldInPlay } from "./play-area.ts"
import { REGION } from "./region.ts"
import { loadDtm, loadGeoDtm } from "./terrain.ts"
import { readUcs } from "./ucs.ts"
import { clipBuildings, openBarriers } from "./walls.ts"

/** The features every later phase reads (the DTM apart: only the terrain reads it). */
export type Sources = Omit<Awaited<ReturnType<typeof readSources>>, "dem">

/** Reads the region's inputs under `root` into features; `lap` marks the end of each stage. */
export const readSources = async (root: string, lap: (label: string) => void) => {
  const lunigiana = REGION.id === "lunigiana"
  const osm = readOsm(join(root, `data/raw/${REGION.id}.osm.gz`))
  const ctr = lunigiana
    ? readCtr(join(root, "data/raw/rt/ctr"))
    : { buildings: [], roadAreas: [], mapped: [] }
  const dem = lunigiana
    ? loadDtm(join(root, "data/raw/rt"))
    : await loadGeoDtm(join(root, "data/raw/cesena/dtm.tif"))
  const ctrRail = lunigiana
    ? readCtrRail(join(root, "data/raw/rt/ctr"))
    : { tracks: [], bridges: [], tunnels: [], platforms: [], crossings: [] }
  // The level crossings the play area holds: the rail and roads are cut at its outline, so one
  // beyond it would hold no level-crossing node.
  const crossings = heldInPlay(ctrRail.crossings)
  // OSM's rail on the CTR's surveyed tracks, plus the tracks only the CTR has; level-crossing nodes
  // slide along their roads with it, and what its bridges span stays under them (water widths
  // depend on the way's mean ground, so the terrain is loaded first).
  const { rail, extra, roads, water, moves, report } = conflateRail(
    extractRail(osm),
    extractRoads(osm),
    extractWater(osm, dem.at),
    { ...ctrRail, crossings },
    lunigiana ? undefined : { drop: new Set(), reserved: new Set(), swap: new Map() },
  )
  lap("rail")
  fitRoads(roads, ctr.roadAreas, ctr.mapped)
  nameFromAddresses(osm, roads)
  const { held, beyond: buildingsBeyond } = extractBuildings(osm, ctr)
  const buildings = clipBuildings(held, roads),
    barriers: Array<Barrier> = openBarriers(extractBarriers(osm), roads),
    // Stops and the Equi foot crossing stand where the rail took their nodes.
    pois = extractPois(osm).map((p) => {
      const to = p.kind.startsWith("area:") ? undefined : moves.get(String(p.id))
      return to === undefined ? p : { ...p, x: r1(to.x), y: r1(to.y) }
    })
  const osmAreas = extractAreas(osm)
  const areas: Array<Area> = [
    ...osmAreas.filter((a) => a.kind !== "platform"),
    ...(lunigiana ? readUcs(join(root, "data/raw/rt/ucs.json.gz")) : []), // rock, pastures and quarries OSM lacks above the woods
    ...ctr.roadAreas.filter((a) => a.paved).map((a) => ({ kind: "paved", rings: a.rings })), // squares, lay-bys
  ]
  const inCtr = (ring: ReadonlyArray<number>) =>
    ctr.mapped.some((m) => pointInRing(ring[0]!, ring[1]!, m))
  // The platforms: the CTR's where its sheets map the ground, OSM's elsewhere; those the play area
  // holds, as one beyond it would stand by the stub of rail its outline leaves.
  const platforms = heldInPlay([
    ...ctrRail.platforms,
    ...osmAreas
      .filter((a) => a.kind === "platform" && !inCtr(a.rings[0]!))
      .map((a, i) => ({ src: `OSM platform ${i}`, rings: a.rings })),
  ])
  const districts: Array<District> = fitDistricts(osm, buildings)
  // What the map leaves out beyond the play area, in the built terrain's box: the trees keep off its
  // roads (as wide as the CTR maps them), water, rail and buildings there as they do in play.
  const beyond = {
    roads: extractRoads(osm, clipBeyond),
    water: extractWater(osm, dem.at, clipBeyond),
    rail: extractRail(osm, clipBeyond),
    buildings: buildingsBeyond,
  }
  fitRoads(beyond.roads, ctr.roadAreas, ctr.mapped)
  lap("features")
  return {
    /** The uncarved terrain (the LiDAR DTM, or Cesena's GeoTIFF). */
    dem,
    rail,
    extra,
    allRail: [...rail, ...extra],
    roads,
    water,
    railReport: report,
    buildings,
    barriers,
    pois,
    areas,
    platforms,
    railCrossings: crossings.map((c) => c.rings),
    districts,
    /** The roads, water, rail and buildings beyond the play area, for the trees alone. */
    beyond,
  }
}

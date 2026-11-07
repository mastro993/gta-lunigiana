// The map build's first phase: the pinned inputs in data/raw (OSM, the surveys of the ground, the
// DTM, the land cover; Regione Toscana's and each part's Regione Liguria's) read into features, the
// rail conflated onto the CTR, and the districts fitted, so the OSM and the surveys go out of scope
// before the terrain is built.
import { join } from "node:path"

import type { Area, Barrier, District } from "../sim/map/index.ts"
import { isWaterArea } from "../sim/map/kinds.ts"
import { conflateRail } from "./conflate.ts"
import { readCtrRail, splitIn } from "./ctr-rail.ts"
import { fitRoads } from "./ctr.ts"
import { fitDistricts } from "./districts.ts"
import { loadDtm, loadGeoDtm } from "./dtm.ts"
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
import { centroid, pointInRing, r1, type V } from "./geometry.ts"
import { ligFolders } from "./liguria.ts"
import { readOsms } from "./osm.ts"
import { clipBeyond, heldInPlay } from "./play-area.ts"
import { REGION, dtmDir, inputParts, osmFiles, ucsFile } from "./region.ts"
import { NO_SURVEY, readSurveys } from "./surveys.ts"
import { readUcs } from "./ucs.ts"
import { clipBuildings, openBarriers } from "./walls.ts"

/** Whether two water areas draw the same water: either's centroid lies in the other's outer ring. */
const overlap = (a: Area, b: Area): boolean => {
  if (!isWaterArea(b.kind)) return false
  const [ax, ay] = centroid(a.rings[0]!),
    [bx, by] = centroid(b.rings[0]!)
  return pointInRing(ax, ay, b.rings[0]!) || pointInRing(bx, by, a.rings[0]!)
}

/** The features every later phase reads (the DTM apart: only the terrain reads it). */
export type Sources = Omit<Awaited<ReturnType<typeof readSources>>, "dem">

/** Reads the region's inputs under `root` into features; `lap` marks the end of each stage. */
export const readSources = async (root: string, lap: (label: string) => void) => {
  const lunigiana = REGION.id === "lunigiana"
  /** Each part's Regione Liguria sources (fetch-lig), where it has some. */
  const lig = ligFolders(root, REGION.parts)
  // Every part's extract, merged by id (fetch-osm writes one a part).
  const osm = readOsms(osmFiles(REGION).map((file) => join(root, file)))
  const { survey, ctr2019 } = lunigiana
    ? readSurveys(join(root, "data/raw/rt"), lig)
    : { survey: NO_SURVEY, ctr2019: NO_SURVEY }
  const dem = lunigiana
    ? loadDtm(join(root, dtmDir(REGION)), REGION)
    : await loadGeoDtm(join(root, "data/raw/cesena/dtm.tif"))
  const ctrRail = lunigiana
    ? readCtrRail(join(root, "data/raw/rt/ctr"))
    : { tracks: [], bridges: [], tunnels: [], platforms: [], crossings: [] }
  // The level crossings the play area holds: the rail and roads are cut at its outline, so one
  // beyond it would hold no level-crossing node.
  const crossings = heldInPlay(ctrRail.crossings)
  // A culvert under a CTR rail bridge runs in the open, under its span: OSM maps the Canale di
  // Campiglia's pass under the line by Gassano as one (way 865496237), under the CTR's 6.7 m bridge,
  // its channel open under it on the 2010 and 2023 orthophotos.
  const bridges = ctrRail.bridges.map((b) => b.rings)
  const openCulvert = (pts: ReadonlyArray<V>) => splitIn(pts, bridges).some((run) => run.inside)
  // OSM's rail on the CTR's surveyed tracks, plus the tracks only the CTR has; level-crossing nodes
  // slide along their roads with it, and what its bridges span stays under them (water widths
  // depend on the way's mean ground, so the terrain is loaded first).
  const { rail, extra, roads, water, moves, report } = conflateRail(
    extractRail(osm),
    extractRoads(osm),
    extractWater(osm, dem.at, undefined, openCulvert),
    { ...ctrRail, crossings },
    lunigiana ? undefined : { drop: new Set(), reserved: new Set(), swap: new Map() },
  )
  lap("rail")
  fitRoads(roads, survey.roadAreas, survey.mapped)
  nameFromAddresses(osm, roads)
  const { held, beyond: buildingsBeyond } = extractBuildings(osm, survey)
  const buildings = clipBuildings(held, roads),
    barriers: Array<Barrier> = openBarriers(extractBarriers(osm), roads),
    // Stops and the Equi foot crossing stand where the rail took their nodes.
    pois = extractPois(osm).map((p) => {
      const to = p.kind.startsWith("area:") ? undefined : moves.get(String(p.id))
      return to === undefined ? p : { ...p, x: r1(to.x), y: r1(to.y) }
    })
  // Lunigiana's orchards with no trees tag are olive groves low down (`extractAreas`).
  const osmAreas = extractAreas(osm, lunigiana ? dem.at : undefined)
  const areas: Array<Area> = [
    ...osmAreas.filter((a) => a.kind !== "platform"),
    // Rock, pastures and quarries OSM lacks above the woods, the rivers' gravel, the woods by type
    // (they refine OSM's, and fill only ground no OSM area claims: `FILL` in sim/map/raster.ts),
    // the olive groves and vineyards OSM lacks on the hills, and the water bodies OSM lacks (OSM's
    // own draws the same water finer, with its level).
    ...(lunigiana
      ? readUcs([
          ...inputParts(REGION).map((part) => join(root, ucsFile(part))),
          ...lig.map((dir) => join(dir, "uds.json.gz")),
        ]).filter((a) => !isWaterArea(a.kind) || !osmAreas.some((o) => overlap(a, o)))
      : []),
    ...survey.roadAreas.filter((a) => a.paved).map((a) => ({ kind: "paved", rings: a.rings })), // squares, lay-bys
  ]
  const inCtr = (ring: ReadonlyArray<number>) =>
    ctr2019.mapped.some((m) => pointInRing(ring[0]!, ring[1]!, m))
  // The platforms: the 2019 CTR's where its sheets map the ground (the only survey whose rail is
  // read), OSM's elsewhere; those the play area holds, as one beyond it would stand by the stub of
  // rail its outline leaves.
  const platforms = heldInPlay([
    ...ctrRail.platforms,
    ...osmAreas
      .filter((a) => a.kind === "platform" && !inCtr(a.rings[0]!))
      .map((a, i) => ({ src: `OSM platform ${i}`, rings: a.rings })),
  ])
  const districts: Array<District> = fitDistricts(osm, buildings)
  // What the map leaves out beyond the play area, in the built terrain's box: the trees keep off its
  // roads (as wide as the surveys map them), water, rail and buildings there as they do in play, and
  // the catchments burn its water, so a river the outline cuts drains on down it (catchment.ts).
  const beyond = {
    roads: extractRoads(osm, clipBeyond),
    water: extractWater(osm, dem.at, clipBeyond, openCulvert),
    rail: extractRail(osm, clipBeyond),
    buildings: buildingsBeyond,
  }
  fitRoads(beyond.roads, survey.roadAreas, survey.mapped)
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
    /** The roads, water, rail and buildings beyond the play area, for the trees, and its water for the catchments. */
    beyond,
  }
}

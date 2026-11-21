// The map build's first phase: the pinned inputs in data/raw (OSM, the surveys of the ground, the
// DTM, the land cover; Regione Toscana's and each part's Regione Liguria's, its beaches and its sea
// floor's isobaths among them) read into features, the shore and the sea from OSM's coastline among
// them, the sea's floor from the isobaths, the rail conflated onto
// the CTR, and the districts fitted, so the OSM and the surveys go out of scope before the terrain
// is built.
import { existsSync } from "node:fs"
import { join } from "node:path"

import type { Area, Barrier, District } from "../sim/map/index.ts"
import { isWaterArea, TILE } from "../sim/map/kinds.ts"
import { nameFromAddresses } from "./addresses.ts"
import { coastIndex, coastLines, seaAreas, shoreLines } from "./coast.ts"
import { conflateRail } from "./conflate.ts"
import { readCtrRail, splitIn } from "./ctr-rail.ts"
import { fitRoads } from "./ctr.ts"
import { fitDistricts } from "./districts.ts"
import { type Dem, loadDtm, loadGeoDtm, sourceAreas } from "./dtm.ts"
import {
  extractAreas,
  extractBarriers,
  extractBuildings,
  extractGoneRail,
  extractPois,
  extractRail,
  extractRoads,
  extractWater,
} from "./features.ts"
import { centroid, pointInRing, r1, type V } from "./geometry.ts"
import { ligFolders } from "./liguria.ts"
import { readOsms } from "./osm.ts"
import { clipBeyond, heldInPlay, inPlay } from "./play-area.ts"
import { underRail } from "./rail-crossings.ts"
import { routeEnds } from "./rail-routes.ts"
import { REGION, dtmDir, osmFiles, type Rect, ucsFile, ucsParts } from "./region.ts"
import { seaFloor } from "./sea-floor.ts"
import { extractShore, holedSea, offBeaches, splitPiers } from "./shore.ts"
import { NO_SURVEY, readSurveys } from "./surveys.ts"
import { readIsobaths, readSpiagge, readUcs } from "./ucs.ts"
import { clipBuildings, openBarriers } from "./walls.ts"
import { inAreas } from "./water-areas.ts"

/** Whether two water areas draw the same water: either's centroid lies in the other's outer ring. */
const overlap = (a: Area, b: Area): boolean => {
  const [ax, ay] = centroid(a.rings[0]!),
    [bx, by] = centroid(b.rings[0]!)
  return pointInRing(ax, ay, b.rings[0]!) || pointInRing(bx, by, a.rings[0]!)
}

/** Each listed tile's square cut to the region's bounds: the boxes the sea is closed over (`seaAreas`). */
const tileBoxes = (): Array<Rect> => {
  const { minX, minY, maxX, maxY } = REGION.bounds
  return REGION.tiles.map(({ i, j }) => [
    Math.max(minX, i * TILE),
    Math.max(minY, j * TILE),
    Math.min(maxX, (i + 1) * TILE),
    Math.min(maxY, (j + 1) * TILE),
  ])
}

/** The features every later phase reads (the DTM apart: only the terrain reads it; and the report's terrain sources). */
export type Sources = Omit<Awaited<ReturnType<typeof readSources>>, "dem" | "terrainSources">

/** Reads the region's inputs under `root` into features; `lap` marks the end of each stage. */
export const readSources = async (root: string, lap: (label: string) => void) => {
  const lunigiana = REGION.id === "lunigiana"
  /** Each part's Regione Liguria sources (fetch-lig), where it has some. */
  const lig = ligFolders(root, REGION.parts)
  // Every part's extract, merged by id (fetch-osm writes one a part).
  const osm = readOsms(osmFiles(REGION).map((file) => join(root, file)))
  // Liguria's beaches (Spiagge), where a part's sources hold them; the shore; and the sea, closed
  // from OSM's coastline over each listed tile (none where the extracts hold no coastline), the
  // breakwaters off the beach cut out of it.
  const ligFiles = (name: string) =>
    lig.map((dir) => join(dir, name)).filter((file) => existsSync(file))
  const beaches = readSpiagge(ligFiles("spiagge.json.gz"))
  const shore = extractShore(osm, beaches)
  const coast = coastLines(osm),
    sea = holedSea(seaAreas(coast, tileBoxes()), shore.raised)
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
  // OSM's rail on the CTR's surveyed tracks, plus the tracks only the CTR has but where OSM maps
  // the rails gone; level-crossing nodes slide along their roads with it, and what its bridges span
  // stays under them (water widths depend on the way's mean ground, so the terrain is loaded first).
  // A road OSM lays under the track with no tunnel tag runs under it (`underRail`).
  const osmRail = extractRail(osm)
  const { rail, extra, roads, water, moves, report } = conflateRail(
    osmRail,
    underRail(extractRoads(osm), osmRail),
    extractWater(osm, dem.at, undefined, openCulvert),
    { ...ctrRail, crossings },
    lunigiana ? undefined : { drop: new Set(), reserved: new Set(), swap: new Map() },
    extractGoneRail(osm),
  )
  lap("rail")
  fitRoads(roads, survey.roadAreas, survey.mapped)
  nameFromAddresses(osm, roads)
  // Lunigiana's orchards with no trees tag are olive groves low down (`extractAreas`).
  const osmAreas = extractAreas(osm, lunigiana ? dem.at : undefined),
    drawnWater = [...osmAreas, ...sea].filter((a) => isWaterArea(a.kind))
  // The sea's floor rises to the shore, the coastline less where it closes a river or a lake across
  // its mouth, from Liguria's survey of it (its isobaths, where a part's sources hold them).
  const shoreline = coastIndex(
    shoreLines(
      coast,
      inAreas(osmAreas, (k) => k === "river" || k === "lake"),
    ),
  )
  const floor = seaFloor(shoreline, readIsobaths(ligFiles("isobaths.json.gz")))
  const areas: Array<Area> = [
    ...osmAreas.filter((a) => a.kind !== "platform"),
    // Rock, pastures and quarries OSM lacks above the woods, the rivers' gravel, the woods by type
    // (they refine OSM's, and fill only ground no OSM area claims: `FILL` in sim/map/raster.ts),
    // the olive groves and vineyards OSM lacks on the hills, and the water bodies OSM and the sea
    // lack (OSM's own draws the same water finer, with its level); Liguria's gravel but on its
    // beaches, whose material Spiagge gives.
    ...(lunigiana
      ? [
          ...readUcs(ucsParts(REGION).map((part) => join(root, ucsFile(part)))),
          ...offBeaches(readUcs(lig.map((dir) => join(dir, "uds.json.gz"))), beaches),
        ].filter((a) => !isWaterArea(a.kind) || !drawnWater.some((o) => overlap(a, o)))
      : []),
    ...survey.roadAreas.filter((a) => a.paved).map((a) => ({ kind: "paved", rings: a.rings })), // squares, lay-bys
    // The beaches, the piers' decks and the breakwaters, and the sea over them.
    ...shore.areas,
    ...sea,
  ]
  // The piers last, as OSM maps them (no survey maps a pier's deck), decks over the water alone.
  roads.push(
    ...splitPiers(
      shore.piers,
      areas.filter((a) => isWaterArea(a.kind)),
    ),
  )
  const { held, beyond: buildingsBeyond } = extractBuildings(osm, survey)
  const buildings = clipBuildings(held, roads),
    barriers: Array<Barrier> = openBarriers([...extractBarriers(osm), ...shore.barriers], roads),
    // Stops and the Equi foot crossing stand where the rail took their nodes.
    pois = extractPois(osm).map((p) => {
      const to = p.kind.startsWith("area:") ? undefined : moves.get(String(p.id))
      return to === undefined ? p : { ...p, x: r1(to.x), y: r1(to.y) }
    })
  // The platforms: the 2019 CTR's where its sheets map the ground (the only survey whose rail is
  // read), OSM's elsewhere, cut cell by cell at the sheets' edges (Aulla Lunigiana's run 330 m on
  // south of 24C60's, where no 2019 sheet maps the ground); those the play area holds, as one
  // beyond it would stand by the stub of rail its outline leaves.
  const platforms = heldInPlay([
    ...ctrRail.platforms,
    ...osmAreas
      .filter((a) => a.kind === "platform")
      .map((a, i) => ({ src: `OSM platform ${i}`, rings: a.rings, leftTo: ctr2019.mapped })),
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
    /**
     * The uncarved terrain (the LiDAR DTM, or Cesena's GeoTIFF), without the source of its cells,
     * which only `terrainSources` reads: they go when this returns, before the terrain (202 MB of
     * Lunigiana's).
     */
    dem: { at: dem.at, grid: dem.grid } satisfies Dem,
    /** Each terrain source's share of the play area, km² (`sourceAreas`), where the DTM says. */
    terrainSources:
      dem.source === undefined ? undefined : sourceAreas(dem.source, REGION.bounds, inPlay),
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
    /** Where OSM's train routes end, and the ways they reach those stops along (`routeEnds`): the lines' termini in play. */
    routeEnds: routeEnds(osm),
    districts,
    /** The ground raised under the piers' decks and the breakwaters (shore.ts). */
    raised: shore.raised,
    /** The sea's floor at a point (sea-floor.ts). */
    seaFloor: floor,
    /** The roads, water, rail and buildings beyond the play area, for the trees, and its water for the catchments. */
    beyond,
  }
}

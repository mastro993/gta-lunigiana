import { staticGrid } from "../sim/collide.ts"
// OSM (and for buildings the CTR) -> map features in local metres: lines clipped to the play area,
// areas to the built terrain's box, buildings to the box and kept where their centre is in play.
// Terrain-dependent fields are filled later: the lines' z by build-terrain.ts, the buildings' z0 by
// `assembleMap` (build-output.ts).
import type { Area, Barrier, Poi } from "../sim/map/index.ts"
import {
  type AreaKind,
  type BuildingStyle,
  isRoadClass,
  laneWidth,
  type RoadClass,
  ROADS,
} from "../sim/map/kinds.ts"
import type { Survey } from "./ctr.ts"
import {
  centroid,
  clipRing,
  crossings,
  flatLine,
  flatRing,
  hash01,
  pointInRing,
  r1,
  ringBox,
  TERRAIN_BOX,
  toLocal,
  type P,
  type V,
} from "./geometry.ts"
import { assembleRings, type Osm, type OsmWay, type Tags } from "./osm.ts"
import { clipPieces, inPlay, OUTLINE, type Piece } from "./play-area.ts"
import { REGION } from "./region.ts"
import { STONE_CORES } from "./stone-cores.ts"

export interface RoadF {
  readonly id: number
  readonly cls: RoadClass
  name?: string
  readonly ref?: string
  w: number
  surface: string
  readonly oneway?: true
  /** A motorway's or trunk road's slip road (OSM `motorway_link`, `trunk_link`), primary by class. */
  readonly ramp?: true
  readonly bridge?: true
  readonly tunnel?: true
  /** A tunnel through a building (OSM `tunnel=building_passage`). */
  readonly passage?: true
  readonly layer?: number
  /** OSM maxheight (m) of an underpass. */
  readonly maxheight?: number
  readonly private: boolean
  readonly pts: ReadonlyArray<V>
}
export interface WaterF {
  readonly id: number
  readonly kind: "river" | "stream"
  readonly name?: string
  readonly w: number
  readonly bed: number
  readonly depth: number
  readonly pts: ReadonlyArray<V>
  /**
   * How far along its OSM way the piece starts, m (0 unless the play area's outline cut the way
   * before it): the bank trees count their steps from the way's start, so the steps stay put as
   * the play area grows (how far a tree stands from the centreline follows the piece's bed).
   */
  readonly from: number
}
/**
 * A `railway=rail` way (or a track only the CTR has, with a negative id) as the build carries it;
 * pieces cut from one way (at bridges, junctions) keep its id.
 */
export interface RailF {
  readonly id: number
  readonly bridge?: true
  readonly tunnel?: true
  /** OSM `maxspeed`, km/h. */
  readonly maxspeed?: number
  readonly pts: ReadonlyArray<V>
}
export interface BuildingF {
  readonly id: number
  readonly kind: string
  readonly name?: string
  /** Wall height when there is no surveyed `eave`, m. */
  readonly h: number
  /** Surveyed eave elevation (CTR), m a.s.l. */
  readonly eave?: number
  readonly style: BuildingStyle
  readonly ruins?: true
  readonly tint: number
  readonly outer: ReadonlyArray<number>
  readonly holes?: ReadonlyArray<ReadonlyArray<number>>
}

const vertices = (osm: Osm, nds: ReadonlyArray<string>): Array<V> =>
  nds.map((id) => {
    const n = osm.nodes.get(id)!
    const [x, y] = toLocal(n.lat, n.lon)
    return { x, y, id }
  })
/** The nodes of `osm` more than one way runs through, by id. */
const sharedNodes = (() => {
  const of = new WeakMap<Osm, Set<string>>()
  return (osm: Osm): Set<string> => {
    let shared = of.get(osm)
    if (shared !== undefined) return shared
    const seen = new Set<string>()
    shared = new Set()
    for (const w of osm.ways.values())
      for (const id of new Set(w.nds)) (seen.has(id) ? shared : seen).add(id)
    of.set(osm, shared)
    return shared
  }
})()
/**
 * A way's vertices as a line, each on its own 0.1 m point (the grid `flatLine` rounds to): of two
 * nodes in a row on one point, the one another way shares stays, else the first, so a junction
 * keeps the id the road graph, the catchments and the culverts join by. An edit glued four
 * streams' junctions 0.008–0.073 m from their next node (the Torrente Mommio's twice).
 */
const lineVertices = (osm: Osm, nds: ReadonlyArray<string>): Array<V> => {
  const shared = sharedNodes(osm),
    out: Array<V> = []
  for (const v of vertices(osm, nds)) {
    const last = out.at(-1)
    if (last === undefined || r1(last.x) !== r1(v.x) || r1(last.y) !== r1(v.y)) out.push(v)
    else if (!shared.has(last.id!) && shared.has(v.id!)) out[out.length - 1] = v
  }
  return out
}
const ringOf = (osm: Osm, nds: ReadonlyArray<string>): Array<P> =>
  vertices(osm, nds.slice(0, -1)).map((v) => [v.x, v.y])
const closed = (w: OsmWay) => w.nds.length > 3 && w.nds[0] === w.nds.at(-1)

/**
 * OSM highway values folded into a road class: each link into the class below (a slip road is
 * narrower and slower than its road; it keeps its `oneway`), living streets drive like residential
 * streets, footways and pedestrian lanes are walked like paths.
 */
const FOLDED: Readonly<Partial<Record<string, RoadClass>>> = {
  motorway_link: "primary",
  trunk_link: "primary",
  primary_link: "secondary",
  secondary_link: "tertiary",
  tertiary_link: "tertiary",
  living_street: "residential",
  footway: "path",
  pedestrian: "path",
}
const CITY_FOLDED: Readonly<Partial<Record<string, RoadClass>>> = {
  cycleway: "path",
}
const classOf = (t: Tags): RoadClass | undefined => {
  if (t.highway === undefined || t.area === "yes") return undefined // squares are areas
  return isRoadClass(t.highway)
    ? t.highway
    : (FOLDED[t.highway] ?? (REGION.id === "cesena" ? CITY_FOLDED[t.highway] : undefined))
}

/**
 * How the extractors cut a line into pieces: to the play area, for the map (the default), or to
 * what lies beyond it in the built terrain's box (`clipBeyond`), for the trees to keep off.
 */
type Clip = (pts: ReadonlyArray<V>) => Array<Piece>
const toPlay: Clip = (pts) => clipPieces(OUTLINE, pts)

/** The highways, cut by `clip`, each piece keeping its way's id and tags. */
export const extractRoads = (osm: Osm, clip: Clip = toPlay): Array<RoadF> =>
  [...osm.ways.values()].flatMap((w) => {
    const t = w.tags,
      cls = classOf(t)
    // A platform OSM draws as a line (a `highway=footway` along its edge, Pieve San Lorenzo's) is
    // the platform, not a path beside the track: the map takes the platforms from the CTR's outlines
    // or OSM's areas (`extractAreas`).
    if (cls === undefined || t.railway === "platform") return []
    // OSM implies `oneway` on motorways, their links and roundabouts, drawn in their direction of travel.
    const oneway =
      t.oneway === "yes" ||
      (t.oneway === undefined &&
        (t.highway === "motorway" ||
          t.highway === "motorway_link" ||
          t.junction === "roundabout" ||
          t.junction === "circular"))
    const lanes = parseInt(t.lanes ?? "", 10),
      width = (lanes >= 1 ? laneWidth(cls, lanes) : undefined) ?? ROADS[cls].w
    return clip(lineVertices(osm, w.nds)).map(({ pts }): RoadF => ({
      id: +w.id,
      cls,
      ...(t.name ? { name: t.name } : {}),
      ...(t.ref ? { ref: t.ref } : {}),
      w: width,
      surface: t.surface ?? (ROADS[cls].paved ? "asphalt" : "unpaved"),
      ...(oneway ? { oneway: true } : {}),
      ...(t.highway === "motorway_link" || t.highway === "trunk_link" ? { ramp: true } : {}),
      ...(t.bridge !== undefined && t.bridge !== "no" ? { bridge: true } : {}),
      ...(t.tunnel !== undefined && t.tunnel !== "no" ? { tunnel: true } : {}),
      ...(t.tunnel === "building_passage" ? { passage: true } : {}),
      ...(t.layer ? { layer: +t.layer } : {}),
      ...(t.maxheight !== undefined && !Number.isNaN(parseFloat(t.maxheight))
        ? { maxheight: parseFloat(t.maxheight) }
        : {}),
      private: t.access === "private" || t.access === "no",
      pts,
    }))
  })

/**
 * Names a street only has on addresses (addr:street of POIs): each goes to the unnamed road whose
 * vertices are nearest to most of its addresses.
 */
export const nameFromAddresses = (osm: Osm, roads: ReadonlyArray<RoadF>): void => {
  const votes = new Map<string, Map<number, number>>()
  for (const n of osm.nodes.values()) {
    const street = n.tags["addr:street"]
    if (street === undefined) continue
    const [x, y] = toLocal(n.lat, n.lon)
    let best: RoadF | undefined,
      bestD = Number.MAX_VALUE
    for (const r of roads)
      for (const p of r.pts) {
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < bestD) [best, bestD] = [r, d]
      }
    if (best === undefined || best.name !== undefined) continue
    const v = votes.get(street) ?? new Map<number, number>()
    v.set(best.id, (v.get(best.id) ?? 0) + 1)
    votes.set(street, v)
  }
  for (const [street, v] of votes) {
    const [id] = [...v].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!
    const name = street.startsWith("Via") ? street : `Via ${street}`
    for (const r of roads) if (r.id === id && r.name === undefined) r.name = name
  }
}

/** Mean ground (m) below which a Lucido or Caldanella way runs on the valley floor; above it, the stream is a wooded mountain gully. */
const MAIN_BELOW = 500
/**
 * Mean ground (m) below which a Torrente Aulella way runs in its open valley bed: halfway between
 * lucido's 788514356 (282.2 m), its last way under the Tassonaro's mouth, and 788514364 (294.3 m),
 * the first of the wooded gorge above it.
 */
const AULELLA_VALLEY_BELOW = 288
/** Mean ground (m) below which the Aulella's gorge keeps its bed: above it, past its first big tributary over Casola, its floor narrows to a headwater's (LiDAR 4–6.5 m against 6–8 m). */
const AULELLA_GORGE_BELOW = 350
/** Mean ground (m) below which the Torrente Mommio keeps its bed: its floor narrows between 766 m (way 788514696) and 782 m (788514702). */
const MOMMIO_GORGE_BELOW = 775
/**
 * Mean ground (m) below which a Torrente Bardine way runs in its open valley bed: halfway between
 * fosdinovo's 790365291 (87.8 m), its last above the Fosso del Lombardello's mouth by Bardine (OSM
 * node 7389111706), and 790365292 (81.8 m), the first below it: below that mouth its gravel bed
 * widens to the Aulella valley's (a median 27 m against the trunk's 15 m above).
 */
const BARDINE_VALLEY_BELOW = 85
/**
 * Mean ground (m) below which a Torrente Bardine way carries the Bardinello's water: halfway between
 * 797861302 (141.0 m), its first below the Bardinello's mouth (node 7462482431), and 797861301
 * (149.5 m), its 3.6 km² head down from the Canale del Vezzanello.
 */
const BARDINE_BED_BELOW = 145
/**
 * Mean ground (m) below which a Torrente Bardinello way runs in the Bardine's gravel bed: halfway
 * between 797861257 (150.4 m), its first below the Torrente Pesciola's mouth (node 7462482051, 33
 * km² there), and 797861254 (156.9 m, 15 km²), its last above it.
 */
const BARDINELLO_BED_BELOW = 154
/**
 * Mean ground (m) below which the Torrente Bardinello is a wooded torrent: halfway between 797860930
 * (265.7 m), its first below the Canale Caldia's mouth (node 7462477158), where it drains 9.3 km²
 * and its LiDAR floor widens from a headwater's 6 m to the wooded torrents' 7-7.5 m, and 797860907
 * (268.9 m, 7.0 km²).
 */
const BARDINELLO_GORGE_BELOW = 267

/**
 * Water width, gravel-bed half-width and depth, m, from the way's name, kind and mean ground `z`
 * (LiDAR, over its vertices). The rivers are measured on the 2010 orthophoto: the Aulella runs in
 * a 25-35 m gravel bed at Gragnola (a wooded 10 m channel at Codiponte), the Lucido in a 22 m one
 * below Monzone, the Rosaro in a 10-28 m one (median 13-15 m, its water 2-8 m) from Fivizzano to
 * Soliera. The Bardine runs in an 18-47 m one (median 27 m, its water 4-18 m, median 10) from
 * Bardine to the map's edge, as wide as the Aulella; above, from the Bardinello's mouth, and the
 * Bardinello below the Pesciola's, in a 6-32 m one (median 15 m, its water 2.5-12 m, upper quartile
 * 7), as the Rosaro (issue #18). The Lucido's Vinca branch and the Caldanella (from Equi) are the
 * main streams on the valley floor (5-16 m of open marble gravel below 400 m). The Aulella's gorge
 * above the Tassonaro's mouth, the Rosaro above Fivizzano, the Mommio and the Bardinello above the
 * Pesciola's mouth are torrents of 9-49 km² in closed woods, whose canopy gaps show 3-10 m of bed
 * over a LiDAR floor of 7-7.5 m (`wooded`, issue #17). Above Vinca the Lucido runs in a beech-wood
 * gully with only 3-6 m of bed showing, like the other named streams (4 m), the Torrente Pesciola
 * among them, unmeasured though its lower course drains 9-18 km²; unnamed ones are 2 m. The depths
 * are the classes' own, as no photo shows them.
 */
const waterSize = (
  name: string | undefined,
  kind: "river" | "stream",
  z: number,
): { readonly w: number; readonly bed: number; readonly depth: number } => {
  if (
    (name === "Torrente Aulella" && z < AULELLA_VALLEY_BELOW) ||
    (name === "Torrente Bardine" && z < BARDINE_VALLEY_BELOW)
  )
    return { w: 12, bed: 13, depth: 2.5 }
  if (name === "Torrente Lucido" && kind === "river") return { w: 14, bed: 11, depth: 2.5 }
  if (
    (name === "Torrente Rosaro" && kind === "river") ||
    (name === "Torrente Bardine" && z < BARDINE_BED_BELOW) ||
    (name === "Torrente Bardinello" && z < BARDINELLO_BED_BELOW)
  )
    return { w: 7, bed: 7, depth: 2.5 }
  const main = (name === "Torrente Lucido" || name === "Torrente Caldanella") && z < MAIN_BELOW
  const wooded =
    (name === "Torrente Aulella" && z < AULELLA_GORGE_BELOW) ||
    name === "Torrente Rosaro" ||
    (name === "Torrente Mommio" && z < MOMMIO_GORGE_BELOW) ||
    (name === "Torrente Bardinello" && z < BARDINELLO_GORGE_BELOW)
  const w = main ? 8 : wooded ? 6 : name === undefined ? 2 : 4
  return {
    w,
    bed: Math.max(w / 2 + 1, 3),
    depth: kind === "river" ? 2.5 : main || wooded ? 1.5 : 1,
  }
}

/** Median cross-section between mapped riverbanks; missing outlines leave the existing default. */
const mappedRiverWidth = (
  pts: ReadonlyArray<V>,
  banks: ReadonlyArray<ReadonlyArray<V>>,
): number | undefined => {
  const widths: Array<number> = []
  for (let index = 1; index < pts.length; index++) {
    const start = pts[index - 1]!,
      end = pts[index]!
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (length < 1) continue
    const x = (start.x + end.x) / 2,
      y = (start.y + end.y) / 2
    const nx = -(end.y - start.y) / length,
      ny = (end.x - start.x) / length
    const section = [
      { x: x - nx * 200, y: y - ny * 200 },
      { x: x + nx * 200, y: y + ny * 200 },
    ]
    for (const bank of banks) {
      const hits = crossings(section, bank)
        .map((hit) => hit.sa)
        .sort((a, b) => a - b)
      for (let hit = 0; hit + 1 < hits.length; hit += 2) {
        const left = hits[hit]!,
          right = hits[hit + 1]!
        if (left <= 200 && right >= 200 && right - left >= 2) widths.push(right - left)
      }
    }
  }
  widths.sort((a, b) => a - b)
  const width = widths[Math.floor(widths.length / 2)]
  return width === undefined ? undefined : r1(width)
}

/**
 * The waterways, cut by `clip`, sized by `ground` under each piece. A culvert is dropped, as a stream
 * crossing a road at grade dips under it (water.ts), but where `open` says it runs in the open: under
 * a bridge the surveys map (`openCulvert` in build-sources.ts).
 */
export const extractWater = (
  osm: Osm,
  ground: (x: number, y: number) => number,
  clip: Clip = toPlay,
  open: (pts: ReadonlyArray<V>) => boolean = () => false,
): Array<WaterF> => {
  const banks =
    REGION.id === "cesena"
      ? [
          ...[...osm.ways.values()]
            .filter((way) => isRiverBank(way.tags) && closed(way))
            .map((way) => vertices(osm, way.nds)),
          ...[...osm.relations.values()]
            .filter((relation) => isRiverBank(relation.tags))
            .flatMap((relation) =>
              assembleRings(osm, relation, "outer").map((ring) => vertices(osm, ring)),
            ),
        ]
      : []
  return [...osm.ways.values()]
    .filter((w) => w.tags.waterway !== undefined && w.tags.waterway !== "riverbank")
    .flatMap((w) => {
      const t = w.tags
      const kind = t.waterway === "river" ? "river" : "stream"
      const line = lineVertices(osm, w.nds)
      if (t.tunnel === "culvert" && !open(line)) return []
      return clip(line).map(({ pts, from }): WaterF => {
        const z = pts.reduce((s, p) => s + ground(p.x, p.y), 0) / pts.length
        const size = waterSize(t.name, kind, z)
        const measured =
          kind === "river" && REGION.id === "cesena" ? mappedRiverWidth(pts, banks) : undefined
        return {
          id: +w.id,
          kind,
          ...(t.name ? { name: t.name } : {}),
          ...size,
          ...(measured === undefined ? {} : { w: measured, bed: measured / 2 + 1 }),
          pts,
          from,
        }
      })
    })
}

/** `railway=rail` ways cut by `clip`, with their bridge, tunnel and speed-limit tags. */
export const extractRail = (osm: Osm, clip: Clip = toPlay): Array<RailF> =>
  [...osm.ways.values()]
    .filter((w) => w.tags.railway === "rail")
    .flatMap((w) =>
      clip(lineVertices(osm, w.nds)).map(({ pts }): RailF => ({
        id: +w.id,
        ...(w.tags.bridge !== undefined && w.tags.bridge !== "no" ? { bridge: true } : {}),
        ...(w.tags.tunnel !== undefined && w.tags.tunnel !== "no" ? { tunnel: true } : {}),
        ...(/^\d+(\.\d+)?$/.test(w.tags.maxspeed ?? "") ? { maxspeed: +w.tags.maxspeed! } : {}),
        pts,
      })),
    )

/** Generic buildings closer than this (m) form a hamlet: up to HAMLET of them take one facade style. */
const HAMLET_LINK = 25
const HAMLET = 200
/** Closer than this (m), buildings are one terrace block, which takes one style in bigger villages too. */
const BLOCK_LINK = 6

/** Stone inside the hill-village cores, plaster elsewhere. */
const genericStyle = (cx: number, cy: number): BuildingStyle =>
  REGION.id === "lunigiana" && STONE_CORES.some(([x, y, r]) => Math.hypot(cx - x, cy - y) < r)
    ? "stone"
    : "plaster"
const isGeneric = (s: BuildingStyle) => s === "plaster" || s === "stone"

const styleOf = (t: Tags, cx: number, cy: number): BuildingStyle => {
  if (t.ruins !== undefined || t.building === "ruins") return "ruin"
  if (t.building === "church" || t.amenity === "place_of_worship") return "church"
  if (t.building === "tower" || t.man_made === "tower") return "tower"
  if (t.building === "train_station") return "station"
  if (t.building === "industrial" || t.power !== undefined) return "industrial"
  return genericStyle(cx, cy)
}

/**
 * Buildings: the surveys' where they map the ground (`readSurveys`), OSM's elsewhere, each clipped to the built
 * terrain's box and kept (`held`) where the centre of its clipped outline is in the play area (an
 * outline edge inside the box may cut through a house, which then stands whole or not at all; one
 * across the box's edge stands clipped), the others `beyond` it, for the trees to keep off. A CTR
 * building inside an OSM footprint takes that building's name, and its style when the CTR only says
 * "building" and surveyed no fixed-style unit (the church itself) inside that footprint: then the
 * other units are the houses around it.
 */
export const extractBuildings = (
  osm: Osm,
  survey: Survey,
): { readonly held: Array<BuildingF>; readonly beyond: Array<BuildingF> } => {
  const fromOsm = osmBuildings(osm)
  const osmIn = staticGrid(fromOsm.length, (k) => ringBox(fromOsm[k]!.outer), 32)
  /** The index of the first OSM footprint (file order) around the point, or -1. */
  const hostOf = (x: number, y: number) => {
    let first = fromOsm.length
    osmIn(x, y, x, y, (k) => {
      if (k < first && pointInRing(x, y, fromOsm[k]!.outer)) first = k
    })
    return first < fromOsm.length ? first : -1
  }
  const hosts = survey.buildings.map((c) => hostOf(...centroid(c.outer)))
  const surveyed = new Set(
    survey.buildings.flatMap((c, i) =>
      c.style !== undefined && hosts[i]! >= 0 ? [hosts[i]!] : [],
    ),
  )
  const fromCtr = survey.buildings.map((c, i): BuildingF => {
    const [cx, cy] = centroid(c.outer)
    const host = fromOsm[hosts[i]!]
    const style =
      c.style ??
      (host !== undefined && !isGeneric(host.style) && !surveyed.has(hosts[i]!)
        ? host.style
        : genericStyle(cx, cy))
    return {
      id: c.id,
      kind: c.kind,
      ...(host?.name === undefined ? {} : { name: host.name }),
      h: c.h,
      ...(c.eave === undefined ? {} : { eave: c.eave }),
      style,
      ...(style === "ruin" ? { ruins: true } : {}),
      // The record's own number, below the id's section and source (survey-ids.ts), seeds the tint.
      tint: Math.floor(hash01(-(c.id | 0), 7) * 4),
      outer: c.outer,
      ...(c.holes === undefined ? {} : { holes: c.holes }),
    }
  })
  const unmapped = fromOsm.filter(
    (b) => !survey.mapped.some((ring) => pointInRing(...centroid(b.outer), ring)),
  )
  const all = [...unmapped, ...fromCtr],
    held = all.map((b) => inPlay(...centroid(b.outer)))
  return {
    held: unifyStyles(
      unifyStyles(
        all.filter((_, k) => held[k]),
        HAMLET_LINK,
        HAMLET,
      ),
      BLOCK_LINK,
    ),
    beyond: all.filter((_, k) => !held[k]),
  }
}

const osmBuildings = (osm: Osm): Array<BuildingF> => {
  const rels = [...osm.relations.values()].filter(
    (r) => r.tags.type === "multipolygon" && r.tags.building !== undefined,
  )
  const inRel = new Set(rels.flatMap((r) => r.members.map((m) => m.ref)))
  const make = (
    id: string,
    t: Tags,
    outer: Array<P>,
    holes: Array<Array<P>>,
  ): BuildingF | undefined => {
    const o = flatRing(clipRing(outer, TERRAIN_BOX), true)
    if (o === undefined) return undefined
    const [cx, cy] = centroid(o)
    const ruins = t.ruins !== undefined || t.building === "ruins"
    const tagged = t.height === undefined ? Number.NaN : parseFloat(t.height)
    const h = Number.isNaN(tagged) ? (ruins ? 2.5 : 6) : Math.min(Math.max(tagged, 2.5), 22)
    const hs = holes
      .map((r) => flatRing(clipRing(r, TERRAIN_BOX), false))
      .filter((r) => r !== undefined)
    return {
      id: +id,
      kind: t.building === "yes" && t.amenity === "place_of_worship" ? "church" : t.building!,
      ...(t.name ? { name: t.name } : {}),
      h: r1(h),
      style: styleOf(t, cx, cy),
      ...(ruins ? { ruins: true } : {}),
      tint: Math.floor(hash01(+id % 1e9, 7) * 4),
      outer: o,
      ...(hs.length > 0 ? { holes: hs } : {}),
    }
  }
  return [
    ...[...osm.ways.values()]
      .filter((w) => w.tags.building !== undefined && !inRel.has(w.id) && closed(w))
      .map((w) => make(w.id, w.tags, ringOf(osm, w.nds), [])),
    ...rels.flatMap((r) => {
      const inner = assembleRings(osm, r, "inner").map((ring) => ringOf(osm, ring))
      return assembleRings(osm, r, "outer").map((ring) =>
        make(r.id, r.tags, ringOf(osm, ring), inner),
      )
    }),
  ].filter((b) => b !== undefined)
}

/**
 * Plaster/stone buildings within `link` m of each other (single linkage) form clusters; each
 * cluster of at most `max` buildings takes its majority style, so it never splits at a core radius.
 */
const unifyStyles = (
  bs: ReadonlyArray<BuildingF>,
  link: number,
  max = Infinity,
): Array<BuildingF> => {
  const generic = bs.map((b) => isGeneric(b.style))
  const parent = bs.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  const near = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
    for (let i = 0; i < a.length; i += 2)
      for (let j = 0; j < b.length; j += 2)
        if (Math.hypot(a[i]! - b[j]!, a[i + 1]! - b[j + 1]!) < link) return true
    return false
  }
  // Candidate pairs: the generic footprints whose box, grown by `link`, overlaps this one's.
  const gen = bs.flatMap((_, i) => (generic[i] ? [i] : []))
  const boxes = bs.map((b) => ringBox(b.outer))
  const grid = staticGrid(
    gen.length,
    (k) => {
      const [x0, y0, x1, y1] = boxes[gen[k]!]!
      return [x0 - link, y0 - link, x1 + link, y1 + link]
    },
    64,
  )
  for (const i of gen)
    grid(...boxes[i]!, (k) => {
      const j = gen[k]!
      if (j > i && find(i) !== find(j) && near(bs[i]!.outer, bs[j]!.outer))
        parent[find(i)] = find(j)
    })
  const stone = new Map<number, number>(),
    size = new Map<number, number>()
  bs.forEach((b, i) => {
    if (!generic[i]) return
    stone.set(find(i), (stone.get(find(i)) ?? 0) + (b.style === "stone" ? 1 : -1))
    size.set(find(i), (size.get(find(i)) ?? 0) + 1)
  })
  return bs.map((b, i) =>
    generic[i] && size.get(find(i))! <= max
      ? { ...b, style: stone.get(find(i))! > 0 ? "stone" : "plaster" }
      : b,
  )
}

const LANDUSE = [
  "cemetery",
  "vineyard",
  "farmland",
  "farmyard",
  "industrial",
  "residential",
  "forest",
  "quarry",
] as const satisfies ReadonlyArray<AreaKind>
const landuses: ReadonlySet<string> = new Set(LANDUSE)
const isLanduse = (landuse: string): landuse is (typeof LANDUSE)[number] => landuses.has(landuse)

/** The `water` values of still water; an untagged `natural=water` is still water too. */
const STILL: ReadonlySet<string> = new Set(["lake", "reservoir", "pond", "basin"])

/** Whether OSM draws a river's water as a polygon (its banks): `waterway=riverbank`, or `natural=water` + `water=river`. */
const isRiverBank = (t: Tags): boolean =>
  t.waterway === "riverbank" || (t.natural === "water" && t.water === "river")

/** A lake's surface from its `ele` tag (m, whole decimetres), if it has a number. */
const eleOf = (kind: AreaKind, t: Tags): { readonly level?: number } => {
  const ele = Number.parseFloat(t.ele ?? "")
  return kind === "lake" && Number.isFinite(ele) ? { level: r1(ele) } : {}
}

/**
 * An orchard with no `trees` tag is an olive grove below this, m a.s.l. (its outer ring's mean
 * ground): on the Lunigiana's hills an orchard is most likely olives, higher up a chestnut grove.
 */
const UNTYPED_OLIVES_BELOW = 600

/** The kind of an area tagged `t`; `"orchard"` for an orchard with no `trees` tag, which its height decides (`extractAreas`). */
const areaKind = (t: Tags): AreaKind | "orchard" | undefined => {
  if (t.landuse === "orchard")
    return t.trees === "olive_trees" ? "olive" : t.trees === undefined ? "orchard" : undefined
  if (t.landuse !== undefined && isLanduse(t.landuse)) return t.landuse
  if (t.highway === "pedestrian" && t.area === "yes") return "paved"
  if (t.leisure === "pitch" || t.leisure === "park") return t.leisure
  if (t.amenity === "parking" || t.amenity === "school") return t.amenity
  if (t.railway === "platform") return "platform"
  if (t.historic === "ruins" || t.historic === "archaeological_site") return "ruins"
  if (
    t.natural === "grassland" ||
    t.natural === "fell" ||
    t.landuse === "meadow" ||
    t.landuse === "grass"
  )
    return "grassland"
  if (t.natural === "wood") return "forest"
  if (t.natural === "bare_rock" || t.natural === "rock") return "rock"
  if (isRiverBank(t)) return "river"
  if (t.natural === "water" && (t.water === undefined || STILL.has(t.water))) return "lake"
  if (t.natural === "shingle") return "pebble" // a river's gravel
  if (t.natural === "scree") return "scree" // mostly ravaneti, the quarries' marble waste
  if (t.natural === "scrub" || t.natural === "heath") return "scrub"
  return undefined
}

/**
 * Closed-way areas plus multipolygon relations with an area kind. The OSM file holds every such
 * relation whole (fetch-osm.ts), so its rings assemble even where most members lie outside the
 * play area. Each inner ring goes to the outer ring that contains it. An orchard with no `trees`
 * tag is an olive grove where its outer ring's mean `ground` lies below UNTYPED_OLIVES_BELOW, and
 * no area without `ground`: Lunigiana's build passes its terrain, Cesena's none (Romagna's orchards
 * are its fruit).
 */
export const extractAreas = (osm: Osm, ground?: (x: number, y: number) => number): Array<Area> => {
  const areas: Array<Area> = []
  /** The kind of an area tagged `tagged` with outer ring `ring` (flat). */
  const kindOf = (tagged: AreaKind | "orchard", ring: ReadonlyArray<number>) => {
    if (tagged !== "orchard") return tagged
    if (ground === undefined) return undefined
    let sum = 0
    for (let k = 0; k < ring.length; k += 2) sum += ground(ring[k]!, ring[k + 1]!)
    return sum / (ring.length / 2) < UNTYPED_OLIVES_BELOW ? "olive" : undefined
  }
  for (const w of osm.ways.values()) {
    const tagged = areaKind(w.tags)
    if (tagged === undefined || w.tags.building !== undefined || !closed(w)) continue
    const ring = flatRing(clipRing(ringOf(osm, w.nds), TERRAIN_BOX), true)
    const kind = ring === undefined ? undefined : kindOf(tagged, ring)
    if (ring !== undefined && kind !== undefined)
      areas.push({
        kind,
        ...(w.tags.name ? { name: w.tags.name } : {}),
        rings: [ring],
        ...eleOf(kind, w.tags),
      })
  }
  for (const rel of osm.relations.values()) {
    const tagged = areaKind(rel.tags)
    if (rel.tags.type !== "multipolygon" || tagged === undefined || rel.tags.building !== undefined)
      continue
    const inners = assembleRings(osm, rel, "inner").map((r) => ringOf(osm, r))
    for (const outer of assembleRings(osm, rel, "outer").map((r) => ringOf(osm, r))) {
      const flat = outer.flatMap(([x, y]) => [x, y])
      const ring = flatRing(clipRing(outer, TERRAIN_BOX), true)
      const kind = ring === undefined ? undefined : kindOf(tagged, ring)
      if (ring === undefined || kind === undefined) continue
      const holes = inners
        .filter((h) => pointInRing(h[0]![0], h[0]![1], flat))
        .map((h) => flatRing(clipRing(h, TERRAIN_BOX), false))
        .filter((h) => h !== undefined)
      areas.push({
        kind,
        ...(rel.tags.name ? { name: rel.tags.name } : {}),
        rings: [ring, ...holes],
        ...eleOf(kind, rel.tags),
      })
    }
  }
  return areas
}

export const extractBarriers = (osm: Osm): Array<Barrier> =>
  [...osm.ways.values()]
    .filter(
      (w) =>
        w.tags.barrier === "wall" || w.tags.barrier === "guard_rail" || w.tags.natural === "cliff",
    )
    .flatMap((w) =>
      toPlay(lineVertices(osm, w.nds)).map(({ pts }) => ({
        kind: w.tags.natural === "cliff" ? "cliff" : w.tags.barrier!,
        pts: flatLine(pts),
      })),
    )

const POI_KEYS = [
  "amenity",
  "shop",
  "tourism",
  "historic",
  "railway",
  "place",
  "leisure",
  "man_made",
  "natural",
  "highway",
]

export const extractPois = (osm: Osm): Array<Poi> => {
  const pois: Array<Poi> = []
  for (const n of osm.nodes.values()) {
    const k = POI_KEYS.find((key) => n.tags[key] !== undefined)
    if (
      k === undefined ||
      n.tags.tourism === "information" ||
      n.tags.railway === "level_crossing" ||
      n.tags.amenity === "bench"
    )
      continue
    if (k === "highway" && n.tags.highway !== "trailhead") continue // crossings, stops, street lamps
    const [x, y] = toLocal(n.lat, n.lon)
    if (inPlay(x, y))
      pois.push({
        id: +n.id,
        kind: `${k}=${n.tags[k]}`,
        ...(n.tags.name ? { name: n.tags.name } : {}),
        x: r1(x),
        y: r1(y),
      })
  }
  // Named polygons (churches, cemetery, station...) as centroid POIs.
  for (const w of osm.ways.values()) {
    if (w.tags.name === undefined || !closed(w) || w.tags.highway !== undefined) continue
    const ring = ringOf(osm, w.nds)
    const x = ring.reduce((s, p) => s + p[0], 0) / ring.length,
      y = ring.reduce((s, p) => s + p[1], 0) / ring.length
    const kind = areaKind(w.tags) ?? w.tags.amenity ?? w.tags.building ?? "named"
    if (inPlay(x, y))
      pois.push({ id: +w.id, kind: `area:${kind}`, name: w.tags.name, x: r1(x), y: r1(y) })
  }
  return pois
}

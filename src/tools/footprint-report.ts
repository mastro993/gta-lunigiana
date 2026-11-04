// What `footprint-check` reports from a cached Overpass answer (`footprintReport`, the object it
// writes to footprint.json, and `reportLines`, what it prints): the places, building clusters and
// roads a part's edges cut through, judged on its play area (geometry in footprint.ts).

import {
  type Edge,
  clusters,
  edgeLabel,
  excursions,
  inArea,
  nearestEdge,
  partEdges,
} from "./footprint.ts"
import { type P, toLocal } from "./geometry.ts"
import type { Part, Rect } from "./region.ts"

/** Findings within this many m of an edge. */
const NEAR = 300
/** Buildings this close, m, chain into one cluster; a cluster counts from CLUSTER buildings. */
const LINK = 50
const CLUSTER = 5
/** Highway classes a car drives (findings) and those only walked or ridden (notes), as regex alternatives. */
export const DRIVEN =
    "(motorway|trunk|primary|secondary|tertiary)(_link)?|unclassified|residential|living_street|service|track|road",
  WALKED = "path|footway|pedestrian|steps|cycleway|bridleway"
const DRIVABLE = new RegExp(`^(${DRIVEN})$`)

interface LatLon {
  readonly lat: number
  readonly lon: number
}
/** An element of the Overpass answer: a place node, a building's centre or a highway way's geometry. */
export interface OsmElement {
  readonly type: "node" | "way" | "relation"
  readonly id: number
  readonly lat?: number
  readonly lon?: number
  readonly center?: LatLon
  readonly geometry?: ReadonlyArray<LatLon | null>
  readonly tags?: Readonly<Record<string, string>>
}
/** The cached answer: the local box it was asked for and its elements. */
export interface OsmCache {
  readonly box: Rect
  readonly elements: ReadonlyArray<OsmElement>
}

const round = (v: number) => Math.round(v)
const at = ([x, y]: P) => [round(x), round(y)] as const
const nameOf = (tags: Readonly<Record<string, string>> = {}) =>
  [tags.ref, tags.name].filter((t) => t !== undefined).join(" ")

/**
 * The report on `part`'s edges from `osm`, beside the built parts `others`: its edges (`partEdges`),
 * the places and building clusters near an edge that is not a seam, and the roads and paths that
 * leave the play area across such an edge and come back, or run to the queried box's edge. The
 * play area is every built part's (`inArea`): a place or building in any of them is inside, a road
 * out through a seam runs on a built part and leaves nothing, and one out and back across other
 * parts' edges alone is theirs to judge.
 */
export const footprintReport = (part: Part, others: ReadonlyArray<Part>, osm: OsmCache) => {
  const built = [part, ...others]
  const edges = partEdges(part, others)
  const open = edges.filter((e) => e.seam === undefined)
  /** The nearest edge that is not a seam, when it lies within NEAR. */
  const near = (p: P) => {
    const hit = nearestEdge(open, p[0], p[1])
    return hit === undefined || hit.distance > NEAR ? undefined : hit
  }
  /** Whether `p`, where a road crosses the play area's outline, lies on this part's edge (within 1 m), not another part's. */
  const ours = (p: P) => {
    const hit = nearestEdge(open, p[0], p[1])
    return hit !== undefined && hit.distance < 1
  }

  const placeNodes = osm.elements
    .filter((e) => e.type === "node" && e.tags?.place !== undefined)
    .map((e) => ({
      node: e.id,
      name: e.tags?.name ?? "",
      place: e.tags!.place!,
      p: toLocal(e.lat!, e.lon!),
    }))
  const places = placeNodes.flatMap(({ p, ...pl }) => {
    const hit = near(p)
    return hit === undefined
      ? []
      : [
          {
            ...pl,
            at: at(p),
            inside: inArea(built, p[0], p[1]),
            distance: round(hit.distance),
            edge: edgeLabel(hit.edge),
          },
        ]
  })
  const nearestPlace = (c: P) =>
    placeNodes
      .map((pl) => ({
        name: pl.name,
        place: pl.place,
        distance: round(Math.hypot(pl.p[0] - c[0], pl.p[1] - c[1])),
      }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null

  const buildings = osm.elements.flatMap((e) =>
    e.center === undefined ? [] : [toLocal(e.center.lat, e.center.lon)],
  )
  const buildingClusters = clusters(buildings, LINK)
    .filter((c) => c.length >= CLUSTER)
    .flatMap((members) => {
      const pts = members.map((i) => buildings[i]!)
      const nearest = pts
        .flatMap((p) => near(p) ?? [])
        .reduce<{ edge: Edge; distance: number } | undefined>(
          (a, b) => (a === undefined || b.distance < a.distance ? b : a),
          undefined,
        )
      if (nearest === undefined) return []
      const c: P = [
        pts.reduce((s, p) => s + p[0], 0) / pts.length,
        pts.reduce((s, p) => s + p[1], 0) / pts.length,
      ]
      return [
        {
          size: pts.length,
          inside: pts.filter((p) => inArea(built, p[0], p[1])).length,
          centroid: at(c),
          distance: round(nearest.distance),
          edge: edgeLabel(nearest.edge),
          place: nearestPlace(c),
        },
      ]
    })

  const ways = osm.elements.flatMap((e) =>
    e.type === "way" && e.geometry !== undefined && e.tags?.highway !== undefined
      ? [
          {
            id: e.id,
            tags: e.tags,
            pts: e.geometry.flatMap((g) => (g === null ? [] : [toLocal(g.lat, g.lon)])),
          },
        ]
      : [],
  )
  const wayById = new Map(ways.map((w) => [w.id, w]))
  const waysOf = (ids: ReadonlyArray<number>) =>
    ids.map((id) => {
      const tags = wayById.get(id)!.tags
      return { way: id, highway: tags.highway!, name: nameOf(tags) }
    })
  // By the edge they leave through, then along it.
  const bySide = (a: { edge: string; exit: readonly [number, number] }, b: typeof a) =>
    a.edge.localeCompare(b.edge) || a.exit[0] - b.exit[0] || a.exit[1] - b.exit[1]
  const trips = (drivable: boolean) => {
    const found = excursions(
      ways.filter((w) => DRIVABLE.test(w.tags.highway!) === drivable),
      built,
      osm.box,
    )
    const reentries = found.reentries
      .filter((r) => ours(r.exit) || ours(r.entry))
      .map((r) => ({
        length: round(r.length),
        depth: round(r.depth),
        far: at(r.far),
        edge: edgeLabel(nearestEdge(edges, r.far[0], r.far[1])!.edge),
        exit: at(r.exit),
        entry: at(r.entry),
        ways: waysOf(r.lines),
      }))
    const unresolved = found.unresolved
      .filter((u) => ours(u.exit))
      .map((u) => ({
        length: round(u.length),
        end: at(u.end),
        edge: edgeLabel(nearestEdge(edges, u.exit[0], u.exit[1])!.edge),
        exit: at(u.exit),
        ways: waysOf(u.lines),
      }))
    return { reentries: reentries.sort(bySide), unresolved: unresolved.sort(bySide) }
  }
  const driven = trips(true),
    walked = trips(false)

  return {
    part: part.key,
    rects: part.rects,
    ...(part.mask === undefined ? {} : { mask: part.mask }),
    osmBox: osm.box,
    counts: { places: placeNodes.length, buildings: buildings.length, highways: ways.length },
    edges: edges.map((e) => ({ ...e, label: edgeLabel(e) })),
    findings: { places, clusters: buildingClusters, roads: driven.reentries },
    notes: { paths: walked.reentries },
    unresolved: { roads: driven.unresolved, paths: walked.unresolved },
    seams: { edges: edges.filter((e) => e.seam !== undefined).map(edgeLabel) },
  }
}

/** The report footprint-check writes to footprint.json. */
export type FootprintReport = ReturnType<typeof footprintReport>

/** The lines footprint-check prints for `report` on `part`. */
export const reportLines = (part: Part, report: FootprintReport): Array<string> => {
  const { counts, edges, findings, notes, unresolved, seams } = report
  const mask = part.mask === undefined ? "" : `a mask of ${part.mask.length / 2} vertices, `
  const waysText = (ws: (typeof findings.roads)[number]["ways"]) =>
    ws.map((w) => `way ${w.way} ${w.highway}${w.name === "" ? "" : ` "${w.name}"`}`).join(", ")
  const trips = (title: string, list: typeof findings.roads) => [
    `${title}: ${list.length}`,
    ...list.map(
      (t) =>
        `  ${t.length} m outside, up to ${t.depth} m out at ${t.far.join(",")} (${t.edge}), leaves at ${t.exit.join(",")}, back at ${t.entry.join(",")}: ${waysText(t.ways)}`,
    ),
  ]
  const runOff = (title: string, list: typeof unresolved.roads) => [
    `${title}: ${list.length}`,
    ...list.map(
      (u) =>
        `  leaves at ${u.exit.join(",")} (${u.edge}), ${u.length} m outside to ${u.end.join(",")}: ${waysText(u.ways)}`,
    ),
  ]
  return [
    `${part.key} (${part.title}): ${part.rects.length} rectangle(s), ${mask}${edges.length} edges (${seams.edges.length} seams); OSM over local ${report.osmBox.join(",")}: ${counts.places} places, ${counts.buildings} buildings, ${counts.highways} highway ways`,
    ...edges.map((e) => `  edge ${e.label}`),
    `places within ${NEAR} m of an edge: ${findings.places.length}`,
    ...findings.places.map(
      (p) =>
        `  ${p.name || "(no name)"} (${p.place}, node ${p.node}) at ${p.at.join(",")}: ${p.distance} m ${p.inside ? "inside" : "outside"} ${p.edge}`,
    ),
    `clusters of ${CLUSTER}+ buildings (${LINK} m links) within ${NEAR} m of an edge: ${findings.clusters.length}`,
    ...findings.clusters.map(
      (c) =>
        `  ${c.size} buildings (${c.inside} inside) round ${c.centroid.join(",")}: one ${c.distance} m from ${c.edge}; ${c.place === null ? "no place" : `${c.place.name} (${c.place.place}) ${c.place.distance} m away`}`,
    ),
    ...trips("roads that leave the play area and come back", findings.roads),
    ...trips("notes: paths, footways, steps that leave and come back", notes.paths),
    ...runOff(
      "unresolved: roads that leave and reach the OSM box's edge, not back",
      unresolved.roads,
    ),
    ...runOff(
      "unresolved: paths that leave and reach the OSM box's edge, not back",
      unresolved.paths,
    ),
    ...(seams.edges.length > 0 ? [`seams: ${seams.edges.join("; ")}`] : []),
  ]
}

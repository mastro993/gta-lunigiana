// The runbook's critic aid (issue #3, step 1): what a part's edges cut through.
// Run: node src/tools/footprint-check.ts <part> [--refresh]  (pnpm footprint-check <part>).
// - The play area is the union of the part's rectangles (region.ts). Its outline is cut into
//   straight edges, each labelled by the side it bounds (N/S/E/W); an edge whose outer side lies
//   in another part is a seam with that built neighbour: listed, never a finding.
// - One Overpass query over the part's box + 1 km: place nodes, building centres and highway ways
//   with their geometry. The answer is kept in .research/<part>/footprint-osm.json and queried
//   again only with --refresh or when its box no longer holds the part's box + 500 m.
// - Findings, against the edges that are not seams: places within 300 m of an edge (either side);
//   clusters of 5+ buildings chained at 50 m with a member within 300 m of one; roads that leave
//   the play area and come back. Ways join where they share a node, so a road split into several
//   ways, or two roads that meet outside, count: from each crossing of the outline, the shortest
//   way outside to another crossing. Drivable classes are findings; paths, footways, steps,
//   cycleways and bridleways, searched on their own, are notes.
// - Unresolved, apart from the findings and notes: roads and paths that leave and come within 50 m
//   of the queried box's edge without coming back. What lies beyond the box was not asked, so such
//   a road may come back there; ask again over a wider box (QUERY_PAD) to follow it.
// Prints the report and writes .research/<part>/footprint.json, which the critic reads; exits 0. A
// mistyped flag throws.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import { type Edge, clusters, edgeLabel, excursions, nearestEdge, outline } from "./footprint.ts"
import { type P, fromLocal, toLocal } from "./geometry.ts"
import { overpass } from "./net.ts"
import { PARTS, type Part, type Rect, inRects, partOf, rectsBox } from "./region.ts"

/** Findings within this many m of an edge. */
const NEAR = 300
/** Buildings this close, m, chain into one cluster; a cluster counts from CLUSTER buildings. */
const LINK = 50
const CLUSTER = 5
/** The Overpass box: the part's box + QUERY_PAD m, queried again once it no longer holds + KEEP_PAD. */
const QUERY_PAD = 1000
const KEEP_PAD = 500
/** Highway classes a car drives (findings) and those only walked or ridden (notes). */
const DRIVEN =
    "(motorway|trunk|primary|secondary|tertiary)(_link)?|unclassified|residential|living_street|service|track|road",
  WALKED = "path|footway|pedestrian|steps|cycleway|bridleway"
const DRIVABLE = new RegExp(`^(${DRIVEN})$`)
const PLACES = "^(city|town|village|hamlet|isolated_dwelling|locality)$"

interface LatLon {
  readonly lat: number
  readonly lon: number
}
interface OsmElement {
  readonly type: "node" | "way" | "relation"
  readonly id: number
  readonly lat?: number
  readonly lon?: number
  readonly center?: LatLon
  readonly geometry?: ReadonlyArray<LatLon | null>
  readonly tags?: Readonly<Record<string, string>>
}
/** The cached answer: the local box it was asked for and its elements. */
interface OsmCache {
  readonly box: Rect
  readonly elements: ReadonlyArray<OsmElement>
}

const holds = (outer: Rect, inner: Rect) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
const padded = ([x0, y0, x1, y1]: Rect, pad: number): Rect => [
  x0 - pad,
  y0 - pad,
  x1 + pad,
  y1 + pad,
]

const readOsm = async (part: Part, path: string, refresh: boolean): Promise<OsmCache> => {
  const need = padded(rectsBox(part.rects), KEEP_PAD)
  if (!refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as OsmCache
    if (holds(cached.box, need)) return cached
  }
  const box = padded(rectsBox(part.rects), QUERY_PAD)
  const [s, w] = fromLocal(box[0], box[1]),
    [n, e] = fromLocal(box[2], box[3])
  const bb = `(${[s, w, n, e].map((v) => v.toFixed(6)).join(",")})`
  const query = [
    "[out:json][timeout:180];",
    `node["place"~"${PLACES}"]${bb};`,
    "out;",
    `(way["building"]${bb};relation["building"]${bb};);`,
    "out ids center;",
    `way["highway"~"^(${DRIVEN}|${WALKED})$"]["area"!="yes"]${bb};`,
    "out tags geom;",
  ].join("")
  console.log(`${part.key}: querying Overpass over ${bb}`)
  const { elements } = JSON.parse(await overpass(query)) as { elements: Array<OsmElement> }
  const cache: OsmCache = { box, elements }
  writeFileSync(path, `${JSON.stringify(cache)}\n`)
  return cache
}

const round = (v: number) => Math.round(v)
const at = ([x, y]: P) => [round(x), round(y)] as const
const nameOf = (tags: Readonly<Record<string, string>> = {}) =>
  [tags.ref, tags.name].filter((t) => t !== undefined).join(" ")

const { values, positionals } = parseArgs({
  strict: true,
  allowPositionals: true,
  options: { refresh: { type: "boolean" } },
})
const part = partOf(positionals[0])
const dir = join(import.meta.dirname, "../../.research", part.key)
mkdirSync(dir, { recursive: true })
const osm = await readOsm(part, join(dir, "footprint-osm.json"), values.refresh === true)

const edges = outline(
  part.rects,
  PARTS.filter((p) => p.key !== part.key),
)
const open = edges.filter((e) => e.seam === undefined)
/** The nearest edge that is not a seam, when it lies within NEAR. */
const near = (p: P) => {
  const hit = nearestEdge(open, p[0], p[1])
  return hit === undefined || hit.distance > NEAR ? undefined : hit
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
          inside: inRects(part.rects, p[0], p[1]),
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
        inside: pts.filter((p) => inRects(part.rects, p[0], p[1])).length,
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
/** The part beyond the seam that `p` lies on (within 1 m), if any. */
const seamAt = (p: P) => {
  const hit = nearestEdge(edges, p[0], p[1])
  return hit !== undefined && hit.distance < 1 ? hit.edge.seam : undefined
}
const waysOf = (ids: ReadonlyArray<number>) =>
  ids.map((id) => {
    const tags = wayById.get(id)!.tags
    return { way: id, highway: tags.highway!, name: nameOf(tags) }
  })
const trips = (drivable: boolean) => {
  const found = excursions(
    ways.filter((w) => DRIVABLE.test(w.tags.highway!) === drivable),
    part.rects,
    osm.box,
  )
  const reentries = found.reentries.map((r) => {
    // Out through a seam and back through one: the road stays on built parts.
    const seam = seamAt(r.entry) === undefined ? undefined : seamAt(r.exit)
    return {
      length: round(r.length),
      depth: round(r.depth),
      far: at(r.far),
      edge: edgeLabel(nearestEdge(edges, r.far[0], r.far[1])!.edge),
      exit: at(r.exit),
      entry: at(r.entry),
      ways: waysOf(r.lines),
      ...(seam === undefined ? {} : { seam }),
    }
  })
  // Out through a seam, a road runs on a built part: not followed.
  const unresolved = found.unresolved
    .filter((u) => seamAt(u.exit) === undefined)
    .map((u) => ({
      length: round(u.length),
      end: at(u.end),
      edge: edgeLabel(nearestEdge(edges, u.exit[0], u.exit[1])!.edge),
      exit: at(u.exit),
      ways: waysOf(u.lines),
    }))
  return { reentries, unresolved }
}
// By the edge they leave through, then along it.
const bySide = (a: { edge: string; exit: readonly [number, number] }, b: typeof a) =>
  a.edge.localeCompare(b.edge) || a.exit[0] - b.exit[0] || a.exit[1] - b.exit[1]
const driven = trips(true),
  walked = trips(false)
const [drives, walks] = [driven.reentries.sort(bySide), walked.reentries.sort(bySide)]
const roads = drives.filter((t) => t.seam === undefined)
const paths = walks.filter((t) => t.seam === undefined)
const unresolved = { roads: driven.unresolved.sort(bySide), paths: walked.unresolved.sort(bySide) }
const seams = {
  edges: edges.filter((e) => e.seam !== undefined).map(edgeLabel),
  ways: [...drives, ...walks].filter((t) => t.seam !== undefined),
}
const out = join(dir, "footprint.json")
writeFileSync(
  out,
  `${JSON.stringify(
    {
      part: part.key,
      rects: part.rects,
      osmBox: osm.box,
      counts: { places: placeNodes.length, buildings: buildings.length, highways: ways.length },
      edges: edges.map((e) => ({ ...e, label: edgeLabel(e) })),
      findings: { places, clusters: buildingClusters, roads },
      notes: { paths },
      unresolved,
      seams,
    },
    null,
    1,
  )}\n`,
)

console.log(
  `${part.key} (${part.title}): ${part.rects.length} rectangle(s), ${edges.length} edges (${seams.edges.length} seams); OSM over local ${osm.box.join(",")}: ${placeNodes.length} places, ${buildings.length} buildings, ${ways.length} highway ways`,
)
for (const e of edges) console.log(`  edge ${edgeLabel(e)}`)
console.log(`places within ${NEAR} m of an edge: ${places.length}`)
for (const p of places)
  console.log(
    `  ${p.name || "(no name)"} (${p.place}, node ${p.node}) at ${p.at.join(",")}: ${p.distance} m ${p.inside ? "inside" : "outside"} ${p.edge}`,
  )
console.log(
  `clusters of ${CLUSTER}+ buildings (${LINK} m links) within ${NEAR} m of an edge: ${buildingClusters.length}`,
)
for (const c of buildingClusters)
  console.log(
    `  ${c.size} buildings (${c.inside} inside) round ${c.centroid.join(",")}: one ${c.distance} m from ${c.edge}; ${c.place === null ? "no place" : `${c.place.name} (${c.place.place}) ${c.place.distance} m away`}`,
  )
const waysText = (ws: ReturnType<typeof waysOf>) =>
  ws.map((w) => `way ${w.way} ${w.highway}${w.name === "" ? "" : ` "${w.name}"`}`).join(", ")
const printTrips = (title: string, list: ReadonlyArray<(typeof drives)[number]>) => {
  console.log(`${title}: ${list.length}`)
  for (const t of list)
    console.log(
      `  ${t.length} m outside, up to ${t.depth} m out at ${t.far.join(",")} (${t.edge}), leaves at ${t.exit.join(",")}, back at ${t.entry.join(",")}: ${waysText(t.ways)}`,
    )
}
printTrips("roads that leave the play area and come back", roads)
printTrips("notes: paths, footways, steps that leave and come back", paths)
const printUnresolved = (title: string, list: ReadonlyArray<(typeof unresolved.roads)[number]>) => {
  console.log(`${title}: ${list.length}`)
  for (const u of list)
    console.log(
      `  leaves at ${u.exit.join(",")} (${u.edge}), ${u.length} m outside to ${u.end.join(",")}: ${waysText(u.ways)}`,
    )
}
printUnresolved(
  "unresolved: roads that leave and reach the OSM box's edge, not back",
  unresolved.roads,
)
printUnresolved(
  "unresolved: paths that leave and reach the OSM box's edge, not back",
  unresolved.paths,
)
if (seams.edges.length > 0) {
  console.log(`seams: ${seams.edges.join("; ")}`)
  printTrips("roads out through a seam and back through one", seams.ways)
}
// Relative, so a report pasted into a PR names no local path (AGENTS.md).
console.log(`wrote ${relative(process.cwd(), out)}`)

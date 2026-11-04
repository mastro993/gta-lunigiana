// Downloads a part's OSM extract, `data/raw/osm/<part>.osm.gz` (`osmFile`), which the map build
// merges with its region's other parts' (`osmFiles`, `readOsms` in osm.ts). Run: node
// src/tools/fetch-osm.ts <part>  (pnpm fetch-osm <part>) for a Lunigiana part (`region.ts`), or
// `--region cesena` for Cesena's one part. A test region's part is refused, as the region is built
// from Lunigiana's parts' extracts, but for one with buildings of its own (`ownBuildings`,
// `pontremoli-town`), which gets OSM's buildings alone, for its map test to check the surveys
// against.
// The OSM API 0.6 `/map` call answers HTTP 400 for a box holding more than 50 000 nodes (or larger
// than 0.25 square degrees), so each of the part's rectangles plus MARGIN is asked for whole, one
// after another (not the box round them, which would take in an L's notch too), and a box answered
// 400 is split in four and each quarter asked for in turn, down to boxes MIN_SIDE wide; a network
// error, 429 or 5xx is retried (net.ts). Every multipolygon relation with an AREA_KEYS tag (land
// use, natural, building, leisure, amenity; `building` alone for a buildings-only extract) is then
// fetched whole (`/relation/<id>/full`), because most of a forest's member ways lie outside the
// boxes. Elements are merged by id, a buildings-only extract keeps what its check reads
// (`buildingsOnly`), and they are written sorted (nodes, ways, relations, each by id), so the same
// OSM data always gives the same file, however the boxes were split. The file's source, every box
// and the date, goes into data/raw.lock.json for `pnpm pin-raw` (`raw-lock.ts`).
import { join } from "node:path"
import { parseArgs } from "node:util"

import { fromLocal } from "./geometry.ts"
import { getText, request } from "./net.ts"
import { fetchedToday, writeRaw } from "./raw-lock.ts"
import { osmFile, type Part, partOf, REGION, type Region, regionOfPart } from "./region.ts"

const API = "https://api.openstreetmap.org/api/0.6"
const MARGIN = 100 // m beyond each of the part's rectangles: ways crossing its edge come whole anyway
const AREA_KEYS = ["landuse", "natural", "building", "leisure", "amenity"]
/** Degrees (40-55 m here): a box this narrow answered 400 is an error, not too many nodes. */
const MIN_SIDE = 0.0005

/** A box in degrees: west, south, east, north (the order of `/map?bbox=`). */
export type Bbox = readonly [number, number, number, number]

/** An HTTP answer: its status and body. */
export interface Answer {
  readonly status: number
  readonly text: string
}

/**
 * Asks `get` for `bbox`, depth first: a 200 goes to `take`, a 400 splits the box in four (south-west,
 * south-east, north-west, north-east) asked for in turn, anything else throws. Quarters share their
 * edges exactly, so none of the box is lost between them.
 */
export const fetchSplit = async (
  bbox: Bbox,
  get: (bbox: Bbox) => Promise<Answer>,
  take: (bbox: Bbox, text: string) => void,
): Promise<void> => {
  const { status, text } = await get(bbox)
  if (status === 200) return take(bbox, text)
  const [w, s, e, n] = bbox
  if (status !== 400 || Math.min(e - w, n - s) < MIN_SIDE)
    throw new Error(`/map?bbox=${bbox.join(",")}: HTTP ${status}: ${text.slice(0, 200)}`)
  const x = (w + e) / 2,
    y = (s + n) / 2
  for (const quarter of [
    [w, s, x, y],
    [x, s, e, y],
    [w, y, x, n],
    [x, y, e, n],
  ] as const)
    await fetchSplit(quarter, get, take)
}

/** Element XML by kind and numeric id. */
export interface Elements {
  readonly node: Map<number, string>
  readonly way: Map<number, string>
  readonly relation: Map<number, string>
}

const elements: Elements = { node: new Map(), way: new Map(), relation: new Map() }
const absorb = (xml: string): void => {
  for (const m of xml.matchAll(
    /<(node|way|relation)\s[^>]*?\bid="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g,
  ))
    elements[m[1] as keyof Elements].set(Number(m[2]), m[0])
}

/** Whether element XML `xml` is a multipolygon relation with a tag of one of `keys`. */
const isAreaRelation = (xml: string, keys: ReadonlyArray<string>): boolean =>
  /<tag k="type" v="multipolygon"\s*\/>/.test(xml) &&
  keys.some((k) => xml.includes(`<tag k="${k}"`))

/** The numbers `pattern`'s first group matches in `xml`. */
const refs = (xml: string, pattern: RegExp): Array<number> =>
  [...xml.matchAll(pattern)].map((m) => Number(m[1]))

/**
 * What a check of buildings reads (`osmBuildings` in features.ts) of `all`: the ways tagged
 * `building`, the building multipolygons and their member ways, and the nodes those ways use.
 */
export const buildingsOnly = (all: Elements): Elements => {
  const relation = new Map([...all.relation].filter(([, xml]) => isAreaRelation(xml, ["building"])))
  const members = new Set(
    [...relation.values()].flatMap((xml) => refs(xml, /<member type="way" ref="(\d+)"/g)),
  )
  const way = new Map(
    [...all.way].filter(([id, xml]) => members.has(id) || xml.includes('<tag k="building"')),
  )
  const used = new Set([...way.values()].flatMap((xml) => refs(xml, /<nd ref="(\d+)"/g)))
  return { node: new Map([...all.node].filter(([id]) => used.has(id))), way, relation }
}

/** `elements` as an OSM XML file: nodes, ways, relations, each sorted by id. */
export const osmXml = (elements: Elements): string => {
  const sorted = (m: Map<number, string>) =>
    [...m].sort((a, b) => a[0] - b[0]).map(([, xml]) => `  ${xml.trim()}`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osm version="0.6" generator="gta-lunigiana fetch-osm">',
    ...sorted(elements.node),
    ...sorted(elements.way),
    ...sorted(elements.relation),
    "</osm>",
    "",
  ].join("\n")
}

/**
 * What `fetch-osm` fetches for its arguments `positionals` with `region` (`--region`): the Lunigiana
 * part they name (`partOf`), or another map's one part, with the region it belongs to. Throws,
 * before any request, for a test region's part, unless that region has buildings of its own: the
 * others are built from Lunigiana's parts' extracts (`osmFiles`), so one of their own would go
 * unread.
 */
export const partToFetch = (
  positionals: ReadonlyArray<string>,
  region: Region = REGION,
): { readonly part: Part; readonly region: Region } => {
  if (region.id !== "lunigiana") {
    if (positionals.length > 0 || region.parts.length !== 1)
      throw new Error(`usage: fetch-osm --region ${region.key}, which fetches its one part`)
    return { part: region.parts[0]!, region }
  }
  if (positionals.length !== 1)
    throw new Error("usage: fetch-osm <part> (a Lunigiana part), or fetch-osm --region cesena")
  const part = partOf(positionals[0]),
    of = regionOfPart(part)
  if (of.test && !of.ownBuildings)
    throw new Error(
      `part ${part.key} is test region ${of.key}'s, built from Lunigiana's parts' OSM: fetch those`,
    )
  return { part, region: of }
}

/**
 * The boxes `fetch-osm` asks `/map` for over `part`: each of its rectangles plus MARGIN, in degrees.
 * Never the box round them, which would take in the land an L's notch leaves out.
 */
export const partBoxes = (part: Pick<Part, "rects">): Array<Bbox> =>
  part.rects.map(([x0, y0, x1, y1]) => {
    const [s, w] = fromLocal(x0 - MARGIN, y0 - MARGIN),
      [n, e] = fromLocal(x1 + MARGIN, y1 + MARGIN)
    return [w, s, e, n]
  })

/** `bbox` as `/map`'s `bbox=` parameter, on 6 decimals (about 0.1 m). */
const bboxParam = (bbox: Bbox): string => bbox.map((v) => v.toFixed(6)).join(",")

/**
 * The source the lock records for an extract over `boxes`: every `/map` box, then the multipolygons
 * fetched whole, the building ones alone for a buildings-only extract (`buildings`).
 */
export const sourceOf = (boxes: ReadonlyArray<Bbox>, buildings: boolean): string =>
  `${boxes.map((b) => `${API}/map?bbox=${bboxParam(b)}`).join(", ")} and each ${
    buildings
      ? "building multipolygon's /relation/<id>/full, buildings only"
      : "area multipolygon's /relation/<id>/full"
  }`

const main = async (): Promise<void> => {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: { region: { type: "string" } },
  })
  const { part, region } = partToFetch(positionals),
    buildings = region.ownBuildings,
    keys = buildings ? ["building"] : AREA_KEYS,
    boxes = partBoxes(part)
  const get = async (b: Bbox): Promise<Answer> => {
    const res = await request(`${API}/map?bbox=${bboxParam(b)}`)
    return { status: res.status, text: await res.text() }
  }
  // Into the same elements: where the rectangles meet, their boxes overlap by twice MARGIN.
  for (const box of boxes)
    await fetchSplit(box, get, (b, xml) => {
      absorb(xml)
      console.log(`box ${bboxParam(b)}: ${elements.node.size} nodes, ${elements.way.size} ways`)
    })
  for (const id of [...elements.relation]
    .filter(([, xml]) => isAreaRelation(xml, keys))
    .map(([id]) => id)) {
    absorb(await getText(`${API}/relation/${id}/full`))
    console.log(`relation ${id}: ${elements.node.size} nodes, ${elements.way.size} ways`)
  }
  const kept = buildings ? buildingsOnly(elements) : elements,
    xml = osmXml(kept)
  // Gzipped at level 9, and left as it is when it already unpacks to these bytes (`writeRaw`).
  writeRaw(
    join(import.meta.dirname, "../..", osmFile(part)),
    Buffer.from(xml),
    fetchedToday(sourceOf(boxes, buildings)),
  )
  console.log({
    part: part.key,
    nodes: kept.node.size,
    ways: kept.way.size,
    relations: kept.relation.size,
    bytes: xml.length,
  })
}

if (import.meta.main) await main()

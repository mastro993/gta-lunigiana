// Downloads the OSM extract the map build reads: `data/raw/<region>.osm.gz`, for the region
// `--region` names (`lunigiana` by default; `region.ts`). A test region with buildings of its own
// (`ownBuildings`, `pontremoli-town`) gets OSM's buildings alone over its box,
// `data/raw/<key>.osm.gz`, which its map test checks the surveys against; the other test regions
// read their map's file.
// Run: node src/tools/fetch-osm.ts [--region cesena | pontremoli-town]  (pnpm fetch-osm).
// The OSM API 0.6 `/map` call answers HTTP 400 for a box holding more than 50 000 nodes (or larger
// than 0.25 square degrees), so the built terrain's box plus MARGIN is asked for whole, and a box
// answered 400 is split in four and each quarter asked for in turn, down to boxes MIN_SIDE wide; a
// network error, 429 or 5xx is retried (net.ts). Every multipolygon relation with an AREA_KEYS tag
// (land use, natural, building, leisure, amenity; `building` alone for a buildings-only extract) is
// then fetched whole (`/relation/<id>/full`), because most of a forest's member ways lie outside the
// box. Elements are merged by id, a buildings-only extract keeps what its check reads
// (`buildingsOnly`), and they are written sorted (nodes, ways, relations, each by id), so the same
// OSM data always gives the same file, however the boxes were split. The file's source, the box and
// the date, goes into data/raw.lock.json for `pnpm pin-raw` (`raw-lock.ts`).
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

import { BOUNDS, fromLocal } from "./geometry.ts"
import { getText, request } from "./net.ts"
import { fetchedToday, recordSource } from "./raw-lock.ts"
import { REGION, type Region } from "./region.ts"

const API = "https://api.openstreetmap.org/api/0.6"
const MARGIN = 100 // m beyond the built terrain's box: ways crossing its edge come whole anyway
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
 * Throws for a test region, before any request, unless it has buildings of its own: its box is not
 * its inputs', so fetching for it would cut down the file it shares (`data/raw/<id>.osm.gz`, which a
 * test region's id names).
 */
export const checkFetchable = ({
  key,
  id,
  test,
  ownBuildings,
}: Pick<Region, "key" | "id" | "test" | "ownBuildings">): void => {
  if (test && !ownBuildings)
    throw new Error(`--region ${key} is a test region: it reads --region ${id}'s OSM`)
}

/** The OSM extract `region` reads, from the repository root: its own buildings' (`ownBuildings`), or its map's. */
export const osmFile = (region: Pick<Region, "key" | "id" | "ownBuildings">): string =>
  `data/raw/${region.ownBuildings ? region.key : region.id}.osm.gz`

const main = async (): Promise<void> => {
  checkFetchable(REGION)
  const out = join(import.meta.dirname, "../..", osmFile(REGION)),
    keys = REGION.ownBuildings ? ["building"] : AREA_KEYS
  const [s, w] = fromLocal(BOUNDS.minX - MARGIN, BOUNDS.minY - MARGIN),
    [n, e] = fromLocal(BOUNDS.maxX + MARGIN, BOUNDS.maxY + MARGIN)
  const box = (b: Bbox) => b.map((v) => v.toFixed(6)).join(",")
  await fetchSplit(
    [w, s, e, n],
    async (b) => {
      const res = await request(`${API}/map?bbox=${box(b)}`)
      return { status: res.status, text: await res.text() }
    },
    (b, xml) => {
      absorb(xml)
      console.log(`box ${box(b)}: ${elements.node.size} nodes, ${elements.way.size} ways`)
    },
  )
  for (const id of [...elements.relation]
    .filter(([, xml]) => isAreaRelation(xml, keys))
    .map(([id]) => id)) {
    absorb(await getText(`${API}/relation/${id}/full`))
    console.log(`relation ${id}: ${elements.node.size} nodes, ${elements.way.size} ways`)
  }
  const kept = REGION.ownBuildings ? buildingsOnly(elements) : elements,
    xml = osmXml(kept)
  writeFileSync(out, gzipSync(xml, { level: 9 }))
  recordSource(
    out,
    fetchedToday(
      REGION.ownBuildings
        ? `${API}/map?bbox=${box([w, s, e, n])} and each building multipolygon's /relation/<id>/full, buildings only`
        : `${API}/map?bbox=${box([w, s, e, n])} and each area multipolygon's /relation/<id>/full`,
    ),
  )
  console.log({
    nodes: kept.node.size,
    ways: kept.way.size,
    relations: kept.relation.size,
    bytes: xml.length,
  })
}

if (import.meta.main) await main()

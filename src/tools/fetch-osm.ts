// Downloads the OSM extract the map build reads: `data/raw/<region>.osm.gz`, for the region
// `--region` names (`lunigiana` by default; `region.ts`).
// Run: node src/tools/fetch-osm.ts [--region cesena]  (pnpm fetch-osm).
// The OSM API 0.6 `/map` call answers HTTP 400 for a box holding more than 50 000 nodes (or larger
// than 0.25 square degrees), so the play area plus MARGIN is asked for whole, and a box answered
// 400 is split in four and each quarter asked for in turn, down to boxes MIN_SIDE wide; a network
// error, 429 or 5xx is retried (net.ts). Every multipolygon relation with an AREA_KEYS tag (land
// use, natural, building, leisure, amenity) is then fetched whole (`/relation/<id>/full`), because
// most of a forest's member ways lie outside the play area. Elements are merged by id and written
// sorted (nodes, ways, relations, each by id), so the same OSM data always gives the same file,
// however the boxes were split.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

import { BOUNDS, fromLocal } from "./geometry.ts"
import { getText, request } from "./net.ts"
import { REGION } from "./region.ts"

const API = "https://api.openstreetmap.org/api/0.6"
const OUT = join(import.meta.dirname, `../../data/raw/${REGION.id}.osm.gz`)
const MARGIN = 100 // m beyond the play area: ways crossing the edge come whole anyway
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
const elements = {
  node: new Map<number, string>(),
  way: new Map<number, string>(),
  relation: new Map<number, string>(),
}
const absorb = (xml: string): void => {
  for (const m of xml.matchAll(
    /<(node|way|relation)\s[^>]*?\bid="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g,
  ))
    elements[m[1] as keyof typeof elements].set(Number(m[2]), m[0])
}

const main = async (): Promise<void> => {
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
  const areaRelation = (xml: string) =>
    /<tag k="type" v="multipolygon"\s*\/>/.test(xml) &&
    AREA_KEYS.some((k) => xml.includes(`<tag k="${k}"`))
  for (const id of [...elements.relation]
    .filter(([, xml]) => areaRelation(xml))
    .map(([id]) => id)) {
    absorb(await getText(`${API}/relation/${id}/full`))
    console.log(`relation ${id}: ${elements.node.size} nodes, ${elements.way.size} ways`)
  }
  const sorted = (m: Map<number, string>) =>
    [...m].sort((a, b) => a[0] - b[0]).map(([, xml]) => `  ${xml.trim()}`)
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osm version="0.6" generator="gta-lunigiana fetch-osm">',
    ...sorted(elements.node),
    ...sorted(elements.way),
    ...sorted(elements.relation),
    "</osm>",
    "",
  ].join("\n")
  writeFileSync(OUT, gzipSync(xml, { level: 9 }))
  console.log({
    nodes: elements.node.size,
    ways: elements.way.size,
    relations: elements.relation.size,
    bytes: xml.length,
  })
}

if (import.meta.main) await main()

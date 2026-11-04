// Downloads a part's OSM extract, `data/raw/osm/<part>.osm.gz` (`osmFile`), which the map build
// merges with its region's other parts' (`osmFiles`, `readOsms` in osm.ts). Run: node
// src/tools/fetch-osm.ts <part>  (pnpm fetch-osm <part>) for a Lunigiana part (`region.ts`), or
// `--region cesena` for Cesena's one part. A test region's part is refused, as the region is built
// from Lunigiana's parts' extracts, but for one with buildings of its own (`ownBuildings`,
// `pontremoli-town`), which gets OSM's buildings alone, for its map test to check the surveys
// against.
// The extract covers the ground of the region's listed tiles in its box that the parts before it
// leave to it (`partGround`): the trees cover that ground, beyond the play area too, and keep off
// OSM's roads, buildings, water and rail there. The OSM API 0.6 `/map` call answers HTTP 400 for a
// box holding more than 50 000 nodes (or larger than 0.25 square degrees), so each rectangle of
// that ground plus MARGIN is asked for whole, one after another (not the box round them, which
// would take in an L's notch too), and a box answered 400 is split in four and each quarter asked
// for in turn, down to boxes MIN_SIDE wide; a network error, 429 or 5xx is retried (net.ts). Every multipolygon relation with an AREA_KEYS tag (land
// use, natural, building, leisure, amenity; `building` alone for a buildings-only extract) is then
// fetched whole (`/relation/<id>/full`), because most of a forest's member ways lie outside the
// boxes. Elements are merged by id, a buildings-only extract keeps what its check reads
// (`buildingsOnly`), and they are written sorted (nodes, ways, relations, each by id), so the same
// OSM data always gives the same file, however the boxes were split. The file's source, every box
// and the date, goes into data/raw.lock.json for `pnpm pin-raw` (`raw-lock.ts`).
import { join } from "node:path"
import { parseArgs } from "node:util"

import { TILE } from "../sim/map/kinds.ts"
import { fromLocal } from "./geometry.ts"
import { getText, request } from "./net.ts"
import { fetchedToday, writeRaw } from "./raw-lock.ts"
import {
  osmFile,
  type Part,
  partOf,
  type Rect,
  rectsBox,
  REGION,
  type Region,
  regionOfPart,
  tilesOf,
} from "./region.ts"

const API = "https://api.openstreetmap.org/api/0.6"
const MARGIN = 100 // m beyond each rectangle of its ground: ways crossing its edge come whole anyway
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

/** `a` cut to `b`, none where they share no ground. */
const clip = (a: Rect, b: Rect): Rect | undefined => {
  const c: Rect = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ]
  return c[0] < c[2] && c[1] < c[3] ? c : undefined
}

/** The ground of `a` outside `b`: up to four rectangles, west and east strips the whole height. */
const rectMinus = (a: Rect, b: Rect): Array<Rect> => {
  const c = clip(a, b)
  if (c === undefined) return [a]
  const pieces: Array<Rect> = [
    [a[0], a[1], c[0], a[3]],
    [c[2], a[1], a[2], a[3]],
    [c[0], a[1], c[2], c[1]],
    [c[0], c[3], c[2], a[3]],
  ]
  return pieces.filter(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1)
}

/**
 * `tiles` as few rectangles: each row's runs of adjacent tiles, a run joined with the same columns'
 * runs in the rows right after it. No tile but `tiles` lies in any.
 */
const tileRects = (
  tiles: ReadonlyArray<{ readonly i: number; readonly j: number }>,
): Array<Rect> => {
  const rows = Map.groupBy(tiles, (t) => t.j),
    open = new Map<string, { i0: number; i1: number; j0: number; j1: number }>(),
    done: Array<Rect> = []
  const close = (r: { i0: number; i1: number; j0: number; j1: number }) =>
    done.push([r.i0 * TILE, r.j0 * TILE, (r.i1 + 1) * TILE, (r.j1 + 1) * TILE])
  for (const j of [...rows.keys()].sort((a, b) => a - b)) {
    const is = rows
        .get(j)!
        .map((t) => t.i)
        .sort((a, b) => a - b),
      runs: Array<[number, number]> = []
    for (const i of is) {
      const last = runs.at(-1)
      if (last?.[1] === i - 1) last[1] = i
      else runs.push([i, i])
    }
    const next = new Map<string, { i0: number; i1: number; j0: number; j1: number }>()
    for (const [i0, i1] of runs) {
      const key = `${i0}_${i1}`,
        run = open.get(key)
      if (run?.j1 === j - 1) {
        run.j1 = j
        next.set(key, run)
        open.delete(key)
      } else next.set(key, { i0, i1, j0: j, j1: j })
    }
    for (const run of open.values()) close(run)
    open.clear()
    for (const [key, run] of next) open.set(key, run)
  }
  for (const run of open.values()) close(run)
  return done.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

/**
 * The ground `fetch-osm` fetches for `part`, the `parts` before it fetched already, local metres:
 * its tiles the earlier parts' do not hold, cut to the box round it and them, and the ground that
 * box adds to the earlier parts' tiles. So the extracts of `parts` hold the ground of every listed
 * tile in the region's box, which the trees cover, and none of an L's notch, which no listed tile
 * holds: by induction, as each earlier extract holds its tiles cut to the box round the parts up to
 * its own. A part with none before it fetches its tiles cut to its box: lucido's rectangle.
 */
export const partGround = (part: Part, parts: ReadonlyArray<Part>): Array<Rect> => {
  const k = parts.indexOf(part)
  if (k < 0) throw new Error(`part ${part.key} is not among ${parts.map((p) => p.key).join(", ")}`)
  const before = parts.slice(0, k).flatMap((p) => p.rects),
    upTo = parts.slice(0, k + 1).flatMap((p) => p.rects),
    box = rectsBox(upTo)
  const earlier = before.length === 0 ? [] : tilesOf(before),
    held = new Set(earlier.map(({ i, j }) => `${i}_${j}`))
  const own = tilesOf(upTo).filter(({ i, j }) => !held.has(`${i}_${j}`))
  return [
    ...tileRects(own).flatMap((r) => {
      const now = clip(r, box)
      return now === undefined ? [] : [now]
    }),
    ...tileRects(earlier).flatMap((r) => {
      const now = clip(r, box)
      return now === undefined ? [] : rectMinus(now, rectsBox(before))
    }),
  ]
}

/** The boxes `fetch-osm` asks `/map` for over `part` (`partGround`), each plus MARGIN, in degrees. */
export const partBoxes = (part: Part, parts: ReadonlyArray<Part>): Array<Bbox> =>
  partGround(part, parts).map(([x0, y0, x1, y1]) => {
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
    boxes = partBoxes(part, region.parts)
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

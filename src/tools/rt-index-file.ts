// The cartoteca index of a part, `.research/<part>/index.json`: written by `rt-index` over the box
// `indexBox` gives, read by `pick-sheets`, `pick-lidar` and `coverage`. Polygons are EPSG:3003, each
// its outer ring then its holes, flat [e0, n0, e1, n1…].

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import * as v from "valibot"

import { WFS_PAD } from "./cartoteca.ts"
import { tileCut } from "./dtm-tiles.ts"
import { gaussBoagaBox } from "./geometry.ts"
import { type Part, type Rect, type Region, regionOfPart, tilesOf } from "./region.ts"

const Polygons = v.array(v.array(v.array(v.number())))
const Head = { status: v.optional(v.number()), bytes: v.optional(v.number()) }

const RtIndexSchema = v.object({
  part: v.string(),
  /** The WFS box, EPSG:3003 [e0, n0, e1, n1] (`indexBox`). */
  box: v.tuple([v.number(), v.number(), v.number(), v.number()]),
  /** CTR 1:2000 sheet frames, one per sheet and year; the 2009 and 2019 ones with their archive's URL and HEAD. */
  ctr: v.array(
    v.object({
      sheet: v.string(),
      year: v.number(),
      url: v.optional(v.string()),
      ...Head,
      polygons: Polygons,
    }),
  ),
  /** LiDAR tiles, one per sheet (lower case) and lot, with the DTM archive the GetFeatureInfo named. */
  lidar: v.array(
    v.object({
      sheet: v.string(),
      lot: v.string(),
      year: v.number(),
      survey: v.string(),
      owner: v.optional(v.string()),
      licence: v.optional(v.string()),
      dtm: v.optional(v.string()),
      ...Head,
      polygons: Polygons,
    }),
  ),
  /**
   * CTR 1:10 000 sections of the 2010 edition, each its frame, with the EPSG:6707 shapefile archive
   * (named with its MD5, no `.zip`) and the licence the GetFeatureInfo inside the frame states, and
   * the archive's HEAD.
   */
  ctr10k: v.array(
    v.object({
      section: v.string(),
      title: v.string(),
      flight: v.string(),
      archive: v.optional(v.string()),
      licence: v.optional(v.string()),
      url: v.optional(v.string()),
      ...Head,
      polygons: Polygons,
    }),
  ),
  /**
   * DBT 1:2000 blocks, one per comune and survey, their attributes as the WFS gives them and their
   * polygon the comune's (not the area mapped), with the archive (named with its MD5, no `.7z`) and
   * the licence the GetFeatureInfo inside the comune states, and the archive's HEAD.
   */
  dbt: v.array(
    v.object({
      attrs: v.record(v.string(), v.string()),
      archive: v.optional(v.string()),
      licence: v.optional(v.string()),
      url: v.optional(v.string()),
      ...Head,
      polygons: Polygons,
    }),
  ),
  /** The 2021 surface model's elements. */
  dsm2021: v.array(
    v.object({
      element: v.string(),
      owner: v.string(),
      survey: v.string(),
      url: v.string(),
      ...Head,
      polygons: Polygons,
    }),
  ),
})

/** A part's cartoteca index. */
export type RtIndex = v.InferOutput<typeof RtIndexSchema>

/** Where part `key`'s index lives. */
export const indexPath = (key: string): string =>
  join(import.meta.dirname, "../../.research", key, "index.json")

/** Part `key`'s index; throws saying to run `rt-index <part>` when there is none. */
export const readIndex = (key: string): RtIndex => {
  const path = indexPath(key)
  if (!existsSync(path)) throw new Error(`no index for ${key}: run pnpm rt-index ${key}`)
  return v.parse(RtIndexSchema, JSON.parse(readFileSync(path, "utf8")))
}

/**
 * The EPSG:3003 box `rt-index` asks the cartoteca over for `part`, on whole metres outwards: round
 * every cell `fetch-rt` may read for it, plus WFS_PAD. A Lunigiana part's fetch writes its tiles'
 * cells (`tileNeed`: each tile's square cut to its region's bounds, HALO round it), so the box is
 * round those cuts, which hold its rectangles; a test region's with terrain of its own mosaics its
 * rectangles' box (`cropOf`), so the box is round them.
 */
export const indexBox = (
  part: Part,
  region: Pick<Region, "ownTerrain" | "bounds"> = regionOfPart(part),
): [number, number, number, number] => {
  const rects: ReadonlyArray<Rect> = region.ownTerrain
    ? part.rects
    : tilesOf(part.rects).flatMap(({ i, j }) => {
        const cut = tileCut(i, j, region.bounds)
        return cut === undefined ? [] : [cut]
      })
  const [e0, n0, e1, n1] = gaussBoagaBox(rects, WFS_PAD)
  return [Math.floor(e0), Math.floor(n0), Math.ceil(e1), Math.ceil(n1)]
}

/**
 * Throws unless an index's `box` holds the one `rt-index` asks over for `part` today (`indexBox`):
 * one asked over less (its rectangles' box, before the tiles' cells; before a later part grew its
 * region's bounds) may miss the tiles and elements over the rest of the cells its fetch fills.
 */
export const checkIndexBox = (
  box: ReadonlyArray<number>,
  part: Part,
  region: Pick<Region, "ownTerrain" | "bounds"> = regionOfPart(part),
): void => {
  const [e0, n0, e1, n1] = indexBox(part, region)
  if (box[0]! > e0 || box[1]! > n0 || box[2]! < e1 || box[3]! < n1)
    throw new Error(
      `the index of ${part.key} is over EPSG:3003 ${box.join(",")}, short of ${[e0, n0, e1, n1].join(",")} round the cells its fetch fills: run pnpm rt-index ${part.key}`,
    )
}

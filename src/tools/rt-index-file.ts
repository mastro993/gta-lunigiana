// The cartoteca index of a part, `.research/<part>/index.json`: written by `rt-index`, read by
// `pick-sheets`, `pick-lidar` and `coverage`. Polygons are EPSG:3003, each its outer ring then its
// holes, flat [e0, n0, e1, n1…].

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import * as v from "valibot"

const Polygons = v.array(v.array(v.array(v.number())))
const Head = { status: v.optional(v.number()), bytes: v.optional(v.number()) }

const RtIndexSchema = v.object({
  part: v.string(),
  /** The WFS box, EPSG:3003 [e0, n0, e1, n1]: the part's corners + 500 m. */
  box: v.tuple([v.number(), v.number(), v.number(), v.number()]),
  /** CTR 1:2000 sheet frames, one per sheet and year; the 2019 ones with their archive's URL and HEAD. */
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
  /** DBT 1:2000 blocks, their attributes as the WFS gives them. */
  dbt: v.array(v.object({ attrs: v.record(v.string(), v.string()), polygons: Polygons })),
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

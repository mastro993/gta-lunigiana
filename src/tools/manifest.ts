// A part's source manifest, `data/parts/<part>.json` (tracked): the Regione Toscana archives
// `fetch-rt` downloads for it. `pick-sheets` writes `ctr`, `pick-lidar` writes `lidar`; `dtm10`
// is written by hand, from the holes `pick-lidar` reports and the provinces they lie in.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import * as v from "valibot"

const ManifestSchema = v.object({
  /** CTR 1:2000 2019 sheets (`23D11`), downloaded as `ctr2k/SHP/S_<sheet>_2019_6707.zip`. */
  ctr: v.array(v.string()),
  /** LiDAR DTM tiles in priority order (a cell keeps the first value written), each the archive's name with its MD5, no `.zip`. */
  lidar: v.array(v.string()),
  /** 10 m DTMs for the cells no LiDAR tile covers, by archive name (`MS_dtm10x10_epsg3003_md5_…`). */
  dtm10: v.array(v.string()),
})

/** What `fetch-rt` downloads for one part. */
export type Manifest = v.InferOutput<typeof ManifestSchema>

/** Where part `key`'s manifest lives. */
export const manifestPath = (key: string): string =>
  join(import.meta.dirname, "../../data/parts", `${key}.json`)

/** Part `key`'s manifest; an empty one when the part has none yet. */
export const readManifest = (key: string): Manifest => {
  const path = manifestPath(key)
  return existsSync(path)
    ? v.parse(ManifestSchema, JSON.parse(readFileSync(path, "utf8")))
    : { ctr: [], lidar: [], dtm10: [] }
}

/** Writes `change` over part `key`'s manifest, keeping the lists it does not name. */
export const updateManifest = (key: string, change: Partial<Manifest>): void => {
  const path = manifestPath(key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...readManifest(key), ...change }, null, 2)}\n`)
}

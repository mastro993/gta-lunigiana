// A part's source manifest, `data/parts/<part>.json` (tracked): the Regione Toscana archives
// `fetch-rt` downloads for it. `pick-sheets` writes `ctr`, `pick-lidar` writes `lidar` and
// `dsm2021`; `dtm10` is written by hand, from the holes `pick-lidar` reports and the provinces they
// lie in, and so are the older surveys (`ctr2009`, `ctr10k`, `dbt2k`), from `rt-index`'s frames and
// archive names.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import * as v from "valibot"

const ManifestSchema = v.object({
  /** CTR 1:2000 2019 sheets (`23D11`), downloaded as `ctr2k/SHP/S_<sheet>_2019_6707.zip`. */
  ctr: v.array(v.string()),
  /** LiDAR DTM tiles in priority order (a cell keeps the first value written), each the archive's name with its MD5, no `.zip`. */
  lidar: v.array(v.string()),
  /** 10 m DTMs for the cells no LiDAR tile covers, by archive name (`MS_dtm10x10_epsg3003_md5_…`), in priority order. */
  dtm10: v.array(v.string()),
  /** Elements of the 2021 surface model (`234012`), for the open ground no LiDAR tile covers; none when absent. */
  dsm2021: v.optional(v.array(v.string()), []),
  /** CTR 1:2000 2009 sheets (`22D04`, the old schema), downloaded as `ctr2k/SHP/S_<sheet>_2009_6707.zip`; none when absent. */
  ctr2009: v.optional(v.array(v.string()), []),
  /** CTR 1:10 000 2010 sections, each the archive's name with its MD5, no `.zip` (`S_249020_2010_6707_a797…`); none when absent. */
  ctr10k: v.optional(v.array(v.string()), []),
  /** DBT 1:2000 comuni, each the archive's name with its MD5, no `.7z` (`DBT2K_045014_PONTREMOLI_2010_2010_3003_21f4…`); none when absent. */
  dbt2k: v.optional(
    v.pipe(
      v.array(v.string()),
      // fetch-rt pins a comune's layers under its ISTAT code alone, so a comune with two surveys
      // (Minucciano's of 2011 and of 1988–2000) lists the one that maps the part.
      v.check(
        (names) => new Set(names.map((name) => name.split("_")[1])).size === names.length,
        "dbt2k lists one comune twice: fetch-rt pins one survey a comune (rt/dbt2k/<ISTAT>_<layer>)",
      ),
    ),
    [],
  ),
})

/** What `fetch-rt` downloads for one part. */
export type Manifest = v.InferOutput<typeof ManifestSchema>

/** Where part `key`'s manifest lives. */
export const manifestPath = (key: string): string =>
  join(import.meta.dirname, "../../data/parts", `${key}.json`)

/** Part `key`'s manifest; an empty one when the part has none yet. */
export const readManifest = (key: string): Manifest => {
  const path = manifestPath(key)
  return v.parse(
    ManifestSchema,
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { ctr: [], lidar: [], dtm10: [] },
  )
}

/** Writes `change` over part `key`'s manifest, keeping the lists it does not name. */
export const updateManifest = (key: string, change: Partial<Manifest>): void => {
  const path = manifestPath(key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...readManifest(key), ...change }, null, 2)}\n`)
}

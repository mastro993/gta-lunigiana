// The land cover as map areas in local metres, clipped to the built terrain's box: Regione Toscana's
// 1:10 000 of 2019 ("Uso e copertura del suolo", data/raw/rt/ucs.json.gz, written by fetch-rt.ts,
// EPSG:3003) and Regione Liguria's 1:10 000, ed. 2025 ("Uso del Suolo", data/raw/lig/<part>/
// uds.json.gz, written by fetch-lig.ts, EPSG:25832), both in Corine's classes, Liguria's to the
// fourth level, read by the third (the code's first three digits). Only the open covers OSM mostly
// lacks above the woods (in the new mountain area it tags about a fifth of the bare rock and half
// the pastures), the rivers' gravel beds and the water bodies. Woods, fields and towns stay OSM's.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import type { Area } from "../sim/map/index.ts"
import type { AreaKind } from "../sim/map/kinds.ts"
import { gaussBoagaToLatLon, utm32ToLatLon } from "./crs.ts"
import { clipRing, flatRing, pointInRing, TERRAIN_BOX, toLocal, type P } from "./geometry.ts"
import type { Rect } from "./region.ts"

/** UCS 2019 classes kept, and the area kind each becomes. */
export const UCS_CODES = {
  "131": "quarry", // aree estrattive
  "321": "grassland", // pascoli naturali e praterie
  "322": "scrub", // brughiere e cespuglieti
  "332": "rock", // rocce nude, falesie, rupi, affioramenti
  "333": "sparse", // vegetazione rada
  "331": "pebble", // spiagge, dune e sabbie: inland, the rivers' gravel bars
  "512": "lake", // corpi d'acqua
} as const satisfies Record<string, AreaKind>

interface UcsFile {
  readonly crs: string
  readonly polygons: ReadonlyArray<{
    readonly id: number
    readonly code: string
    readonly rings: ReadonlyArray<ReadonlyArray<number>>
  }>
}

/** Each land cover file's CRS, to lat/lon. */
const PROJECTIONS: Readonly<Record<string, (e: number, n: number) => [number, number]>> = {
  "EPSG:3003": (e, n) => gaussBoagaToLatLon(e, n),
  "EPSG:25832": utm32ToLatLon,
}

/**
 * The kept polygons of the land cover files at `paths` as areas, clipped to `box`: outer ring
 * first, then the holes inside it. A polygon in two files (two parts' Liguria files hold the
 * polygons across their edge) is read once: the same CRS, id and outer ring.
 */
export const readUcs = (paths: ReadonlyArray<string>, box: Rect = TERRAIN_BOX): Array<Area> => {
  const seen = new Set<string>()
  return paths.flatMap((path) => readOne(path, seen, box))
}

const readOne = (path: string, seen: Set<string>, box: Rect): Array<Area> => {
  const file = JSON.parse(gunzipSync(readFileSync(path)).toString()) as UcsFile
  const project = PROJECTIONS[file.crs]
  if (project === undefined) throw new Error(`${path}: land cover in ${file.crs}`)
  return file.polygons.flatMap(({ id, code, rings }) => {
    const key = `${file.crs} ${id} ${rings[0]!.join(",")}`,
      kind = UCS_CODES[code.slice(0, 3) as keyof typeof UCS_CODES]
    if (seen.has(key) || kind === undefined) return []
    seen.add(key)
    const [outer, ...holes] = rings.map((r) => {
      const ring: Array<P> = []
      for (let i = 0; i + 1 < r.length; i += 2) ring.push(toLocal(...project(r[i]!, r[i + 1]!)))
      return ring.slice(0, -1) // gml and GeoJSON repeat the first point
    })
    const o = flatRing(clipRing(outer!, box), true)
    if (o === undefined) return []
    const hs = holes
      .map((h) => flatRing(clipRing(h, box), false))
      .filter((h): h is Array<number> => h !== undefined && pointInRing(h[0]!, h[1]!, o))
    return [{ kind, rings: [o, ...hs] }]
  })
}

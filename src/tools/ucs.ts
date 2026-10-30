// Regione Toscana land cover 1:10 000, 2019 ("Uso e copertura del suolo", data/raw/rt/ucs.json.gz,
// written by fetch-rt.ts) as map areas in local metres, clipped to the built terrain's box. Only
// the open covers OSM mostly lacks above the woods: in the new mountain area it tags about a fifth
// of the bare rock and half the pastures. Woods, fields and towns stay OSM's.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import type { Area } from "../sim/map/index.ts"
import type { AreaKind } from "../sim/map/kinds.ts"
import { gaussBoagaToLatLon } from "./crs.ts"
import { clipRing, flatRing, pointInRing, TERRAIN_BOX, toLocal, type P } from "./geometry.ts"

/** UCS 2019 classes kept, and the area kind each becomes. */
export const UCS_CODES = {
  "131": "quarry", // aree estrattive
  "321": "grassland", // pascoli naturali e praterie
  "322": "scrub", // brughiere e cespuglieti
  "332": "rock", // rocce nude, falesie, rupi, affioramenti
  "333": "sparse", // vegetazione rada
} as const satisfies Record<string, AreaKind>

interface UcsFile {
  readonly polygons: ReadonlyArray<{
    readonly code: keyof typeof UCS_CODES
    readonly rings: ReadonlyArray<ReadonlyArray<number>>
  }>
}

/** The kept UCS polygons as areas: outer ring first, then the holes inside it. */
export const readUcs = (path: string): Array<Area> => {
  const file = JSON.parse(gunzipSync(readFileSync(path)).toString()) as UcsFile
  return file.polygons.flatMap(({ code, rings }) => {
    const [outer, ...holes] = rings.map((r) => {
      const ring: Array<P> = []
      for (let i = 0; i + 1 < r.length; i += 2)
        ring.push(toLocal(...gaussBoagaToLatLon(r[i]!, r[i + 1]!)))
      return ring.slice(0, -1) // gml repeats the first point
    })
    const o = flatRing(clipRing(outer!, TERRAIN_BOX), true)
    if (o === undefined) return []
    const hs = holes
      .map((h) => flatRing(clipRing(h, TERRAIN_BOX), false))
      .filter((h): h is Array<number> => h !== undefined && pointInRing(h[0]!, h[1]!, o))
    return [{ kind: UCS_CODES[code], rings: [o, ...hs] }]
  })
}

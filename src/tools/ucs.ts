// Regione Toscana land cover 1:10 000, 2019 ("Uso e copertura del suolo", data/raw/rt/ucs.json.gz,
// written by fetch-rt.ts) as map areas in local metres, clipped to the built terrain's box: the
// open covers OSM mostly lacks above the woods (in the new mountain area it tags about a fifth of
// the bare rock and half the pastures), the rivers' gravel beds, the water bodies, and the woods by
// type. The woods fill first and every other area over them (`FILL` in sim/map/raster.ts), so
// inside OSM's woods the conifer and mixed ones refine its forest, and elsewhere a UCS wood holds
// only ground no OSM area claims. Fields and towns stay OSM's.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import type { Area } from "../sim/map/index.ts"
import { type AreaKind, isWood } from "../sim/map/kinds.ts"
import { gaussBoagaToLatLon } from "./crs.ts"
import {
  clipRing,
  flatRing,
  pointInRing,
  ringBox,
  TERRAIN_BOX,
  toLocal,
  type P,
} from "./geometry.ts"
import type { Rect } from "./region.ts"

/** UCS 2019 classes kept, and the area kind each becomes. */
export const UCS_CODES = {
  "131": "quarry", // aree estrattive
  "311": "forest", // boschi di latifoglie
  "312": "conifer", // boschi di conifere
  "313": "mixed", // boschi misti di conifere e latifoglie
  "321": "grassland", // pascoli naturali e praterie
  "322": "scrub", // brughiere e cespuglieti
  "332": "rock", // rocce nude, falesie, rupi, affioramenti
  "333": "sparse", // vegetazione rada
  "331": "pebble", // spiagge, dune e sabbie: inland, the rivers' gravel bars
  "512": "lake", // corpi d'acqua
} as const satisfies Record<string, AreaKind>

interface UcsFile {
  readonly polygons: ReadonlyArray<{
    readonly code: keyof typeof UCS_CODES
    readonly rings: ReadonlyArray<ReadonlyArray<number>>
  }>
}

/**
 * The side of the squares the woods are cut on, m (on the local origin, so on the tiles' seams too):
 * an area lies whole in every tile its outer ring's box comes within HALO of, and one wood across
 * the valley, 10,254 vertices, lay whole in 19 tiles.
 */
const CUT = 500
/** How far a wood's piece reaches past its square, m: neighbours overlap, so the maps paint no seam between them (the minimap draws 0.3 px a metre). */
const OVERLAP = 4

/** The boxes `outer` is cut to: the built terrain's box, or for a wood each `CUT` m square its box meets, grown by `OVERLAP` and cut to the terrain's box. */
const piecesOf = (outer: ReadonlyArray<P>, wood: boolean): Array<Rect> => {
  if (!wood) return [TERRAIN_BOX]
  const [X0, Y0, X1, Y1] = TERRAIN_BOX
  const box = ringBox(outer.flat())
  const boxes: Array<Rect> = []
  for (let j = Math.floor(box[1] / CUT); j * CUT < box[3]; j++)
    for (let i = Math.floor(box[0] / CUT); i * CUT < box[2]; i++) {
      const piece: Rect = [
        Math.max(X0, i * CUT - OVERLAP),
        Math.max(Y0, j * CUT - OVERLAP),
        Math.min(X1, (i + 1) * CUT + OVERLAP),
        Math.min(Y1, (j + 1) * CUT + OVERLAP),
      ]
      if (piece[0] < piece[2] && piece[1] < piece[3]) boxes.push(piece)
    }
  return boxes
}

/**
 * A UCS polygon of `kind` (its outer ring and holes in local metres) as areas, outer ring first, then
 * the holes inside it, cut to the built terrain's box; a wood in pieces (`piecesOf`).
 */
export const ucsAreas = (
  kind: AreaKind,
  outer: ReadonlyArray<P>,
  holes: ReadonlyArray<ReadonlyArray<P>>,
): Array<Area> => {
  // The holes inside the outer ring, tested before any cut: a cut hole may keep no vertex off the
  // box's edges (a clearing wider than a piece), where a test of its first vertex could go either way.
  const flat = outer.flat()
  const inside = holes.filter((h) => pointInRing(h[0]![0], h[0]![1], flat))
  return piecesOf(outer, isWood(kind)).flatMap((box) => {
    const o = flatRing(clipRing(outer, box), true)
    if (o === undefined) return []
    const hs = inside
      .map((h) => flatRing(clipRing(h, box), false))
      .filter((h): h is Array<number> => h !== undefined)
    return [{ kind, rings: [o, ...hs] }]
  })
}

/** The kept UCS polygons as areas (`ucsAreas`). */
export const readUcs = (path: string): Array<Area> => {
  const file = JSON.parse(gunzipSync(readFileSync(path)).toString()) as UcsFile
  return file.polygons.flatMap(({ code, rings }) => {
    const [outer, ...holes] = rings.map((r) => {
      const ring: Array<P> = []
      for (let i = 0; i + 1 < r.length; i += 2)
        ring.push(toLocal(...gaussBoagaToLatLon(r[i]!, r[i + 1]!)))
      return ring.slice(0, -1) // gml repeats the first point
    })
    return ucsAreas(UCS_CODES[code], outer!, holes)
  })
}

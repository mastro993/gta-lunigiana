// The land cover as map areas in local metres, clipped to the built terrain's box: Regione Toscana's
// 1:10 000 of 2019 ("Uso e copertura del suolo", data/raw/rt/ucs.json.gz, written by fetch-rt.ts,
// EPSG:3003) and Regione Liguria's 1:10 000, ed. 2025 ("Uso del Suolo", data/raw/lig/<part>/
// uds.json.gz, written by fetch-lig.ts, EPSG:25832), both in Corine's classes, Liguria's to the
// fourth level, read by the third (the code's first three digits: its 3111 holm oak and maquis and
// 3115 chestnut are broadleaf woods, 311). Kept: the open covers OSM mostly lacks above the woods
// (in the new mountain area it tags about a fifth of the bare rock and half the pastures), the
// rivers' gravel beds, the water bodies, and the woods by type. The woods fill first and every
// other area over them (`FILL` in sim/map/raster.ts), so inside OSM's woods the conifer and mixed
// ones refine its forest, and elsewhere a land-cover wood holds only ground no OSM area claims.
// Fields and towns stay OSM's.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import type { Area } from "../sim/map/index.ts"
import { type AreaKind, isWood } from "../sim/map/kinds.ts"
import { gaussBoagaToLatLon, utm32ToLatLon } from "./crs.ts"
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

/** A land cover file: its CRS and its polygons, each an id, a class code and its rings (outer first, flat). */
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
 * The side of the squares the woods are cut on, m (on the local origin, so on the tiles' seams too):
 * an area lies whole in every tile its outer ring's box comes within HALO of, and one wood across
 * the valley, 10,254 vertices, lay whole in 19 tiles.
 */
const CUT = 500
/** How far a wood's piece reaches past its square, m: neighbours overlap, so the maps paint no seam between them (the minimap draws 0.3 px a metre). */
const OVERLAP = 4

/** The boxes `outer` is cut to: `box`, or for a wood each `CUT` m square its box meets, grown by `OVERLAP` and cut to `box`. */
const piecesOf = (outer: ReadonlyArray<P>, wood: boolean, box: Rect): Array<Rect> => {
  if (!wood) return [box]
  const [X0, Y0, X1, Y1] = box
  const [x0, y0, x1, y1] = ringBox(outer.flat())
  const boxes: Array<Rect> = []
  for (let j = Math.floor(y0 / CUT); j * CUT < y1; j++)
    for (let i = Math.floor(x0 / CUT); i * CUT < x1; i++) {
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
 * A land-cover polygon of `kind` (its outer ring and holes in local metres) as areas, outer ring
 * first, then the holes inside it, cut to `box`; a wood in pieces (`piecesOf`).
 */
export const ucsAreas = (
  kind: AreaKind,
  outer: ReadonlyArray<P>,
  holes: ReadonlyArray<ReadonlyArray<P>>,
  box: Rect = TERRAIN_BOX,
): Array<Area> => {
  // The holes inside the outer ring, tested before any cut: a cut hole may keep no vertex off the
  // box's edges (a clearing wider than a piece), where a test of its first vertex could go either way.
  const flat = outer.flat()
  const inside = holes.filter((h) => pointInRing(h[0]![0], h[0]![1], flat))
  return piecesOf(outer, isWood(kind), box).flatMap((piece) => {
    const o = flatRing(clipRing(outer, piece), true)
    if (o === undefined) return []
    const hs = inside
      .map((h) => flatRing(clipRing(h, piece), false))
      .filter((h): h is Array<number> => h !== undefined)
    return [{ kind, rings: [o, ...hs] }]
  })
}

/**
 * The kept polygons of the land cover files at `paths` as areas, clipped to `box` (`ucsAreas`). A
 * polygon in two files (two parts' files hold the polygons across their edge) is read from the
 * first that holds its id (in its CRS), so a later part's fetch, which may see it edited since,
 * never moves an earlier part's cover; within a file, a polygon twice (the same id and outer ring)
 * is read once, while the pieces of one multipolygon share its id.
 */
export const readUcs = (paths: ReadonlyArray<string>, box: Rect = TERRAIN_BOX): Array<Area> => {
  const seen = new Set<string>()
  return paths.flatMap((path) => {
    const file = readUcsFile(path),
      ids = file.polygons.map(({ id }) => `${file.crs} ${id}`)
    const areas = readOne(path, file, seen, box)
    for (const id of ids) seen.add(id)
    return areas
  })
}

/** A land cover file as `fetch-rt` and `fetch-lig` write it. */
export const readUcsFile = (path: string): UcsFile =>
  JSON.parse(gunzipSync(readFileSync(path)).toString()) as UcsFile

const readOne = (
  path: string,
  file: UcsFile,
  seen: ReadonlySet<string>,
  box: Rect,
): Array<Area> => {
  const project = PROJECTIONS[file.crs]
  if (project === undefined) throw new Error(`${path}: land cover in ${file.crs}`)
  const twice = new Set<string>()
  return file.polygons.flatMap(({ id, code, rings }) => {
    const key = `${id} ${rings[0]!.join(",")}`,
      kind = UCS_CODES[code.slice(0, 3) as keyof typeof UCS_CODES]
    if (seen.has(`${file.crs} ${id}`) || twice.has(key) || kind === undefined) return []
    twice.add(key)
    const [outer, ...holes] = rings.map((r) => {
      const ring: Array<P> = []
      for (let i = 0; i + 1 < r.length; i += 2) ring.push(toLocal(...project(r[i]!, r[i + 1]!)))
      return ring.slice(0, -1) // gml and GeoJSON repeat the first point
    })
    return ucsAreas(kind, outer!, holes, box)
  })
}

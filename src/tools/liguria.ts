// Regione Liguria's Geoportale services (issue #12), each CC BY 4.0 in its ISO metadata
// (srvcarto.regione.liguria.it/geoservices/REST/metadata/scheda_xml/<id>), as `fetch-lig` asks them:
// - the NC5 (DB Geotopografico National Core 1:5000, id 2052) on WFS M2052, in EPSG:25832, 3D:
//   buildings (L6871), minor buildings (L6870), carriageways (L6858) and the mapped area (L6945);
// - the land use 1:10 000, ed. 2025 (Uso del Suolo, id 2660) on WFS M2660, layer L10449, in
//   EPSG:25832 (its Z is 0);
// - the DTM ed. 2023 (id 2056) on WCS M2056, coverage M2056__L6952: EPSG:3003, 5 m cells of whole
//   metres (Int16, −32767 where none), clipped at the regional border; in La Spezia's province it is
//   interpolated from the NC5's own heights.
// The WFS pages are GeoJSON of at most PAGE features, the server's cap: `fetchWfs` asks the count
// first (resultType=hits), then every page from its startIndex (a page asked without one comes back
// unsorted, its order changing between calls), sorted by a unique field, and checks the rows against
// that count. Its box filter is loose (a feature's bounding box against the box), a superset the
// readers clip.

import { existsSync } from "node:fs"
import { join } from "node:path"

import { TILE } from "../sim/map/kinds.ts"
import { gaussBoagaToLatLon } from "./crs.ts"
import { cropOf } from "./dtm-mosaic.ts"
import { clipRing, gaussBoagaBox, toLocal } from "./geometry.ts"
import { ligDir, type Part, type Rect, tilesOf } from "./region.ts"

/** The folders under `root` that `fetch-lig` wrote for any of `parts` (`ligDir`), in the parts' order: what the build reads of Liguria. */
export const ligFolders = (root: string, parts: ReadonlyArray<Pick<Part, "key">>): Array<string> =>
  parts.map((p) => join(root, ligDir(p))).filter((dir) => existsSync(dir))

/** The Geoportale's GeoServer. */
const GEOSERVER = "https://geoservizi.regione.liguria.it/geoserver"
/** Features a WFS page holds: the server's cap, whatever larger count is asked. */
export const PAGE = 5000

/** A WFS query: the service, its layer, the unique field its pages are sorted by and the filter's parameters. */
export interface WfsQuery {
  readonly map: string
  readonly layer: string
  readonly sortBy: string
  readonly filter: Readonly<Record<string, string>>
}

/** The NC5's layers `fetch-lig` pins, by what each holds. */
export const NC5_LAYERS = {
  buildings: "L6871",
  minor: "L6870",
  carriageways: "L6858",
  mapped: "L6945",
} as const

/** NC5 layer `layer`'s features whose bounding box meets the EPSG:25832 `box`. */
export const nc5Query = (layer: string, box: Rect): WfsQuery => ({
  map: "M2052",
  layer,
  sortBy: "ogr_fid",
  filter: { bbox: `${box.join(",")},urn:ogc:def:crs:EPSG::25832` },
})

/**
 * The land use's polygons whose bounding box meets the EPSG:25832 `box` and whose code starts with
 * one of `classes` (Corine's third level, `COD_USO` being the third or the fourth): a CQL filter, as
 * the server takes a `bbox` or a filter, not both, and the sea, one polygon of 1,071 km², would
 * otherwise come with every box on the coast.
 */
export const udsQuery = (box: Rect, classes: ReadonlyArray<string>): WfsQuery => ({
  map: "M2660",
  layer: "L10449",
  sortBy: "ID_RLIG",
  filter: {
    cql_filter: `BBOX(GEOMETRY,${box.join(",")}) AND (${classes.map((c) => `COD_USO LIKE '${c}%'`).join(" OR ")})`,
  },
})

/** The GetFeature URL of `q`: its count when `startIndex` is undefined, else its GeoJSON page from there, in EPSG:25832. */
export const wfsUrl = (q: WfsQuery, startIndex?: number): string => {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `${q.map}:${q.layer}`,
    ...(startIndex === undefined
      ? { resultType: "hits" }
      : {
          outputFormat: "application/json",
          srsName: "EPSG:25832",
          count: String(PAGE),
          startIndex: String(startIndex),
          sortBy: q.sortBy,
        }),
    ...q.filter,
  })
  return `${GEOSERVER}/${q.map}/wfs?${params}`
}

/** A GeoJSON feature as the WFS gives it: its attributes and its (multi)polygon, E, N, Z. */
export interface WfsFeature {
  readonly properties: Readonly<Record<string, string | number | null>>
  readonly geometry: {
    readonly type: string
    readonly coordinates: ReadonlyArray<unknown>
  } | null
}

/**
 * Every feature of `q`, in its sort order: the count first, then each page from its startIndex;
 * throws unless the pages hold that count of features, each once, in ascending `sortBy`. `get` is
 * the text of a 2xx answer (`getText`).
 */
export const fetchWfs = async (
  q: WfsQuery,
  get: (url: string) => Promise<string>,
): Promise<Array<WfsFeature>> => {
  const hits = Number(/numberMatched="(\d+)"/.exec(await get(wfsUrl(q)))?.[1] ?? Number.NaN)
  if (!Number.isInteger(hits)) throw new Error(`${q.map}:${q.layer}: no numberMatched in the count`)
  const features: Array<WfsFeature> = []
  for (let start = 0; start < hits; start += PAGE) {
    const page = JSON.parse(await get(wfsUrl(q, start))) as {
      readonly numberMatched: number
      readonly features: ReadonlyArray<WfsFeature>
    }
    if (page.numberMatched !== hits)
      throw new Error(`${q.map}:${q.layer} changed while paging: ${page.numberMatched} of ${hits}`)
    features.push(...page.features)
  }
  if (features.length !== hits)
    throw new Error(`${q.map}:${q.layer}: ${features.length} features of ${hits}`)
  const keys = features.map((f) => Number(f.properties[q.sortBy]))
  for (let k = 0; k < keys.length; k++)
    if (!(Number.isInteger(keys[k]) && (k === 0 || keys[k]! > keys[k - 1]!)))
      throw new Error(`${q.map}:${q.layer}: ${q.sortBy} ${keys[k]} out of order or repeated`)
  return features
}

/** A layer's file as `fetch-lig` writes it (data/raw/lig/<part>/nc5/<layer>.json.gz). */
export interface Nc5LayerFile {
  readonly layer: string
  readonly crs: "EPSG:25832"
  /** The EPSG:25832 box asked, on whole metres. */
  readonly box: Rect
  /** The server's count for the box, which the features' number matched. */
  readonly numberMatched: number
  readonly features: ReadonlyArray<{
    readonly properties: WfsFeature["properties"]
    readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  }>
}

/**
 * The file of NC5 layer `q`'s `features` asked over `box`: each feature's attributes as served and
 * its polygons (`polygonsOfFeature`), the mapped area's (L6945, one polygon of 942.57 km² over La
 * Spezia's lot) clipped to the box (`clippedRings`).
 */
export const nc5File = (
  q: WfsQuery,
  box: Rect,
  features: ReadonlyArray<WfsFeature>,
): Nc5LayerFile => ({
  layer: `${q.map}:${q.layer}`,
  crs: "EPSG:25832",
  box,
  numberMatched: features.length,
  features: features.flatMap((f) => {
    const polygons = polygonsOfFeature(f)
    const shapes =
      q.layer === NC5_LAYERS.mapped ? polygons.map((rings) => clippedRings(rings, box)) : polygons
    const left = shapes.filter((rings) => rings.length > 0)
    return left.length === 0 ? [] : [{ properties: f.properties, polygons: left }]
  }),
})

/** A polygon's rings [e, n, z, …] clipped to `box`, on whole centimetres and Z 0 (the mapped area's own), those left with an area. */
export const clippedRings = (
  rings: ReadonlyArray<ReadonlyArray<number>>,
  box: Rect,
): Array<Array<number>> =>
  rings.flatMap((ring) => {
    const pairs: Array<readonly [number, number]> = []
    for (let i = 0; i + 2 < ring.length; i += 3) pairs.push([ring[i]!, ring[i + 1]!])
    const cut = clipRing(pairs, box)
    return cut.length < 3 ? [] : [cut.flatMap(([e, n]) => [cm(e), cm(n), 0])]
  })

/**
 * The land use's features as `ucs.json.gz` holds polygons, one entry a polygon: its `ID_RLIG`, its
 * whole code (3 or 4 digits), its rings flat [e, n, …] on decimetres, Z dropped; throws on a code
 * outside `classes` (the third level), which the query's filter should have left out.
 */
export const udsPolygons = (
  features: ReadonlyArray<WfsFeature>,
  classes: ReadonlyArray<string>,
): Array<{ id: number; code: string; rings: Array<Array<number>> }> =>
  features.flatMap((f) => {
    const code = String(f.properties.COD_USO)
    if (!classes.includes(code.slice(0, 3))) throw new Error(`land use code ${code} not kept`)
    return polygonsOfFeature(f).map((rings) => ({
      id: Number(f.properties.ID_RLIG),
      code,
      rings: rings.map((ring) =>
        ring.flatMap((v, k) => (k % 3 === 2 ? [] : [Math.round(v * 10) / 10])),
      ),
    }))
  })

/** A feature's polygons: each its rings, each ring flat [e0, n0, z0, e1, …] on whole centimetres. */
export const polygonsOfFeature = (f: WfsFeature): Array<Array<Array<number>>> => {
  const g = f.geometry
  if (g === null) return []
  const polygons =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? g.coordinates
        : (() => {
            throw new Error(`not a polygon: ${g.type}`)
          })()
  return (polygons as ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>).map(
    (rings) => rings.map((ring) => ring.flatMap(([e, n, z = 0]) => [cm(e!), cm(n!), cm(z)])),
  )
}

/** `v` rounded to the centimetre. */
const cm = (v: number): number => Math.round(v * 100) / 100

/** The DTM ed. 2023's lattice: the west and north edges of its cell (0, 0) in EPSG:3003, and its cell, m. */
export const DTM_LATTICE = { e: 1379054.19189, n: 4947084.40548, cell: 5 } as const
/** The largest crop asked in one piece, cells a side: the server deflates only a crop that fits one TIFF tile. */
const DTM_TILE = 512
/** How far past its tile a DTM crop reaches, m: two of its cells, the bilinear's neighbour across the tile's edge and Liguria's EPSG:3003, 0.3 m from ours. */
const DTM_PAD = 10

/**
 * The 2 km tiles whose DTM crops fetch-lig asks for a part's `rects`: every tile the local box round
 * fetch-rt's crop of them (`cropOf`, their EPSG:3003 box plus its margin) meets, a notch between
 * rectangles included, as the chain fills the whole crop. Each crop is its tile's EPSG:3003 box
 * plus DTM_PAD (`dtmCropBox`), so together they cover the crop.
 */
export const dtmTiles = (rects: ReadonlyArray<Rect>): ReturnType<typeof tilesOf> => {
  const { e0, n0, cols, rows } = cropOf(rects)
  const corners = [
    [e0, n0],
    [e0 + cols - 1, n0],
    [e0, n0 + rows - 1],
    [e0 + cols - 1, n0 + rows - 1],
  ].map(([e, n]) => toLocal(...gaussBoagaToLatLon(e!, n!)))
  const xs = corners.map((c) => c[0]),
    ys = corners.map((c) => c[1])
  return tilesOf([[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]])
}

/** The EPSG:3003 box of tile (i, j)'s DTM crop: the tile's own box plus DTM_PAD. */
export const dtmCropBox = (i: number, j: number): Rect =>
  gaussBoagaBox([[i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE]], DTM_PAD)

/**
 * The files of a part's `dtm/` folder (`names`) that an earlier run of fetch-lig wrote and this one,
 * which wrote `written`, does not: the crops to delete. A dotfile (a `.DS_Store` Finder leaves) is
 * no input, as `rawFiles` skips it, so it stays.
 */
export const staleCrops = (
  names: ReadonlyArray<string>,
  written: ReadonlySet<string>,
): Array<string> => names.filter((name) => !written.has(name) && !name.startsWith("."))

/** Whether a WCS answer says the crop lies wholly beyond the coverage's grid (`InvalidSubsetting`, "Empty intersection after subsetting"), so there is nothing to keep. */
export const beyondCoverage = (status: number, body: string): boolean =>
  status === 404 && body.includes('exceptionCode="InvalidSubsetting"')

/**
 * The WCS 2.0.1 GetCoverage of the DTM's native cells over the EPSG:3003 `box`, its edges snapped
 * outward to the lattice (2.0.1 snaps to the nearest edge; 1.0.0 would resample onto a shifted
 * grid), as one deflated GeoTIFF; throws for a box over DTM_TILE cells a side.
 */
export const dtmCropUrl = ([x0, y0, x1, y1]: Rect): string => {
  const { e, n, cell } = DTM_LATTICE
  const c0 = Math.floor((x0 - e) / cell),
    c1 = Math.ceil((x1 - e) / cell),
    r0 = Math.floor((n - y1) / cell),
    r1 = Math.ceil((n - y0) / cell)
  if (c1 - c0 > DTM_TILE || r1 - r0 > DTM_TILE)
    throw new Error(`a DTM crop of ${c1 - c0} × ${r1 - r0} cells: at most ${DTM_TILE} a side`)
  const at = (v: number) => v.toFixed(5)
  const params = new URLSearchParams({
    service: "WCS",
    version: "2.0.1",
    request: "GetCoverage",
    coverageId: "M2056__L6952",
    format: "image/tiff",
    "geotiff:compression": "DEFLATE",
    "geotiff:tiling": "true",
    "geotiff:tilewidth": String(DTM_TILE),
    "geotiff:tileheight": String(DTM_TILE),
  })
  // URLSearchParams would escape the subsets' parentheses and commas, which the server reads as is.
  return `${GEOSERVER}/M2056/wcs?${params}&subset=X(${at(e + c0 * cell)},${at(e + c1 * cell)})&subset=Y(${at(n - r1 * cell)},${at(n - r0 * cell)})`
}

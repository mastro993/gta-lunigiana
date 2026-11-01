// The fallback chain's sources (issue #10) as fetch-rt reads them, each sampled at the 1 m crop's
// cell centres in EPSG:3003 (`dtm-mosaic.ts`), in decimetres, NaN where it has no data:
// - the province 10 m DTMs (Regione Toscana, from the CTR 1:10 000, CC BY 3.0 IT): ESRI ASCII grids
//   in EPSG:3003, corner-registered, NODATA beyond the province;
// - the 2021 surface model (DSM_autocorrelazione_2021, Regione Toscana, CC BY 4.0): elements of
//   1 m ESRI ASCII grids in EPSG:7791, corner-registered on fractional metres; a surface model, so
//   the chain takes it on open ground alone (`openGround`), less the trees and shrubs standing on
//   it (`clearCanopy`);
// - Regione Emilia-Romagna's DTM 5x5 (CC BY 4.0): its WCS's native 5 m grid, EPSG:7791, a GeoTIFF.
// EPSG:7791 is RDN2008 / UTM 32N. A cell's place there comes from exact transforms on a lattice
// every PROJ_STEP m over the crop, bilinear between, as `dtm.ts` places the map's points.

import { gaussBoagaToLatLon, latLonToUtm32 } from "./crs.ts"
import { ascHeader, type Crop } from "./dtm-mosaic.ts"
import type { Filler } from "./fill-chain.ts"
import { fillPolygon } from "./geometry.ts"

/** The terrain's sources in the chain's order: a cell's source code is the index of its source here. */
export const SOURCES = ["lidar", "dsm2021", "dtm10", "rer"] as const
/** One of the terrain's sources. */
export type Source = (typeof SOURCES)[number]

/** A source's code in the mosaic's source raster. */
export const codeOf = (source: Source): number => SOURCES.indexOf(source)

/**
 * UCS 2019 classes without a canopy, where a surface model shows the ground: arable land (211),
 * meadows (231), natural pastures (321), heath (322), sand and gravel (331), bare rock (332) and
 * sparse vegetation (333).
 */
const OPEN_GROUND: ReadonlySet<string> = new Set(["211", "231", "321", "322", "331", "332", "333"])

/** Lattice step of the EPSG:3003 → 7791 transform, m: bilinear between exact nodes is good to well under 1 mm. */
const PROJ_STEP = 50

/** Heights in metres, NaN where none: cell (c, r) centred on (x0 + c × cell, y0 + r × cell), row 0 south. */
export interface Raster {
  readonly x0: number
  readonly y0: number
  readonly cell: number
  readonly cols: number
  readonly rows: number
  readonly z: Float32Array
}

/** Bilinear height of `r` at (x, y), m; NaN outside its cell centres or beside a cell without data. */
export const sample = (r: Raster, x: number, y: number): number => {
  const fx = (x - r.x0) / r.cell,
    fy = (y - r.y0) / r.cell
  if (!(fx >= 0 && fy >= 0 && fx <= r.cols - 1 && fy <= r.rows - 1)) return Number.NaN
  const c = Math.min(r.cols - 2, Math.floor(fx)),
    w = Math.min(r.rows - 2, Math.floor(fy))
  const tx = fx - c,
    ty = fy - w,
    k = w * r.cols + c
  return (
    (r.z[k]! * (1 - tx) + r.z[k + 1]! * tx) * (1 - ty) +
    (r.z[k + r.cols]! * (1 - tx) + r.z[k + r.cols + 1]! * tx) * ty
  )
}

/**
 * The window of an ESRI ASCII grid (the bytes of its file) over `box` [x0, y0, x1, y1] in its own
 * CRS, with a cell to spare each side: corner- or centre-registered, NODATA cells NaN; undefined
 * when the grid misses the box. Only the rows over the box are parsed.
 */
export const ascWindow = (
  buf: Buffer,
  [bx0, by0, bx1, by1]: readonly [number, number, number, number],
  name: string,
): Raster | undefined => {
  const starts = [0]
  for (let o = buf.indexOf(10); o >= 0 && starts.length <= 6; o = buf.indexOf(10, o + 1))
    starts.push(o + 1)
  const h = ascHeader(buf.toString("latin1", 0, starts[6]).split("\n"))
  const { ncols, nrows, cellsize: cell, nodata_value } = h
  if (ncols === undefined || nrows === undefined || cell === undefined)
    throw new Error(`${name}: no ncols, nrows or cellsize`)
  // The centres of the south-west cell.
  const xc = h.xllcenter ?? h.xllcorner! + cell / 2,
    yc = h.yllcenter ?? h.yllcorner! + cell / 2
  if (Number.isNaN(xc) || Number.isNaN(yc)) throw new Error(`${name}: no lower-left corner`)
  const c0 = Math.max(0, Math.floor((bx0 - xc) / cell) - 1),
    c1 = Math.min(ncols - 1, Math.ceil((bx1 - xc) / cell) + 1)
  // Rows counted from the south: file row nrows - 1 - r.
  const r0 = Math.max(0, Math.floor((by0 - yc) / cell) - 1),
    r1 = Math.min(nrows - 1, Math.ceil((by1 - yc) / cell) + 1)
  if (c0 > c1 || r0 > r1) return undefined
  const cols = c1 - c0 + 1,
    rows = r1 - r0 + 1
  const z = new Float32Array(cols * rows)
  const first = nrows - 1 - r1,
    last = nrows - 1 - r0
  for (let f = 0, o = starts[6]!; f <= last; f++) {
    const end = buf.indexOf(10, o)
    if (f >= first) {
      const values = buf
        .toString("latin1", o, end < 0 ? buf.length : end)
        .trim()
        .split(/\s+/)
      const r = nrows - 1 - f - r0
      for (let c = 0; c < cols; c++) {
        const v = Number(values[c0 + c])
        z[r * cols + c] = v === nodata_value || Number.isNaN(v) ? Number.NaN : v
      }
    }
    if (end < 0) break
    o = end + 1
  }
  return { x0: xc + c0 * cell, y0: yc + r0 * cell, cell, cols, rows, z }
}

/** Emilia-Romagna's DTM 5x5 WCS: its native 5 m grid over an EPSG:7791 box (edges on 5 m multiples, outward), a GeoTIFF. */
export const rerUrl = ([x0, y0, x1, y1]: readonly [number, number, number, number]): string => {
  const a = Math.floor(x0 / 5) * 5,
    b = Math.floor(y0 / 5) * 5,
    c = Math.ceil(x1 / 5) * 5,
    d = Math.ceil(y1 / 5) * 5
  return `https://servizigis.regione.emilia-romagna.it/wcs/dtm5x5?service=WCS&version=1.0.0&request=GetCoverage&coverage=DTM5X5_RDN32_RMD&crs=EPSG:7791&response_crs=EPSG:7791&bbox=${a},${b},${c},${d}&width=${(c - a) / 5}&height=${(d - b) / 5}&format=GeoTIFF`
}

/** A one-band GeoTIFF in EPSG:7791 as a raster; heights below -1000 m, or its nodata value, are NaN. */
export const geoTiffRaster = async (bytes: Buffer): Promise<Raster> => {
  const { fromArrayBuffer } = await import("geotiff")
  const tiff = await fromArrayBuffer(new Uint8Array(bytes).buffer)
  const image = await tiff.getImage()
  if (image.getGeoKeys()?.ProjectedCSTypeGeoKey !== 7791)
    throw new Error("the GeoTIFF is not in EPSG:7791")
  const [ox, oy] = image.getOrigin(),
    [rx, ry] = image.getResolution()
  if (rx !== -ry!) throw new Error(`the GeoTIFF's cells are not square: ${rx} by ${ry}`)
  const cols = image.getWidth(),
    rows = image.getHeight(),
    nodata = image.getGDALNoData()
  const north = (await image.readRasters({ interleave: true })) as ArrayLike<number>
  const z = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = north[(rows - 1 - r) * cols + c]!
      z[r * cols + c] = v === nodata || v < -1000 ? Number.NaN : v
    }
  return { x0: ox! + rx / 2, y0: oy! + ry! * (rows - 0.5), cell: rx, cols, rows, z }
}

/**
 * Where cell (col, row) of the crop lies in EPSG:7791, written to `out` [easting, northing]:
 * bilinear on a lattice of exact transforms every PROJ_STEP m from the crop's first cell.
 */
export const utmOfCrop = (crop: Crop): ((col: number, row: number, out: Float64Array) => void) => {
  const ni = Math.floor((crop.cols - 1) / PROJ_STEP) + 2,
    nj = Math.floor((crop.rows - 1) / PROJ_STEP) + 2
  const lattice = new Float64Array(ni * nj * 2)
  for (let j = 0; j < nj; j++)
    for (let i = 0; i < ni; i++)
      lattice.set(
        latLonToUtm32(...gaussBoagaToLatLon(crop.e0 + i * PROJ_STEP, crop.n0 + j * PROJ_STEP)),
        2 * (j * ni + i),
      )
  return (col, row, out) => {
    const fx = col / PROJ_STEP,
      fy = row / PROJ_STEP
    const i = Math.floor(fx),
      j = Math.floor(fy),
      tx = fx - i,
      ty = fy - j,
      p = 2 * (j * ni + i),
      q = p + 2 * ni
    for (let a = 0; a < 2; a++)
      out[a] =
        (lattice[p + a]! * (1 - tx) + lattice[p + 2 + a]! * tx) * (1 - ty) +
        (lattice[q + a]! * (1 - tx) + lattice[q + 2 + a]! * tx) * ty
  }
}

/** The EPSG:7791 box [x0, y0, x1, y1] round the crop's cell centres. */
export const utmBox = (crop: Crop): [number, number, number, number] => {
  const at = utmOfCrop(crop),
    p = new Float64Array(2),
    xs: Array<number> = [],
    ys: Array<number> = []
  for (const [c, r] of [
    [0, 0],
    [crop.cols - 1, 0],
    [0, crop.rows - 1],
    [crop.cols - 1, crop.rows - 1],
  ] as const) {
    at(c, r, p)
    xs.push(p[0]!)
    ys.push(p[1]!)
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * The filler of `source` reading `rasters` in turn (the first with data at a cell wins), each in
 * the crop's own EPSG:3003 (`utm` undefined) or in EPSG:7791 through `utm`; `where` limits it.
 */
export const rasterFiller = (
  source: Source,
  crop: Crop,
  rasters: ReadonlyArray<Raster>,
  utm?: (col: number, row: number, out: Float64Array) => void,
  where?: (k: number) => boolean,
): Filler => {
  const p = new Float64Array(2)
  return {
    source: codeOf(source),
    at: (c, r) => {
      if (utm === undefined) {
        p[0] = crop.e0 + c
        p[1] = crop.n0 + r
      } else utm(c, r, p)
      for (const raster of rasters) {
        const v = sample(raster, p[0]!, p[1]!)
        if (!Number.isNaN(v)) return v * 10
      }
      return Number.NaN
    },
    ...(where === undefined ? {} : { where }),
  }
}

/** 1 on each crop cell whose centre lies in a UCS polygon of an open-ground class (EPSG:3003 rings), else 0. */
export const openGround = (
  features: ReadonlyArray<{
    readonly attrs: Readonly<Record<string, string>>
    readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  }>,
  crop: Crop,
): Uint8Array => {
  const out = new Uint8Array(crop.cols * crop.rows),
    block = { c0: 0, r0: 0, cols: crop.cols, rows: crop.rows }
  for (const { attrs, polygons } of features)
    if (OPEN_GROUND.has(attrs.ucs2019 ?? ""))
      for (const rings of polygons)
        fillPolygon(rings, crop.e0 - 0.5, crop.n0 - 0.5, 1, block, (k) => (out[k] = 1))
  return out
}

/** The widest bump (or pit) of the surface model taken for a tree or a shrub, m: the side of the opening's square. */
export const CANOPY_SIDE = 9
/** How far a cell of the surface model stands above its opening to be canopy, or below its closing to be a pit, dm. */
export const CANOPY_RISE = 7
/** How far round a canopy or pit cell the cells go with it, m: a crown's edge, under the rise but above the ground. */
const FRINGE = 2

/**
 * Clears from `open` the cells in `box` (crop columns and rows [c0, r0, c1, r1]) where the surface
 * model shows canopy or a pit rather than the ground: its height above `ground` (a smooth DTM, so
 * a slope is not taken for a bump) is opened by a square of CANOPY_SIDE m (the lowest within the
 * square, then the highest of those), which keeps the ground and drops what stands on it narrower
 * than the square, and closed (the highest, then the lowest), which fills what sinks into it so; a
 * cell more than CANOPY_RISE above its opening or below its closing is cleared, and so are the
 * cells within FRINGE m of one (a crown's edge). The pastures of the Apennine ridge carry scattered trees and
 * shrubs, UCS's 1:10 000 polygons take in the edge of the woods round them, and the image matching
 * the model comes from fails here and there in pits tens of metres deep.
 */
export const clearCanopy = (
  open: Uint8Array,
  dsm: Filler,
  ground: Filler,
  crop: Crop,
  [c0, r0, c1, r1]: readonly [number, number, number, number],
): void => {
  const w = c1 - c0 + 1,
    h = r1 - r0 + 1,
    rise = new Float32Array(w * h).fill(Number.NaN)
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++)
      if (open[(r0 + r) * crop.cols + c0 + c] === 1)
        rise[r * w + c] = dsm.at(c0 + c, r0 + r) - ground.at(c0 + c, r0 + r)
  const opened = extreme(extreme(rise, w, h, Math.min), w, h, Math.max),
    closed = extreme(extreme(rise, w, h, Math.max), w, h, Math.min)
  const canopy = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k++)
    if (rise[k]! - opened[k]! > CANOPY_RISE || closed[k]! - rise[k]! > CANOPY_RISE) {
      const c = k % w,
        r = (k - c) / w
      for (let b = Math.max(0, r - FRINGE); b <= Math.min(h - 1, r + FRINGE); b++)
        for (let a = Math.max(0, c - FRINGE); a <= Math.min(w - 1, c + FRINGE); a++)
          canopy[b * w + a] = 1
    }
  // The ground left, opened by the same square: a strip or a scrap of it narrower than the square,
  // between trees or along a gully the woods hide, would stand out of the smooth fill round it.
  const left = new Float32Array(w * h)
  for (let k = 0; k < w * h; k++)
    left[k] = Number.isNaN(rise[k]!) ? Number.NaN : canopy[k] === 1 ? 0 : 1
  const kept = extreme(extreme(left, w, h, Math.min), w, h, Math.max)
  for (let k = 0; k < w * h; k++)
    if (canopy[k] === 1 || kept[k] !== 1)
      open[(r0 + Math.floor(k / w)) * crop.cols + c0 + (k % w)] = 0
}

/** `pick` (Math.min or Math.max) over the CANOPY_SIDE m square round each cell of a `w` × `h` grid with data, NaN skipped: rows, then columns. */
const extreme = (
  z: Float32Array,
  w: number,
  h: number,
  pick: (a: number, b: number) => number,
): Float32Array => {
  const half = (CANOPY_SIDE - 1) / 2,
    rows = new Float32Array(w * h),
    out = new Float32Array(w * h)
  const along = (
    from: Float32Array,
    to: Float32Array,
    n: number,
    step: number,
    lines: number,
    next: number,
  ) => {
    for (let l = 0; l < lines; l++)
      for (let i = 0; i < n; i++) {
        const k = l * next + i * step
        if (Number.isNaN(z[k]!)) {
          to[k] = Number.NaN
          continue
        }
        let v = Number.NaN
        for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
          const u = from[l * next + j * step]!
          if (!Number.isNaN(u)) v = Number.isNaN(v) ? u : pick(v, u)
        }
        to[k] = v
      }
  }
  along(z, rows, w, 1, h, w)
  along(rows, out, h, w, w, 1)
  return out
}

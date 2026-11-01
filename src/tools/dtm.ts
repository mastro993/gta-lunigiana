// The DTMs the map build reads, sampled in local metres: Regione Toscana's LiDAR DTM as fetch-rt
// writes it (`loadDtm`), or a geographic GeoTIFF (`loadGeoDtm`, Cesena's). Each gives the height at
// a point and windows of the terrain grid's nodes (terrain.ts), each node the mean of the heights
// round it.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

import { latLonToGaussBoaga } from "./crs.ts"
import { BOUNDS, fromLocal } from "./geometry.ts"
import { REGION } from "./region.ts"
import {
  BOX,
  cellOf,
  fractionOf,
  type Grid,
  gridLattice,
  type Ground,
  makeGrid,
  type Span,
} from "./terrain.ts"

/** Lattice step, m, on which local -> Gauss-Boaga is computed exactly; bilinear in between is exact to well under 1 mm. */
const PROJ_STEP = 50

/**
 * The uncarved terrain: m a.s.l. at a local point (`at`), and a window of the grid's nodes, each
 * the mean of `at` over the box `makeGrid` averages (`grid`); where the DTM says which source each
 * cell came from (`fetch-rt`'s chain, issue #10), the source of the cell nearest a point.
 */
export interface Dem {
  readonly at: (x: number, y: number) => number
  readonly grid: (span: Span) => Grid
  readonly source?: (x: number, y: number) => string
}

/** Samples a geographic GeoTIFF at pixel centres, rejecting missing terrain rather than inventing heights. */
export const loadGeoDtm = async (file: string): Promise<Dem> => {
  const { fromArrayBuffer } = await import("geotiff")
  const bytes = readFileSync(file)
  const tiff = await fromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  const image = await tiff.getImage()
  const keys = image.getGeoKeys()
  if (
    keys === null ||
    keys.GeographicTypeGeoKey !== 4326 ||
    keys.ProjectedCSTypeGeoKey !== undefined
  )
    throw new Error("DTM must use EPSG:4326")
  const [west, south, east, north] = image.getBoundingBox()
  const cols = image.getWidth(),
    rows = image.getHeight()
  if (cols < 2 || rows < 2 || image.getSamplesPerPixel() !== 1)
    throw new Error("Invalid DTM dimensions")
  for (const [x, y] of [
    [BOUNDS.minX - 4, BOUNDS.minY - 4],
    [BOUNDS.maxX + 4, BOUNDS.maxY + 4],
  ]) {
    const [lat, lon] = fromLocal(x!, y!)
    if (lon < west! || lon > east! || lat < south! || lat > north!)
      throw new Error("DTM does not cover the play area")
  }
  const samples = await image.readRasters({ interleave: true })
  const noData = image.getGDALNoData()
  if (Array.from(samples).some((z) => !Number.isFinite(z) || z === noData || z < -500 || z > 3000))
    throw new Error("DTM contains missing or invalid heights")
  const at = (x: number, y: number) => {
    const [lat, lon] = fromLocal(x, y)
    const fx = ((lon - west!) / (east! - west!)) * cols - 0.5,
      fy = ((north! - lat) / (north! - south!)) * rows - 0.5
    const col = Math.min(cols - 2, Math.max(0, Math.floor(fx))),
      row = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
    const tx = Math.min(1, Math.max(0, fx - col)),
      ty = Math.min(1, Math.max(0, fy - row))
    const k = row * cols + col
    return (
      (samples[k]! * (1 - tx) + samples[k + 1]! * tx) * (1 - ty) +
      (samples[k + cols]! * (1 - tx) + samples[k + cols + 1]! * tx) * ty
    )
  }
  return { at, grid: (span) => makeGrid(at, span) }
}

/**
 * The LiDAR DTM as `fetch-rt.ts` writes it: heights, m, on `cols` × `rows` cells of `cell` m in
 * EPSG:3003 (Gauss-Boaga west), row-major from the cell centred on (`e0`, `n0`).
 */
export interface DtmData {
  readonly e0: number
  readonly n0: number
  readonly cols: number
  readonly rows: number
  readonly cell: number
  readonly z: Float32Array
  /** Each cell's source, an index into `names` (`terrain-sources.ts`). */
  readonly sources: { readonly names: ReadonlyArray<string>; readonly codes: Uint8Array }
}

/**
 * Bilinear easting (`c` 0) or northing (1) at fractional cell (fx, fy) past node (ox, oy) of the
 * projection lattice `a` (`cols` × `rows` nodes, two values each), clamped to its edge.
 */
const bilinear = (
  a: Float64Array,
  cols: number,
  rows: number,
  fx: number,
  fy: number,
  c: number,
  ox: number,
  oy: number,
) => {
  const i = cellOf(fx, ox, cols),
    j = cellOf(fy, oy, rows)
  const tx = fractionOf(fx, ox, i),
    ty = fractionOf(fy, oy, j)
  const v = (di: number, dj: number) => a[((j + dj) * cols + i + di) * 2 + c]!
  return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty
}

/**
 * Bilinear height at fractional cell (fx, fy) of the DTM's `cols` × `rows` heights `z`, clamped to
 * its edge: `bilinear`'s sum from the raster's first node. Kept apart from `bilinear` so V8 inlines
 * it into the grid's 25 samples a node (through `bilinear`'s offsets it did not, and the grid
 * stage took 2.0 s of lucido's build rather than 0.85 s).
 */
const dtmHeight = (z: Float32Array, cols: number, rows: number, fx: number, fy: number) => {
  const i = Math.min(cols - 2, Math.max(0, Math.floor(fx))),
    j = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
  const tx = Math.min(1, Math.max(0, fx - i)),
    ty = Math.min(1, Math.max(0, fy - j))
  const k = j * cols + i
  return (
    (z[k]! * (1 - tx) + z[k + 1]! * tx) * (1 - ty) +
    (z[k + cols]! * (1 - tx) + z[k + cols + 1]! * tx) * ty
  )
}

/** The DTM that `fetch-rt.ts` writes to `dir`: dtm.json, dtm.bin and dtm-src.bin (EPSG:3003, 2 m cells). */
export const readDtm = (dir: string): DtmData => {
  const meta = JSON.parse(readFileSync(join(dir, "dtm.json"), "utf8")) as Omit<
    DtmData,
    "z" | "sources"
  > & { readonly sources: ReadonlyArray<string> }
  const raw = inflateSync(readFileSync(join(dir, "dtm.bin")))
  const z = new Float32Array(meta.cols * meta.rows)
  for (let k = 0, acc = 0; k < z.length; k++) {
    acc = (k % meta.cols === 0 ? 0 : acc) + raw.readInt16LE(2 * k)
    z[k] = acc / 10
  }
  const codes = new Uint8Array(inflateSync(readFileSync(join(dir, "dtm-src.bin"))))
  if (codes.length !== z.length)
    throw new Error(`${dir}/dtm-src.bin: ${codes.length} cells, not ${z.length}`)
  return { ...meta, z, sources: { names: meta.sources, codes } }
}

/** The DTM that `fetch-rt.ts` writes to `dir`, sampled in local metres (`dtmDem`). */
export const loadDtm = (dir: string, ground: Ground = REGION): Dem => dtmDem(readDtm(dir), ground)

/**
 * Bilinear sampler in local metres of `dtm`, through a lattice of exact projections every
 * PROJ_STEP m over `ground`'s built terrain and 100 m round it; outside the crop it holds the edge
 * value. The lattice's nodes and a point's fraction of a lattice cell are measured from 100 m
 * south-west of the region's anchor, so a point's height keeps its bits when parts grow the box.
 * Its grid windows give the nodes `makeGrid` gives on the sampler, bit for bit, but read each
 * sample's projection from terms worked out once per lattice row: the same operations on the
 * same doubles, about twice as fast (the grid's tile pass took 3.5 s of Lunigiana's 12 s).
 */
export const dtmDem = (dtm: DtmData, ground: Ground = REGION): Dem => {
  const { bounds, anchor } = ground
  const margin = 2 * PROJ_STEP
  // The reference node (rx, ry), its column and row (ri, rj), and the lattice's first node.
  const rx = anchor.x - margin,
    ry = anchor.y - margin
  const ri = Math.ceil((rx - bounds.minX + margin) / PROJ_STEP),
    rj = Math.ceil((ry - bounds.minY + margin) / PROJ_STEP)
  const lx0 = rx - ri * PROJ_STEP,
    ly0 = ry - rj * PROJ_STEP
  const lcols = Math.ceil((bounds.maxX + margin - lx0) / PROJ_STEP) + 1,
    lrows = Math.ceil((bounds.maxY + margin - ly0) / PROJ_STEP) + 1
  const lattice = new Float64Array(lcols * lrows * 2)
  for (let j = 0; j < lrows; j++)
    for (let i = 0; i < lcols; i++)
      lattice.set(
        latLonToGaussBoaga(...fromLocal(lx0 + i * PROJ_STEP, ly0 + j * PROJ_STEP)),
        2 * (j * lcols + i),
      )
  const { e0, n0, cell: dc, cols: dcols, rows: drows, z, sources } = dtm
  const at = (x: number, y: number) => {
    const fx = (x - rx) / PROJ_STEP,
      fy = (y - ry) / PROJ_STEP
    const e = bilinear(lattice, lcols, lrows, fx, fy, 0, ri, rj),
      n = bilinear(lattice, lcols, lrows, fx, fy, 1, ri, rj)
    return dtmHeight(z, dcols, drows, (e - e0) / dc, (n - n0) / dc)
  }
  const source = (x: number, y: number) => {
    const fx = (x - rx) / PROJ_STEP,
      fy = (y - ry) / PROJ_STEP
    const e = bilinear(lattice, lcols, lrows, fx, fy, 0, ri, rj),
      n = bilinear(lattice, lcols, lrows, fx, fy, 1, ri, rj)
    const c = Math.min(dcols - 1, Math.max(0, Math.round((e - e0) / dc))),
      r = Math.min(drows - 1, Math.max(0, Math.round((n - n0) / dc)))
    return sources.names[sources.codes[r * dcols + c]!]!
  }
  const grid = (span: Span): Grid => {
    const g = gridLattice(ground),
      side = 2 * BOX + 1
    const { i0, j0, cols: w, rows: h } = span
    // Each sample column (a node's column, then its box's dx): its lattice column and weights.
    const m = w * side,
      li = new Int32Array(m),
      tx = new Float64Array(m),
      ux = new Float64Array(m)
    for (let c = 0; c < w; c++)
      for (let dx = -BOX; dx <= BOX; dx++) {
        const q = c * side + dx + BOX,
          fx = (g.x0 + (i0 + c) * g.cell + dx - rx) / PROJ_STEP
        const i = cellOf(fx, ri, lcols),
          t = fractionOf(fx, ri, i)
        li[q] = i
        tx[q] = t
        ux[q] = 1 - t
      }
    // A sample column's easting and northing along the lattice rows below (a) and above (b) it:
    // the first halves of `bilinear`'s sum, the same for every sample of the column in that row.
    const ea = new Float64Array(m),
      eb = new Float64Array(m),
      na = new Float64Array(m),
      nb = new Float64Array(m)
    let row = -1
    const sums = new Float64Array(w),
      out = new Float64Array(w * h)
    for (let j = j0; j < j0 + h; j++) {
      sums.fill(0)
      for (let dy = -BOX; dy <= BOX; dy++) {
        const fy = (g.y0 + j * g.cell + dy - ry) / PROJ_STEP
        const lj = cellOf(fy, rj, lrows)
        const ty = fractionOf(fy, rj, lj),
          uy = 1 - ty
        if (lj !== row) {
          row = lj
          for (let q = 0; q < m; q++) {
            const s = 2 * (lj * lcols + li[q]!),
              t = s + 2 * lcols
            ea[q] = lattice[s]! * ux[q]! + lattice[s + 2]! * tx[q]!
            eb[q] = lattice[t]! * ux[q]! + lattice[t + 2]! * tx[q]!
            na[q] = lattice[s + 1]! * ux[q]! + lattice[s + 3]! * tx[q]!
            nb[q] = lattice[t + 1]! * ux[q]! + lattice[t + 3]! * tx[q]!
          }
        }
        // Each node's box summed as makeGrid sums it: dy by dy, dx by dx within.
        for (let c = 0, q = 0; c < w; c++) {
          let sum = sums[c]!
          for (let k = 0; k < side; k++, q++) {
            const e = ea[q]! * uy + eb[q]! * ty,
              n = na[q]! * uy + nb[q]! * ty
            sum += dtmHeight(z, dcols, drows, (e - e0) / dc, (n - n0) / dc)
          }
          sums[c] = sum
        }
      }
      for (let c = 0; c < w; c++) out[(j - j0) * w + c] = sums[c]! / side ** 2
    }
    return { ...g, z: out, span }
  }
  return { at, grid, source }
}

/** The step, m, at which `sourceAreas` samples the play area: a 0.01 ha cell keeps a part under a million samples. */
const AREA_STEP = 10

/**
 * Each terrain source's share of the play area, km²: the source (`Dem.source`) at the centre of
 * each AREA_STEP m cell over `bounds` that `inPlay` holds, as the build's summary prints it.
 */
export const sourceAreas = (
  source: (x: number, y: number) => string,
  bounds: Ground["bounds"],
  inPlay: (x: number, y: number) => boolean,
): Record<string, number> => {
  const cells = new Map<string, number>()
  for (let y = bounds.minY + AREA_STEP / 2; y < bounds.maxY; y += AREA_STEP)
    for (let x = bounds.minX + AREA_STEP / 2; x < bounds.maxX; x += AREA_STEP)
      if (inPlay(x, y)) {
        const name = source(x, y)
        cells.set(name, (cells.get(name) ?? 0) + 1)
      }
  return Object.fromEntries([...cells].map(([name, n]) => [name, (n * AREA_STEP ** 2) / 1e6]))
}

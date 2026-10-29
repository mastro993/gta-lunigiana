// The raster `coverage.ts` measures on: square cells in local metres over a part's rectangles, a
// cell inside a polygon when its centre is (`fillPolygon`), and the per-comune tally, markdown
// table and picture of what each source maps there.

import { fillPolygon } from "./geometry.ts"
import { type Rect, inRects, rectsBox } from "./region.ts"

/** Cells of `res` m in local metres: cell (col, row) is centred on (x0 + (col + 0.5) res, y0 + (row + 0.5) res), row 0 south. */
interface Grid {
  readonly x0: number
  readonly y0: number
  readonly res: number
  readonly cols: number
  readonly rows: number
}

/** A polygon as flat local rings [x0, y0, x1, y1…], outer and holes alike (filled even-odd). */
export type Polygon = ReadonlyArray<ReadonlyArray<number>>

/** Polygons that paint `value` into the cells they hold. */
interface Layer {
  readonly value: number
  readonly polygons: ReadonlyArray<Polygon>
}

/** The grid of `res` m cells over the box round the rectangles. */
export const gridOver = (rects: ReadonlyArray<Rect>, res: number): Grid => {
  const [x0, y0, x1, y1] = rectsBox(rects)
  return { x0, y0, res, cols: Math.ceil((x1 - x0) / res), rows: Math.ceil((y1 - y0) / res) }
}

/** 1 in each cell whose centre lies in one of the rectangles (the play area), else 0. */
export const playMask = (grid: Grid, rects: ReadonlyArray<Rect>): Uint16Array => {
  const { x0, y0, res, cols, rows } = grid
  const out = new Uint16Array(cols * rows)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      if (inRects(rects, x0 + (col + 0.5) * res, y0 + (row + 0.5) * res)) out[row * cols + col] = 1
  return out
}

/**
 * Each cell's value from the first layer with a polygon holding it, 0 where none does: the rule
 * of `fetch-rt`'s mosaic, where a cell keeps the first tile's value. Each polygon fills on its own,
 * so two that overlap add up instead of cancelling.
 */
export const paint = (grid: Grid, layers: ReadonlyArray<Layer>): Uint16Array => {
  const { x0, y0, res, cols, rows } = grid
  const out = new Uint16Array(cols * rows)
  for (const { value, polygons } of layers)
    for (const rings of polygons)
      fillPolygon(rings, x0, y0, res, cols, rows, (k) => {
        if (out[k] === 0) out[k] = value
      })
  return out
}

/** 1 in each cell one of the polygons holds, else 0. */
export const mask = (grid: Grid, polygons: ReadonlyArray<Polygon>): Uint16Array =>
  paint(grid, [{ value: 1, polygons }])

/** What each cell holds, one value per grid cell, for the tally and the picture. */
export interface Layers {
  /** 1 inside the play area. */
  readonly play: Uint16Array
  /** The comune holding the cell, 1-based into the comune names; 0 = none. */
  readonly comune: Uint16Array
  /** 1 where a 2019 CTR sheet maps the cell (its AZR area). */
  readonly ctr: Uint16Array
  /** The LiDAR lot that writes the cell, 1-based into the lots; 0 = no LiDAR. */
  readonly lot: Uint16Array
  /** 1 in the UCS 2019 woods. */
  readonly ucs: Uint16Array
  /** 1 in OSM forest. */
  readonly osm: Uint16Array
}

/** One comune's play-area cells, and how many of them each source maps. */
interface Tally {
  readonly name: string
  cells: number
  ctr: number
  /** Cells per LiDAR lot, in the lots' order. */
  readonly lots: Array<number>
  /** Cells no LiDAR tile holds. */
  none: number
  ucs: number
  osm: number
  /** UCS woods that OSM marks as forest too. */
  both: number
}

const NO_COMUNE = "(no comune)"

/**
 * The play area's cells counted per comune (`names[i]` is comune value i + 1), largest first; the
 * cells outside every comune make a last row of their own, when there are any.
 */
export const tally = (layers: Layers, names: ReadonlyArray<string>, lots: number): Array<Tally> => {
  const rows: Array<Tally> = [NO_COMUNE, ...names].map((name) => ({
    name,
    cells: 0,
    ctr: 0,
    lots: Array.from({ length: lots }, () => 0),
    none: 0,
    ucs: 0,
    osm: 0,
    both: 0,
  }))
  const { play, comune, ctr, lot, ucs, osm } = layers
  for (let k = 0; k < play.length; k++) {
    if (play[k] === 0) continue
    const row = rows[comune[k]!]!
    row.cells++
    row.ctr += ctr[k]!
    if (lot[k] === 0) row.none++
    else row.lots[lot[k]! - 1]!++
    row.ucs += ucs[k]!
    row.osm += osm[k]!
    row.both += ucs[k]! & osm[k]!
  }
  const [outside, ...comuni] = rows
  return [
    ...comuni.filter((r) => r.cells > 0).toSorted((a, b) => b.cells - a.cells),
    outside!,
  ].filter((r) => r.cells > 0)
}

/**
 * The markdown table of the tallies, plus a total row: the play area in km², the CTR 2019, each
 * LiDAR lot and no LiDAR as km² (share of the comune's play area), the UCS woods and OSM forest
 * in km², and the share of the UCS woods OSM also marks as forest. `cellArea` is in m².
 */
export const coverageTable = (
  rows: ReadonlyArray<Tally>,
  lots: ReadonlyArray<string>,
  cellArea: number,
): string => {
  const km = (cells: number) => ((cells * cellArea) / 1e6).toFixed(2)
  const pct = (n: number, of: number) => (of === 0 ? "–" : `${((100 * n) / of).toFixed(1)}%`)
  const share = (n: number, of: number) => `${km(n)} (${pct(n, of)})`
  const sum = (pick: (r: Tally) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const total: Tally = {
    name: "**Total**",
    cells: sum((r) => r.cells),
    ctr: sum((r) => r.ctr),
    lots: lots.map((_, i) => sum((r) => r.lots[i]!)),
    none: sum((r) => r.none),
    ucs: sum((r) => r.ucs),
    osm: sum((r) => r.osm),
    both: sum((r) => r.both),
  }
  const head = [
    "Comune",
    "Play area, km²",
    "CTR 2019",
    ...lots.map((l) => `LiDAR ${l}`),
    "no LiDAR",
    "UCS woods, km²",
    "OSM forest, km²",
    "UCS woods OSM marks as forest",
  ]
  const line = (cells: ReadonlyArray<string>) => `| ${cells.join(" | ")} |`
  return [
    line(head),
    line(head.map((_, i) => (i === 0 ? "---" : "--:"))),
    ...[...rows, total].map((r) =>
      line([
        r.name,
        km(r.cells),
        share(r.ctr, r.cells),
        ...r.lots.map((n) => share(n, r.cells)),
        share(r.none, r.cells),
        km(r.ucs),
        km(r.osm),
        pct(r.both, r.ucs),
      ]),
    ),
  ].join("\n")
}

type Rgb = readonly [number, number, number]

/** The colours of the LiDAR lots the parts use most; any other lot is OTHER_LOT. */
const LOT_COLOURS: Readonly<Record<string, Rgb>> = { "004": [70, 160, 70], "005": [70, 110, 210] }
const OTHER_LOT: Rgb = [235, 150, 40]
const NO_LIDAR: Rgb = [215, 45, 45]
const OUTSIDE: Rgb = [150, 150, 150]
const BOUNDARY: Rgb = [25, 25, 25]
/** How far the CTR's mapped area lightens a cell towards white. */
const CTR_LIGHTEN = 0.55

/** The picture's legend, one line per colour. */
export const LEGEND = [
  "green: LiDAR 004, blue: LiDAR 005, orange: other lots, red: no LiDAR",
  `lighter (${Math.round(CTR_LIGHTEN * 100)}% towards white): mapped by a 2019 CTR sheet`,
  "dark lines: comune boundaries, grey: outside the play area",
].join("\n")

/** One RGB pixel per cell, north row first (for `encodePngRgb`), coloured as LEGEND says. */
export const coverageImage = (
  grid: Grid,
  layers: Layers,
  lots: ReadonlyArray<string>,
): Uint8Array => {
  const { cols, rows } = grid
  const { play, comune, ctr, lot } = layers
  const rgb = new Uint8Array(cols * rows * 3)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const k = row * cols + col
      const edge =
        (col + 1 < cols && comune[k] !== comune[k + 1]) ||
        (row + 1 < rows && comune[k] !== comune[k + cols])
      let c: Rgb
      if (edge) c = BOUNDARY
      else if (play[k] === 0) c = OUTSIDE
      else if (lot[k] === 0) c = NO_LIDAR
      else c = LOT_COLOURS[lots[lot[k]! - 1]!] ?? OTHER_LOT
      const lift = !edge && play[k] === 1 && ctr[k] === 1 ? CTR_LIGHTEN : 0
      rgb.set(
        c.map((v) => Math.round(v + (255 - v) * lift)),
        ((rows - 1 - row) * cols + col) * 3,
      )
    }
  return rgb
}

// The terrain of a map built from Lunigiana's inputs since issue #17: one file a 2 km map tile,
// data/raw/rt/dtm/<i>_<j>.bin, which `fetch-rt <part>` writes (`fetch-dtm.ts`) and the build reads
// (`loadDtm` in dtm.ts), so a part adds the tiles it brings and fills in the cells a grown box adds
// to those it shares, and never rewrites a cell another part's fetch wrote.
// - Every file lies on one lattice of 2 m cells in EPSG:3003 (`LATTICE`): lucido's mosaic's of
//   raw-20261101, its first cell centred on (1587397, 4884308), so its cells are that mosaic's to
//   the bit. A cell is the mean of four 1 m cells of the LiDAR or of the chain that fills it.
// - A tile's file spans the lattice cells whose centres lie in the EPSG:3003 box round the tile's
//   square widened by HALO (`tileGrid`): the projection turns the frames by about 0.8°, and the
//   grid's box filter and its bilinear reach 2 m past a node. A cell holds a height where a fetch
//   computed it (the region's box and HALO round it) and none (NONE) elsewhere.
// - The file: deflate of a JSON line (the first cell, the size, the sources' names), then the
//   heights, int16 decimetres, row 0 south, each row delta-coded from its first, then a byte a cell,
//   its source's index in the names, or NONE. A cell without a height repeats the one before it in
//   its row (0 at a row's start), so the deflate packs it into next to nothing.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

import { TILE } from "../sim/map/kinds.ts"
import type { Crop } from "./dtm-mosaic.ts"
import type { DtmData } from "./dtm.ts"
import { NONE } from "./fill-chain.ts"
import { gaussBoagaBox } from "./geometry.ts"
import { type Rect, tilesOf } from "./region.ts"

/** The centre of the lattice's cell (0, 0) in EPSG:3003: lucido's mosaic's first cell. */
export const LATTICE = { e: 1587397, n: 4884308 } as const
/** The lattice's cell, m. */
export const CELL = 2
/** How far past its tile's square a tile's file reaches, m, in EPSG:3003. */
export const HALO = 32

/** A block of lattice cells: its first cell's centre in EPSG:3003 and its size, row 0 south. */
export interface Cells {
  readonly e0: number
  readonly n0: number
  readonly cols: number
  readonly rows: number
}

/** A tile's file read: its cells, the sources' names, the heights (dm) and each cell's source, NONE where it holds none. */
export interface DtmTile extends Cells {
  readonly names: ReadonlyArray<string>
  readonly dm: Int16Array
  readonly codes: Uint8Array
}

/**
 * The lattice cells whose centres lie in the EPSG:3003 box [e0, n0, e1, n1]. A mosaic `cropOf` cut
 * on the lattice holds them all: its first cell's centre is the first past the box's edge.
 */
export const cellsOver = ([e0, n0, e1, n1]: readonly [number, number, number, number]): Cells => {
  const a0 = Math.ceil((e0 - LATTICE.e) / CELL),
    a1 = Math.floor((e1 - LATTICE.e) / CELL),
    b0 = Math.ceil((n0 - LATTICE.n) / CELL),
    b1 = Math.floor((n1 - LATTICE.n) / CELL)
  return {
    e0: LATTICE.e + CELL * a0,
    n0: LATTICE.n + CELL * b0,
    cols: a1 - a0 + 1,
    rows: b1 - b0 + 1,
  }
}

/** Tile (i, j)'s square in local metres. */
export const tileRect = (i: number, j: number): Rect => [
  i * TILE,
  j * TILE,
  (i + 1) * TILE,
  (j + 1) * TILE,
]

/** The cells of tile (i, j)'s file: the EPSG:3003 box round its square, widened by HALO. */
export const tileGrid = (i: number, j: number): Cells =>
  cellsOver(gaussBoagaBox([tileRect(i, j)], HALO))

/** A map's built terrain in local metres: its region's `bounds`. */
interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** Tile (i, j)'s square cut to `bounds`, undefined when it lies wholly past them. */
export const tileCut = (i: number, j: number, bounds: Bounds): Rect | undefined => {
  const [x0, y0, x1, y1] = tileRect(i, j)
  const cut: Rect = [
    Math.max(x0, bounds.minX),
    Math.max(y0, bounds.minY),
    Math.min(x1, bounds.maxX),
    Math.min(y1, bounds.maxY),
  ]
  return cut[0] >= cut[2] || cut[1] >= cut[3] ? undefined : cut
}

/** The cells tile (i, j) must hold for a map whose terrain spans `bounds`: its square cut to them, widened by HALO, within its file. */
export const tileNeed = (i: number, j: number, bounds: Bounds): Cells | undefined => {
  const cut = tileCut(i, j, bounds)
  return cut === undefined
    ? undefined
    : intersect(cellsOver(gaussBoagaBox([cut], HALO)), tileGrid(i, j))
}

/**
 * The tiles a part's terrain fetch writes for a map whose terrain spans `bounds`: those its
 * rectangles meet (`tilesOf`), south to north, then west to east, each with the cells it must hold.
 */
export const partTiles = (
  rects: ReadonlyArray<Rect>,
  bounds: Bounds,
): Array<{ readonly i: number; readonly j: number; readonly need: Cells }> =>
  tilesOf(rects).flatMap(({ i, j }) => {
    const need = tileNeed(i, j, bounds)
    return need === undefined ? [] : [{ i, j, need }]
  })

/** The box of lattice cells round `blocks`. */
export const blockOf = (blocks: ReadonlyArray<Cells>): Cells => {
  const e0 = Math.min(...blocks.map((b) => b.e0)),
    n0 = Math.min(...blocks.map((b) => b.n0))
  return {
    e0,
    n0,
    cols: (Math.max(...blocks.map((b) => b.e0 + CELL * b.cols)) - e0) / CELL,
    rows: (Math.max(...blocks.map((b) => b.n0 + CELL * b.rows)) - n0) / CELL,
  }
}

/**
 * The 1 m crop over a block of lattice cells, on the LiDAR's cell centres (x.5): the block's cell
 * (c, r) is the mean of the crop's (2c, 2r) to (2c + 1, 2r + 1), its centre 0.5 m past theirs.
 */
export const cropOver = (block: Cells): Crop => ({
  e0: block.e0 - 0.5,
  n0: block.n0 - 0.5,
  cols: 2 * block.cols,
  rows: 2 * block.rows,
})

/** The cells two blocks share, undefined when none. */
export const intersect = (a: Cells, b: Cells): Cells | undefined => {
  const e0 = Math.max(a.e0, b.e0),
    n0 = Math.max(a.n0, b.n0),
    e1 = Math.min(a.e0 + CELL * (a.cols - 1), b.e0 + CELL * (b.cols - 1)),
    n1 = Math.min(a.n0 + CELL * (a.rows - 1), b.n0 + CELL * (b.rows - 1))
  if (e0 > e1 || n0 > n1) return undefined
  return { e0, n0, cols: (e1 - e0) / CELL + 1, rows: (n1 - n0) / CELL + 1 }
}

/** The file of tile (i, j) in `dir`. */
export const tilePath = (dir: string, i: number, j: number): string => join(dir, `${i}_${j}.bin`)

/** A tile's file's bytes before the deflate. */
export const encodeTile = (t: DtmTile): Buffer => {
  const header = {
    crs: "EPSG:3003",
    e0: t.e0,
    n0: t.n0,
    cols: t.cols,
    rows: t.rows,
    cell: CELL,
    unit: "dm",
    sources: t.names,
    encoding:
      "after this line: int16le heights, row 0 south, each row delta-coded from its first, a cell without one repeating the height before it; then a uint8 a cell, its index in sources, 255 where it holds none",
  }
  const deltas = new Int16Array(t.cols * t.rows)
  for (let r = 0; r < t.rows; r++)
    for (let c = 0, prev = 0; c < t.cols; c++) {
      const k = r * t.cols + c,
        v = t.codes[k] === NONE ? prev : t.dm[k]!
      deltas[k] = c === 0 ? v : v - prev
      prev = v
    }
  return Buffer.concat([
    Buffer.from(`${JSON.stringify(header)}\n`),
    Buffer.from(deltas.buffer),
    Buffer.from(t.codes),
  ])
}

/** A tile's file's bytes, inflated, read back (`encodeTile`); `name` names it in an error. */
export const decodeTile = (bytes: Buffer, name: string): DtmTile => {
  const eol = bytes.indexOf(10)
  const h = JSON.parse(bytes.subarray(0, eol).toString("utf8")) as {
    readonly e0: number
    readonly n0: number
    readonly cols: number
    readonly rows: number
    readonly cell: number
    readonly sources: ReadonlyArray<string>
  }
  const n = h.cols * h.rows
  if (h.cell !== CELL || bytes.length !== eol + 1 + 3 * n)
    throw new Error(`${name}: ${bytes.length - eol - 1} bytes for ${n} cells of ${h.cell} m`)
  const dm = new Int16Array(n)
  for (let r = 0; r < h.rows; r++)
    for (let c = 0, acc = 0; c < h.cols; c++) {
      const k = r * h.cols + c
      acc = ((acc + bytes.readInt16LE(eol + 1 + 2 * k)) << 16) >> 16
      dm[k] = acc
    }
  const codes = new Uint8Array(bytes.subarray(eol + 1 + 2 * n))
  return { e0: h.e0, n0: h.n0, cols: h.cols, rows: h.rows, names: h.sources, dm, codes }
}

/** Tile (i, j)'s file in `dir`, undefined when there is none. */
export const readTile = (dir: string, i: number, j: number): DtmTile | undefined => {
  const path = tilePath(dir, i, j)
  return existsSync(path) ? decodeTile(inflateSync(readFileSync(path)), path) : undefined
}

/** The tile of every file in `dir` (`<i>_<j>.bin`), in the order of their names; none when `dir` does not exist. */
export const tileKeys = (dir: string): Array<{ readonly i: number; readonly j: number }> =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^-?\d+_-?\d+\.bin$/.test(f))
        .sort()
        .map((f) => {
          const [i, j] = f.slice(0, -4).split("_").map(Number)
          return { i: i!, j: j! }
        })
    : []

/** An empty tile (i, j): its file's cells, none holding a height. */
export const emptyTile = (i: number, j: number, names: ReadonlyArray<string>): DtmTile => {
  const g = tileGrid(i, j)
  return {
    ...g,
    names,
    dm: new Int16Array(g.cols * g.rows),
    codes: new Uint8Array(g.cols * g.rows).fill(NONE),
  }
}

/**
 * The tiles' cells as one DTM over the box round them (`DtmData`, heights in decimetres), a cell
 * some tile holds with its source and any other with NONE: two tiles holding one cell hold the same
 * height and source (a fetch keeps what is held), else it throws. Each tile is read (`read`, which
 * must give its `cells`) only when its cells are copied, so one tile at a time is held: all of
 * Lunigiana's 190 at once took 640 MB beside the DTM. Sources are named in the order first met,
 * NONE of them at most. A cell no tile holds is 0 until `drawEdgesOn` draws the edge on over it.
 */
export const assembleTiles = (
  tiles: ReadonlyArray<{
    readonly key: string
    readonly cells: Cells
    readonly read: () => DtmTile
  }>,
): DtmData => {
  if (tiles.length === 0) throw new Error("no terrain tiles")
  const { e0, n0, cols, rows } = blockOf(tiles.map((t) => t.cells))
  const dm = new Int16Array(cols * rows),
    codes = new Uint8Array(cols * rows).fill(NONE),
    names: Array<string> = []
  for (const { key, cells, read } of tiles) {
    const tile = read()
    if (
      tile.e0 !== cells.e0 ||
      tile.n0 !== cells.n0 ||
      tile.cols !== cells.cols ||
      tile.rows !== cells.rows
    )
      throw new Error(`tile ${key} spans other cells than its file should`)
    const code = tile.names.map((name) => {
      if (!names.includes(name)) names.push(name)
      return names.indexOf(name)
    })
    if (names.length > NONE) throw new Error(`tile ${key} brings the terrain's source ${NONE + 1}`)
    const dc = (tile.e0 - e0) / CELL,
      dr = (tile.n0 - n0) / CELL
    for (let r = 0; r < tile.rows; r++)
      for (let c = 0; c < tile.cols; c++) {
        const k = r * tile.cols + c
        if (tile.codes[k] === NONE) continue
        const q = (dr + r) * cols + dc + c,
          h = tile.dm[k]!,
          s = code[tile.codes[k]!]!
        if (codes[q] !== NONE && (dm[q] !== h || codes[q] !== s))
          throw new Error(
            `tile ${key} holds ${(h / 10).toFixed(1)} m (${names[s]}) at EPSG:3003 ${e0 + CELL * (dc + c)}, ${n0 + CELL * (dr + r)}, where another holds ${(dm[q]! / 10).toFixed(1)} m (${names[codes[q]!]})`,
          )
        dm[q] = h
        codes[q] = s
      }
  }
  return { e0, n0, cols, rows, cell: CELL, dm, sources: { names, codes } }
}

/**
 * Fills `dtm`'s cells no tile holds (their source NONE) with the edge drawn on, as a sampler past a single
 * mosaic's edge held its edge's value: along each row from the nearest cell held in it (the one
 * before, else after), then, in a row holding none, from the nearest row that holds one (below,
 * else above), column by column. Their source stays NONE.
 */
export const drawEdgesOn = (dtm: DtmData): void => {
  const { cols, rows, dm } = dtm,
    { codes } = dtm.sources
  const filled = new Uint8Array(rows)
  for (let r = 0; r < rows; r++) {
    const o = r * cols
    let first = -1
    for (let c = 0; c < cols; c++)
      if (codes[o + c] !== NONE) {
        first = c
        break
      }
    if (first < 0) continue
    filled[r] = 1
    for (let c = 0; c < first; c++) dm[o + c] = dm[o + first]!
    for (let c = first + 1; c < cols; c++) if (codes[o + c] === NONE) dm[o + c] = dm[o + c - 1]!
  }
  for (let r = 0; r < rows; r++) {
    if (filled[r] === 1) continue
    let from = -1
    for (let d = 1; d < rows && from < 0; d++)
      if (r - d >= 0 && filled[r - d] === 1) from = r - d
      else if (r + d < rows && filled[r + d] === 1) from = r + d
    if (from < 0) throw new Error("no terrain tile holds a height")
    dm.copyWithin(r * cols, from * cols, (from + 1) * cols)
  }
}

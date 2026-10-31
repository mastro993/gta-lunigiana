// The terrain grid, built one 2 km tile at a time: on each tile's window of nodes the LiDAR is
// averaged, the beds carved under the water as first settled, the road and rail claims written in
// the build's order, the beds carved again under the water kept below the decks (outside the road
// cores), the terrain under each water sample read for the perched check, the grid rounded to
// 0.1 m and the rail bed levelled. Each of those writes a node from that node alone (its own value,
// position, owner and the vectors), so a window needs no halo, and a node two tiles share comes out
// the same in both: the pass checks it.
import type { Dem } from "./dtm.ts"
import type { WaterF } from "./features.ts"
import { segIndex } from "./geometry.ts"
import { cellTile, gridTiles } from "./grid-tiles.ts"
import { replayClaims, type Claim } from "./profiles.ts"
import { bedLimits, bedReport, railBed } from "./rail-bed.ts"
import { gridLattice, sampleGrid, type Grid, type Profile } from "./terrain.ts"
import { carveAll } from "./water.ts"

/** What the tile pass reads. */
interface GridInput {
  /** The uncarved terrain, whose grid windows the tiles start from. */
  readonly dem: Dem
  readonly water: ReadonlyArray<WaterF>
  /** The water's surfaces as first settled, and as kept under the decks (`capUnderDecks`). */
  readonly wp0: ReadonlyArray<Profile>
  readonly wp: ReadonlyArray<Profile>
  /** The road and rail profiles' claims, in the order they were made. */
  readonly claims: ReadonlyArray<Claim>
  /** The at-grade rail as shipped, and the level crossings' nodes. */
  readonly rail: ReadonlyArray<{
    readonly pts: ReadonlyArray<number>
    readonly z: ReadonlyArray<number>
  }>
  readonly levels: ReadonlyArray<readonly [number, number]>
}

/**
 * The finished grid, the uncarved one (the catchments read it), the carved grid before its rounding
 * under every water sample (`perched[i][k]`, for `dropPerched`), and what the rail bed moved.
 */
export const tileByTile = ({ dem, water, wp0, wp, claims, rail, levels }: GridInput) => {
  const lattice = gridLattice()
  const size = lattice.cols * lattice.rows
  const uncarved: Grid = { ...lattice, z: new Float64Array(size) },
    grid: Grid = { ...lattice, z: new Float64Array(size) }
  const written = new Uint8Array(size)
  // Roads may claim river banks but never the water itself.
  const wet = segIndex<null>()
  for (const w of water) if (w.w >= 4) wet.addLine(w.pts, w.w / 2 + 1, null)
  const limits = bedLimits(lattice, rail, levels)
  const moved = new Map<number, number>()
  // Each water sample is read in the tile whose own cells hold its cell.
  const tileOf = cellTile(lattice)
  const samples = new Map<string, Array<number>>()
  wp.forEach((p, i) => {
    for (let k = 0; k < p.x.length; k++) {
      const key = tileOf(p.x[k]!, p.y[k]!),
        list = samples.get(key)
      if (list === undefined) samples.set(key, [i, k])
      else list.push(i, k)
    }
  })
  const perched = wp.map((p) => new Float64Array(p.x.length))
  for (const tile of gridTiles(lattice)) {
    const { i0, j0, cols, rows } = tile.span
    const win = dem.grid(tile.span)
    for (let r = 0; r < rows; r++)
      uncarved.z.set(win.z.subarray(r * cols, (r + 1) * cols), (j0 + r) * lattice.cols + i0)
    carveAll(win, water, wp0)
    const protect = new Uint8Array(cols * rows),
      owner = new Uint8Array(cols * rows).fill(255)
    for (let k = 0; k < protect.length; k++)
      protect[k] = wet.covers(
        lattice.x0 + (i0 + (k % cols)) * lattice.cell,
        lattice.y0 + (j0 + Math.floor(k / cols)) * lattice.cell,
      )
        ? 1
        : 0
    replayClaims(win, claims, owner, protect)
    carveAll(win, water, wp, (k) => owner[k] !== 255)
    const own = samples.get(tile.key) ?? []
    for (let m = 0; m < own.length; m += 2) {
      const p = wp[own[m]!]!,
        k = own[m + 1]!
      perched[own[m]!]![k] = sampleGrid(win, p.x[k]!, p.y[k]!)
    }
    for (let k = 0; k < win.z.length; k++) win.z[k] = Math.round(win.z[k]! * 10) / 10
    // A road's core (ranks 0, 2, 3) and a wide stream's bed keep their level; the rail's and the
    // extra tracks' cells (1, 4) and open ground may be raised.
    const keep = (k: number) =>
      protect[k] === 1 || owner[k] === 0 || owner[k] === 2 || owner[k] === 3
    for (const [n, dz] of railBed(win, limits, keep)) moved.set(n, dz)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const n = (j0 + r) * lattice.cols + i0 + c,
          z = win.z[r * cols + c]!
        if (written[n] === 1 && !Object.is(grid.z[n], z))
          throw new Error(
            `grid node (${i0 + c}, ${j0 + r}) is ${grid.z[n]} in one tile and ${z} in tile ${tile.key}`,
          )
        grid.z[n] = z
        written[n] = 1
      }
  }
  return { grid, uncarved, perched, bed: bedReport(moved) }
}

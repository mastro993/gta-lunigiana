// The terrain grid, built one listed 2 km tile at a time: on each tile's window of nodes the LiDAR
// is averaged, the lakes and river polygons carved (water-areas.ts) and the beds under the water as
// first settled, the road and rail claims written in the build's order (never on the water), the
// river polygons (their gravel bars raised now) and the beds (outside the road cores) carved again
// under the water kept below the decks, the terrain under each water sample read for the perched
// check, the grid rounded to
// 0.1 m and the rail bed levelled. Each of those writes a node from that node alone (its own value,
// position, owner and the vectors), so a window needs no halo, and a node two tiles share comes out
// the same in both: the pass checks it. A tile of the bounds' box the region leaves off its list (an
// L's notch) is never worked: no terrain is read there. Once every tile is written, the ground under
// the decks is lowered on the whole grid (deck-ground.ts): where a deck stands clear of the ground
// reads the ground along it, across the tiles.
import { deckGround, deckReport, type Slab, slabNodes } from "./deck-ground.ts"
import type { Dem } from "./dtm.ts"
import type { WaterF } from "./features.ts"
import { segIndex, type V } from "./geometry.ts"
import { type Claim, replayClaims } from "./grid-claims.ts"
import { cellTile, extendEdges, gridTiles } from "./grid-tiles.ts"
import { ROAD_RANKS } from "./profiles.ts"
import { type BedLine, bedLimits, bedReport, railBed } from "./rail-bed.ts"
import { gridLattice, sampleGrid, slotOf, type Grid, type Profile } from "./terrain.ts"
import { carveAreas, waterNodes, type CarvedArea } from "./water-areas.ts"
import { carveAll } from "./water.ts"

/** What the tile pass reads. */
interface GridInput {
  /** The uncarved terrain, whose grid windows the tiles start from. */
  readonly dem: Dem
  readonly water: ReadonlyArray<WaterF>
  /** The water's surfaces as first settled, and as kept under the decks (`capUnderDecks`). */
  readonly wp0: ReadonlyArray<Profile>
  readonly wp: ReadonlyArray<Profile>
  /** The lakes and river polygons. */
  readonly areas: ReadonlyArray<CarvedArea>
  /** The road and rail profiles' claims, in the order they were made. */
  readonly claims: ReadonlyArray<Claim>
  /** The road bridges: each centreline, and how far either side of it its deck reaches, m. */
  readonly decks: ReadonlyArray<{ readonly pts: ReadonlyArray<V>; readonly half: number }>
  /** The road and rail bridges' slabs as shipped, which the ground is lowered under. */
  readonly slabs: ReadonlyArray<Slab>
  /** The at-grade rail as shipped (the run-outs' beyond the play area alone), and the level crossings' nodes. */
  readonly rail: ReadonlyArray<BedLine>
  readonly levels: ReadonlyArray<readonly [number, number]>
}

/**
 * The finished grid, the uncarved one (the catchments read it), the nodes the listed tiles hold
 * (`listed`, 1, as `listedNodes` in grid-tiles.ts), the carved grid before its rounding under every
 * water sample (`perched[i][k]`, for `dropPerched`), and what the rail bed and the ground under the
 * decks moved. A node no listed tile holds (an L's notch) is 0 in the uncarved grid, which the
 * catchments leave out, and in the finished grid the listed node the game reads there
 * (`extendEdges`), so the walls' slopes, the buildings' floors and the water on the play area's
 * inner edge read the edge extended, not a cliff down to 0 m.
 */
export const tileByTile = ({
  dem,
  water,
  wp0,
  wp,
  areas,
  claims,
  decks,
  slabs,
  rail,
  levels,
}: GridInput) => {
  const lattice = gridLattice()
  const size = lattice.cols * lattice.rows
  const uncarved: Grid = { ...lattice, z: new Float64Array(size) },
    grid: Grid = { ...lattice, z: new Float64Array(size) }
  const written = new Uint8Array(size)
  // Roads may claim river banks but never the water itself: a wide stream's anywhere, and a narrow
  // one's under a road bridge's deck, between its ends, where no road stands on the ground (at grade
  // it runs in the road's culvert; under the rail the channel dips under the bed, channel.ts). An
  // approach road's core reaches its full width past its end, under the bridge: at Pognana the
  // SP41's filled a 2 m stream's bed under its 12 m bridge to the deck, and the spate stood on it.
  const wet = segIndex<null>(),
    narrow = segIndex<null>(),
    under = segIndex<{ readonly first: boolean; readonly last: boolean }>()
  for (const w of water)
    if (w.w >= 4) wet.addLine(w.pts, w.w / 2 + 1, null)
    else narrow.addLine(w.pts, w.w / 2 + 1, null)
  for (const { pts, half } of decks)
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!,
        b = pts[i + 1]!
      under.add(a.x, a.y, b.x, b.y, half, { first: i === 0, last: i + 2 === pts.length })
    }
  /** Under a deck, not past either of its ends (a segment's t is clamped there). */
  const underDeck = (x: number, y: number) => {
    let hit = false
    under.within(x, y, (s, _, t) => {
      if ((t > 0 || !s.data.first) && (t < 1 || !s.data.last)) hit = true
    })
    return hit
  }
  const isWet = (x: number, y: number) =>
    wet.covers(x, y) || (narrow.covers(x, y) && underDeck(x, y))
  const limits = bedLimits(lattice, rail, levels)
  const moved = new Map<number, number>()
  // The nodes round the decks, and those of them a road's or the rail's core holds behind a deck's
  // ends: an approach keeps its level.
  const round = slabNodes(lattice, slabs),
    cores = new Set<number>()
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
    carveAreas(win, areas, water, wp0, false)
    carveAll(win, water, wp0)
    const protect = waterNodes(win, areas),
      owner = new Uint8Array(cols * rows).fill(255)
    for (let k = 0; k < protect.length; k++)
      if (protect[k] === 0)
        protect[k] = isWet(
          lattice.x0 + (i0 + (k % cols)) * lattice.cell,
          lattice.y0 + (j0 + Math.floor(k / cols)) * lattice.cell,
        )
          ? 1
          : 0
    replayClaims(win, claims, owner, protect)
    carveAreas(win, areas, water, wp, true)
    carveAll(win, water, wp, (k) => owner[k] !== 255)
    const own = samples.get(tile.key) ?? []
    for (let m = 0; m < own.length; m += 2) {
      const p = wp[own[m]!]!,
        k = own[m + 1]!
      perched[own[m]!]![k] = sampleGrid(win, p.x[k]!, p.y[k]!)
    }
    for (let k = 0; k < win.z.length; k++) win.z[k] = Math.round(win.z[k]! * 10) / 10
    // A road's core (ROAD_RANKS) and a wide stream's bed keep their level; the rail's and the extra
    // tracks' cells and open ground may be raised.
    const keep = (k: number) => protect[k] === 1 || ROAD_RANKS.has(owner[k]!)
    for (const [n, dz] of railBed(win, limits, keep)) moved.set(n, dz)
    for (const [n, abeam] of round) {
      const i = n % lattice.cols,
        j = (n - i) / lattice.cols
      if (
        !abeam &&
        i >= i0 &&
        j >= j0 &&
        i < i0 + cols &&
        j < j0 + rows &&
        owner[slotOf(win, i, j)] !== 255
      )
        cores.add(n)
    }
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
    samples.delete(tile.key)
  }
  // The ground under the decks, read as the game draws it: the notch's nodes extend the edge.
  extendEdges(grid, written)
  const lowered = deckGround(grid, slabs, (n) => cores.has(n) || written[n] !== 1)
  if (lowered.length > 0) extendEdges(grid, written)
  // A sample whose cell lies in an unlisted tile (one on the notch's west or south side, where the
  // play area cuts the water, reads the cell east or north of it) reads the finished grid there, as
  // the game does: on the side the notch's nodes weigh nothing, and past it they are the edge's.
  for (const own of samples.values())
    for (let m = 0; m < own.length; m += 2) {
      const p = wp[own[m]!]!,
        k = own[m + 1]!
      perched[own[m]!]![k] = sampleGrid(grid, p.x[k]!, p.y[k]!)
    }
  return {
    grid,
    uncarved,
    listed: written,
    perched,
    bed: bedReport(moved),
    decks: deckReport(lowered),
  }
}

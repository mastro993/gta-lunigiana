// Water areas for the map build: a lake's level, the waterways a river polygon follows, and the
// carving under both, node by node. A node belongs to a water area when one of its four cells does
// (the cell's centre in the polygon, the cells the land cover paints), so the water drawn over the
// area's cells always lies on carved ground.
import type { Area } from "../sim/map/index.ts"
import { isWaterArea } from "../sim/map/kinds.ts"
import type { Dem } from "./dtm.ts"
import type { WaterF } from "./features.ts"
import { fillPolygon, pointInRing, r1, ringBox, segDist2 } from "./geometry.ts"
import { anchorNode, gridLattice, type Grid, type Profile } from "./terrain.ts"

/** A lake's bed deepens by this much a metre from its shore (m/m) … */
const SHELF = 0.1
/** … down to this far under its level, m. */
const DEEPEST = 3
/**
 * Ground inside a water area higher than this over its water's top (a lake's level, the ground a
 * river's surface was sampled on) is a bank the polygon reaches up, m, left as it is: a quarry face
 * a pond's outline climbs, an island.
 */
const BANK = 1
/** A river's gravel bar (`pebble` inside its polygon) stands this far above its water's surface, m. */
const BAR = 0.3
/**
 * A river polygon's bed lies this far under its river's floor, m: half the step the grid is rounded
 * to, so no node of it rounds above the floor the game's water stands on (`Water.floor`).
 */
const HALF_STEP = 0.05
/** The buckets of the waterways' segments a river node's nearest point is looked up in, m. */
const BUCKET = 32

/** A water area as the tile pass carves it. */
export interface CarvedArea {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  /** The box of its outer ring: minX, minY, maxX, maxY. */
  readonly box: readonly [number, number, number, number]
  /** Still water's level, m; a river polygon takes its waterways' surface instead. */
  readonly level?: number
  /** A river polygon's waterways, indices in the water. */
  readonly waters?: ReadonlyArray<number>
  /** The gravel bars inside a river polygon: the `pebble` areas whose box meets its own. */
  readonly bars: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
}

/** Whether (x, y) is inside `rings`, even-odd over them all (a hole's inside is outside). */
export const inRings = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number) => {
  let inside = false
  for (const ring of rings) if (pointInRing(x, y, ring)) inside = !inside
  return inside
}

/** Squared distance from (x, y) to the nearest edge of `rings`. */
const shore2 = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number) => {
  let best = Number.MAX_VALUE
  for (const ring of rings)
    for (let k = 0, n = ring.length; k < n; k += 2) {
      const { d2 } = segDist2(x, y, ring[k]!, ring[k + 1]!, ring[(k + 2) % n]!, ring[(k + 3) % n]!)
      best = Math.min(best, d2)
    }
  return best
}

/** Whether two boxes (minX, minY, maxX, maxY) meet. */
const meet = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]!

/**
 * The cells of `rings` over `g`'s window and the ring of cells round it, filled from the anchor as
 * the land cover is (so a cell comes out the same in every window that holds it), into `cells`
 * (`span.cols + 1` × `span.rows + 1`, from the cell south-west of the window's first node).
 */
const fillCells = (g: Grid, rings: ReadonlyArray<ReadonlyArray<number>>, cells: Uint8Array) => {
  const span = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const [ai, aj] = anchorNode(g)
  fillPolygon(
    rings,
    g.ax,
    g.ay,
    g.cell,
    { c0: span.i0 - 1 - ai, r0: span.j0 - 1 - aj, cols: span.cols + 1, rows: span.rows + 1 },
    (k) => (cells[k] = 1),
  )
}

/** A fresh cell mask for `g`'s window and the ring round it (`fillCells`). */
const cellMask = (g: Grid) => {
  const span = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  return new Uint8Array((span.cols + 1) * (span.rows + 1))
}

/**
 * Calls `set` with the index in `g.z` of each node `g` holds that a cell of `cells` touches, and
 * whether a cell outside `whole` touches it too (the node is on the water's edge; `whole` is all the
 * water there, so the seam between two polygons of one river is no edge).
 */
const eachNode = (
  g: Grid,
  cells: Uint8Array,
  set: (k: number, edge: boolean) => void,
  whole: Uint8Array = cells,
): void => {
  const span = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const cols = span.cols + 1
  for (let r = 0; r < span.rows; r++)
    for (let c = 0; c < span.cols; c++) {
      const k = r * cols + c
      if (cells[k]! + cells[k + 1]! + cells[k + cols]! + cells[k + cols + 1]! > 0)
        set(
          r * span.cols + c,
          whole[k]! + whole[k + 1]! + whole[k + cols]! + whole[k + cols + 1]! < 4,
        )
    }
}

/** Calls `set` with each node of `g` a cell of `rings` touches, and whether it is on their edge (`eachNode`). */
const nodesOf = (
  g: Grid,
  rings: ReadonlyArray<ReadonlyArray<number>>,
  set: (k: number, edge: boolean) => void,
): void => {
  const cells = cellMask(g)
  fillCells(g, rings, cells)
  eachNode(g, cells, set)
}

/** The median of `values` (the lower of the middle two), sorted in place. */
const median = (values: Array<number>) => {
  values.sort((a, b) => a - b)
  return values[(values.length - 1) >> 1]!
}

/**
 * A still water's level, m: the median of the uncarved grid's nodes inside its rings (LiDAR flies
 * over a lake's surface, and reads it flat), or of the DTM at its vertices when no node falls inside,
 * but no higher than the lowest node of its edge, where it would spill: an outline the 4 m grid reads
 * up a slope, a cascade or a quarry face would otherwise hold its water over the ground beside it.
 */
const levelOf = (rings: ReadonlyArray<ReadonlyArray<number>>, dem: Dem) => {
  const lattice = gridLattice(),
    [x0, y0, x1, y1] = ringBox(rings[0]!)
  // The nodes round the rings' box, and a node more: every node a cell of the rings touches.
  const i0 = Math.max(0, Math.floor((x0 - lattice.x0) / lattice.cell) - 1),
    i1 = Math.min(lattice.cols - 1, Math.ceil((x1 - lattice.x0) / lattice.cell) + 1),
    j0 = Math.max(0, Math.floor((y0 - lattice.y0) / lattice.cell) - 1),
    j1 = Math.min(lattice.rows - 1, Math.ceil((y1 - lattice.y0) / lattice.cell) + 1)
  const win = dem.grid({ i0, j0, cols: i1 - i0 + 1, rows: j1 - j0 + 1 })
  const inside: Array<number> = []
  let spill = Number.MAX_VALUE
  nodesOf(win, rings, (k, edge) => {
    const x = lattice.x0 + (i0 + (k % (i1 - i0 + 1))) * lattice.cell,
      y = lattice.y0 + (j0 + Math.floor(k / (i1 - i0 + 1))) * lattice.cell
    if (inRings(rings, x, y)) inside.push(win.z[k]!)
    if (edge) spill = Math.min(spill, win.z[k]!)
  })
  if (inside.length === 0) {
    const outer = rings[0]!
    for (let k = 0; k < outer.length; k += 2) inside.push(dem.at(outer[k]!, outer[k + 1]!))
  }
  return r1(Math.min(median(inside), spill))
}

/**
 * The water areas of `areas` with what the game reads of them (a lake's `level`, a river
 * polygon's `waters`: the pieces of `water` with a sample of `wp` inside it, or its `level` when it
 * has none, the map having cut its river away), in their order, and each as the tile pass carves it.
 */
export const waterAreas = (
  areas: ReadonlyArray<Area>,
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  dem: Dem,
): { readonly areas: Array<Area>; readonly carved: Array<CarvedArea> } => {
  const pebbles = areas
    .filter((a) => a.kind === "pebble")
    .map((a) => ({ rings: a.rings, box: ringBox(a.rings[0]!) }))
  const carved: Array<CarvedArea> = []
  const out = areas.map((a): Area => {
    if (!isWaterArea(a.kind)) return a
    const box = ringBox(a.rings[0]!)
    const waters =
      a.kind === "river"
        ? water.flatMap((_, i) => {
            const p = wp[i]!
            for (let k = 0; k < p.x.length; k++) if (inRings(a.rings, p.x[k]!, p.y[k]!)) return [i]
            return []
          })
        : []
    if (waters.length > 0) {
      const bars = pebbles.filter((b) => meet(b.box, box)).map((b) => b.rings)
      carved.push({ rings: a.rings, box, waters, bars })
      return { ...a, waters }
    }
    const level = a.level ?? levelOf(a.rings, dem)
    carved.push({ rings: a.rings, box, level, bars: [] })
    return { ...a, level }
  })
  return { areas: out, carved }
}

/** The nearest point on a river polygon's waterways: its surface there (m) and that water's depth. */
type Nearest = (x: number, y: number) => { readonly surface: number; readonly depth: number }

/** Nearest-point lookups on the profiles `wp` of each carved river polygon's waterways. */
const nearestOn = (
  areas: ReadonlyArray<CarvedArea>,
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
): Map<CarvedArea, Nearest> => {
  const out = new Map<CarvedArea, Nearest>()
  for (const area of areas) {
    if (area.waters === undefined) continue
    // Each sample segment of the area's waterways, bucketed; a lookup searches rings of buckets
    // out from its own until the next ring lies farther than the best found.
    const segs: Array<readonly [number, number]> = [],
      buckets = new Map<number, Array<number>>()
    const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
    for (const w of area.waters) {
      const p = wp[w]!
      for (let k = 0; k + 1 < p.x.length; k++) {
        const n = segs.length
        segs.push([w, k])
        for (
          let i = Math.floor(Math.min(p.x[k]!, p.x[k + 1]!) / BUCKET);
          i <= Math.floor(Math.max(p.x[k]!, p.x[k + 1]!) / BUCKET);
          i++
        )
          for (
            let j = Math.floor(Math.min(p.y[k]!, p.y[k + 1]!) / BUCKET);
            j <= Math.floor(Math.max(p.y[k]!, p.y[k + 1]!) / BUCKET);
            j++
          ) {
            const list = buckets.get(key(i, j))
            if (list === undefined) buckets.set(key(i, j), [n])
            else list.push(n)
          }
      }
    }
    out.set(area, (x, y) => {
      const bi = Math.floor(x / BUCKET),
        bj = Math.floor(y / BUCKET)
      let best = Number.MAX_VALUE,
        hit = -1,
        at = 0
      for (let ring = 0; ring < 4096; ring++) {
        for (let i = bi - ring; i <= bi + ring; i++) {
          // The ring's own buckets: its first and last columns whole, the top and bottom of the rest.
          const side = i === bi - ring || i === bi + ring
          for (let j = bj - ring; j <= bj + ring; j += side || ring === 0 ? 1 : 2 * ring)
            for (const n of buckets.get(key(i, j)) ?? []) {
              const [w, k] = segs[n]!,
                p = wp[w]!
              const { d2, t } = segDist2(x, y, p.x[k]!, p.y[k]!, p.x[k + 1]!, p.y[k + 1]!)
              // The nearest, the first in the waters' order and along them on a tie: one answer
              // whatever order the buckets are searched in.
              if (d2 < best || (d2 === best && n < hit)) [best, hit, at] = [d2, n, t]
            }
        }
        // What the rings past this one hold lies at least `ring` buckets away.
        const searched = ring * BUCKET
        if (hit >= 0 && searched * searched >= best) break
      }
      const [w, k] = segs[hit]!,
        p = wp[w]!
      return { surface: p.z[k]! + (p.z[k + 1]! - p.z[k]!) * at, depth: water[w]!.depth }
    })
  }
  return out
}

/**
 * Carves the water areas into the window `g`: a lake's nodes to its level less SHELF a metre from
 * its shore (DEEPEST at most), and its edge raised to the level (by a rounding at most: the level is
 * no higher than its spill), so the shore holds the water drawn over its cells; a river polygon's
 * inner nodes to its waterways' floor at the nearest point (depth/2 under their surface, where the
 * river line itself is carved, and HALF_STEP more), its edge left, so its bank starts on its
 * outline, and with `raiseBars` its bars raised to BAR over that surface (the pass under the water
 * kept below the decks: a bar never stands over a capped surface). Ground BANK over the water's top
 * is left. Run this before the lines are carved, which then cut their channels through a lake's
 * edge and a river's bars.
 */
export const carveAreas = (
  g: Grid,
  areas: ReadonlyArray<CarvedArea>,
  water: ReadonlyArray<WaterF>,
  wp: ReadonlyArray<Profile>,
  raiseBars: boolean,
): void => {
  const span = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const reach: readonly [number, number, number, number] = [
    g.x0 + (span.i0 - 1) * g.cell,
    g.y0 + (span.j0 - 1) * g.cell,
    g.x0 + (span.i0 + span.cols) * g.cell,
    g.y0 + (span.j0 + span.rows) * g.cell,
  ]
  const near = nearestOn(
    areas.filter((a) => meet(a.box, reach)),
    water,
    wp,
  )
  const node = (k: number): readonly [number, number] => [
    g.x0 + (span.i0 + (k % span.cols)) * g.cell,
    g.y0 + (span.j0 + Math.floor(k / span.cols)) * g.cell,
  ]
  // All the water the window holds: a node is on the edge only where it meets dry ground.
  const here = areas.filter((a) => meet(a.box, reach)),
    whole = cellMask(g)
  for (const area of here) fillCells(g, area.rings, whole)
  for (const area of here) {
    const nearest = near.get(area)
    const bar = new Uint8Array(nearest === undefined ? 0 : g.z.length)
    if (nearest !== undefined) for (const rings of area.bars) nodesOf(g, rings, (k) => (bar[k] = 1))
    const own = cellMask(g)
    fillCells(g, area.rings, own)
    eachNode(
      g,
      own,
      (k, edge) => {
        const [x, y] = node(k),
          z = g.z[k]!
        if (nearest === undefined) {
          const level = area.level!
          if (edge) g.z[k] = Math.max(z, level)
          else if (z <= level + BANK) {
            const d = inRings(area.rings, x, y) ? Math.sqrt(shore2(area.rings, x, y)) : 0
            g.z[k] = Math.min(z, level - Math.min(DEEPEST, SHELF * d))
          }
          return
        }
        if (edge && bar[k] === 0) return
        const { surface, depth } = nearest(x, y)
        if (bar[k] === 1) {
          if (raiseBars) g.z[k] = Math.max(z, surface + BAR)
        } else if (z <= surface + depth / 2 + BANK)
          g.z[k] = Math.min(z, surface - depth / 2 - HALF_STEP)
      },
      whole,
    )
  }
}

/** Whether (x, y) lies in one of `areas` (rings and box). */
const inAny =
  (
    areas: ReadonlyArray<{ readonly rings: CarvedArea["rings"]; readonly box: CarvedArea["box"] }>,
  ) =>
  (x: number, y: number): boolean =>
    areas.some(
      (a) =>
        x >= a.box[0] && x <= a.box[2] && y >= a.box[1] && y <= a.box[3] && inRings(a.rings, x, y),
    )

/** Whether (x, y) lies in a lake (or another still water area) of `areas`: the water there is the lake's. */
export const inStill = (areas: ReadonlyArray<CarvedArea>) =>
  inAny(areas.filter((a) => a.level !== undefined))

/** Whether (x, y) lies in a water area (`isWaterArea`) of `areas`. */
export const inWater = (areas: ReadonlyArray<Area>) =>
  inAny(
    areas
      .filter((a) => isWaterArea(a.kind))
      .map((a) => ({ rings: a.rings, box: ringBox(a.rings[0]!) })),
  )

/**
 * Whether each node of the window `g` (by its index in `g.z`) is the water's, which roads may not
 * claim: a node of a lake or a river polygon, but a river polygon's outer edge, which is left as the
 * ground it was (a lake's edge holds its water).
 */
export const waterNodes = (g: Grid, areas: ReadonlyArray<CarvedArea>): Uint8Array => {
  const span = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const reach = [
    g.x0 + (span.i0 - 1) * g.cell,
    g.y0 + (span.j0 - 1) * g.cell,
    g.x0 + (span.i0 + span.cols) * g.cell,
    g.y0 + (span.j0 + span.rows) * g.cell,
  ]
  const here = areas.filter((a) => meet(a.box, reach)),
    whole = cellMask(g),
    still = cellMask(g)
  for (const area of here) fillCells(g, area.rings, area.level === undefined ? whole : still)
  for (const area of here) if (area.level !== undefined) fillCells(g, area.rings, whole)
  const out = new Uint8Array(g.z.length)
  eachNode(g, whole, (k, edge) => (out[k] = edge ? 0 : 1))
  eachNode(g, still, (k) => (out[k] = 1))
  return out
}

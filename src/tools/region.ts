// The maps the build makes and the parts each is made of.
// - Regions: separately built maps (Lunigiana, Cesena), never sharing survey inputs; the build,
//   `fetch-osm` and the geometry read the one `--region` names (REGION, Lunigiana by default). A
//   region's play area is the union of its parts' (play-area.ts); its built terrain is the box round
//   every part's rectangles (`bounds`), its tiles those the rectangles meet, and its trees stand on
//   a lattice from a corner fixed for good (`anchor`, trees.ts).
// - Test regions (issue #7): other shapes and sizes built from Lunigiana's inputs, in its frame and
//   on its anchor, into `test-maps/` (gitignored), to check the build; the game never loads them.
// - Parts (issue #3): the Lunigiana map grows one part at a time, each a key, a title and its
//   rectangles in local metres, on 100 m multiples, and optionally a mask inside them. Today's map
//   is part `lucido`. The part tools (`rt-index`, `pick-sheets`, `pick-lidar`, `coverage`,
//   `footprint-check`) and `fetch-rt` take parts from here.

import type { MapId } from "../maps.ts"
import { tileRange } from "../sim/map/kinds.ts"

/** A rectangle [minX, minY, maxX, maxY] in local metres. */
export type Rect = readonly [number, number, number, number]

/** A part of a map: its key (the tools' argument), its title, its rectangles and its mask. */
export interface Part {
  readonly key: string
  readonly title: string
  readonly rects: ReadonlyArray<Rect>
  /**
   * The part's play area where it is less than its rectangles: one simple counter-clockwise flat
   * ring [x0, y0, x1, y1, ...] on 0.1 m, inside the rectangles (`checkMask`). Without one, the
   * part plays over the whole of its rectangles.
   */
  readonly mask?: ReadonlyArray<number>
}

/** A separately built map; survey inputs are never shared between regions, but a test region's. */
export interface Region {
  /** The `--region` argument that selects it. */
  readonly key: string
  /** The map whose inputs and local frame it is built from (`data/raw/<id>.osm.gz`, …). */
  readonly id: MapId
  /** Its files' name: the global file `<file>.bin` and the tiles `<file>/<i>_<j>.bin`, in `mapDir`. */
  readonly file: string
  /** A test region: built from another region's inputs to check the build, into `test-maps/`; never shipped or fetched for. */
  readonly test: boolean
  readonly origin: { readonly lat: number; readonly lon: number }
  /** Its parts: the play area is the union of their masks, or their rectangles where they have none. */
  readonly parts: ReadonlyArray<Part>
  /** The box round every part's rectangles: the built terrain, which the play area lies in. */
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
  /** The 2 km tiles its parts' rectangles meet, south to north, then west to east: the trees cover these. */
  readonly tiles: ReadonlyArray<{ readonly i: number; readonly j: number }>
  /**
   * The south-west corner of the tree lattice and its masks, local metres on the 4 m bank cells
   * (trees.ts): set once, where the first part's corner was, and never moved, so no lattice tree
   * moves and no tree changes its id as parts are added.
   */
  readonly anchor: { readonly x: number; readonly y: number }
}

/** Whether local (x, y) lies in one of the rectangles. */
export const inRects = (rects: ReadonlyArray<Rect>, x: number, y: number): boolean =>
  rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)

/** A rectangle as a counter-clockwise flat ring from its south-west corner. */
export const rectRing = ([x0, y0, x1, y1]: Rect): Array<number> => [x0, y0, x1, y0, x1, y1, x0, y1]

/** The local box [minX, minY, maxX, maxY] round every rectangle. */
export const rectsBox = (rects: ReadonlyArray<Rect>): Rect => [
  Math.min(...rects.map((r) => r[0])),
  Math.min(...rects.map((r) => r[1])),
  Math.max(...rects.map((r) => r[2])),
  Math.max(...rects.map((r) => r[3])),
]

/** The sign of the turn a → b → c, exact on integers: 1 left, −1 right, 0 straight. */
const turn = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))

/** Whether c, on the line through a and b, lies between them (ends included). */
const between = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.min(ax, bx) <= cx &&
  cx <= Math.max(ax, bx) &&
  Math.min(ay, by) <= cy &&
  cy <= Math.max(ay, by)

/** Whether two segments [ax, ay, bx, by] share any point. */
const meet = ([ax, ay, bx, by]: Rect, [cx, cy, dx, dy]: Rect): boolean => {
  const d1 = turn(cx, cy, dx, dy, ax, ay),
    d2 = turn(cx, cy, dx, dy, bx, by),
    d3 = turn(ax, ay, bx, by, cx, cy),
    d4 = turn(ax, ay, bx, by, dx, dy)
  if (d1 * d2 < 0 && d3 * d4 < 0) return true
  return (
    (d1 === 0 && between(cx, cy, dx, dy, ax, ay)) ||
    (d2 === 0 && between(cx, cy, dx, dy, bx, by)) ||
    (d3 === 0 && between(ax, ay, bx, by, cx, cy)) ||
    (d4 === 0 && between(ax, ay, bx, by, dx, dy))
  )
}

/**
 * Throws, naming the part and the fault, unless its mask (if any) is one simple counter-clockwise
 * ring on 0.1 m lying in its rectangles: at least three vertices, no edge meeting another but at
 * the vertex they share, every stretch of every edge in a rectangle, and no ground outside the
 * rectangles inside it (a gap they leave). Checked on whole
 * decimetres, so the predicates are exact.
 */
export const checkMask = ({ key, rects, mask }: Part): void => {
  if (mask === undefined) return
  const fail = (why: string): never => {
    throw new Error(`part ${key}'s mask ${why}`)
  }
  if (mask.length < 6 || mask.length % 2 !== 0) fail("needs three or more (x, y) vertices")
  if (mask.some((v) => Math.round(v * 10) / 10 !== v)) fail("has a vertex off the 0.1 m lattice")
  const dm = mask.map((v) => Math.round(v * 10)),
    n = dm.length / 2
  const edge = (i: number): Rect => [
    dm[2 * i]!,
    dm[2 * i + 1]!,
    dm[(2 * i + 2) % dm.length]!,
    dm[(2 * i + 3) % dm.length]!,
  ]
  let area = 0
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = edge(i)
    area += ax * by - bx * ay
  }
  if (area <= 0) fail("is not counter-clockwise")
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = edge(i)
    if (ax === bx && ay === by) fail(`repeats vertex ${i}`)
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = edge(i)
    // The next edge may only share its first vertex: it must not fold back along this one.
    const [, , cx, cy] = edge((i + 1) % n)
    if (turn(ax, ay, bx, by, cx, cy) === 0 && !between(ax, ay, cx, cy, bx, by))
      fail(`folds back at vertex ${(i + 1) % n}`)
    for (let j = i + 2; j < n; j++)
      if ((j + 1) % n !== i && meet(edge(i), edge(j))) fail(`crosses itself: edges ${i} and ${j}`)
  }
  for (let i = 0; i < n; i++)
    if (!inRects(rects, mask[2 * i]!, mask[2 * i + 1]!))
      fail(`has vertex ${i} outside its rectangles`)
  // Each edge in the rectangles: cut where it crosses any rectangle's side, the middle of every
  // piece between the cuts lies in one (a piece is in or out of each rectangle all along, and the
  // rectangles are closed).
  for (let i = 0; i < n; i++) {
    const [ex, ey, fx, fy] = edge(i),
      [ax, ay, bx, by] = [ex / 10, ey / 10, fx / 10, fy / 10]
    const ts = [0, 1]
    for (const [x0, y0, x1, y1] of rects) {
      if (bx !== ax) ts.push((x0 - ax) / (bx - ax), (x1 - ax) / (bx - ax))
      if (by !== ay) ts.push((y0 - ay) / (by - ay), (y1 - ay) / (by - ay))
    }
    const cuts = ts.filter((t) => t >= 0 && t <= 1).sort((s, t) => s - t)
    for (let k = 0; k + 1 < cuts.length; k++) {
      const t = (cuts[k]! + cuts[k + 1]!) / 2
      if (!inRects(rects, ax + (bx - ax) * t, ay + (by - ay) * t))
        fail(`leaves its rectangles on edge ${i}`)
    }
  }
  // Its inside in the rectangles too: their sides cut the box round them into cells each wholly in
  // or wholly out of them, and with no edge leaving them, a cell they miss is wholly in or out of
  // the mask, so its centre decides (a mask round a hole in a donut of rectangles fails here).
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b),
    ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b)
  for (let a = 0; a + 1 < xs.length; a++)
    for (let b = 0; b + 1 < ys.length; b++) {
      const x = (xs[a]! + xs[a + 1]!) / 2,
        y = (ys[b]! + ys[b + 1]!) / 2
      if (!inRects(rects, x, y) && insideRing(mask, x, y))
        fail("encloses ground outside its rectangles")
    }
}

/** Whether (x, y), on no edge of the flat ring, lies inside it (even-odd). */
const insideRing = (ring: ReadonlyArray<number>, x: number, y: number): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!,
      yi = ring[i + 1]!,
      xj = ring[j]!,
      yj = ring[j + 1]!
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) inside = !inside
  }
  return inside
}

/** Every tile any of `rects` meets (more than along its edge), south to north, then west to east. */
const tilesOf = (rects: ReadonlyArray<Rect>): Region["tiles"] => {
  const keys = new Set<string>(),
    tiles: Array<{ i: number; j: number }> = []
  for (const [minX, minY, maxX, maxY] of rects) {
    const { i0, i1, j0, j1 } = tileRange({ minX, minY, maxX, maxY })
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (!keys.has(`${i}_${j}`)) {
          keys.add(`${i}_${j}`)
          tiles.push({ i, j })
        }
  }
  return tiles.sort((a, b) => a.j - b.j || a.i - b.i)
}

/** A region of `parts` with its tree lattice at `anchor`, each mask checked, its bounds the box round every rectangle. */
const regionOf = (
  { key, id, file, test }: Pick<Region, "key" | "id" | "file" | "test">,
  origin: Region["origin"],
  parts: ReadonlyArray<Part>,
  anchor: Region["anchor"],
): Region => {
  for (const part of parts) checkMask(part)
  const rects = parts.flatMap((p) => p.rects)
  const [minX, minY, maxX, maxY] = rectsBox(rects)
  return {
    key,
    id,
    file,
    test,
    origin,
    parts,
    bounds: { minX, minY, maxX, maxY },
    tiles: tilesOf(rects),
    anchor,
  }
}

/**
 * Every Lunigiana part, in build order; `fetch-rt` reads one until #17 brings `fetch-rt <part>` and
 * the per-part raw layout. `lucido`: lat 44.1069–44.1968, lon 10.0937–10.1913, the whole Lucido
 * catchment, ridge to ridge, plus the Aulella side by Gragnola and Codiponte.
 */
export const PARTS: ReadonlyArray<Part> = [
  { key: "lucido", title: "Valle del Lucido", rects: [[-2900, -6100, 4900, 3900]] },
]

const LUNIGIANA_ORIGIN = { lat: 44.16175, lon: 10.13 }
// Each anchor is its first part's south-west corner.
const LUNIGIANA_ANCHOR = { x: -2900, y: -6100 }
const LUNIGIANA = regionOf(
  { key: "lunigiana", id: "lunigiana", file: "monzone", test: false },
  LUNIGIANA_ORIGIN,
  PARTS,
  LUNIGIANA_ANCHOR,
)
const lucido = PARTS[0]!.rects[0]!

/**
 * The test regions, each built from Lunigiana's inputs on its origin and anchor (so a tree stands
 * where it does on the shipped map, with the same id):
 * - `lunigiana-l`: two rectangles of lucido in an L, 6 of its tiles. The leg, x −2400…0 by y
 *   0…3900, holds Monzone (its station, the Carabinieri, the start) and Gragnola's rail layout to
 *   lucido's north edge; the foot, x 0…2400 by y 0…1400, Equi Terme and its station. The notch, round
 *   Fazzano, Casciana and Codiponte, is real land, so roads leave the play area across its two sides
 *   and are capped there (`l-region.map-test.ts`, which CI runs on it).
 * - `lunigiana-3x`: lucido between two rectangles of terrain only, as wide as it, 3 times its built
 *   terrain and 78 tiles; a mask on lucido's rectangle keeps the play area lucido's. Past the DTM's
 *   crop the terrain is the crop's edge drawn on (`loadDtm`): synthetic, for the build's memory and
 *   time and the cars round Monzone (docs/map.md, "Test regions").
 */
const TEST_REGIONS: ReadonlyArray<Region> = [
  regionOf(
    { key: "lunigiana-l", id: "lunigiana", file: "lunigiana-l", test: true },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "lucido-l",
        title: "Valle del Lucido, an L from Gragnola to Equi Terme",
        rects: [
          [-2400, 0, 0, 3900],
          [0, 0, 2400, 1400],
        ],
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
  regionOf(
    { key: "lunigiana-3x", id: "lunigiana", file: "lunigiana-3x", test: true },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "lucido-3x",
        title: "Valle del Lucido between two of terrain only",
        rects: [[-10700, -6100, -2900, 3900], lucido, [4900, -6100, 12700, 3900]],
        mask: rectRing(lucido),
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
]

const regions: ReadonlyArray<Region> = [
  LUNIGIANA,
  regionOf(
    { key: "cesena", id: "cesena", file: "cesena", test: false },
    { lat: 44.1391, lon: 12.2429 },
    [{ key: "cesena", title: "Cesena", rects: [[-2000, -2000, 2000, 2000]] }],
    { x: -2000, y: -2000 },
  ),
  ...TEST_REGIONS,
]

/** Selects a known region by its key, defaulting to the original map; invalid input fails before I/O. */
export const regionFromArgs = (args: ReadonlyArray<string>): Region => {
  const index = args.indexOf("--region")
  const key = index < 0 ? "lunigiana" : args[index + 1]
  const region = regions.find((candidate) => candidate.key === key)
  if (region === undefined)
    throw new Error(
      `Unknown or missing region: ${key ?? "--region requires a name"} (use one of ${regions.map((r) => r.key).join(", ")})`,
    )
  return region
}

/** Where the build writes `region`'s files, from the repository root: beside the game's map code, or a test region's in the gitignored `test-maps`. */
export const mapDir = (region: Region): string => (region.test ? "test-maps" : "src/sim/map")

/** Build region for this Node invocation, fixed before the geometry modules load. */
export const REGION = regionFromArgs(globalThis.process?.argv?.slice(2) ?? [])

/**
 * The Lunigiana part with `key`; throws naming the known keys, so a tool run without one says what
 * to pass, and when the build region is not Lunigiana, whose local frame the parts' rectangles are
 * in.
 */
export const partOf = (key: string | undefined): Part => {
  if (REGION.id !== LUNIGIANA.id)
    throw new Error(`parts belong to the Lunigiana map, not --region ${REGION.id}`)
  const part = PARTS.find((p) => p.key === key)
  if (part === undefined)
    throw new Error(`unknown part ${key}: use one of ${PARTS.map((p) => p.key).join(", ")}`)
  return part
}

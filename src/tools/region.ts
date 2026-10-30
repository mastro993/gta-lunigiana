// The maps the build makes and the parts each is made of.
// - Regions: separately built maps (Lunigiana, Cesena), never sharing survey inputs; the build,
//   `fetch-osm` and the geometry read the one `--region` names (REGION, Lunigiana by default). A
//   region's play area is the union of its parts' (play-area.ts); its built terrain is the box round
//   every part's rectangles (`bounds`), its tiles those the rectangles meet, and its trees stand on
//   a lattice from a corner fixed for good (`anchor`, trees.ts).
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

/** A separately built map; survey inputs are never shared between regions. */
export interface Region {
  readonly id: MapId
  readonly file: string
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
   * (trees.ts): set once, where the first part's corner was, and never moved, so no tree moves or
   * changes its id as parts are added.
   */
  readonly anchor: { readonly x: number; readonly y: number }
}

/** Whether local (x, y) lies in one of the rectangles. */
export const inRects = (rects: ReadonlyArray<Rect>, x: number, y: number): boolean =>
  rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)

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
 * the vertex they share, and every stretch of every edge in a rectangle. Checked on whole
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
  id: MapId,
  file: string,
  origin: Region["origin"],
  parts: ReadonlyArray<Part>,
  anchor: Region["anchor"],
): Region => {
  for (const part of parts) checkMask(part)
  const rects = parts.flatMap((p) => p.rects)
  const [minX, minY, maxX, maxY] = rectsBox(rects)
  return {
    id,
    file,
    origin,
    parts,
    bounds: { minX, minY, maxX, maxY },
    tiles: tilesOf(rects),
    anchor,
  }
}

/**
 * Every Lunigiana part, in build order; `fetch-rt` reads one until issue #7 builds the map tile by
 * tile. `lucido`: lat 44.1069–44.1968, lon 10.0937–10.1913, the whole Lucido catchment, ridge to
 * ridge, plus the Aulella side by Gragnola and Codiponte.
 */
export const PARTS: ReadonlyArray<Part> = [
  { key: "lucido", title: "Valle del Lucido", rects: [[-2900, -6100, 4900, 3900]] },
]

// Each anchor is its first part's south-west corner.
const LUNIGIANA = regionOf("lunigiana", "monzone", { lat: 44.16175, lon: 10.13 }, PARTS, {
  x: -2900,
  y: -6100,
})

const regions: ReadonlyArray<Region> = [
  LUNIGIANA,
  regionOf(
    "cesena",
    "cesena",
    { lat: 44.1391, lon: 12.2429 },
    [{ key: "cesena", title: "Cesena", rects: [[-2000, -2000, 2000, 2000]] }],
    { x: -2000, y: -2000 },
  ),
]

/** Selects a known region, defaulting to the original map; invalid input fails before I/O. */
export const regionFromArgs = (args: ReadonlyArray<string>): Region => {
  const index = args.indexOf("--region")
  const id = index < 0 ? "lunigiana" : args[index + 1]
  const region = regions.find((candidate) => candidate.id === id)
  if (region === undefined)
    throw new Error(`Unknown or missing region: ${id ?? "--region requires a name"}`)
  return region
}

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

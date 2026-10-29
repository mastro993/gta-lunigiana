// The playtest bot's drive mode, apart from its CDP plumbing: the default route (the SP59 from
// Monzone to Vinca, chained from the global map file), the page script that teleports the player
// along a route every animation frame, and the report it makes of the frames (the frame statistics
// heap mode shares). src/tools/playtest.ts runs it.
import { TILE } from "../sim/map/kinds.ts"
import { decodeMap, MAP_URL, readMapFile } from "../sim/map/packed.ts"

/** The slowest of `deltas` and its 99th percentile (nearest rank), in their unit; 0 for none. */
export const frameStats = (deltas: ReadonlyArray<number>): { slowest: number; p99: number } => {
  const sorted = deltas.toSorted((a, b) => a - b)
  return {
    slowest: sorted.at(-1) ?? 0,
    p99: sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? 0,
  }
}

interface Point {
  readonly x: number
  readonly y: number
}

const gap = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
/** The first or last vertex of flat [x0, y0, x1, y1, …] points. */
export const endOf = (pts: ReadonlyArray<number>, last: boolean): Point =>
  last ? { x: pts.at(-2)!, y: pts.at(-1)! } : { x: pts[0]!, y: pts[1]! }
/** The item `distance` puts nearest; the first of a tie. */
const nearest = <T>(items: ReadonlyArray<T>, distance: (item: T) => number): T | undefined =>
  items.reduce<T | undefined>(
    (best, item) => (best === undefined || distance(item) < distance(best) ? item : best),
    undefined,
  )

/**
 * One road's pieces (each flat [x0, y0, x1, y1, …], as `Road.pts`) chained through their shared end
 * vertices (the same OSM node, so equal coordinates) into one flat polyline: from the free end (one no
 * other piece shares) nearest `from`, or the end nearest it when none is free, taking at a fork the
 * piece whose far end is nearest `toward`, until no piece goes on.
 */
export const chainRoad = (
  pieces: ReadonlyArray<ReadonlyArray<number>>,
  from: Point,
  toward: Point,
): Array<number> => {
  const ends = pieces.flatMap((pts) => [endOf(pts, false), endOf(pts, true)])
  const shared = new Map<string, number>()
  for (const { x, y } of ends) shared.set(`${x},${y}`, (shared.get(`${x},${y}`) ?? 0) + 1)
  const free = ends.filter(({ x, y }) => shared.get(`${x},${y}`) === 1)
  let at = nearest(free.length > 0 ? free : ends, (end) => gap(end, from))
  if (at === undefined) throw new Error("chainRoad: no road to chain")
  const route = [at.x, at.y],
    left = new Set(pieces)
  for (;;) {
    const here = at
    const ways = [...left].flatMap((pts) =>
      [false, true].flatMap((last) => (gap(endOf(pts, last), here) === 0 ? [{ pts, last }] : [])),
    )
    // Entered at its last vertex, a piece leaves by its first.
    const way = nearest(ways, ({ pts, last }) => gap(endOf(pts, !last), toward))
    if (way === undefined) return route
    left.delete(way.pts)
    for (let k = 2; k < way.pts.length; k += 2) {
      const v = way.last ? way.pts.length - 2 - k : k
      route.push(way.pts[v]!, way.pts[v + 1]!)
    }
    at = endOf(way.pts, !way.last)
  }
}

/** The default drive: the SP59 from its end nearest the player's start (by Monzone) to Vinca (its district), chained from the global map file on disk. */
export const defaultRoute = (): Array<number> => {
  const map = decodeMap(readMapFile(MAP_URL))
  const vinca = map.districts.find((d) => d.name === "Vinca")
  if (vinca === undefined) throw new Error("the map has no Vinca district: no default drive")
  const sp59 = map.roads.filter((road) => road.ref === "SP59").map((road) => road.pts)
  const route = chainRoad(sp59, map.spawns.player, vinca)
  const end = endOf(route, true)
  if (gap(end, vinca) > 500)
    throw new Error(
      `the SP59 from Monzone ends at (${end.x}, ${end.y}), short of Vinca: a piece no longer shares its end with the next`,
    )
  return route
}

/** The length of flat [x0, y0, x1, y1, …] points, m. */
export const lengthOf = (route: ReadonlyArray<number>): number => {
  let m = 0
  for (let k = 2; k < route.length; k += 2)
    m += Math.hypot(route[k]! - route[k - 2]!, route[k + 1]! - route[k - 1]!)
  return m
}

/** One frame of a drive: ms since the drive's first frame and since the frame before, the player's x and y (m; null with no player), the tiles resident. */
export type Frame = readonly [
  t: number,
  dt: number,
  x: number | null,
  y: number | null,
  tiles: number,
]

/**
 * The page script of a drive: each animation frame it teleports the player (`gta.teleport(x, y,
 * angle)`, the angle from +x towards +y) to where `speed` m/s has reached along `route` (held at its
 * end), heading along it, for `seconds` s (or, without frames, 5 s past them). It resolves to a
 * `Frame` per frame after the first, read before that frame's teleport.
 */
export const driveScript = (
  route: ReadonlyArray<number>,
  speed: number,
  seconds: number,
): string => `new Promise((done) => {
  const pts = ${JSON.stringify(route)}, cum = [0], frames = [], ms = ${seconds * 1000}
  for (let k = 2; k < pts.length; k += 2) cum.push(cum.at(-1) + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]))
  let k = 0, t0, last
  const tick = (t) => {
    t0 ??= t
    const s = Math.min(((t - t0) / 1000) * ${speed}, cum.at(-1))
    while (k < cum.length - 2 && cum[k + 1] < s) k++
    const ax = pts[2 * k], ay = pts[2 * k + 1], dx = pts[2 * k + 2] - ax, dy = pts[2 * k + 3] - ay
    const f = (s - cum[k]) / (cum[k + 1] - cum[k] || 1)
    if (last !== undefined) {
      const pose = gta.player()?.pose
      frames.push([t - t0, t - last, pose?.x ?? null, pose?.y ?? null, gta.tiles().length])
    }
    last = t
    gta.teleport(ax + f * dx, ay + f * dy, Math.atan2(dy, dx))
    if (t - t0 < ms) requestAnimationFrame(tick)
    else done(frames)
  }
  requestAnimationFrame(tick)
  setTimeout(() => done(frames), ms + 5000)
})`

/** A tile seam the player crossed: the axis, the seam's x or y (a multiple of `TILE`, m), when (ms into the drive), and the slowest frame within 1 s of then (ms). */
interface Seam {
  readonly axis: "x" | "y"
  readonly at: number
  readonly t: number
  readonly slowest: number
}

/** Frames longer than this are listed one by one (ms): the frame budget a seam crossing must keep (issue #5). */
const SLOW_FRAME = 30

/** A frame over `SLOW_FRAME`: when (ms into the drive), where the player was (m) and how long it took (ms). */
interface Slow {
  readonly t: number
  readonly x: number | null
  readonly y: number | null
  readonly dt: number
}

/**
 * What a drive's frames show: their `frameStats` (ms), each tile-seam crossing (the player's x or y
 * passing a multiple of `TILE` from where it was last known, so a jump crosses every seam between)
 * with the slowest frame within 1 s of it, every frame over `SLOW_FRAME`, and the most tiles
 * resident at once.
 */
export const driveReport = (
  frames: ReadonlyArray<Frame>,
): {
  slowest: number
  p99: number
  seams: Array<Seam>
  slow: Array<Slow>
  maxTiles: number
} => {
  const crossings: Array<Omit<Seam, "slowest">> = []
  let was: Point | undefined
  for (const [t, , x, y] of frames) {
    if (x === null || y === null) continue
    if (was !== undefined)
      for (const [axis, from, to] of [
        ["x", was.x, x],
        ["y", was.y, y],
      ] as const) {
        const a = Math.floor(from / TILE),
          b = Math.floor(to / TILE)
        for (let n = Math.min(a, b) + 1; n <= Math.max(a, b); n++)
          crossings.push({ axis, at: n * TILE, t })
      }
    was = { x, y }
  }
  const seams = crossings.map((seam) => ({
    ...seam,
    slowest: frames.reduce((m, [t, dt]) => (Math.abs(t - seam.t) <= 1000 ? Math.max(m, dt) : m), 0),
  }))
  return {
    ...frameStats(frames.map(([, dt]) => dt)),
    seams,
    slow: frames.flatMap(([t, dt, x, y]) => (dt > SLOW_FRAME ? [{ t, x, y, dt }] : [])),
    maxTiles: frames.reduce((m, frame) => Math.max(m, frame[4]), 0),
  }
}

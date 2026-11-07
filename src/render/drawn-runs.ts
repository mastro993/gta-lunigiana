/**
 * The track the render draws past the lines' terminals: each line's run-out as its trains ride it (`LINES`: the map's track on
 * beyond the terminal, straight on past where that ends) over the drawn run (`DRAWN_RUN`), where a train past a terminal is
 * still seen. A run's first stretch on its terminal piece's level carries that piece's own polyline on, so their strips meet
 * mitred; its other stretches (a bridge or a bore on beyond the terminal) are pieces of their own.
 *
 * @module render/drawn-runs
 */
import { MAP, RAIL_LIFT, type Rail } from "../sim/map/index.ts"
import { DRAWN_RUN, type Line, LINES, pointAt } from "../sim/rail/lines.ts"
import { levelOf } from "../sim/rail/run-on.ts"

/** A stretch of track as the render draws it: flat x, y and the bed's z per vertex, as `MAP.rail` holds them. */
export type Track = Pick<Rail, "kind" | "bridge" | "tunnel" | "pts" | "z">

/**
 * The track of `line` over the drawn run past its terminal `end` (0 its first, 1 its last), walked away from the terminal,
 * in stretches of one level: its vertices there and the drawn run's end, the bed under the rail head (`RAIL_LIFT` lower).
 */
export const drawnRun = (line: Line, end: 0 | 1): Array<Track> => {
  const s0 = end === 0 ? 0 : line.length,
    way = end === 0 ? -1 : 1
  const between = Array.from(line.s).filter((s) => (s - s0) * way > 0 && (s - s0) * way < DRAWN_RUN)
  const ss = [s0, ...(way < 0 ? between.toReversed() : between), s0 + way * DRAWN_RUN]
  const out: Array<{ level: number; pts: Array<number>; z: Array<number> }> = []
  for (let i = 0; i + 1 < ss.length; i++) {
    const mid = pointAt(line, (ss[i]! + ss[i + 1]!) / 2),
      level = mid.tunnel ? 2 : mid.bridge ? 1 : 0
    let at = out.at(-1)
    if (at?.level !== level) {
      const a = pointAt(line, ss[i]!)
      at = { level, pts: [a.x, a.y], z: [a.z - RAIL_LIFT] }
      out.push(at)
    }
    const b = pointAt(line, ss[i + 1]!)
    at.pts.push(b.x, b.y)
    at.z.push(b.z - RAIL_LIFT)
  }
  return out.map(({ level, pts, z }) => ({
    pts,
    z,
    ...(level === 1 ? { bridge: true } : level === 2 ? { tunnel: true } : {}),
  }))
}

/** `t` walked the other way. */
const flipped = (t: Track): Track => ({
  ...t,
  pts: Array.from(
    { length: t.pts.length },
    (_, i) => t.pts[t.pts.length - 2 - (i & ~1) + (i & 1)]!,
  ),
  z: t.z.toReversed(),
})

/**
 * Every `MAP.rail` piece as drawn, in order, each line's terminal piece carried on over the first stretch of its drawn run
 * (`drawnRun`) where that runs on at its level, then the drawn runs' other stretches. A terminal two lines share is drawn
 * once.
 */
export const drawnTrack = (): Array<Track> => {
  const before = new Map<number, Track>(),
    after = new Map<number, Track>(),
    alone: Array<Track> = [],
    done = new Set<string>()
  for (const line of LINES)
    for (const end of [0, 1] as const) {
      const { pieces } = MAP.railway.lines[line.index]!
      const { rail, rev } = end === 0 ? pieces[0]! : pieces.at(-1)!
      // The terminal is its piece's first vertex where the line leaves the piece from there.
      const first = (end === 0) !== rev,
        key = `${rail} ${first}`
      if (done.has(key)) continue
      done.add(key)
      const [on, ...rest] = drawnRun(line, end)
      if (on !== undefined && levelOf(on) === levelOf(MAP.rail[rail]!)) {
        ;(first ? before : after).set(rail, on)
        alone.push(...rest)
      } else alone.push(...(on === undefined ? [] : [on]), ...rest)
    }
  return [
    ...MAP.rail.map((piece, i): Track => {
      const head = before.get(i),
        tail = after.get(i)
      if (head === undefined && tail === undefined) return piece
      const from = head === undefined ? undefined : flipped(head)
      return {
        ...piece,
        pts: [...(from?.pts.slice(0, -2) ?? []), ...piece.pts, ...(tail?.pts.slice(2) ?? [])],
        z: [...(from?.z.slice(0, -1) ?? []), ...piece.z, ...(tail?.z.slice(1) ?? [])],
      }
    }),
    ...alone,
  ]
}

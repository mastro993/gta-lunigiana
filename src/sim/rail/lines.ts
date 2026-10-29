/**
 * The lines as trains run them: each of `MAP.railway.lines` as one polyline in arc length `s`, its
 * pieces of `MAP.rail` joined end to end and extended straight past both terminals: over the drawn
 * apron (`DRAWN_RUN`), past which AI trains are removed, to the end of the run-out, where they enter
 * out of view (`runOut`). A line's s counts from its first terminal (0) to its last (`length`), as the
 * map's stations, crossings and speed limits do; the run-outs are s < 0 and s > length. Lines that
 * run on the same pieces (or past the same terminal) share that track: `SHARED` maps one line's s
 * onto another's there. Static module content, built once at load; `makeLine` builds one from any
 * track, for tests.
 *
 * @module rail/lines
 */
import { Ops } from "@typeonce/ritmo-math"

import { segDist2, staticGrid } from "../collide.ts"
import { MAP, RAIL_LIFT, type RailLine, type Station } from "../map/index.ts"
import { strikeIn } from "./barriers.ts"
import { TRAIN_MODELS, trainLength } from "./models.ts"

/** How far past a terminal the track is drawn, m: the render's apron beyond the map's bounds (`APRON` × the heightmap's cell, src/render/chunks.ts, whose test holds them equal; a driven train's buffer stop). */
export const DRAWN_RUN = 192
/** Line speed on a stretch OSM gives no limit, m/s: 80 km/h, rank B on a secondary line such as Lucca–Aulla. */
export const DEFAULT_SPEED = 80 / 3.6
/** Headings are taken over this chord, m: a 2 m segment on the map's 0.1 m grid can turn 3° on its own. */
export const CHORD = 5
/** Curvature is the heading's change over this chord, m. */
const BEND = 20
/** The longest train there is, m. */
const LONGEST = Math.max(...TRAIN_MODELS.map(trainLength))

/**
 * How far past a terminal with line speed `v` m/s the track runs on, m: a train entering at the run-out's end at that speed
 * has its whole body past the drawn run and its nose the strike-in (`strikeIn`, rail/barriers.ts) short of the terminal, so
 * even a box at the map's edge is down before the train would brake for it. 1129 m at 85 km/h.
 */
export const runOut = (v: number): number => Math.max(DRAWN_RUN, strikeIn(v)) + LONGEST

/** A stretch of line speed: from s to s (m), at `v` m/s. */
export interface SpeedSpan {
  readonly from: number
  readonly to: number
  readonly v: number
}

/**
 * A stretch of a line on one piece of track, from s to s: `key` names the track (a `MAP.rail` index, or
 * −1 − (2·rail + end) for the run-out straight on past vertex `end` (0 its first, 1 its last) of
 * terminal piece `rail`), which the line walks from its own start toward its end when `forward`.
 */
export interface TrackRun {
  readonly key: number
  readonly from: number
  readonly to: number
  readonly forward: boolean
}

/** A line's running track: vertices by s, what each segment runs on, its speed limits and stations. */
export interface Line {
  /** Its index into `MAP.railway.lines` (and `LINES`). */
  readonly index: number
  /** The s of its last terminal, m: the track between its terminals. */
  readonly length: number
  /** The run-outs' far ends, m: −`runOut` at the start's line speed and length + `runOut` at the end's. */
  readonly start: number
  readonly end: number
  /** Per vertex: s, x, y and the rail head's z (the bed's profile plus `RAIL_LIFT`), m. */
  readonly s: Float64Array
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  /** Per segment (vertex k to k + 1): 0 at grade, 1 on a bridge, 2 in a tunnel. */
  readonly level: Uint8Array
  /** Line speed over [start, end], in s order, no gaps. */
  readonly speeds: ReadonlyArray<SpeedSpan>
  /** Its stations: indices into `MAP.railway.stations`, by s. */
  readonly stations: ReadonlyArray<number>
  /** Its tunnels (consecutive tunnel segments merged): from s to s, m. */
  readonly tunnels: ReadonlyArray<{ readonly from: number; readonly to: number }>
  /** The track it runs on, piece by piece and the run-outs, by s (none for track with no `rail`). */
  readonly runs: ReadonlyArray<TrackRun>
}

/** A point of a line: where, the rail head's height, the heading toward +s (rad), the grade (rise per metre toward +s), and what it runs on. */
export interface TrackPoint {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly grade: number
  readonly bridge: boolean
  readonly tunnel: boolean
}

/** One stretch of track: flat x, y, the rail head's z per vertex, whether it is a bridge or a tunnel, and the `MAP.rail` piece it is (walked from its last vertex when `rev`), if any. */
export interface TrackPiece {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly bridge?: boolean
  readonly tunnel?: boolean
  readonly rail?: number
  readonly rev?: boolean
}

/** The line speed over [start, end] from OSM's limits (km/h): a gap takes the lower of its neighbours, a line with none `DEFAULT_SPEED`. */
const speedSpans = (
  maxspeed: RailLine["maxspeed"],
  start: number,
  end: number,
): Array<SpeedSpan> => {
  if (maxspeed.length === 0) return [{ from: start, to: end, v: DEFAULT_SPEED }]
  const spans: Array<SpeedSpan> = []
  let at = start
  for (const [i, [from, to, kmh]] of maxspeed.entries()) {
    const v = kmh / 3.6
    if (from > at) {
      const before = i === 0 ? v : Math.min(v, spans.at(-1)!.v)
      spans.push({ from: at, to: from, v: before })
    }
    spans.push({ from: Math.max(at, from), to, v })
    at = to
  }
  if (at < end) spans.push({ from: at, to: end, v: spans.at(-1)!.v })
  spans[0] = { ...spans[0]!, from: start }
  return spans
}

/**
 * A line from its pieces in running order (consecutive pieces share their end vertex), extended
 * straight past both ends at the end's height, along the heading over the last `CHORD` m, by the
 * `runOut` at the line speed there.
 */
export const makeLine = (
  index: number,
  pieces: ReadonlyArray<TrackPiece>,
  maxspeed: RailLine["maxspeed"] = [],
  stations: ReadonlyArray<number> = [],
): Line => {
  const xs: Array<number> = [],
    ys: Array<number> = [],
    zs: Array<number> = [],
    levels: Array<number> = [],
    spansOf: Array<readonly [first: number, last: number]> = []
  for (const piece of pieces) {
    const level = piece.tunnel === true ? 2 : piece.bridge === true ? 1 : 0
    let first = xs.length
    for (let k = 0; k < piece.z.length; k++) {
      const x = piece.pts[2 * k]!,
        y = piece.pts[2 * k + 1]!
      if (k === 0 && xs.length > 0 && xs.at(-1) === x && ys.at(-1) === y) {
        first = xs.length - 1
        continue
      }
      if (xs.length > 0) levels.push(level)
      xs.push(x)
      ys.push(y)
      zs.push(piece.z[k]!)
    }
    spansOf.push([first, xs.length - 1])
  }
  const apart = (i: number, j: number) => Math.sqrt((xs[i]! - xs[j]!) ** 2 + (ys[i]! - ys[j]!) ** 2)
  const inner = [0]
  for (let k = 1; k < xs.length; k++) inner.push(inner[k - 1]! + apart(k - 1, k))
  const length = inner.at(-1)!
  const speeds = speedSpans(maxspeed, 0, length)
  const before = runOut(speeds[0]!.v),
    after = runOut(speeds.at(-1)!.v),
    start = -before,
    end = length + after
  speeds[0] = { ...speeds[0]!, from: start }
  speeds[speeds.length - 1] = { ...speeds.at(-1)!, to: end }
  // Past each end, straight on along the heading over its last CHORD m, at the end's height.
  const away = (from: number, step: number) => {
    let k = from + step
    while (k > 0 && k < xs.length - 1 && apart(k, from) < CHORD) k += step
    const d = apart(from, k)
    return { dx: (xs[from]! - xs[k]!) / d, dy: (ys[from]! - ys[k]!) / d }
  }
  const head = away(0, 1),
    tail = away(xs.length - 1, -1)
  const n = xs.length + 2
  const s = new Float64Array(n),
    x = new Float64Array(n),
    y = new Float64Array(n),
    z = new Float64Array(n),
    level = new Uint8Array(n - 1)
  x[0] = xs[0]! + head.dx * before
  y[0] = ys[0]! + head.dy * before
  z[0] = zs[0]!
  s[0] = start
  for (let k = 0; k < xs.length; k++) {
    x[k + 1] = xs[k]!
    y[k + 1] = ys[k]!
    z[k + 1] = zs[k]!
    s[k + 1] = inner[k]!
    if (k > 0) level[k] = levels[k - 1]!
  }
  x[n - 1] = xs.at(-1)! + tail.dx * after
  y[n - 1] = ys.at(-1)! + tail.dy * after
  z[n - 1] = zs.at(-1)!
  s[n - 1] = end
  const tunnels: Array<{ from: number; to: number }> = []
  for (let k = 0; k < n - 1; k++) {
    if (level[k] !== 2) continue
    const last = tunnels.at(-1)
    if (last !== undefined && last.to === s[k]) last.to = s[k + 1]!
    else tunnels.push({ from: s[k]!, to: s[k + 1]! })
  }
  // The track under it: each piece, and each run-out keyed by the terminal vertex it leaves from.
  const firstPiece = pieces[0],
    lastPiece = pieces.at(-1)
  const runs: Array<TrackRun> =
    firstPiece?.rail === undefined || lastPiece?.rail === undefined
      ? []
      : [
          {
            key: -1 - (2 * firstPiece.rail + (firstPiece.rev === true ? 1 : 0)),
            from: start,
            to: 0,
            forward: false,
          },
          ...pieces.flatMap((piece, i) =>
            piece.rail === undefined
              ? []
              : [
                  {
                    key: piece.rail,
                    from: inner[spansOf[i]![0]]!,
                    to: inner[spansOf[i]![1]]!,
                    forward: piece.rev !== true,
                  },
                ],
          ),
          {
            key: -1 - (2 * lastPiece.rail + (lastPiece.rev === true ? 0 : 1)),
            from: length,
            to: end,
            forward: true,
          },
        ]
  return { index, length, start, end, s, x, y, z, level, speeds, stations, tunnels, runs }
}

/** Every line of the map, indexed like `MAP.railway.lines`. */
export const LINES: ReadonlyArray<Line> = MAP.railway.lines.map((line, index) =>
  makeLine(
    index,
    line.pieces.map(({ rail, rev }) => {
      const piece = MAP.rail[rail]!,
        n = piece.z.length
      const at = (k: number) => (rev ? n - 1 - k : k)
      return {
        pts: Array.from({ length: 2 * n }, (_, i) => piece.pts[2 * at(i >> 1) + (i & 1)]!),
        z: Array.from({ length: n }, (_, k) => piece.z[at(k)]! + RAIL_LIFT),
        bridge: piece.bridge,
        tunnel: piece.tunnel,
        rail,
        rev,
      }
    }),
    line.maxspeed,
    MAP.railway.stations.flatMap((station, i) => (station.line === index ? [i] : [])),
  ),
)

/** A stretch of track a line shares with another: s `from`…`to` of the other lies at `at` + `sign`·s on this one. */
export interface SharedRun {
  readonly from: number
  readonly to: number
  readonly at: number
  readonly sign: 1 | -1
}

/** `runs` by s with each stretch that carries straight on from the one before (the same way round, on along) made one with it. */
const joined = (runs: ReadonlyArray<SharedRun>): Array<SharedRun> =>
  runs.reduce<Array<SharedRun>>((out, run) => {
    const last = out.at(-1)
    if (
      last !== undefined &&
      last.sign === run.sign &&
      Math.abs(last.at - run.at) < 1e-6 &&
      Math.abs(last.to - run.from) < 1e-6
    )
      out[out.length - 1] = { ...last, to: run.to }
    else out.push(run)
    return out
  }, [])

/**
 * The track each of `lines` shares with each other one, by their runs: `[onto][from]`, the stretches of line `from` that line
 * `onto` runs on too (none for a line with itself), each run on unbroken over the pieces they share in a row.
 */
export const sharedTrack = (
  lines: ReadonlyArray<Line>,
): ReadonlyArray<ReadonlyArray<ReadonlyArray<SharedRun>>> =>
  lines.map((onto) => {
    const runs = new Map(onto.runs.map((run) => [run.key, run]))
    return lines.map((other) =>
      other === onto
        ? []
        : joined(
            other.runs.flatMap((run): Array<SharedRun> => {
              const mine = runs.get(run.key)
              if (mine === undefined) return []
              // Along the track from its own start (a piece's first vertex, a run-out's terminal), as far as both lines run it.
              const both = Math.min(run.to - run.from, mine.to - mine.from),
                zero = run.forward ? run.from : run.to,
                base = mine.forward ? mine.from : mine.to,
                sign = run.forward === mine.forward ? 1 : -1
              return [
                {
                  from: run.forward ? run.from : run.to - both,
                  to: run.forward ? run.from + both : run.to,
                  at: base - sign * zero,
                  sign,
                },
              ]
            }),
          ),
    )
  })

/** The map's shared track (`sharedTrack` of `LINES`). */
export const SHARED = sharedTrack(LINES)

/** Where the stretch [lo, hi] of another line lies on a line, over the track they share (`shared`, from `SHARED`): each part's ends and the sign that turns the other line's +s into this one's. */
export const sharedPart = (
  shared: ReadonlyArray<SharedRun>,
  lo: number,
  hi: number,
): ReadonlyArray<{ readonly lo: number; readonly hi: number; readonly sign: 1 | -1 }> =>
  shared.flatMap((run) => {
    const a = Math.max(lo, run.from),
      b = Math.min(hi, run.to)
    if (a > b) return []
    const p = run.at + run.sign * a,
      q = run.at + run.sign * b
    return [{ lo: Math.min(p, q), hi: Math.max(p, q), sign: run.sign }]
  })

/** The segment of `line` holding s (clamped to the line): the last vertex at or before it. */
const segmentAt = (line: Line, s: number): number => {
  let lo = 0,
    hi = line.s.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (line.s[mid]! <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Where s (clamped to the line) lies: x, y and the rail head's z. */
const placeAt = (line: Line, s: number) => {
  const at = Math.max(line.start, Math.min(line.end, s)),
    k = segmentAt(line, at)
  const t = (at - line.s[k]!) / Math.max(1e-9, line.s[k + 1]! - line.s[k]!)
  return {
    k,
    x: line.x[k]! + (line.x[k + 1]! - line.x[k]!) * t,
    y: line.y[k]! + (line.y[k + 1]! - line.y[k]!) * t,
    z: line.z[k]! + (line.z[k + 1]! - line.z[k]!) * t,
  }
}

/** The ends of the `CHORD` m chord of `line` about s (kept on the line). */
const chordAt = (line: Line, s: number) => {
  const from = Math.max(line.start, Math.min(line.end - CHORD, s - CHORD / 2))
  return [placeAt(line, from), placeAt(line, from + CHORD)] as const
}

/** The heading toward +s at s, over a `CHORD` m chord (rad). */
const headingAt = (line: Line, s: number): number => {
  const [a, b] = chordAt(line, s)
  return Ops.atan2(b.y - a.y, b.x - a.x)
}

/** The point of `line` at s (clamped to its ends), its heading and grade over `CHORD` m. */
export const pointAt = (line: Line, s: number): TrackPoint => {
  const here = placeAt(line, s),
    [a, b] = chordAt(line, s)
  return {
    x: here.x,
    y: here.y,
    z: here.z,
    angle: Ops.atan2(b.y - a.y, b.x - a.x),
    grade: (b.z - a.z) / CHORD,
    bridge: line.level[here.k] === 1,
    tunnel: line.level[here.k] === 2,
  }
}

/** The line's curvature at s, 1/m: its heading's turn over `BEND` m (left +). */
export const curvatureAt = (line: Line, s: number): number => {
  const turn = headingAt(line, s + BEND / 2) - headingAt(line, s - BEND / 2)
  return Ops.atan2(Ops.sin(turn), Ops.cos(turn)) / BEND
}

/** The line speed at s, m/s. */
export const speedAt = (line: Line, s: number): number =>
  (line.speeds.find((span) => s < span.to) ?? line.speeds.at(-1)!).v

/** Where a train of `length` m running in `dir` has its head when it stands centred on the station's platforms, m of s. */
export const stopPoint = (station: Station, dir: 1 | -1, length: number): number =>
  (station.s0 + station.s1) / 2 + (dir * length) / 2

const segments: Array<readonly [line: number, k: number]> = LINES.flatMap((line) =>
  Array.from({ length: line.s.length - 1 }, (_, k) => [line.index, k] as const),
)
const segmentsIn = staticGrid(
  segments.length,
  (i) => {
    const [l, k] = segments[i]!,
      line = LINES[l]!
    return [
      Math.min(line.x[k]!, line.x[k + 1]!),
      Math.min(line.y[k]!, line.y[k + 1]!),
      Math.max(line.x[k]!, line.x[k + 1]!),
      Math.max(line.y[k]!, line.y[k + 1]!),
    ]
  },
  32,
)

/** A point of a line near a place: the line's index, its s and how far off the place is, m. */
export interface LinePoint {
  readonly line: number
  readonly s: number
  readonly distance: number
}

/** Each line passing within `reach` m of (x, y), at its point nearest there, in the order the grid meets them. */
export const linesNear = (x: number, y: number, reach: number): ReadonlyArray<LinePoint> => {
  const best = new Map<number, LinePoint>()
  segmentsIn(x - reach, y - reach, x + reach, y + reach, (i) => {
    const [l, k] = segments[i]!,
      line = LINES[l]!
    const { d2, t } = segDist2(x, y, line.x[k]!, line.y[k]!, line.x[k + 1]!, line.y[k + 1]!)
    const distance = Math.sqrt(d2),
      known = best.get(l)
    if (distance <= reach && (known === undefined || distance < known.distance))
      best.set(l, { line: l, s: line.s[k]! + (line.s[k + 1]! - line.s[k]!) * t, distance })
  })
  return [...best.values()]
}

/** A train at rest this near its stop point, or past it, m, has arrived. */
export const STOP_REACH = 3

/** The station a train of `length` m running `dir` with its head at s calls at next on `line`: the first whose stop point lies ahead beyond `STOP_REACH` m (an index into `MAP.railway.stations`), or −1. */
export const nextStop = (line: Line, s: number, dir: 1 | -1, length: number): number => {
  let best = -1,
    near = Number.MAX_VALUE
  for (const i of line.stations) {
    const ahead = (stopPoint(MAP.railway.stations[i]!, dir, length) - s) * dir
    if (ahead > STOP_REACH && ahead < near) [best, near] = [i, ahead]
  }
  return best
}

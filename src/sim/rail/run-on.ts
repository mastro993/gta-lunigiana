/**
 * The track past a line's terminal as its trains ride it (`makeLine` in ./lines.ts runs each line on
 * along it): the map's stored run-out (`runOuts` in `MAP.railway`) out to the length the run-out
 * needs, straight on past where that ends short. Pure functions.
 *
 * @module rail/run-on
 */

/** A stretch of track: flat x, y and the rail head's z per vertex, and whether it is a bridge or a tunnel. */
export interface Stretch {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly bridge?: boolean
  readonly tunnel?: boolean
}

/** What a stretch of track runs on: 0 at grade, 1 a bridge, 2 a tunnel. */
export const levelOf = (piece: Stretch): number =>
  piece.tunnel === true ? 2 : piece.bridge === true ? 1 : 0

/** The track past a terminal: each vertex beyond it, how far from it (m), and what the segment to it runs on (`levelOf`). */
export interface RunOn {
  readonly x: Array<number>
  readonly y: Array<number>
  readonly z: Array<number>
  readonly d: Array<number>
  readonly level: Array<number>
}

/**
 * The track past a terminal at height `z0`, out to `need` m from it: its stored run-out `out` (walked away from it, each
 * piece on from the last one's end) cut where it has run `need` m, and where that ends short, straight on along the
 * heading over its last `chord` m at its last height, at grade. `bx`, `by` are the line's own vertices from the terminal
 * inward, which that heading takes in where the stored track runs shorter.
 */
export const runOn = (
  bx: ReadonlyArray<number>,
  by: ReadonlyArray<number>,
  z0: number,
  out: ReadonlyArray<Stretch>,
  need: number,
  chord: number,
): RunOn => {
  const run: RunOn = { x: [], y: [], z: [], d: [], level: [] }
  const push = (x: number, y: number, z: number, d: number, level: number) => {
    run.x.push(x)
    run.y.push(y)
    run.z.push(z)
    run.d.push(d)
    run.level.push(level)
  }
  let px = bx[0]!,
    py = by[0]!,
    pz = z0,
    d = 0
  for (const piece of out)
    for (let k = 1; k < piece.z.length; k++) {
      const x = piece.pts[2 * k]!,
        y = piece.pts[2 * k + 1]!,
        z = piece.z[k]!,
        len = Math.sqrt((x - px) ** 2 + (y - py) ** 2)
      if (len === 0) continue
      if (d + len >= need) {
        const t = (need - d) / len
        push(px + (x - px) * t, py + (y - py) * t, pz + (z - pz) * t, need, levelOf(piece))
        return run
      }
      d += len
      push(x, y, z, d, levelOf(piece))
      ;[px, py, pz] = [x, y, z]
    }
  const xs = [...bx].reverse().concat(run.x),
    ys = [...by].reverse().concat(run.y),
    last = xs.length - 1
  const apart = (k: number) => Math.sqrt((xs[last]! - xs[k]!) ** 2 + (ys[last]! - ys[k]!) ** 2)
  let k = last - 1
  while (k > 0 && apart(k) < chord) k--
  const len = apart(k),
    dx = (xs[last]! - xs[k]!) / len,
    dy = (ys[last]! - ys[k]!) / len
  push(xs[last]! + dx * (need - d), ys[last]! + dy * (need - d), pz, need, 0)
  return run
}

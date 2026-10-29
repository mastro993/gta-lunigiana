/**
 * The railway as it sounds: where the rails clack (a joint every `JOINT` m along each line, and the
 * switches, wherever a piece of track the line does not run on, a loop or a siding, meets it) and
 * how a train in a tunnel reaches the open air (by its portals). Any line of `MAP.railway` the same
 * way; the switches are found on the first query.
 *
 * @module audio/places/track
 */
import { MAP } from "../../sim/map/index.ts"
import { LINES, linesNear, pointAt } from "../../sim/rail/lines.ts"
import { JOINT } from "../synth/rail.ts"

/** A piece's end this near a line lies on it, m: shared vertices are bit-identical on the map's grid. */
const ON = 0.05

let switches: ReadonlyArray<ReadonlyArray<number>> | undefined

/** Each line's switches by s: where an end of a `MAP.rail` piece the line does not run on lies on the line. */
const switchesOf = (line: number): ReadonlyArray<number> => {
  switches ??= LINES.map((l) => {
    const runs = new Set(l.runs.map((run) => run.key)),
      found: Array<number> = []
    for (const [index, piece] of MAP.rail.entries()) {
      if (runs.has(index)) continue
      for (const k of [0, piece.z.length - 1]) {
        const near = linesNear(piece.pts[2 * k]!, piece.pts[2 * k + 1]!, ON).find(
          (p) => p.line === l.index,
        )
        if (near !== undefined) found.push(near.s)
      }
    }
    return found.sort((a, b) => a - b)
  })
  return switches[line] ?? []
}

/** The s of `line`'s rail joints and switches from `lo` to `hi`, m. */
export const jointsBetween = (line: number, lo: number, hi: number): Array<number> => {
  const joints: Array<number> = []
  for (let k = Math.ceil(lo / JOINT); k * JOINT <= hi; k++) joints.push(k * JOINT)
  for (const s of switchesOf(line)) if (s >= lo && s <= hi) joints.push(s)
  return joints
}

/** A tunnel's mouth as a source deep inside it reaches it: where (x, y, the rail head's z), and how far in along the track the source is, m. */
export interface Portal {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly depth: number
}

/** The portals of the tunnel s on `line` lies in (none out of one), each with the source's depth from it. */
export const portalsOf = (line: number, s: number): ReadonlyArray<Portal> => {
  const track = LINES[line],
    tunnel = track?.tunnels.find((t) => s >= t.from && s <= t.to)
  if (track === undefined || tunnel === undefined) return []
  return [tunnel.from, tunnel.to].map((at) => {
    const { x, y, z } = pointAt(track, at)
    return { x, y, z, depth: Math.abs(s - at) }
  })
}

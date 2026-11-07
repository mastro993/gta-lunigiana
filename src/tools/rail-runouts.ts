// The lines' run-outs (`runOuts` in `MAP.railway`): where the play area's outline cuts the running
// track at a terminal, OSM's track on beyond it, so a train past the terminal runs on along the real
// line over the ground there instead of straight on into a hill. The walk takes the terminal's own
// way from its cut beside the terminal, then on through the pieces sharing each end node, the
// straightest way under the lines' MAX_TURN, as far as OSM's pieces beyond the play area and in the
// built terrain's box go (`clipBeyond`). build-terrain.ts profiles each chain as the rail in play is,
// from the terminal's level.
import { Ops } from "@typeonce/ritmo-math"

import type { RailF } from "./features.ts"
import type { V } from "./geometry.ts"
import { HEADING_SPAN, MAX_TURN, splitAtJunctions } from "./rail-graph.ts"

/**
 * A piece of a terminal's way beyond the play area has its cut this near the terminal (m) to carry
 * its track on, and its first vertices this near give way to the terminal: the line in play lies on
 * the CTR's surveyed track, beyond it on OSM's, and at Rometta's terminal the two are 0.7 m apart,
 * which over the 2.4 m to OSM's next node zig-zagged the track 17° (a curve of 86 m).
 */
const JOIN = 10

/** A terminal (end `end` of piece `piece` of the rail in play) and the pieces carrying its track on, each walked away from it, the first from the terminal itself. */
export interface Continuation {
  readonly piece: number
  readonly end: 0 | 1
  readonly chain: ReadonlyArray<RailF>
}

/** Unit direction from vertex 0 of `pts` into it, over HEADING_SPAN m. */
const into = (pts: ReadonlyArray<V>): readonly [number, number] => {
  const a = pts[0]!
  let k = 1
  while (k < pts.length - 1 && Math.hypot(pts[k]!.x - a.x, pts[k]!.y - a.y) < HEADING_SPAN) k++
  const dx = pts[k]!.x - a.x,
    dy = pts[k]!.y - a.y,
    d = Math.hypot(dx, dy) || 1
  return [dx / d, dy / d]
}

/** The turn (degrees) from running out of `pts` at its last vertex into `next` at its first. */
const turnOnto = (pts: ReadonlyArray<V>, next: ReadonlyArray<V>): number => {
  const [ox, oy] = into([...pts].reverse()),
    [lx, ly] = into(next)
  return (Ops.acos(Math.max(-1, Math.min(1, -(ox * lx + oy * ly)))) * 180) / Math.PI
}

/**
 * The track on past each terminal of `rail` (the running track in play, cut at the outline): each
 * end with no id where `onEdge` holds, carried on by the piece of `beyond` (OSM's rail beyond the play
 * area) of the same way whose own cut lies nearest it within JOIN m, from the terminal's point on to
 * its first vertex JOIN m from it, then at each end node the piece turning least, under MAX_TURN,
 * until none runs on. None for a terminal no such piece carries on.
 */
export const continuations = (
  rail: ReadonlyArray<RailF>,
  beyond: ReadonlyArray<RailF>,
  onEdge: (x: number, y: number) => boolean,
): Array<Continuation> => {
  const pieces = splitAtJunctions(beyond)
  // Each piece walked from either end: the end's vertex first.
  const walked = pieces.map((p) => [p.pts, [...p.pts].reverse()] as const)
  const atNode = new Map<string, Array<readonly [number, 0 | 1]>>()
  pieces.forEach((p, i) => {
    for (const end of [0, 1] as const) {
      const id = walked[i]![end][0]!.id
      if (id !== undefined) atNode.set(id, [...(atNode.get(id) ?? []), [i, end]])
    }
  })
  return rail.flatMap((r, piece) =>
    ([0, 1] as const).flatMap((end): Array<Continuation> => {
      const t = end === 0 ? r.pts[0]! : r.pts.at(-1)!
      if (t.id !== undefined || !onEdge(t.x, t.y)) return []
      let near = JOIN,
        from: readonly [number, 0 | 1] | undefined
      pieces.forEach((p, i) => {
        if (p.id !== r.id) return
        for (const e of [0, 1] as const) {
          const c = walked[i]![e][0]!
          const d = Math.hypot(c.x - t.x, c.y - t.y)
          if (c.id === undefined && d < near) [near, from] = [d, [i, e]]
        }
      })
      if (from === undefined) return []
      const used = new Set([from[0]])
      const chain: Array<RailF> = []
      for (let at: readonly [number, 0 | 1] | undefined = from; at !== undefined;) {
        const [i, e]: readonly [number, 0 | 1] = at
        const run: ReadonlyArray<V> = walked[i]![e]
        // From the terminal on to the first vertex JOIN m from it (or the piece's end node).
        const pts: ReadonlyArray<V> =
          chain.length === 0
            ? [
                { x: t.x, y: t.y },
                ...run.filter(
                  (v, k) =>
                    k === run.length - 1 || (k > 0 && Math.hypot(v.x - t.x, v.y - t.y) >= JOIN),
                ),
              ]
            : run
        chain.push({ ...pieces[i]!, pts })
        const node: string | undefined = pts.at(-1)!.id
        let next: readonly [number, 0 | 1] | undefined,
          least = MAX_TURN
        for (const [j, f] of node === undefined ? [] : atNode.get(node)!) {
          if (used.has(j)) continue
          const turn = turnOnto(pts, walked[j]![f])
          if (turn < least) [least, next] = [turn, [j, f]]
        }
        if (next !== undefined) used.add(next[0])
        at = next
      }
      return [{ piece, end, chain }]
    }),
  )
}

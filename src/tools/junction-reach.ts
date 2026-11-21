import type { Linear } from "./chains.ts"
// Where a junction may stand when a chain's fit sets it, so that the roads linking it to junctions
// already set keep their grade. A link fitted after both its ends were set is the straight line
// between them, however steep: the road fitted round a hill east of Collegnago left its junction
// 3.3 m over the ground, and the 12 m unclassified link from there to the junction an earlier fit
// set climbed 53% where the ground between them climbs 18%.
import { arcLengths } from "./geometry.ts"

/** A level a road's fit keeps at arc length `s` along it, under (`max`) or over (`min`). */
export interface Limit {
  readonly s: number
  readonly z: number
  readonly kind: "min" | "max"
}

/**
 * A road piece the profiles fit, and the steepest grade its fit draws: its pass's `relax` times its
 * class's limit; and the levels its fit keeps (`limits`, read when a junction asks: a rail bridge's
 * clearance over it).
 */
export interface Graded {
  readonly piece: Linear
  readonly grade: number
  readonly limits?: () => ReadonlyArray<Limit>
}

/** Where a node id lies: on which link, at which vertex. */
interface At {
  readonly link: number
  readonly i: number
}

/**
 * The least and most z a junction may take: within reach of each junction already set (`zOf`) that
 * a link not yet fitted (`open`) leads to, along it and on through the joints where it alone runs
 * on. The reach is the link's steepest grade over the way there, or the ground's own climb between
 * the two where that is steeper (an old lane straight up a village's hillside). So too of each level
 * such a link keeps on the way there (`limits`), at its grade: the Pontremolese's bridge 617064928
 * by Vezzano Ligure kept the primary 1295717964 5.5 m under it, but the junction 3.4 m from it,
 * set at 22.0 m by the primary fitted before it, held the road 2.27 m under the deck. Cones that
 * miss each other give the span between them, as near both as the junction can stand.
 */
export const junctionReach = (
  links: ReadonlyArray<Graded>,
  ground: (x: number, y: number) => number,
) => {
  const at = new Map<string, Array<At>>()
  const arcs = links.map(({ piece }) => arcLengths(piece.pts))
  links.forEach(({ piece }, link) =>
    piece.pts.forEach((v, i) => {
      if (v.id === undefined) return
      const list = at.get(v.id)
      if (list === undefined) at.set(v.id, [{ link, i }])
      else list.push({ link, i })
    }),
  )
  return (
    id: string,
    zOf: (id: string) => number | undefined,
    open: (l: Linear) => boolean,
  ): readonly [number, number] | undefined => {
    const here = at.get(id)
    if (here === undefined) return undefined
    const { x, y } = links[here[0]!.link]!.piece.pts[here[0]!.i]!
    let lo = -Infinity,
      hi = Infinity
    for (const start of here)
      for (const step of [-1, 1]) {
        if (!open(links[start.link]!.piece)) continue
        let { link, i } = start,
          dir = step,
          cost = 0
        const seen = new Set([link])
        for (;;) {
          const pts = links[link]!.piece.pts
          if (i + dir < 0 || i + dir >= pts.length) {
            // A link's end: run on into the one other link ending there, if no other road meets it.
            const joint = pts[i]!.id === undefined ? undefined : at.get(pts[i]!.id!)
            const next = joint?.length === 2 ? joint.find((o) => o.link !== link) : undefined
            if (next === undefined || seen.has(next.link) || !open(links[next.link]!.piece)) break
            const n = links[next.link]!.piece.pts.length
            if (next.i !== 0 && next.i !== n - 1) break
            ;({ link, i } = next)
            dir = i === 0 ? 1 : -1
            seen.add(link)
            continue
          }
          const from = arcs[link]![i]!,
            to = arcs[link]![i + dir]!
          for (const l of links[link]!.limits?.() ?? [])
            if ((l.s - from) * (l.s - to) <= 0) {
              const r = cost + links[link]!.grade * Math.abs(l.s - from)
              if (l.kind === "max") hi = Math.min(hi, l.z + r)
              else lo = Math.max(lo, l.z - r)
            }
          cost += links[link]!.grade * Math.abs(to - from)
          i += dir
          const w = pts[i]!,
            z = w.id === undefined ? undefined : zOf(w.id)
          if (z === undefined) continue
          const r = Math.max(cost, Math.abs(ground(x, y) - ground(w.x, w.y)))
          lo = Math.max(lo, z - r)
          hi = Math.min(hi, z + r)
          break
        }
      }
    if (lo === -Infinity && hi === Infinity) return undefined
    return [Math.min(lo, hi), Math.max(lo, hi)]
  }
}

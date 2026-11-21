// The pieces a profile is fitted along: roads, tracks and paths, chained through the nodes where
// two of their ends meet, and the nodes inside a bore or on a deck.
import { Ops } from "@typeonce/ritmo-math"

import { arcLengths, type V } from "./geometry.ts"
import { headingOut } from "./rail-graph.ts"

/** A piece of a line: its vertices, and whether it is a bridge or a tunnel. */
export interface Linear {
  readonly pts: ReadonlyArray<V>
  readonly bridge?: true
  readonly tunnel?: true
}
/** Whether a piece stands off the ground: a bridge or a tunnel. */
export const lifted = (l: Linear): boolean => l.bridge === true || l.tunnel === true

/** A chain member; `rev` = walked from its last vertex to its first. */
export interface Link<T> {
  readonly item: T
  readonly rev: boolean
}

/** The unit heading out of node `id` along piece `t` (from its end there), over `span` m into it. */
const leaving = (t: Linear, id: string, span: number): readonly [number, number] => {
  const p = t.pts[0]!.id === id ? t.pts : [...t.pts].reverse()
  return headingOut(p.length, (k) => [p[k]!.x, p[k]!.y], span)
}

/**
 * Pieces joined into chains through nodes where exactly two piece ends meet; longest chain first.
 * With `through` (the rail's), a node where three or more ends meet (a switch, a crossing) joins its
 * ends in pairs too, the two leaving it most nearly opposite first, each pair turning `through.turn`
 * degrees or less (headings over `through.span` m): a track runs on through its switches as one
 * chain, and only the track that diverges ends there.
 */
export const chainsOf = <T extends Linear>(
  items: ReadonlyArray<T>,
  through?: { readonly turn: number; readonly span: number },
): Array<Array<Link<T>>> => {
  const ends = new Map<string, Array<number>>()
  items.forEach((t, i) => {
    for (const v of [t.pts[0]!, t.pts.at(-1)!])
      if (v.id !== undefined) ends.set(v.id, [...(ends.get(v.id) ?? []), i])
  })
  // The piece each piece's end at a node runs on into, by node then piece.
  const pairs = new Map<string, Map<number, number>>()
  for (const [id, list] of ends) {
    const paired = new Map<number, number>()
    if (list.length === 2) paired.set(list[0]!, list[1]!).set(list[1]!, list[0]!)
    else if (through !== undefined && list.length > 2) {
      const least = -Ops.cos((through.turn * Math.PI) / 180)
      const heads = list.map((i) => leaving(items[i]!, id, through.span))
      const options: Array<readonly [number, number, number]> = []
      for (let a = 0; a < list.length; a++)
        for (let b = a + 1; b < list.length; b++) {
          if (list[a] === list[b]) continue
          const dot = heads[a]![0] * heads[b]![0] + heads[a]![1] * heads[b]![1]
          if (dot <= least) options.push([dot, a, b])
        }
      options.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])
      for (const [, a, b] of options)
        if (!paired.has(list[a]!) && !paired.has(list[b]!))
          paired.set(list[a]!, list[b]!).set(list[b]!, list[a]!)
    }
    pairs.set(id, paired)
  }
  const onFrom = (id: string | undefined, i: number) =>
    id === undefined ? undefined : pairs.get(id)?.get(i)
  const used = new Uint8Array(items.length)
  const walk = (start: number, rev: boolean): Array<Link<T>> => {
    const chain: Array<Link<T>> = []
    for (let i = start, r = rev; ;) {
      used[i] = 1
      chain.push({ item: items[i]!, rev: r })
      const tail = r ? items[i]!.pts[0]!.id : items[i]!.pts.at(-1)!.id
      const j = onFrom(tail, i)
      if (j === undefined || used[j] === 1) return chain
      r = items[j]!.pts[0]!.id !== tail
      i = j
    }
  }
  const chains: Array<Array<Link<T>>> = []
  items.forEach((t, i) => {
    if (used[i] === 1) return
    if (onFrom(t.pts[0]!.id, i) === undefined) chains.push(walk(i, false))
    else if (onFrom(t.pts.at(-1)!.id, i) === undefined) chains.push(walk(i, true))
  })
  items.forEach((_, i) => {
    if (used[i] === 0) chains.push(walk(i, false)) // closed loops
  })
  const length = (c: ReadonlyArray<Link<T>>) =>
    c.reduce((s, { item }) => s + arcLengths(item.pts).at(-1)!, 0)
  return chains
    .map((c) => [c, length(c)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
}

/**
 * The nodes inside a bore or on a deck: a piece's end that only lifted pieces pass through (a switch
 * in a tunnel, a crossover's on a bridge, a dead end in a tunnel). `Spec.inside` reads them.
 */
export const insideNodes = (items: ReadonlyArray<Linear>): ReadonlySet<string> => {
  const all = new Map<string, boolean>(),
    ends = new Set<string>()
  for (const t of items) {
    for (const v of t.pts)
      if (v.id !== undefined) all.set(v.id, (all.get(v.id) ?? true) && lifted(t))
    for (const v of [t.pts[0]!, t.pts.at(-1)!]) if (v.id !== undefined) ends.add(v.id)
  }
  return new Set([...ends].filter((id) => all.get(id) === true))
}

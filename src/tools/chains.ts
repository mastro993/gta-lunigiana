// The pieces a profile is fitted along: roads, tracks and paths, chained through the nodes where
// two of their ends meet, and the nodes inside a bore or on a deck.
import { arcLengths, type V } from "./geometry.ts"

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

/** Pieces joined into chains through nodes where exactly two piece ends meet; longest chain first. */
export const chainsOf = <T extends Linear>(items: ReadonlyArray<T>): Array<Array<Link<T>>> => {
  const ends = new Map<string, Array<number>>()
  items.forEach((t, i) => {
    for (const v of [t.pts[0]!, t.pts.at(-1)!])
      if (v.id !== undefined) ends.set(v.id, [...(ends.get(v.id) ?? []), i])
  })
  const through = (id: string | undefined) => id !== undefined && ends.get(id)!.length === 2
  const used = new Uint8Array(items.length)
  const walk = (start: number, rev: boolean): Array<Link<T>> => {
    const chain: Array<Link<T>> = []
    for (let i = start, r = rev; ;) {
      used[i] = 1
      chain.push({ item: items[i]!, rev: r })
      const tail = r ? items[i]!.pts[0]!.id : items[i]!.pts.at(-1)!.id
      const j = through(tail) ? ends.get(tail!)!.find((n) => n !== i) : undefined
      if (j === undefined || used[j] === 1) return chain
      r = items[j]!.pts[0]!.id !== tail
      i = j
    }
  }
  const chains: Array<Array<Link<T>>> = []
  items.forEach((t, i) => {
    if (used[i] === 1) return
    if (!through(t.pts[0]!.id)) chains.push(walk(i, false))
    else if (!through(t.pts.at(-1)!.id)) chains.push(walk(i, true))
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

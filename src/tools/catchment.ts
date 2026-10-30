// Upstream catchment areas for the map build: the 4 m grid with the water burned in, filled
// (priority-flood + epsilon, Barnes et al. 2014), routed D8 and accumulated, read at every sample
// of each water profile.
import type { Grid, Profile } from "./terrain.ts"

/** How far (m) the water's samples are burned under the terrain, so D8 follows the mapped water, not the 4 m grid's guess. */
const BURN = 100
/** Rise (m) a filled flat gains per node, so every node drains to a lower neighbour. */
const EPSILON = 1e-4

/** A binary min-heap of node indices keyed by elevation. */
const heap = (z: Float64Array) => {
  const items: Array<number> = []
  const less = (a: number, b: number) => z[items[a]!]! < z[items[b]!]!
  const swap = (a: number, b: number) => {
    const t = items[a]!
    items[a] = items[b]!
    items[b] = t
  }
  return {
    get size() {
      return items.length
    },
    push(n: number) {
      items.push(n)
      for (let k = items.length - 1; k > 0;) {
        const up = (k - 1) >> 1
        if (!less(k, up)) break
        swap(k, up)
        k = up
      }
    },
    pop(): number {
      const top = items[0]!,
        last = items.pop()!
      if (items.length > 0) {
        items[0] = last
        for (let k = 0; ;) {
          const l = 2 * k + 1,
            r = l + 1
          let m = k
          if (l < items.length && less(l, m)) m = l
          if (r < items.length && less(r, m)) m = r
          if (m === k) break
          swap(k, m)
          k = m
        }
      }
      return top
    },
  }
}

/**
 * Upstream area (km²) at every sample of each profile in `wp`, from grid `g` before carving; `ids`
 * holds each profile's OSM vertex ids, where pieces meet. The
 * water is burned in BURN m under its own profile, the grid filled so every node drains (its edge
 * the outlet), each node routed to its steepest lower neighbour (D8) and the 4 m cells accumulated
 * downstream. Area flowing in from beyond the grid is not counted.
 */
export const catchments = (
  g: Grid,
  wp: ReadonlyArray<Profile>,
  ids: ReadonlyArray<ReadonlyArray<string | undefined>>,
): Array<Float64Array> => {
  const { cols, rows, cell } = g
  const z = Float64Array.from(g.z)
  const nodeOf = (x: number, y: number) =>
    Math.min(rows - 1, Math.max(0, Math.round((y - g.y0) / cell))) * cols +
    Math.min(cols - 1, Math.max(0, Math.round((x - g.x0) / cell)))
  // Which water burned each node (-1 none, -2 more than one: where waters meet).
  const owner = new Int32Array(cols * rows).fill(-1)
  wp.forEach((p, w) => {
    for (let k = 0; k < p.z.length; k++) {
      const n = nodeOf(p.x[k]!, p.y[k]!)
      z[n] = Math.min(z[n]!, p.z[k]! - BURN)
      owner[n] = owner[n] === -1 || owner[n] === w ? w : -2
    }
  })
  // Priority-flood from the edge: a node first reached from a lower one is raised just above it.
  const seen = new Uint8Array(cols * rows)
  const open = heap(z)
  for (let n = 0; n < cols * rows; n++) {
    const i = n % cols,
      j = (n - i) / cols
    if (i > 0 && j > 0 && i < cols - 1 && j < rows - 1) continue
    seen[n] = 1
    open.push(n)
  }
  while (open.size > 0) {
    const n = open.pop(),
      i = n % cols,
      j = (n - i) / cols
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const a = i + di,
          b = j + dj
        if (a < 0 || b < 0 || a >= cols || b >= rows) continue
        const m = b * cols + a
        if (seen[m] === 1) continue
        seen[m] = 1
        if (z[m]! <= z[n]!) z[m] = z[n]! + EPSILON
        open.push(m)
      }
  }
  // D8: each inner node drains to its steepest lower neighbour; edge nodes leave the grid.
  const to = new Int32Array(cols * rows).fill(-1),
    inflow = new Int32Array(cols * rows)
  for (let j = 1; j < rows - 1; j++)
    for (let i = 1; i < cols - 1; i++) {
      const n = j * cols + i
      let best = 0
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue
          const m = n + dj * cols + di,
            drop = (z[n]! - z[m]!) / (di !== 0 && dj !== 0 ? Math.SQRT2 : 1)
          if (drop > best) [best, to[n]] = [drop, m]
        }
      if (to[n]! >= 0) inflow[to[n]!]!++
    }
  // Accumulate from the ridges down (Kahn's order: a node once everything above it is counted).
  const area = new Float64Array(cols * rows).fill((cell * cell) / 1e6)
  const ready: Array<number> = []
  for (let n = 0; n < area.length; n++) if (inflow[n] === 0) ready.push(n)
  while (ready.length > 0) {
    const n = ready.pop()!,
      m = to[n]!
    if (m < 0) continue
    area[m] = area[m]! + area[n]!
    if (--inflow[m]! === 0) ready.push(m)
  }
  // Near another water D8 may route its flow through this one's nodes (a tail running beside the
  // river it joins): only nodes clear of every other water by two nodes count.
  const clear = (n: number, w: number): boolean => {
    const ci = n % cols,
      cj = (n - ci) / cols
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const i = ci + di,
          j = cj + dj
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue
        const o = owner[j * cols + i]!
        if (o !== -1 && o !== w) return false
      }
    return true
  }
  // Each piece starts with what the pieces ending where it begins bring (a confluence adds them up, a
  // fork shares them among its arms),
  // then reads the most its own clear burned nodes around each sample gather (D8 may cut a bend's
  // corner past a sample's node), never less than upstream; the last sample keeps what came down to
  // it (a confluence is the receiving water's).
  const out: Array<Float64Array | undefined> = wp.map(() => undefined)
  // The pieces ending at each node (not a loop on it), in order, and how many start there.
  const endAt = new Map<string, Array<number>>(),
    starts = new Map<string, number>()
  ids.forEach((v, u) => {
    const a = v[0],
      b = v.at(-1)
    if (b !== undefined && a !== b) endAt.set(b, [...(endAt.get(b) ?? []), u])
    if (a !== undefined) starts.set(a, (starts.get(a) ?? 0) + 1)
  })
  const solve = (w: number): Float64Array => {
    const known = out[w]
    if (known !== undefined) return known
    const p = wp[w]!,
      start = ids[w]![0]
    const result = new Float64Array(p.x.length)
    out[w] = result // a loop of pieces reads zeros rather than recursing for ever
    // What comes down to its start, shared among the arms that leave it (a braid's rejoin adds them up again).
    let carried = 0
    if (start !== undefined) {
      for (const u of endAt.get(start) ?? []) if (u !== w) carried += solve(u).at(-1)!
      carried /= starts.get(start)!
    }
    for (let k = 0; k < p.x.length; k++) {
      let most = k > 0 ? result[k - 1]! : carried
      if (k === 0 || k < p.x.length - 1) {
        const c = nodeOf(p.x[k]!, p.y[k]!),
          ci = c % cols,
          cj = (c - ci) / cols
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const i = ci + di,
              j = cj + dj
            if (i < 0 || j < 0 || i >= cols || j >= rows) continue
            const n = j * cols + i
            if (owner[n] === w && clear(n, w)) most = Math.max(most, area[n]!)
          }
      }
      result[k] = most
    }
    return result
  }
  return wp.map((_, w) => solve(w))
}

// The step across a terrain-source seam, for the fill chain's tests on a synthetic mosaic
// (fill-chain.test.ts) and for the fetched terrains on the build's own grid
// (terrain-seams.map-test.ts). A step is how far the height difference across the seam lies
// outside the range of the differences beside it: a slope, a kink at the seam or a cliff on one
// side gives 0, a ledge of h gives h, up or down.

/**
 * The steepest step over every seam of a `cols` × `rows` grid of heights `z` and sources `src`,
 * against the one difference either side (a' → a and b → b', each within its own source), with
 * the cells it lies between: for a smooth synthetic terrain. A height that is not a number makes
 * an infinite step.
 */
export const largestStep = (
  cols: number,
  rows: number,
  z: ArrayLike<number>,
  src: ArrayLike<number>,
): { step: number; a: number; b: number; seams: number } => {
  let worst = { step: -Infinity, a: -1, b: -1 },
    seams = 0
  const check = (a0: number, a: number, b: number, b1: number) => {
    if (src[a] === src[b] || src[a0] !== src[a] || src[b1] !== src[b]) return
    seams++
    const u = z[a]! - z[a0]!,
      v = z[b1]! - z[b]!,
      across = z[b]! - z[a]!
    const step = Math.max(across - Math.max(u, v), Math.min(u, v) - across)
    if (Number.isNaN(step) || step > worst.step)
      worst = { step: Number.isNaN(step) ? Infinity : step, a, b }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 1; c + 2 < cols; c++) {
      const k = r * cols + c
      check(k - 1, k, k + 1, k + 2)
    }
  for (let r = 1; r + 2 < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c
      check(k - cols, k, k + cols, k + 2 * cols)
    }
  return { ...worst, seams }
}

/** Differences each side of a pair that bound its step, along its line: up to 3 nodes, 12 m on the 4 m grid. */
const ALONG = 3
/** How far round a seam the terrain's own steps excuse its step, in nodes: 5, 20 m on the 4 m grid. */
const ROUND = 5

/** A seam's step and what the terrain round it allows. */
interface SeamStep {
  /** The two sources, in the order of their names. */
  readonly pair: string
  /** The node before the seam, k = row × cols + col. */
  readonly at: number
  readonly step: number
  /** The step less the largest step within one source within ROUND nodes of it. */
  readonly excess: number
}

/**
 * Every seam of a rough terrain (`z` on a `cols` × `rows` grid, each node's source `src`), with its
 * step and how far it passes the terrain's own. Rough ground has steps of its own wherever a
 * gully or a ledge of rock runs: so a pair's step is bounded by the differences up to ALONG nodes
 * either side on its own line and the lines beside it, each between two nodes of the source on its
 * side, and a seam's step is judged against the steps of node pairs within one source within
 * ROUND nodes of it: a seam the fill left as a ledge passes them, a gully the LiDAR ends against
 * the smoother fill does not. A height that is not a number makes an infinite step.
 */
export const seamSteps = (
  cols: number,
  rows: number,
  z: ArrayLike<number>,
  src: ReadonlyArray<string>,
): Array<SeamStep> => {
  const inside = new Float64Array(cols * rows),
    seams: Array<{ pair: string; at: number; step: number }> = []
  /**
   * The step between node a and node a + d (d 1 east or cols north), or undefined when the node
   * before a or the one after a + d is of another source than its neighbour, so no difference
   * either side bounds it.
   */
  const stepAt = (a: number, d: number): number | undefined => {
    const b = a + d,
      side = d === 1 ? cols : 1
    if (src[a - d] !== src[a] || src[b + d] !== src[b]) return undefined
    let lo = Infinity,
      hi = -Infinity
    const c = a % cols
    for (const o of [-side, 0, side]) {
      // A line beside a north-south one wraps past the grid's west or east edge.
      if (d === cols && ((o === -1 && c === 0) || (o === 1 && c === cols - 1))) continue
      for (let i = 0; i < ALONG; i++) {
        for (const [p, q, s] of [
          [a - (i + 1) * d + o, a - i * d + o, src[a]],
          [b + i * d + o, b + (i + 1) * d + o, src[b]],
        ] as const)
          if (p >= 0 && q < z.length && src[p] === s && src[q] === s) {
            lo = Math.min(lo, z[q]! - z[p]!)
            hi = Math.max(hi, z[q]! - z[p]!)
          }
      }
    }
    const across = z[b]! - z[a]!,
      step = Math.max(across - hi, lo - across, 0)
    return Number.isNaN(step) ? Infinity : step
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * cols + c
      for (const [d, fits] of [
        [1, c >= ALONG && c + ALONG + 1 < cols],
        [cols, r >= ALONG && r + ALONG + 1 < rows],
      ] as const) {
        if (!fits) continue
        const step = stepAt(a, d)
        if (step === undefined) continue
        if (src[a] === src[a + d]) inside[a] = Math.max(inside[a]!, step)
        else seams.push({ pair: [src[a]!, src[a + d]!].sort().join("-"), at: a, step })
      }
    }
  return seams.map(({ pair, at, step }) => {
    const c = at % cols,
      r = (at - c) / cols
    let round = 0
    for (let j = Math.max(0, r - ROUND); j <= Math.min(rows - 1, r + ROUND); j++)
      for (let i = Math.max(0, c - ROUND); i <= Math.min(cols - 1, c + ROUND); i++)
        round = Math.max(round, inside[j * cols + i]!)
    return { pair, at, step, excess: step - round }
  })
}

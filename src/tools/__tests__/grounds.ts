// Two grounds round one anchor, for the tests that check a height keeps its bits when a region's
// box grows (dtm.test.ts, terrain.test.ts), and points to sample them at.

/** The anchor both grounds share. */
const anchor = { x: -400, y: -300 }
/** The ground of a 2 m DTM of 400 × 300 cells round local (0, 0): the DTM's own box. */
export const first = { bounds: { minX: -400, minY: -300, maxX: 400, maxY: 300 }, anchor }
/** `first` grown 2 km west and south, as a part beyond the first would grow it. */
export const grown = { bounds: { minX: -2400, minY: -2300, maxX: 400, maxY: 300 }, anchor }

/** `n` points in the first box, off the lattices (a fixed pseudo-random walk). */
export const points = (n: number): Array<readonly [number, number]> => {
  let seed = 7
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  return Array.from({ length: n }, () => [-399 + 798 * next(), -299 + 598 * next()] as const)
}

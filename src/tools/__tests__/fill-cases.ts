// Synthetic mosaics for the fill chain's tests (fill-chain.test.ts, fill-chain.long-test.ts): a
// tilted LiDAR with a square hole in its middle, and a filler that is the same plane with a smooth
// error on top, as the 10 m DTM is beside the LiDAR.

import { type Filler, type Mosaic, NONE } from "../fill-chain.ts"

/** The LiDAR's plane, dm at cell (col, row): 0.3 m a metre east and 0.1 m north from 500 m. */
export const plane = (c: number, r: number): number => 5000 + 3 * c + r

/** The filler's error, dm: 25 m off, bending by ±5 m over a few hundred metres. */
export const error = (c: number, r: number): number =>
  250 + 50 * Math.sin(c / 600) * Math.cos(r / 800)

/**
 * A `side` m square crop of `lidar` heights (the plane unless given) with a `hole` m square hole in
 * its middle, the rest LiDAR (source 0).
 */
export const holed = (
  side: number,
  hole: number,
  lidar: (c: number, r: number) => number = plane,
): Mosaic => {
  const dm = new Float32Array(side * side),
    src = new Uint8Array(side * side)
  const lo = Math.floor((side - hole) / 2),
    hi = lo + hole
  for (let r = 0; r < side; r++)
    for (let c = 0; c < side; c++) {
      const k = r * side + c
      const inHole = c >= lo && c < hi && r >= lo && r < hi
      dm[k] = inHole ? Number.NaN : lidar(c, r)
      src[k] = inHole ? NONE : 0
    }
  return { cols: side, rows: side, dm, src }
}

/** A filler (source 1 unless given): the plane with `error` on top, everywhere. */
export const tenMetre = (source = 1): Filler => ({
  source,
  at: (c, r) => plane(c, r) + error(c, r),
})

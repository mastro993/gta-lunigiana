// The sea's floor (issue #13): how deep the sea lies at a point, from its distance to OSM's coastline
// (`coastIndex` in coast.ts, its islets' too). An 8 % beach face down to 0.6 m, then the shelf off
// Marinella the issue fits to EMODnet's depth samples (1 m at 450 m, 8 m at 1.1 km, 13 m at 2.2 km,
// 17 m at 7.8 km; constants only), whichever is deeper. The tile pass carves every node in the sea
// to it (`carveAreas`), node by node, so tiles meet. Only + − × ÷ and sqrt, so every architecture
// builds the same floor (`map-key.test.ts`).
import type { CoastIndex } from "./coast.ts"

/** The shelf's depth (m) by distance from the coastline (m), linear between its points and level past the last. */
const SHELF: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [450, 1],
  [1100, 8],
  [2200, 13],
  [7800, 17],
]
/** The beach's face falls this many metres a metre out from the waterline … */
const FACE = 0.08
/** … down to this deep, m. */
const FACE_DEPTH = 0.6

/** The shelf's depth (m) at `d` m from the coastline. */
const shelf = (d: number): number => {
  for (let k = 1; k < SHELF.length; k++) {
    const [d1, z1] = SHELF[k]!
    if (d <= d1) {
      const [d0, z0] = SHELF[k - 1]!
      return z0 + ((z1 - z0) * (d - d0)) / (d1 - d0)
    }
  }
  return SHELF.at(-1)![1]
}

/**
 * The sea's floor (m a.s.l., under 0) at a point, from `coast`: the beach's face or the shelf
 * there, whichever is deeper, at its distance from the nearest coastline (capped where the shelf
 * levels off). The one place the sea's depth is decided: a survey's isobaths would replace it.
 */
export const seaFloor =
  (coast: CoastIndex) =>
  (x: number, y: number): number => {
    const d = coast.distance(x, y, SHELF.at(-1)![0])
    return -Math.max(Math.min(FACE * d, FACE_DEPTH), shelf(d))
  }

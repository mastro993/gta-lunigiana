/**
 * Where the map lies, for the sky: its origin's latitude and longitude, its low ground and which way
 * its ground falls. The map module works it out once it decodes the map and hands it over
 * (`providePlace`, as the host hands the map file to `provideMap`); the sky reads it through `place()`
 * and so decodes no map. A page or a test that loads no map gets the reference site, the shipped map's
 * own place. Per-load map content, not game state: it never changes while a map is loaded.
 *
 * @module place
 */
import { Ops } from "@typeonce/ritmo-math"

/** The map's place: origin (degrees north and east), low ground (m a.s.l.) and the way its ground falls (rad, counter-clockwise from east). */
export interface Place {
  /** The map's origin, degrees: the sun, the moon and the latitude's climate are worked out for it. */
  readonly lat: number
  readonly lon: number
  /** The map's low ground, m a.s.l.: the 5th percentile of its heights. Fog, cloud base, wind exposure and drying air count from it. */
  readonly floor: number
  /** The way the ground falls across the map (steepest descent of a plane fitted to its heights): the night's breeze, the day's the other way. */
  readonly downslope: number
}

/** The reference site, the shipped map's place (Monzone, 44.16175 N, 10.13 E): what a page or test that loads no map uses. */
export const REFERENCE_PLACE: Place = { lat: 44.16175, lon: 10.13, floor: 162, downslope: 2.92 }

/** The place the map module handed over, else the reference site. */
let current: Place = REFERENCE_PLACE

/** Hands over the loaded map's place; the map module calls it once it has decoded the map. */
export const providePlace = (where: Place): void => {
  current = where
}

/** The loaded map's place (the reference site when no map is loaded). */
export const place = (): Place => current

/** A heightmap as the map holds it: `cols` × `rows` nodes `cell` m apart, row-major from the south-west, in whole decimetres. */
interface Heights {
  readonly cell: number
  readonly cols: number
  readonly rows: number
  readonly data: ArrayLike<number>
}

/**
 * The place of a map with origin `origin` and heights `heights`: its 5th-percentile height and the
 * way a plane fitted to its heights falls, over the nodes `listed` holds (1; every node without it).
 * A map's are those its listed tiles hold (`listedNodes` in src/tools/grid-tiles.ts): an L's notch
 * has no ground of its own.
 */
export const placeFrom = (
  origin: { readonly lat: number; readonly lon: number },
  heights: Heights,
  listed?: ArrayLike<number>,
): Place => {
  const { cell, cols, rows, data } = heights
  const held = (k: number) => listed === undefined || listed[k] === 1
  let low = Number.MAX_SAFE_INTEGER,
    high = -Number.MAX_SAFE_INTEGER,
    n = 0
  for (let k = 0; k < data.length; k++)
    if (held(k)) [low, high, n] = [Math.min(low, data[k]!), Math.max(high, data[k]!), n + 1]
  // Decimetres are whole numbers: count them, then walk up to the 5th percentile.
  const counts = new Uint32Array(high - low + 1)
  let sx = 0,
    sy = 0,
    sz = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sxz = 0,
    syz = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!held(j * cols + i)) continue
      const z = data[j * cols + i]!,
        x = i * cell,
        y = j * cell
      counts[z - low]!++
      sx += x
      sy += y
      sz += z
      sxx += x * x
      syy += y * y
      sxy += x * y
      sxz += x * z
      syz += y * z
    }
  }
  const rank = Math.floor(0.05 * (n - 1))
  let floor = low,
    seen = counts[0]!
  while (seen <= rank) seen += counts[++floor - low]!
  // Least squares z = a + b·x + c·y: (b, c) points uphill.
  const mx = sx / n,
    my = sy / n,
    mz = sz / n
  const cxx = sxx / n - mx * mx,
    cyy = syy / n - my * my,
    cxy = sxy / n - mx * my,
    cxz = sxz / n - mx * mz,
    cyz = syz / n - my * mz
  const det = cxx * cyy - cxy * cxy,
    b = (cxz * cyy - cyz * cxy) / det,
    c = (cyz * cxx - cxz * cxy) / det
  return {
    lat: origin.lat,
    lon: origin.lon,
    floor: floor / 10,
    downslope: det === 0 ? 0 : Ops.atan2(-c, -b),
  }
}

// Synthetic Overpass answers in the shape footprint-check caches (`OsmCache`), laid out in local
// metres so a test reads where each place, building and road lies: round lucido (region.ts's
// part), and round the parts made here, two rectangles side by side and a masked part.

import type { OsmCache, OsmElement } from "../footprint-report.ts"
import { type P, fromLocal } from "../geometry.ts"
import type { Part, Rect } from "../region.ts"

const latLon = ([x, y]: P) => {
  const [lat, lon] = fromLocal(x, y)
  return { lat, lon }
}
/** A place node at local `at`. */
export const place = (id: number, at: P, kind: string, name?: string): OsmElement => ({
  type: "node",
  id,
  ...latLon(at),
  tags: name === undefined ? { place: kind } : { place: kind, name },
})
/** `n` building centres, ids from `id`, from `from` on in steps of `step`. */
const buildings = (id: number, from: P, step: P, n: number): Array<OsmElement> =>
  Array.from({ length: n }, (_, k) => ({
    type: "way",
    id: id + k,
    center: latLon([from[0] + step[0] * k, from[1] + step[1] * k]),
  }))
/** A highway way through local `pts`. */
export const road = (
  id: number,
  highway: string,
  pts: ReadonlyArray<P>,
  tags: Readonly<Record<string, string>> = {},
): OsmElement => ({ type: "way", id, geometry: pts.map(latLon), tags: { highway, ...tags } })
/** The box footprint-check asks Overpass for: the rectangles' box + 1 km. */
export const queried = ([x0, y0, x1, y1]: Rect): Rect => [
  x0 - 1000,
  y0 - 1000,
  x1 + 1000,
  y1 + 1000,
]

/**
 * Round lucido's rectangle, x −2900…4900 by y −6100…3900: places within 300 m of its edges (one past
 * its north-east corner), a cluster across its east edge, one 200 m out of its west edge, two that
 * are not findings (far inside, and too small), a road of two ways out of its north edge and back,
 * a track out of its east edge and back, a footway out of its south edge and back, a road and a
 * path that run out to the queried box's edge, a dead end, and a road inside.
 */
export const LUCIDO_OSM: OsmCache = {
  box: queried([-2900, -6100, 4900, 3900]),
  elements: [
    place(101, [-2800, 0], "village", "Vinca"),
    place(102, [1000, 4050], "hamlet", "Casola"),
    place(103, [0, -1000], "town", "Monzone"),
    place(104, [5000, 4000], "locality"),
    place(105, [4700, -5900], "village", "Equi"),
    ...buildings(201, [4875, 1000], [10, 0], 6),
    ...buildings(211, [0, -3000], [10, 0], 5),
    ...buildings(221, [1000, -6050], [10, 0], 4),
    ...buildings(231, [-3100, 2000], [0, 10], 5),
    road(301, "residential", [
      [500, 3800],
      [500, 4000],
      [700, 4000],
    ]),
    road(
      302,
      "residential",
      [
        [700, 4000],
        [700, 3800],
      ],
      { name: "Via Uno" },
    ),
    road(303, "track", [
      [4800, -2000],
      [5100, -2000],
      [5100, -1800],
      [4800, -1800],
    ]),
    road(304, "footway", [
      [0, -6000],
      [0, -6200],
      [100, -6200],
      [100, -6000],
    ]),
    road(
      305,
      "secondary",
      [
        [-2800, -3000],
        [-3900, -3000],
      ],
      { ref: "SP10", name: "Via Ovest" },
    ),
    road(306, "path", [
      [4000, 3800],
      [4000, 4900],
    ]),
    road(307, "service", [
      [-1000, 3800],
      [-1000, 4200],
    ]),
    road(308, "primary", [
      [0, 0],
      [1000, 0],
    ]),
  ],
}

/** A part of `rects` keyed `key`, with `mask` when given. */
export const part = (
  key: string,
  rects: ReadonlyArray<Rect>,
  mask?: ReadonlyArray<number>,
): Part => ({
  key,
  title: key,
  rects,
  ...(mask === undefined ? {} : { mask }),
})

/** A 1 km square part. */
export const WEST = part("west", [[0, 0, 1000, 1000]])
/** A part beside `WEST`, along the south half of its east edge. */
export const EAST = part("east", [[1000, 0, 2000, 500]])

/**
 * Round `WEST`, judged beside `EAST`: places within 300 m of its edges and one in `EAST` farther,
 * a cluster beyond the open half of its east edge, a road out through the seam into `EAST` and
 * back, one out of its north edge and back, one through the seam and on past the queried box's
 * edge, and one out of its west edge to that edge.
 */
export const PAIR_OSM: OsmCache = {
  box: queried([0, 0, 1000, 1000]),
  elements: [
    place(401, [50, 500], "hamlet", "Alfa"),
    place(402, [1100, 800], "village", "Beta"),
    place(403, [1500, 250], "hamlet", "Gamma"),
    ...buildings(501, [1010, 900], [10, 0], 5),
    road(601, "residential", [
      [900, 200],
      [1300, 200],
      [1300, 300],
      [900, 300],
    ]),
    road(602, "unclassified", [
      [300, 900],
      [300, 1100],
      [400, 1100],
      [400, 900],
    ]),
    road(603, "unclassified", [
      [900, 400],
      [2100, 400],
    ]),
    road(604, "tertiary", [
      [100, 600],
      [-1000, 600],
    ]),
  ],
}

/**
 * A part whose mask cuts its 2 km square's north-east corner off along one slanted edge, from
 * (2000, 400) to (800, 2000), facing north-east at 53°.
 */
export const SLANT = part(
  "slant",
  [[0, 0, 2000, 2000]],
  [0, 0, 2000, 0, 2000, 400, 800, 2000, 0, 2000],
)
/** A part whose rectangle runs along `SLANT`'s mask's east edge, x 2000, from y 0 to 400. */
export const BESIDE = part("beside", [[2000, 0, 3000, 400]])

/**
 * Round `SLANT`, all inside its rectangle: a place 280 m beyond the slanted edge, a cluster across
 * it, 600 m from the rectangle's edges, and a road out across it and back.
 */
export const SLANT_OSM: OsmCache = {
  box: queried([0, 0, 2000, 2000]),
  elements: [
    place(701, [1600, 1400], "hamlet", "Delta"),
    // Across the slanted edge at its middle, (1400, 1200), along its outward normal (0.8, 0.6).
    ...buildings(801, [1380, 1185], [8, 6], 6),
    road(901, "residential", [
      [1300, 1000],
      [1700, 1300],
      [1500, 1500],
      [1100, 1300],
    ]),
  ],
}

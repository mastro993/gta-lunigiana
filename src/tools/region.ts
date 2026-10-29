// The parts of the map (issue #3): each a key, a title and its rectangles in local metres, on 100 m
// multiples. Today's map is part `lucido`. The part tools (`rt-index`, `pick-sheets`,
// `pick-lidar`, `coverage`, `footprint-check`) and `fetch-rt` take parts from here; issue #7 adds
// masks and the outline walls.

import { latLonToGaussBoaga } from "./crs.ts"
import { BOUNDS, fromLocal } from "./geometry.ts"

/** A rectangle [minX, minY, maxX, maxY] in local metres. */
export type Rect = readonly [number, number, number, number]

/** A part of the map: its key (the tools' argument), its title and its rectangles. */
export interface Part {
  readonly key: string
  readonly title: string
  readonly rects: ReadonlyArray<Rect>
}

/** Every part, in build order; `fetch-rt` reads one until issue #7 builds the map tile by tile. */
export const PARTS: ReadonlyArray<Part> = [
  {
    key: "lucido",
    title: "Valle del Lucido",
    rects: [[BOUNDS.minX, BOUNDS.minY, BOUNDS.maxX, BOUNDS.maxY]],
  },
]

/** The part with `key`; throws naming the known keys, so a tool run without one says what to pass. */
export const partOf = (key: string | undefined): Part => {
  const part = PARTS.find((p) => p.key === key)
  if (part === undefined)
    throw new Error(`unknown part ${key}: use one of ${PARTS.map((p) => p.key).join(", ")}`)
  return part
}

/** Whether local (x, y) lies in one of the rectangles. */
export const inRects = (rects: ReadonlyArray<Rect>, x: number, y: number): boolean =>
  rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)

/** The local box [minX, minY, maxX, maxY] round every rectangle. */
export const rectsBox = (rects: ReadonlyArray<Rect>): Rect => [
  Math.min(...rects.map((r) => r[0])),
  Math.min(...rects.map((r) => r[1])),
  Math.max(...rects.map((r) => r[2])),
  Math.max(...rects.map((r) => r[3])),
]

/**
 * The EPSG:3003 box [e0, n0, e1, n1] round every rectangle corner, widened by `pad` metres. The
 * local frame turns against Gauss-Boaga's grid, so the box holds more than the rectangles.
 */
export const gaussBoagaBox = (
  rects: ReadonlyArray<Rect>,
  pad = 0,
): [number, number, number, number] => {
  const corners = rects.flatMap(([x0, y0, x1, y1]) =>
    [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ].map(([x, y]) => latLonToGaussBoaga(...fromLocal(x!, y!))),
  )
  return [
    Math.min(...corners.map((c) => c[0])) - pad,
    Math.min(...corners.map((c) => c[1])) - pad,
    Math.max(...corners.map((c) => c[0])) + pad,
    Math.max(...corners.map((c) => c[1])) + pad,
  ]
}

// The maps the build makes and the parts of the Lunigiana one.
// - Regions: separately built play areas (Lunigiana, Cesena), never sharing survey inputs; the
//   build, `fetch-osm` and the geometry read the one `--region` names (REGION, Lunigiana by default).
// - Parts (issue #3): the Lunigiana map grows one part at a time, each a key, a title and its
//   rectangles in local metres, on 100 m multiples. Today's map is part `lucido`. The part tools
//   (`rt-index`, `pick-sheets`, `pick-lidar`, `coverage`, `footprint-check`) and `fetch-rt` take
//   parts from here; issue #7 adds masks and the outline walls.

import type { MapId } from "../maps.ts"

/** A separately built play area; survey inputs are never shared between regions. */
export interface Region {
  readonly id: MapId
  readonly file: string
  readonly origin: { readonly lat: number; readonly lon: number }
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
}

const LUNIGIANA: Region = {
  id: "lunigiana",
  file: "monzone",
  origin: { lat: 44.16175, lon: 10.13 },
  bounds: { minX: -2900, minY: -6100, maxX: 4900, maxY: 3900 },
}

const regions: ReadonlyArray<Region> = [
  LUNIGIANA,
  {
    id: "cesena",
    file: "cesena",
    origin: { lat: 44.1391, lon: 12.2429 },
    bounds: { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 },
  },
]

/** Selects a known region, defaulting to the original map; invalid input fails before I/O. */
export const regionFromArgs = (args: ReadonlyArray<string>): Region => {
  const index = args.indexOf("--region")
  const id = index < 0 ? "lunigiana" : args[index + 1]
  const region = regions.find((candidate) => candidate.id === id)
  if (region === undefined)
    throw new Error(`Unknown or missing region: ${id ?? "--region requires a name"}`)
  return region
}

/** Build region for this Node invocation, fixed before the geometry modules load. */
export const REGION = regionFromArgs(globalThis.process?.argv?.slice(2) ?? [])

/** A rectangle [minX, minY, maxX, maxY] in local metres. */
export type Rect = readonly [number, number, number, number]

/** A part of the Lunigiana map: its key (the tools' argument), its title and its rectangles. */
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
    rects: [
      [LUNIGIANA.bounds.minX, LUNIGIANA.bounds.minY, LUNIGIANA.bounds.maxX, LUNIGIANA.bounds.maxY],
    ],
  },
]

/**
 * The part with `key`; throws naming the known keys, so a tool run without one says what to pass,
 * and when the build region is not Lunigiana, whose local frame the parts' rectangles are in.
 */
export const partOf = (key: string | undefined): Part => {
  if (REGION.id !== LUNIGIANA.id)
    throw new Error(`parts belong to the Lunigiana map, not --region ${REGION.id}`)
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

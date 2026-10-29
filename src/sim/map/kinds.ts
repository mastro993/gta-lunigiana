/**
 * Map vocabulary shared by the build (src/tools) and the runtime map module:
 * where the map lies on the Earth, road classes, building styles, area kinds and the tree-trunk
 * wall size, and the 2 km tile grid the map files are cut on. Imports no data, so the build can use it
 * before the map exists. Game code imports
 * these through `./index.ts`; the sky (`src/sim/sky`) reads the loaded map's place through
 * `place()` (sky/place.ts) instead.
 *
 * @module map/kinds
 */

/** The map's origin, degrees (north, east): x and y count metres east and north of it. The build projects with it and writes it as `MAP.origin`. */
export const ORIGIN = { lat: 44.16175, lon: 10.13 } as const

/** Side of a map tile, m: tile (i, j) is the square x 2000i … 2000(i + 1), y 2000j … 2000(j + 1) on the local origin. */
export const TILE = 2000

/** A tile's key, `"i_j"`: its file is `<key>.bin`, and "map tile i_j not loaded" names it. */
export const tileKey = (i: number, j: number): string => `${i}_${j}`

/**
 * The tiles [i0, i1] × [j0, j1] whose squares hold the terrain nodes of a map spanning `bounds`
 * (its first and last nodes lie on the bounds): every tile with ground in it. A last node on a seam
 * (Cesena's bounds lie on them) is the shared border of the tile below the seam, not a tile of its own.
 */
export const tileRange = (bounds: {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}): { readonly i0: number; readonly i1: number; readonly j0: number; readonly j1: number } => ({
  i0: Math.floor(bounds.minX / TILE),
  i1: Math.ceil(bounds.maxX / TILE) - 1,
  j0: Math.floor(bounds.minY / TILE),
  j1: Math.ceil(bounds.maxY / TILE) - 1,
})

/**
 * Highway classes the build emits, widest first. The build folds OSM `primary` (the SR445) into
 * tertiary, `living_street` into residential, `footway` and `pedestrian` into path.
 */
export const ROAD_CLASSES = [
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "track",
  "path",
  "steps",
] as const
export type RoadClass = (typeof ROAD_CLASSES)[number]

const roadClasses: ReadonlySet<string> = new Set(ROAD_CLASSES)
/** Whether `cls` is one of ROAD_CLASSES. */
export const isRoadClass = (cls: string): cls is RoadClass => roadClasses.has(cls)

/**
 * Per class: carriageway width (m), whether it is asphalt when OSM names no surface, and who uses
 * it (AI traffic and the player's car, the player's car only, or only people on foot).
 */
export const ROADS = {
  tertiary: { w: 6.5, paved: true, use: "traffic" },
  unclassified: { w: 5, paved: true, use: "traffic" },
  residential: { w: 4.5, paved: true, use: "traffic" },
  service: { w: 3.5, paved: false, use: "traffic" },
  track: { w: 3, paved: false, use: "drive" },
  path: { w: 1.5, paved: false, use: "walk" },
  steps: { w: 2, paved: false, use: "walk" },
} as const satisfies Record<
  RoadClass,
  { readonly w: number; readonly paved: boolean; readonly use: "traffic" | "drive" | "walk" }
>

/** Whether the player can drive a road of this class (tracks included). */
export const isDrivable = (cls: string): boolean => isRoadClass(cls) && ROADS[cls].use !== "walk"

/** Whether AI traffic may use a road of this class (drivable minus tracks). */
export const isTraffic = (cls: string): boolean => isRoadClass(cls) && ROADS[cls].use === "traffic"

/**
 * How far from a road's centreline people walk, m, on either side: its verge, 0.8 m past the
 * carriageway's edge, or 0.3 m off the middle of paths, steps and tracks. A road's own `verge`
 * (the build's, where the verge would run beside the railway) overrides it.
 */
export const vergeOf = (cls: string, w: number): number =>
  cls === "path" || cls === "steps" || cls === "track" ? 0.3 : w / 2 + 0.8

/** The nominal traffic lane offset, m right of a road's centreline (drive on the right): a quarter of the width plus 0.2 m on roads 5 m wide or more, 0.5 m on narrower ones. */
export const laneOffset = (w: number): number => (w >= 5 ? w / 4 + 0.2 : 0.5)

/** Facade styles the build emits. */
export const BUILDING_STYLES = [
  "plaster",
  "stone",
  "church",
  "tower",
  "industrial",
  "station",
  "ruin",
] as const
export type BuildingStyle = (typeof BUILDING_STYLES)[number]

/** Land-use kinds the build emits. */
export const AREA_KINDS = [
  "forest",
  "cemetery",
  "pitch",
  "park",
  "parking",
  "vineyard",
  "farmland",
  "farmyard",
  "industrial",
  "residential",
  "platform",
  "school",
  "ruins",
  "grassland",
  "paved",
  "quarry",
  "rock",
  "sparse",
  "scree",
  "scrub",
] as const
export type AreaKind = (typeof AREA_KINDS)[number]

const areaKinds: ReadonlySet<string> = new Set(AREA_KINDS)
/** Whether `kind` is one of AREA_KINDS. */
export const isAreaKind = (kind: string): kind is AreaKind => areaKinds.has(kind)

/**
 * Track on no line, drawn and driven by no train: a loop rejoins other track at both ends
 * (Gragnola's track 1), a siding leads to a dead end (yard tracks, stubs).
 */
export const RAIL_KINDS = ["loop", "siding"] as const
/** A kind of track on no line. */
export type RailKind = (typeof RAIL_KINDS)[number]

/** The rail head over a rail piece's `z` (the bed its sleepers lie on), m: where trains run (`src/sim/rail/lines.ts`) and the rails are drawn (`src/render/rail.ts`). */
export const RAIL_LIFT = 0.12

/** Side of the square wall around every tree trunk, m. */
export const TRUNK = 0.5

/** Appends the four edges (ax, ay, bx, by) of the TRUNK square centred on (x, y) to `out`. */
export const pushTrunk = (out: Array<number>, x: number, y: number): void => {
  const h = TRUNK / 2
  out.push(
    x - h,
    y - h,
    x + h,
    y - h,
    x + h,
    y - h,
    x + h,
    y + h,
    x + h,
    y + h,
    x - h,
    y + h,
    x - h,
    y + h,
    x - h,
    y - h,
  )
}

/**
 * How the HUD's maps look, shared by the minimap (src/hud/minimap.ts, painting a tile's canvas) and
 * the full map's overview, which the build bakes into a raster (src/tools/overview.ts): the layers
 * in order (the play area's grass, then areas, water, rail, roads narrowest class first so the main
 * roads lie on top at junctions and overpasses, buildings), their colours and their widths, drawn
 * through a pen (a canvas, or the build's raster). It imports no module that decodes the map, so
 * the build can paint before the map exists.
 *
 * @module render/map-style
 */
import {
  type AreaKind,
  isAreaKind,
  isRoadClass,
  ROAD_CLASSES,
  type RoadClass,
} from "../sim/map/kinds.ts"
import { PALETTE } from "./palette.ts"

/** Area fills; kinds left out (grassland, residential) show the grass background. */
const AREA_HEX: Partial<Record<AreaKind, number>> = {
  forest: PALETTE.forest,
  cemetery: PALETTE.plasterGrey,
  pitch: PALETTE.forestLight,
  park: PALETTE.forestLight,
  parking: PALETTE.asphaltWorn,
  vineyard: PALETTE.grassDry,
  farmland: PALETTE.grassDry,
  farmyard: PALETTE.dirtTrack,
  industrial: PALETTE.stoneMid,
  platform: PALETTE.asphaltWorn,
  school: PALETTE.grass,
  ruins: PALETTE.stoneMid,
  paved: PALETTE.asphaltWorn,
  quarry: PALETTE.marbleWhite,
  rock: PALETTE.limestone,
  scree: PALETTE.stoneLight,
  sparse: PALETTE.grassDry,
  scrub: PALETTE.forestLight,
}

/** The full map's least road width by class, px (the rest: 1.5), so the main roads stand out at a few pixels per hundred metres. */
const OVERVIEW_MIN: Readonly<Partial<Record<RoadClass, number>>> = {
  motorway: 3,
  trunk: 3,
  primary: 2.5,
  secondary: 2.5,
  tertiary: 2,
}

/** Flat rings `[x0, y0, x1, y1, ...]`, m. */
type Rings = ReadonlyArray<ReadonlyArray<number>>

/** What a map is painted with: points in map metres, widths in px at the paint's scale. */
export interface MapPen {
  /** Clips everything painted after it to the rings, by the even-odd rule. */
  readonly clip: (rings: Rings) => void
  /** Fills the rings in `hex` by the fill rule. */
  readonly fill: (rings: Rings, hex: number, rule: "evenodd" | "nonzero") => void
  /** Strokes the open polyline with round caps and joins, `width` px wide, in `hex` at opacity `alpha`. */
  readonly stroke: (pts: ReadonlyArray<number>, width: number, hex: number, alpha: number) => void
}

/** A road as a paint reads it: its attributes and its line. */
interface PaintRoad {
  readonly cls: string
  readonly w: number
  readonly tunnel?: boolean
  readonly pts: ReadonlyArray<number>
}

/** The features a paint draws, each layer in the whole map's order (a tile's paint: the tile's, still in that order). */
export interface MapLayers<R extends PaintRoad = PaintRoad> {
  /** The play area (`MAP.outline`): the paint lays grass over it and clips to it. */
  readonly outline: Rings
  readonly areas: ReadonlyArray<{ readonly kind: string; readonly rings: Rings }>
  readonly water: ReadonlyArray<{ readonly w: number; readonly pts: ReadonlyArray<number> }>
  readonly rail: ReadonlyArray<{ readonly tunnel?: boolean; readonly pts: ReadonlyArray<number> }>
  readonly roads: ReadonlyArray<R>
  readonly buildings: ReadonlyArray<{ readonly outer: ReadonlyArray<number> }>
}

/** A stroke's look: its colour, width (px) and opacity. */
export interface Stroke {
  readonly hex: number
  readonly width: number
  readonly alpha: number
}

/** How the roads look in a paint: the stroke of a road of class `cls` at `scale` px/m. */
export type RoadLook<R extends PaintRoad> = (road: R, cls: RoadClass, scale: number) => Stroke

/** The road's class; anything the build does not emit reads as "path" (as `roadClassOf` in src/sim/map/index.ts). */
const classOf = (cls: string): RoadClass => (isRoadClass(cls) ? cls : "path")

/**
 * A line `width` m wide at `scale` px/m, in `hex`: at least `min` px wide, and fading towards 30 %
 * opacity where it would be thinner than that.
 */
export const faded = (width: number, scale: number, hex: number, min = 1): Stroke => ({
  hex,
  width: Math.max(min, width * scale),
  alpha: Math.min(1, Math.max(0.3, (width * scale) / min)),
})

/** The full map's roads: light (tracks paler, motorways and trunk roads yellow), opaque and at least `OVERVIEW_MIN` px wide. */
export const overviewRoad: RoadLook<PaintRoad> = (road, cls, scale) => ({
  hex:
    cls === "track"
      ? PALETTE.stoneLight
      : cls === "motorway" || cls === "trunk"
        ? PALETTE.signYellow
        : PALETTE.limestone,
  width: Math.max(OVERVIEW_MIN[cls] ?? 1.5, road.w * 1.6 * scale),
  alpha: 1,
})

/** The order roads are painted in, as indices into `roads`: the narrow classes first, then by index. */
const roadOrder = (roads: ReadonlyArray<{ readonly cls: string }>): Array<number> =>
  roads
    .map((road, k) => [ROAD_CLASSES.indexOf(classOf(road.cls)), k] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .map(([, k]) => k)

/**
 * Paints `map` at `scale` px/m with `pen`: grass over the play area, clipped to it, then the areas
 * (even-odd, kinds without a colour left out), the water and the rail out of tunnels (`faded`), the
 * roads out of tunnels, paths left out (`roadOrder`, each as `road` says), and the buildings' outer
 * rings (non-zero).
 */
export const paintLayers = <R extends PaintRoad>(
  pen: MapPen,
  map: MapLayers<R>,
  scale: number,
  road: RoadLook<R>,
): void => {
  pen.clip(map.outline)
  pen.fill(map.outline, PALETTE.grass, "evenodd")
  for (const area of map.areas) {
    const hex = isAreaKind(area.kind) ? AREA_HEX[area.kind] : undefined
    if (hex !== undefined) pen.fill(area.rings, hex, "evenodd")
  }
  const line = (pts: ReadonlyArray<number>, { hex, width, alpha }: Stroke) =>
    pen.stroke(pts, width, hex, alpha)
  for (const w of map.water) line(w.pts, faded(w.w, scale, PALETTE.waterShallow))
  for (const r of map.rail) if (r.tunnel !== true) line(r.pts, faded(2, scale, PALETTE.stoneDark))
  for (const k of roadOrder(map.roads)) {
    const r = map.roads[k]!,
      cls = classOf(r.cls)
    if (r.tunnel !== true && cls !== "path") line(r.pts, road(r, cls, scale))
  }
  for (const b of map.buildings) pen.fill([b.outer], PALETTE.roofTile, "nonzero")
}

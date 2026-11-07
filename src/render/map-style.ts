/**
 * How the HUD's maps look, shared by the minimap (src/hud/minimap.ts, painting a tile's canvas) and
 * the full map's overview, which the build bakes into a raster (src/tools/overview.ts): the layers
 * in order (the play area's grass, then areas, water, rail, roads narrowest class first so the main
 * roads lie on top at junctions and overpasses, a road in a tunnel dashed, buildings), their colours
 * and their widths, drawn through a pen (a canvas, or the build's raster). It imports no module
 * that decodes the map, so the build can paint before the map exists.
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
import { fillRank } from "../sim/map/raster.ts"
import { PALETTE } from "./palette.ts"

/**
 * Area fills. Grassland and residential land take the play area's grass, so they paint over a wood
 * under them (a UCS wood under OSM's grassland) as the land cover's raster does.
 */
const AREA_HEX = {
  grassland: PALETTE.grass,
  residential: PALETTE.grass,
  forest: PALETTE.forest,
  conifer: PALETTE.conifer,
  mixed: PALETTE.forestDark,
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
  pebble: PALETTE.limestone,
  river: PALETTE.waterShallow,
  lake: PALETTE.waterShallow,
  olive: PALETTE.olive,
} as const satisfies Record<AreaKind, number>

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

/**
 * The stretches of the polyline `pts` a dashed line draws: from its start, every other `dash` m
 * along it. Only + − × ÷ and sqrt, so the build's raster paints the same bits on every machine.
 */
const dashesOf = (pts: ReadonlyArray<number>, dash: number): Array<Array<number>> => {
  const out: Array<Array<number>> = []
  let current = [pts[0]!, pts[1]!],
    on = true,
    left = dash
  for (let k = 2; k + 1 < pts.length; k += 2) {
    let ax = pts[k - 2]!,
      ay = pts[k - 1]!
    const bx = pts[k]!,
      by = pts[k + 1]!
    let length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))
    while (length > left) {
      const t = left / length,
        cx = ax + (bx - ax) * t,
        cy = ay + (by - ay) * t
      if (on) {
        current.push(cx, cy)
        out.push(current)
      } else current = [cx, cy]
      on = !on
      ax = cx
      ay = cy
      length -= left
      left = dash
    }
    if (on) current.push(bx, by)
    left -= length
  }
  if (on && current.length >= 4) out.push(current)
  return out
}

/** A tunnel's dashes, and the gaps between them, are twice the road's width and this many px long: the round caps eat a width of each gap. */
const DASH_PAD = 2

/** The order roads are painted in, as indices into `roads`: the narrow classes first, then by index. */
const roadOrder = (roads: ReadonlyArray<{ readonly cls: string }>): Array<number> =>
  roads
    .map((road, k) => [ROAD_CLASSES.indexOf(classOf(road.cls)), k] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .map(([, k]) => k)

/**
 * Paints `map` at `scale` px/m with `pen`: grass over the play area, clipped to it, then the areas
 * (even-odd, in the order the land cover's raster fills them, `fillRank`: the woods first, the
 * rest of the land by kind, the lakes and river polygons over it, a river's gravel bars over them), the water (opaque, at least 1 px wide), the rail out of tunnels (`faded`), the roads,
 * paths left out (`roadOrder`, each as `road` says, a road in a tunnel dashed in its own look: `dashesOf`), and the buildings' outer rings (non-zero).
 */
export const paintLayers = <R extends PaintRoad>(
  pen: MapPen,
  map: MapLayers<R>,
  scale: number,
  road: RoadLook<R>,
): void => {
  pen.clip(map.outline)
  pen.fill(map.outline, PALETTE.grass, "evenodd")
  // each pass in the layer's order (a stable sort)
  for (const area of [...map.areas].sort((a, b) => fillRank(a.kind) - fillRank(b.kind))) {
    const hex = isAreaKind(area.kind) ? AREA_HEX[area.kind] : undefined
    if (hex !== undefined) pen.fill(area.rings, hex, "evenodd")
  }
  const line = (pts: ReadonlyArray<number>, { hex, width, alpha }: Stroke) =>
    pen.stroke(pts, width, hex, alpha)
  // Water in one colour, opaque: faded streams darkened where they crossed or met a river.
  for (const w of map.water)
    line(w.pts, { hex: PALETTE.waterShallow, width: Math.max(1, w.w * scale), alpha: 1 })
  for (const r of map.rail) if (r.tunnel !== true) line(r.pts, faded(2, scale, PALETTE.stoneDark))
  for (const k of roadOrder(map.roads)) {
    const r = map.roads[k]!,
      cls = classOf(r.cls)
    if (cls === "path") continue
    const look = road(r, cls, scale)
    if (r.tunnel === true)
      for (const dash of dashesOf(r.pts, (2 * look.width + DASH_PAD) / scale)) line(dash, look)
    else line(r.pts, look)
  }
  for (const b of map.buildings) pen.fill([b.outer], PALETTE.roofTile, "nonzero")
}

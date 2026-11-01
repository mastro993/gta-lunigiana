// The full map's overview: the whole play area painted once by the build (build-map.ts, after the
// map is written) into `<map>/overview.png` beside the tiles, which the full map (M,
// src/hud/worldmap.ts) downloads the first time it opens and draws scaled to the screen, so the game
// never needs every tile's vectors at once. It is the full map's look (src/render/map-style.ts:
// grass over the play area and clipped to it, areas, water, rail, roads light by class at least
// `OVERVIEW_MIN` px wide, buildings) as a map about 820 px on its long side would show it (between
// a 1280 × 720 window's 600 px and a 1920 × 1080 window's 960 px), at
// `OVERVIEW_RATIO` px per px: about `OVERVIEW_SIDE` px on its long side, the bounds exactly. The
// same bytes on every run and machine with the same Node build (paint-raster.ts paints with + − × ÷
// and sqrt alone; another zlib compresses the same image data differently, `pngData`).
import { writeFileSync } from "node:fs"

import { type MapLayers, overviewRoad, paintLayers } from "../render/map-style.ts"
import { makeRaster, rasterPen, straightRgba } from "./paint-raster.ts"
import { encodePngRgba } from "./png.ts"

/** The overview's long side, px (at most: see `OVERVIEW_PIXELS`). */
export const OVERVIEW_SIDE = 4096
/** Its pixels, at most: under Safari's 16.7 MP canvas limit, which a 4096 px square passes. */
const OVERVIEW_PIXELS = 16_000_000
/** Overview pixels per px of the look: its lines are as wide as on a map `OVERVIEW_SIDE / OVERVIEW_RATIO` px long shown at that pixel ratio. */
const OVERVIEW_RATIO = 5

/** The box the overview spans, m: the map's bounds. */
interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** The overview's size, px, and its scale, px/m: `OVERVIEW_SIDE` on the long side, less where that passes `OVERVIEW_PIXELS`. */
export const overviewSize = (
  bounds: Bounds,
): { readonly width: number; readonly height: number; readonly scale: number } => {
  const w = bounds.maxX - bounds.minX,
    h = bounds.maxY - bounds.minY
  const scale = Math.min(OVERVIEW_SIDE / Math.max(w, h), Math.sqrt(OVERVIEW_PIXELS / (w * h)))
  return { width: Math.round(w * scale), height: Math.round(h * scale), scale }
}

/**
 * The overview of `map` (its layers, whole) over `bounds`, as straight RGBA rows top first: the
 * bounds span it exactly (whole pixels across and down, so its two scales differ by under a pixel
 * in its side), and the paint's scale is `scale / OVERVIEW_RATIO` px/m, as on the reference map.
 */
export const paintOverview = (map: MapLayers, bounds: Bounds) => {
  const { width, height, scale } = overviewSize(bounds)
  const sx = width / (bounds.maxX - bounds.minX),
    sy = height / (bounds.maxY - bounds.minY)
  const raster = makeRaster(width, height)
  const pen = rasterPen(
    raster,
    { u: (x) => (x - bounds.minX) * sx, v: (y) => (bounds.maxY - y) * sy },
    OVERVIEW_RATIO,
  )
  paintLayers(pen, map, scale / OVERVIEW_RATIO, overviewRoad)
  return { width, height, scale, rgba: straightRgba(raster) }
}

/** The overview of `map` over `bounds` as a PNG. */
export const overviewPng = (map: MapLayers, bounds: Bounds): Buffer => {
  const { width, height, rgba } = paintOverview(map, bounds)
  return encodePngRgba(width, height, rgba)
}

/** Writes the overview of `map` over `bounds` to `file`; returns its size, bytes. */
export const writeOverview = (file: string, map: MapLayers, bounds: Bounds): number => {
  const png = overviewPng(map, bounds)
  writeFileSync(file, png)
  return png.length
}

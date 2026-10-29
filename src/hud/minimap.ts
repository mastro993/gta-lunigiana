/**
 * The minimap: the map round the player (areas, water, rail, roads, buildings), blitted every frame
 * from offscreen canvases of one 2 km tile each, turned with the view so that screen-up is
 * minimap-up, with the player as an arrow. A tile's canvas is painted from the map's global vectors
 * once the player comes within `PAINT` of it (one a frame, nearest first) and let go past `EVICT`,
 * so a few are kept whatever the map's size: one canvas of the whole region would pass Safari's
 * 16.7 MP. `paintMap` and `paintArrow` also draw the full map (`worldmap.ts`).
 *
 * @module hud/minimap
 */
import { roadHex } from "../render/lines.ts"
import { css, PALETTE } from "../render/palette.ts"
import {
  type AreaKind,
  buildingBoxes,
  isAreaKind,
  MAP,
  roadClassOf,
  TILE,
} from "../sim/map/index.ts"
import { tileKey, tileRange } from "../sim/map/kinds.ts"
import { screenAxes } from "../sim/view.ts"

/** Base map pixels per metre: the minimap's own scale (90 canvas px over SPAN), so the blit is 1:1. */
const BASE = 0.3
/** Metres across the minimap. */
const SPAN = 300
/** Pixels each tile's canvas reaches past its square on every side: under a turned nearest-neighbour blit, neighbours overlap instead of leaving a seam. */
const OVERLAP = 1
/** A tile canvas's side, px: 600 for the 2 km square plus the overlaps (1.4 MB of pixels). */
const SIDE = TILE * BASE + 2 * OVERLAP
/** How far the minimap shows from the player, m: the corner of its square, which a turn brings onto either axis. */
const VIEW = (SPAN / 2) * Math.SQRT2
/** Tiles within this of the player (m, along either axis) get painted, nearest first; those past `EVICT` are let go. */
const PAINT = 1000
const EVICT = 1500
/** How far past a tile's square a feature may start and still reach its canvas, m: the widest stroke's half (a 12 m road drawn 1.6 times as wide), the overlap pixel and some spare. */
const MARGIN = 20

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

const HOME_UP = screenAxes(0).up
/**
 * Canvas rotation that turns screen-up to minimap-up for a view turned `yaw` rad to the left of its
 * home seat: the canvas is drawn north-up (v = −y), where the home screen-up points at angle
 * atan2(−up.y, up.x); rotating by −π/2 minus that brings it to the top. The view's turn takes
 * screen-up to canvas angle atan2(−up.y, up.x) − yaw, so the rotation grows by `yaw`.
 */
export const minimapRotation = (yaw: number): number =>
  yaw - Math.PI / 2 - Math.atan2(-HOME_UP.y, HOME_UP.x)

/** A box [minX, minY, maxX, maxY], m. */
type Box = readonly [number, number, number, number]

const boxOf = (flat: ArrayLike<number>): Box => {
  let x0 = flat[0]!,
    y0 = flat[1]!,
    x1 = x0,
    y1 = y0
  for (let k = 2; k + 1 < flat.length; k += 2) {
    x0 = Math.min(x0, flat[k]!)
    x1 = Math.max(x1, flat[k]!)
    y0 = Math.min(y0, flat[k + 1]!)
    y1 = Math.max(y1, flat[k + 1]!)
  }
  return [x0, y0, x1, y1]
}

/** Each layer's features' boxes, in the layer's order, for painting a tile with only what reaches it; made on first use. */
let layerBoxes:
  | {
      readonly areas: ReadonlyArray<Box>
      readonly water: ReadonlyArray<Box>
      readonly rail: ReadonlyArray<Box>
      readonly roads: ReadonlyArray<Box>
    }
  | undefined
const boxes = () =>
  (layerBoxes ??= {
    areas: MAP.areas.map((area) => boxOf(area.rings[0] ?? [])),
    water: MAP.water.map((w) => boxOf(w.pts)),
    rail: MAP.rail.map((r) => boxOf(r.pts)),
    roads: MAP.roads.map((road) => boxOf(road.pts)),
  })

/** How `paintMap` places the map, and what it paints. */
interface PaintOptions {
  /** The canvas pixel of the corner, px. */
  readonly ox?: number
  readonly oy?: number
  /** The full map's look: roads light and at least 2 px (main roads) or 1.5 px wide. */
  readonly overview?: boolean
  /** Paint only the features whose boxes reach this box, m (a tile's canvas); else all of them. */
  readonly within?: Box
}

/**
 * Paints the map layers (areas, water, rail, roads, buildings) north-up at `scale` px/m, with the
 * map point `corner` (its west edge and north edge, m) at canvas pixel (ox, oy). Lines stay at least
 * 1 px wide; those thinner than that at this scale fade instead. `overview` (the full map) draws roads
 * light and at least 2 px (main roads) or 1.5 px wide, so the network reads at a few pixels per
 * hundred metres.
 */
export const paintMap = (
  ctx: CanvasRenderingContext2D,
  scale: number,
  corner: { readonly minX: number; readonly maxY: number },
  { ox = 0, oy = 0, overview = false, within }: PaintOptions = {},
): void => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const u = (x: number) => ox + (x - corner.minX) * scale,
    v = (y: number) => oy + (corner.maxY - y) * scale
  const reaches = (box: Box | undefined) =>
    within === undefined ||
    (box !== undefined &&
      box[0] <= within[2] &&
      box[2] >= within[0] &&
      box[1] <= within[3] &&
      box[3] >= within[1])
  const layers = within === undefined ? undefined : boxes()
  const path = (flat: ArrayLike<number>, closed: boolean, into = new Path2D()) => {
    into.moveTo(u(flat[0]!), v(flat[1]!))
    for (let i = 2; i + 1 < flat.length; i += 2) into.lineTo(u(flat[i]!), v(flat[i + 1]!))
    if (closed) into.closePath()
    return into
  }
  ctx.fillStyle = css(PALETTE.grass)
  ctx.fillRect(u(minX), v(maxY), (maxX - minX) * scale, (maxY - minY) * scale)
  MAP.areas.forEach((area, k) => {
    const hex = isAreaKind(area.kind) ? AREA_HEX[area.kind] : undefined
    if (hex === undefined || !reaches(layers?.areas[k])) return
    const p = new Path2D()
    for (const ring of area.rings) path(ring, true, p)
    ctx.fillStyle = css(hex)
    ctx.fill(p, "evenodd")
  })
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  const stroke = (flat: ArrayLike<number>, width: number, hex: number, min = 1) => {
    ctx.strokeStyle = css(hex)
    ctx.lineWidth = Math.max(min, width * scale)
    ctx.globalAlpha = Math.min(1, Math.max(0.3, (width * scale) / min))
    ctx.stroke(path(flat, false))
    ctx.globalAlpha = 1
  }
  MAP.water.forEach((w, k) => {
    if (reaches(layers?.water[k])) stroke(w.pts, w.w, PALETTE.waterShallow)
  })
  MAP.rail.forEach((r, k) => {
    if (r.tunnel !== true && reaches(layers?.rail[k])) stroke(r.pts, 2, PALETTE.stoneDark)
  })
  MAP.roads.forEach((road, k) => {
    const cls = roadClassOf(road)
    if (road.tunnel === true || cls === "path" || !reaches(layers?.roads[k])) return
    if (overview) {
      ctx.strokeStyle = css(cls === "track" ? PALETTE.stoneLight : PALETTE.limestone)
      ctx.lineWidth = Math.max(cls === "tertiary" ? 2 : 1.5, road.w * 1.6 * scale)
      ctx.stroke(path(road.pts, false))
    } else {
      stroke(road.pts, road.w * 1.6, roadHex(road))
    }
  })
  ctx.fillStyle = css(PALETTE.roofTile)
  MAP.buildings.forEach((b, k) => {
    if (reaches(buildingBoxes[k])) ctx.fill(path(b.outer, true))
  })
}

/** The player marker: an arrow along +x, `size` px from tail to tip, centred on the current origin. */
export const paintArrow = (
  ctx: CanvasRenderingContext2D,
  size = 9,
  fill: number = PALETTE.signYellow,
): void => {
  const k = size / 9
  ctx.beginPath()
  ctx.moveTo(5 * k, 0)
  ctx.lineTo(-4 * k, 3.5 * k)
  ctx.lineTo(-2 * k, 0)
  ctx.lineTo(-4 * k, -3.5 * k)
  ctx.closePath()
  ctx.fillStyle = css(fill)
  ctx.strokeStyle = css(PALETTE.outline)
  ctx.lineWidth = Math.max(1, k)
  ctx.fill()
  ctx.stroke()
}

const range = tileRange(MAP.bounds)

/** A tile (i, j) of the map's grid (`TILE`), by its key. */
interface TileRef {
  readonly key: string
  readonly i: number
  readonly j: number
}

/** The tiles with map in them whose squares come closer than `r` m to (x, y) along either axis, nearest first. */
export const tilesNear = (x: number, y: number, r: number): Array<TileRef> => {
  const near: Array<TileRef & { readonly d: number }> = []
  /** The tiles along one axis whose spans come closer than `r` to `p`, within `lo`..`hi`. */
  const span = (p: number, lo: number, hi: number) => ({
    from: Math.max(lo, Math.floor((p - r) / TILE)),
    to: Math.min(hi, Math.ceil((p + r) / TILE) - 1),
  })
  const gap = (p: number, n: number) => Math.max(0, n * TILE - p, p - (n + 1) * TILE)
  const across = span(x, range.i0, range.i1),
    down = span(y, range.j0, range.j1)
  for (let j = down.from; j <= down.to; j++)
    for (let i = across.from; i <= across.to; i++)
      near.push({ key: tileKey(i, j), i, j, d: Math.hypot(gap(x, i), gap(y, j)) })
  return near.sort((a, b) => a.d - b.d)
}

/** The box whose features tile (i, j)'s canvas paints, m: its square plus the overlap pixel and `MARGIN` all round. */
export const tileReach = (i: number, j: number): Box => {
  const m = OVERLAP / BASE + MARGIN
  return [i * TILE - m, j * TILE - m, (i + 1) * TILE + m, (j + 1) * TILE + m]
}

/** Tile (i, j)'s canvas: its square at BASE plus `OVERLAP` px all round, clipped to the map's bounds as the whole map's canvas was. */
const paintTile = (document: Document, { i, j }: TileRef): HTMLCanvasElement => {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = SIDE
  const ctx = canvas.getContext("2d")
  if (ctx === null) return canvas
  const minX = i * TILE,
    maxY = (j + 1) * TILE,
    { bounds } = MAP
  ctx.beginPath()
  ctx.rect(
    OVERLAP + (bounds.minX - minX) * BASE,
    OVERLAP + (maxY - bounds.maxY) * BASE,
    (bounds.maxX - bounds.minX) * BASE,
    (bounds.maxY - bounds.minY) * BASE,
  )
  ctx.clip()
  paintMap(ctx, BASE, { minX, maxY }, { ox: OVERLAP, oy: OVERLAP, within: tileReach(i, j) })
  return canvas
}

/** The minimap canvas (90 px square, which hud.css shows larger for chunky pixels) and its per-frame draw. */
export const makeMinimap = (document: Document) => {
  const canvas = document.createElement("canvas")
  canvas.className = "minimap"
  canvas.width = canvas.height = SPAN * BASE
  const ctx = canvas.getContext("2d")
  const s = canvas.width
  /** The painted tiles' canvases, by key. */
  const painted = new Map<string, HTMLCanvasElement>()
  return {
    canvas,
    /** Draws the map around (x, y), turned with the view's `yaw`, with the player arrow pointing along `angle` (radians CCW from east). */
    draw: (x: number, y: number, angle: number, yaw: number): void => {
      if (ctx === null) return
      // One tile a frame (painting one takes a few milliseconds), the nearest first: those in view come before those ahead.
      const next = tilesNear(x, y, PAINT).find((tile) => !painted.has(tile.key))
      if (next !== undefined) painted.set(next.key, paintTile(document, next))
      const keep = new Set(tilesNear(x, y, EVICT).map((tile) => tile.key))
      for (const [key, tile] of painted)
        if (!keep.has(key)) {
          tile.width = tile.height = 0 // frees its pixels now: Safari caps the memory canvases hold
          painted.delete(key)
        }
      ctx.imageSmoothingEnabled = false
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = css(PALETTE.forestDark)
      ctx.fillRect(0, 0, s, s)
      ctx.setTransform(1, 0, 0, 1, s / 2, s / 2)
      const rotation = minimapRotation(yaw)
      ctx.rotate(rotation)
      for (const tile of tilesNear(x, y, VIEW)) {
        const image = painted.get(tile.key)
        if (image !== undefined)
          ctx.drawImage(
            image,
            (tile.i * TILE - x) * BASE - OVERLAP,
            (y - (tile.j + 1) * TILE) * BASE - OVERLAP,
          )
      }
      ctx.setTransform(1, 0, 0, 1, s / 2, s / 2)
      ctx.rotate(rotation - angle)
      paintArrow(ctx)
    },
  }
}

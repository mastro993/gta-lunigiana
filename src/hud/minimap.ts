/**
 * The minimap: the map round the player (areas, water, rail, roads, buildings), blitted every frame
 * from offscreen canvases of one 2 km tile each, turned with the view so that screen-up is
 * minimap-up, with the player as an arrow. A tile's canvas is painted from that tile's own vectors
 * (and the global rail reaching it) once the player comes within `PAINT` of it and the tile is in
 * memory (one a frame, nearest first; it never asks for a tile), and let go past `EVICT`, so a few
 * are kept whatever the map's size: one canvas of the whole region would pass Safari's 16.7 MP.
 * `paintArrow` also draws the full map's marker (`worldmap.ts`).
 *
 * @module hud/minimap
 */
import { roadHex } from "../render/lines.ts"
import { faded, type MapLayers, paintLayers, type RoadLook } from "../render/map-style.ts"
import { css, PALETTE } from "../render/palette.ts"
import { MAP, type Road, TILE } from "../sim/map/index.ts"
import { tileKey } from "../sim/map/kinds.ts"
import type { TileVectors } from "../sim/map/packed.ts"
import { isListed, residentTile, TILE_RANGE } from "../sim/map/tiles.ts"
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
/** Tiles within this of the player (m, along either axis) get painted, nearest first, once in memory; those past `EVICT` are let go. */
const PAINT = 1000
const EVICT = 1500
/** How far past a tile's square a feature may start and still reach its canvas, m: the widest stroke's half (a 12 m road drawn 1.6 times as wide), the overlap pixel and some spare. Less than the tile's `HALO`, so its vectors hold every such feature. */
const MARGIN = 20

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

/** The rail's boxes, in `MAP.rail` order (the rail is global: a tile paints the pieces reaching it); made on first use. */
let railBoxes: ReadonlyArray<Box> | undefined

/** The minimap's roads: in their surface's colour, at least 1 px wide and fading where thinner (`faded`). */
const minimapRoad: RoadLook<Road> = (road, _, scale) => faded(road.w * 1.6, scale, roadHex(road))

/**
 * Paints `layers` (a tile's features, `tileLayers`) in the minimap's look north-up at `scale` px/m,
 * with the map point `corner` (its west edge and north edge, m) at canvas pixel (ox, oy), on grass
 * over the play area and clipped to it (`paintLayers`: the areas reach the built terrain's box,
 * which an L's notch lies in). Lines stay at least 1 px wide; those thinner than that at this scale
 * fade instead. Roads are painted narrowest class first.
 */
export const paintMap = (
  ctx: CanvasRenderingContext2D,
  scale: number,
  corner: { readonly minX: number; readonly maxY: number },
  layers: MapLayers<Road>,
  { ox = 0, oy = 0 }: { readonly ox?: number; readonly oy?: number } = {},
): void => {
  const u = (x: number) => ox + (x - corner.minX) * scale,
    v = (y: number) => oy + (corner.maxY - y) * scale
  const path = (flat: ArrayLike<number>, closed: boolean, into = new Path2D()) => {
    into.moveTo(u(flat[0]!), v(flat[1]!))
    for (let i = 2; i + 1 < flat.length; i += 2) into.lineTo(u(flat[i]!), v(flat[i + 1]!))
    if (closed) into.closePath()
    return into
  }
  const rings = (list: ReadonlyArray<ReadonlyArray<number>>) => {
    const p = new Path2D()
    for (const ring of list) path(ring, true, p)
    return p
  }
  ctx.save()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  paintLayers(
    {
      clip: (outline) => ctx.clip(rings(outline), "evenodd"),
      fill: (list, hex, rule) => {
        ctx.fillStyle = css(hex)
        ctx.fill(rings(list), rule)
      },
      stroke: (pts, width, hex, alpha) => {
        ctx.strokeStyle = css(hex)
        ctx.lineWidth = width
        ctx.globalAlpha = alpha
        ctx.stroke(path(pts, false))
        ctx.globalAlpha = 1
      },
    },
    layers,
    scale,
    minimapRoad,
  )
  ctx.restore()
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

/** A tile (i, j) of the map's grid (`TILE`), by its key. */
interface TileRef {
  readonly key: string
  readonly i: number
  readonly j: number
}

/** The listed tiles (those with map in them) whose squares come closer than `r` m to (x, y) along either axis, nearest first. */
export const tilesNear = (x: number, y: number, r: number): Array<TileRef> => {
  const near: Array<TileRef & { readonly d: number }> = []
  /** The tiles along one axis whose spans come closer than `r` to `p`, within `lo`..`hi`. */
  const span = (p: number, lo: number, hi: number) => ({
    from: Math.max(lo, Math.floor((p - r) / TILE)),
    to: Math.min(hi, Math.ceil((p + r) / TILE) - 1),
  })
  const gap = (p: number, n: number) => Math.max(0, n * TILE - p, p - (n + 1) * TILE)
  const across = span(x, TILE_RANGE.i0, TILE_RANGE.i1),
    down = span(y, TILE_RANGE.j0, TILE_RANGE.j1)
  for (let j = down.from; j <= down.to; j++)
    for (let i = across.from; i <= across.to; i++)
      if (isListed(i, j))
        near.push({ key: tileKey(i, j), i, j, d: Math.hypot(gap(x, i), gap(y, j)) })
  return near.sort((a, b) => a.d - b.d)
}

/** The box whose features tile (i, j)'s canvas can show, m: its square plus the overlap pixel and `MARGIN` all round. */
const tileReach = (i: number, j: number): Box => {
  const m = OVERLAP / BASE + MARGIN
  return [i * TILE - m, j * TILE - m, (i + 1) * TILE + m, (j + 1) * TILE + m]
}

/**
 * What tile (i, j)'s canvas paints: the tile's `vectors` (every feature within `HALO` of its square,
 * in the whole map's order), its roads with their attributes (`MAP.roads`), and the global rail
 * whose boxes reach `tileReach`.
 */
export const tileLayers = (vectors: TileVectors, i: number, j: number): MapLayers<Road> => {
  const { areas, water, roads, buildings } = vectors
  const [x0, y0, x1, y1] = tileReach(i, j)
  const rail = (railBoxes ??= MAP.rail.map((r) => boxOf(r.pts)))
  return {
    outline: MAP.outline,
    areas: areas.items,
    water: water.items,
    rail: MAP.rail.filter((_, k) => {
      const b = rail[k]!
      return b[0] <= x1 && b[2] >= x0 && b[1] <= y1 && b[3] >= y0
    }),
    roads: roads.ids.map((id, k) => ({ ...MAP.roads[id]!, ...roads.items[k]! })),
    buildings: buildings.items,
  }
}

/** Tile (i, j)'s canvas, painted from its `vectors`: its square at BASE plus `OVERLAP` px all round (`paintMap` clips it to the play area). */
const paintTile = (document: Document, { i, j }: TileRef, vectors: TileVectors) => {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = SIDE
  const ctx = canvas.getContext("2d")
  if (ctx === null) return canvas
  const minX = i * TILE,
    maxY = (j + 1) * TILE
  paintMap(ctx, BASE, { minX, maxY }, tileLayers(vectors, i, j), { ox: OVERLAP, oy: OVERLAP })
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
      // One tile a frame (painting one takes a few milliseconds), the nearest in memory first: those in view (always in memory, as the step reads round the player) come before those ahead.
      for (const tile of tilesNear(x, y, PAINT)) {
        const resident = painted.has(tile.key) ? undefined : residentTile(tile.key)
        if (resident === undefined) continue
        painted.set(tile.key, paintTile(document, tile, resident.vectors))
        break
      }
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

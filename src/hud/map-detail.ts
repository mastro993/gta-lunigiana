/**
 * The full map's detail: zoomed in until its frame shows DETAIL_AREA or less, the map tiles under it are
 * painted from their own vectors at screen resolution, roads as wide as they are (or the overview's
 * least widths in px, `overviewRoad`), over the overview, whose lines are baked as wide as the whole
 * map needs them. A tile in memory (round the player) lends its vectors; any other is downloaded
 * once while the map is open, its vectors kept (past `KEPT`, those off the frame go) and the rest
 * of it left unread. One painting covers the frame as it stood (`paint`); while a gesture moves the map it is
 * drawn moved and scaled with it (`draw`), and painted again once the map holds still.
 *
 * @module hud/map-detail
 */
import { overviewRoad } from "../render/map-style.ts"
import { MAP, TILE } from "../sim/map/index.ts"
import { tileKey } from "../sim/map/kinds.ts"
import { decodeTileVectors, type TileVectors } from "../sim/map/packed.ts"
import { isListed, residentTile, TILE_RANGE } from "../sim/map/tiles.ts"
import { fetchFile, gunzipped } from "../stream.ts"
import type { Box, Fit } from "./map-view.ts"
import { paintMap, tileLayers } from "./minimap.ts"

/**
 * The most ground the frame may show for the detail to be painted, m² (16 tiles' worth, about
 * 7 MB of tile files to download): from 0.107 px/m at 1280 × 720, 0.058 on an 844 × 390 phone and
 * 0.167 at 1920 × 1080. Further out, the overview's baked lines are no more than a few px wide.
 */
const DETAIL_AREA = 64e6

/** Tiles whose downloaded vectors are kept while the map is open; past that, those off the frame go. */
const KEPT = 16

/** Whether the map placed as `fit` is zoomed in enough for the detail: its frame shows DETAIL_AREA or less. */
export const detailed = ({ scale, frame }: Fit): boolean =>
  ((frame.x1 - frame.x0) / scale) * ((frame.y1 - frame.y0) / scale) <= DETAIL_AREA

/** The listed tiles (i, j) whose squares overlap the map box (x0, y0)–(x1, y1), m. */
export const tilesUnder = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<{ readonly key: string; readonly i: number; readonly j: number }> => {
  const tiles = []
  const i0 = Math.max(TILE_RANGE.i0, Math.floor(x0 / TILE)),
    i1 = Math.min(TILE_RANGE.i1, Math.ceil(x1 / TILE) - 1),
    j0 = Math.max(TILE_RANGE.j0, Math.floor(y0 / TILE)),
    j1 = Math.min(TILE_RANGE.j1, Math.ceil(y1 / TILE) - 1)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) if (isListed(i, j)) tiles.push({ key: tileKey(i, j), i, j })
  return tiles
}

/** The map box (minX, minY, maxX, maxY), m, a frame shows under `fit`. */
const boxOf = (fit: Fit, frame: Box) => {
  const { bounds } = MAP
  return {
    x0: bounds.minX + (frame.x0 - fit.ox) / fit.scale,
    x1: bounds.minX + (frame.x1 - fit.ox) / fit.scale,
    y0: bounds.maxY - (frame.y1 - fit.oy) / fit.scale,
    y1: bounds.maxY - (frame.y0 - fit.oy) / fit.scale,
  }
}

/**
 * The full map's detail over `document`, its tiles downloaded from `tileUrl` (the page's map's,
 * `src/maps.ts`); `arrived` hears that a tile's vectors came, so the detail is worth painting again.
 */
export const makeMapDetail = (
  document: Document,
  tileUrl: (key: string) => URL,
  arrived: () => void,
) => {
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d")
  /** Downloaded tiles' vectors, the least recently painted first. */
  const kept = new Map<string, TileVectors>()
  /** Tiles downloading, so each is asked for once. */
  const loading = new Set<string>()
  /** Bumped when the map closes: a download that comes after is dropped. */
  let opening = 0,
    /** The fit the canvas was painted for; undefined while it holds nothing. */
    painted: Fit | undefined

  const vectorsOf = (key: string): TileVectors | undefined => {
    const resident = residentTile(key)?.vectors
    if (resident !== undefined) return resident
    const own = kept.get(key)
    if (own !== undefined) {
      kept.delete(key)
      kept.set(key, own)
    }
    return own
  }
  const download = (key: string) => {
    loading.add(key)
    const at = opening
    fetchFile(tileUrl(key))
      .then(gunzipped)
      .then((file) => {
        if (at !== opening) return
        const tile = decodeTileVectors(file)
        if (tile.hash !== MAP.hash)
          throw new Error(`map tile ${key} is from another build (${tile.hash}, not ${MAP.hash})`)
        kept.set(key, tile.vectors)
        arrived()
      })
      // The overview stays under a tile that did not come; the next painting asks for it again.
      .catch((error: unknown) => console.warn(`full map: tile ${key}:`, error))
      .finally(() => {
        if (at === opening) loading.delete(key)
      })
  }

  return {
    /**
     * Paints the tiles under `fit`'s frame on a `width` × `height` px screen at `dpr` device px a px,
     * asking for those not yet here; not `detailed`, it lets the painting go instead.
     */
    paint: (fit: Fit, width: number, height: number, dpr: number): void => {
      if (ctx === null) return
      if (!detailed(fit)) {
        canvas.width = canvas.height = 0
        painted = undefined
        return
      }
      const w = Math.round(width * dpr),
        h = Math.round(height * dpr)
      if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h]
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const { frame } = fit,
        { x0, y0, x1, y1 } = boxOf(fit, frame),
        { bounds } = MAP
      const under = tilesUnder(x0, y0, x1, y1)
      // The oldest kept tiles off the frame go first; those under it stay, or each painting would download them again.
      const needed = new Set(under.map((t) => t.key))
      for (const key of kept.keys()) if (kept.size > KEPT && !needed.has(key)) kept.delete(key)
      for (const { key, i, j } of under) {
        const vectors = vectorsOf(key)
        if (vectors === undefined) {
          if (!loading.has(key)) download(key)
          continue
        }
        // Each tile paints its own square of the frame (its vectors reach past it, `HALO`, into its
        // neighbours'), its edges on whole device pixels: two tiles share each seam, with no
        // antialiased gap for the overview to show through.
        const snap = (px: number) => Math.round(px * dpr) / dpr
        const sx0 = snap(Math.max(frame.x0, fit.ox + (i * TILE - bounds.minX) * fit.scale)),
          sx1 = snap(Math.min(frame.x1, fit.ox + ((i + 1) * TILE - bounds.minX) * fit.scale)),
          sy0 = snap(Math.max(frame.y0, fit.oy + (bounds.maxY - (j + 1) * TILE) * fit.scale)),
          sy1 = snap(Math.min(frame.y1, fit.oy + (bounds.maxY - j * TILE) * fit.scale))
        ctx.save()
        ctx.beginPath()
        ctx.rect(sx0, sy0, sx1 - sx0, sy1 - sy0)
        ctx.clip()
        paintMap(ctx, fit.scale, bounds, tileLayers(vectors, i, j), {
          ox: fit.ox,
          oy: fit.oy,
          road: overviewRoad,
        })
        ctx.restore()
      }
      painted = fit
    },
    /** Draws the last painting onto `target` where the map now stands under `fit`, inside its frame, scaled with any zoom since. */
    draw: (target: CanvasRenderingContext2D, fit: Fit, width: number, height: number): void => {
      if (painted === undefined || !detailed(fit)) return
      const k = fit.scale / painted.scale,
        { frame } = fit
      target.save()
      target.beginPath()
      target.rect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0)
      target.clip()
      target.imageSmoothingEnabled = true
      target.drawImage(
        canvas,
        fit.ox - painted.ox * k,
        fit.oy - painted.oy * k,
        width * k,
        height * k,
      )
      target.restore()
    },
    /** The map closed: lets the painting and the downloaded vectors go, and drops downloads still running. */
    release: (): void => {
      opening++
      canvas.width = canvas.height = 0
      painted = undefined
      kept.clear()
      loading.clear()
    },
  }
}

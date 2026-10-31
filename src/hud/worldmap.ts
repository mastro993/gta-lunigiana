/**
 * The full map (M or a tap on the minimap; Esc or a tap closes it): the whole play area north-up
 * over the screen, the build's overview of it (src/tools/overview.ts, downloaded when the map first
 * opens) scaled to fit, with the frame, the villages and hamlets named, the scale bar and the player
 * as an arrow painted afresh at screen resolution over it. While it is open the host stops ticking
 * the simulation and drawing the world (`main.ts`).
 *
 * @module hud/worldmap
 */
import { mapForSearch } from "../maps.ts"
import { css, PALETTE } from "../render/palette.ts"
import { districtAt, MAP } from "../sim/map/index.ts"
import { fetchFile } from "../stream.ts"
import { paintArrow } from "./minimap.ts"
import { element } from "./title.ts"

/** Screen px kept clear around the map: the header above, the scale bar (and the two-line credits of narrow windows) below. */
const MARGIN = { top: 64, right: 24, bottom: 56, left: 24 } as const

/** North-up placement: `scale` px per metre, the map's north-west corner at (ox, oy). */
interface Fit {
  readonly scale: number
  readonly ox: number
  readonly oy: number
}

interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** The largest north-up scale that fits `bounds` in a `width` × `height` px screen inside MARGIN, centred. */
export const fitMap = (bounds: Bounds, width: number, height: number): Fit => {
  const bw = bounds.maxX - bounds.minX,
    bh = bounds.maxY - bounds.minY
  const w = Math.max(1, width - MARGIN.left - MARGIN.right),
    h = Math.max(1, height - MARGIN.top - MARGIN.bottom)
  const scale = Math.min(w / bw, h / bh)
  return { scale, ox: MARGIN.left + (w - bw * scale) / 2, oy: MARGIN.top + (h - bh * scale) / 2 }
}

/** A named place: villages are `major` (big labels, placed first), hamlets and peaks are not. */
export interface Place {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly major: boolean
}

const isPlace = (kind: string) =>
  kind === "place=town" || kind === "place=village" || kind === "place=hamlet"
const districts: ReadonlySet<string> = new Set(MAP.districts.map((d) => d.name))

/**
 * The villages and hamlets OSM names inside the map (its `place=*` POIs; localities left out), then
 * the peaks the HUD names (a landmark district of the same name), once per name: OSM has two
 * Argigliano nodes and two Monte Borla summits. Peaks come last, so a hamlet beats a peak it overlaps.
 */
export const PLACES: ReadonlyArray<Place> = [
  ...MAP.pois.flatMap((p) =>
    p.name !== undefined && isPlace(p.kind)
      ? [{ name: p.name, x: p.x, y: p.y, major: p.kind !== "place=hamlet" }]
      : [],
  ),
  ...MAP.pois.flatMap((p) =>
    p.name !== undefined && p.kind === "natural=peak" && districts.has(p.name)
      ? [{ name: p.name, x: p.x, y: p.y, major: false }]
      : [],
  ),
].filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)

/** A label's screen box. */
interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

const apart = (a: Box, b: Box): boolean =>
  a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0

/**
 * The labels that fit without overlapping each other or the `fixed` boxes (the north arrow):
 * majors first, then in order; later ones that would overlap are dropped.
 */
export const placeLabels = (
  labels: ReadonlyArray<Box & { readonly major: boolean }>,
  fixed: ReadonlyArray<Box> = [],
): Array<number> => {
  const order = labels
    .map((_, i) => i)
    .sort((a, b) => Number(labels[b]!.major) - Number(labels[a]!.major) || a - b)
  const kept: Array<number> = []
  for (const i of order) {
    const a = labels[i]!
    if (fixed.every((b) => apart(a, b)) && kept.every((j) => apart(a, labels[j]!))) kept.push(i)
  }
  return kept.sort((p, q) => p - q)
}

const FONT = '"Courier New", ui-monospace, Menlo, Consolas, monospace'
const LABEL = {
  major: { size: 16, dot: 6, hex: PALETTE.signYellow },
  minor: { size: 11, dot: 4, hex: PALETTE.marbleWhite },
} as const
const PAD = 2 // px around a label's box

/**
 * The overview's bitmap as the full map holds it: its file downloaded the first time the map opens
 * (`want`; a failed download is tried again at the next opening), decoded at each opening, and
 * released when the map closes (`release`), as Lunigiana's decodes to 52 MB. `ready` hears that the
 * bitmap came while the map is still open; one that comes after it closed is let go at once.
 */
export const overviewBitmap = <B extends { close(): void }>(
  download: () => Promise<Blob>,
  decode: (file: Blob) => Promise<B>,
  ready: () => void,
) => {
  let file: Promise<Blob> | undefined,
    bitmap: B | undefined,
    openings = 0,
    /** The current opening's number; 0 while the map is closed. */
    open = 0
  return {
    /** The decoded overview, while the map is open and it has come. */
    get bitmap(): B | undefined {
      return bitmap
    },
    /** The map opened: download the overview if it has not been, and decode it. */
    want: (): void => {
      if (open !== 0) return
      const opening = (open = ++openings)
      file ??= download()
      file.then(decode).then(
        (decoded) => {
          if (open === opening) {
            bitmap = decoded
            ready()
          } else decoded.close()
        },
        () => {
          if (open === opening) file = undefined
        },
      )
    },
    /** The map closed: let the decoded overview go. */
    release: (): void => {
      open = 0
      bitmap?.close()
      bitmap = undefined
    },
  }
}

/**
 * Binds the full map to its markup (#hud-map). `show` paints it for the player at (x, y) heading
 * `angle` (radians CCW from east), over the overview at `overview` (the page's map's, `src/maps.ts`).
 */
export const makeWorldMap = (
  document: Document,
  overview: URL = mapForSearch(document.defaultView!.location.search).overview,
) => {
  const root = element(document, "hud-map"),
    here = element(document, "hud-map-here")
  const window = document.defaultView!
  // The player marker has its own canvas over the map, so CSS can blink it (hud.css) without repainting.
  const canvas = document.createElement("canvas"),
    marker = document.createElement("canvas")
  marker.className = "marker"
  root.prepend(canvas, marker)
  const ctx = canvas.getContext("2d"),
    mark = marker.getContext("2d")
  let player = { x: Number.NaN, y: Number.NaN, angle: 0 }

  const paint = () => {
    if (ctx === null || mark === null) return
    // The dialog's own box, not the window's: a phone held upright lays the page out sideways (hud.css).
    const width = root.clientWidth,
      height = root.clientHeight,
      dpr = window.devicePixelRatio
    for (const [c, g] of [
      [canvas, ctx],
      [marker, mark],
    ] as const) {
      c.width = Math.round(width * dpr)
      c.height = Math.round(height * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, width, height)
    }
    const { bounds } = MAP
    const fit = fitMap(bounds, width, height)
    const px = (x: number) => fit.ox + (x - bounds.minX) * fit.scale,
      py = (y: number) => fit.oy + (bounds.maxY - y) * fit.scale
    const mapW = (bounds.maxX - bounds.minX) * fit.scale,
      mapH = (bounds.maxY - bounds.minY) * fit.scale
    // The overview spans the bounds exactly, and is smoothed: it is drawn smaller than it is.
    const image = overviewMap.bitmap
    if (image !== undefined) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(image, fit.ox, fit.oy, mapW, mapH)
    }
    // The frame's corners and the labels' outlines are round, as the map's lines are.
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 2
    ctx.strokeStyle = css(PALETTE.marbleWhite)
    ctx.strokeRect(fit.ox - 1, fit.oy - 1, mapW + 2, mapH + 2)

    // Place names: a dot on the place, the name above it; names that would collide are left out.
    ctx.textAlign = "center"
    ctx.textBaseline = "bottom"
    const labels = PLACES.map((p) => {
      const look = p.major ? LABEL.major : LABEL.minor
      ctx.font = `700 ${look.size}px ${FONT}`
      const text = p.major ? p.name.toUpperCase() : p.name
      // Centred over the place, but kept inside the map frame.
      const w = ctx.measureText(text).width,
        y = py(p.y) - look.dot
      const x = Math.min(fit.ox + mapW - w / 2 - PAD, Math.max(fit.ox + w / 2 + PAD, px(p.x)))
      return {
        text,
        look,
        x,
        y,
        dotX: px(p.x),
        dotY: py(p.y),
        major: p.major,
        x0: x - w / 2 - PAD,
        x1: x + w / 2 + PAD,
        y0: y - look.size - PAD,
        y1: y + PAD,
      }
    })
    const nx = fit.ox + mapW - 20,
      ny = fit.oy + 12
    // A place without its name is just a dot that reads as someone else's: dots go with their labels.
    for (const i of placeLabels(labels, [{ x0: nx - 6, x1: nx + 6, y0: ny - 9, y1: ny + 14 }])) {
      const l = labels[i]!
      ctx.fillStyle = css(PALETTE.outline)
      ctx.fillRect(
        l.dotX - l.look.dot / 2 - 1,
        l.dotY - l.look.dot / 2 - 1,
        l.look.dot + 2,
        l.look.dot + 2,
      )
      ctx.fillStyle = css(l.look.hex)
      ctx.fillRect(l.dotX - l.look.dot / 2, l.dotY - l.look.dot / 2, l.look.dot, l.look.dot)
      ctx.font = `700 ${l.look.size}px ${FONT}`
      ctx.lineWidth = 3
      ctx.strokeStyle = css(PALETTE.outline)
      ctx.strokeText(l.text, l.x, l.y)
      ctx.fillStyle = css(l.look.hex)
      ctx.fillText(l.text, l.x, l.y)
    }

    // North arrow (top right of the map) and a 1 km scale bar (bottom left).
    ctx.font = `700 14px ${FONT}`
    ctx.textBaseline = "top"
    ctx.lineWidth = 3
    ctx.strokeText("N", nx, ny)
    ctx.fillStyle = css(PALETTE.marbleWhite)
    ctx.fillText("N", nx, ny)
    ctx.beginPath()
    ctx.moveTo(nx, ny - 8)
    ctx.lineTo(nx - 5, ny - 1)
    ctx.lineTo(nx + 5, ny - 1)
    ctx.closePath()
    ctx.fill()
    const bar = 1000 * fit.scale,
      bx = fit.ox,
      by = fit.oy + mapH + 12
    ctx.fillStyle = css(PALETTE.marbleWhite)
    ctx.fillRect(bx, by, bar, 3)
    ctx.fillRect(bx, by - 4, 2, 11)
    ctx.fillRect(bx + bar - 2, by - 4, 2, 11)
    ctx.textAlign = "left"
    ctx.fillText("1 km", bx + bar + 8, by - 5)

    // The player, on the blinking canvas above everything, in red: no label is red, so it never melts into a village name.
    if (Number.isFinite(player.x)) {
      mark.translate(Math.round(px(player.x)), Math.round(py(player.y)))
      mark.beginPath()
      mark.arc(0, 0, 13, 0, 2 * Math.PI)
      mark.lineWidth = 5
      mark.strokeStyle = css(PALETTE.outline)
      mark.stroke()
      mark.lineWidth = 2
      mark.strokeStyle = css(PALETTE.signalRed)
      mark.stroke()
      mark.rotate(-player.angle)
      paintArrow(mark, 18, PALETTE.signalRed)
    }
  }
  const onResize = () => paint()
  const overviewMap = overviewBitmap(
    async () => (await fetchFile(overview)).blob(),
    (file) => createImageBitmap(file),
    paint,
  )

  return {
    get open(): boolean {
      return !root.hidden
    },
    /** Opens (or repaints) the map for the player at (x, y) heading `angle`. */
    show: (x: number, y: number, angle: number): void => {
      player = { x, y, angle }
      here.textContent = Number.isFinite(x) ? districtAt(x, y).name : ""
      root.hidden = false
      root.focus({ preventScroll: true }) // the dialog takes focus, so screen readers announce it
      paint()
      overviewMap.want()
      window.addEventListener("resize", onResize)
    },
    hide: (): void => {
      root.hidden = true
      overviewMap.release()
      window.removeEventListener("resize", onResize)
    },
  }
}

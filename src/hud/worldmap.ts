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
import { districtAt, inPlay, MAP } from "../sim/map/index.ts"
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

/** The map point (x east, y north) painted at (sx, sy) px on a `width` × `height` px screen fitted to `bounds`, or undefined off its frame. */
export const mapPointAt = (
  bounds: Bounds,
  width: number,
  height: number,
  sx: number,
  sy: number,
): { readonly x: number; readonly y: number } | undefined => {
  const fit = fitMap(bounds, width, height)
  const x = bounds.minX + (sx - fit.ox) / fit.scale,
    y = bounds.maxY - (sy - fit.oy) / fit.scale
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY
    ? { x, y }
    : undefined
}

/**
 * A named place: `rank` is its kind's place in RANKS, the order labels are placed in; towns and
 * villages are `major` (big labels), hamlets and peaks are not.
 */
export interface Place {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly rank: number
  readonly major: boolean
}

/** The kinds of place the full map names, in the order their labels are placed. */
const RANKS: ReadonlyArray<string> = ["place=town", "place=village", "place=hamlet", "natural=peak"]

const isPlace = (kind: string) =>
  kind === "place=town" || kind === "place=village" || kind === "place=hamlet"
const districts: ReadonlySet<string> = new Set(MAP.districts.map((d) => d.name))
const place = (
  name: string,
  p: { readonly x: number; readonly y: number; readonly kind: string },
): Place => {
  const rank = RANKS.indexOf(p.kind)
  return { name, x: p.x, y: p.y, rank, major: rank < RANKS.indexOf("place=hamlet") }
}

/**
 * The towns, villages and hamlets OSM names inside the map (its `place=*` POIs; localities left
 * out), then the peaks the HUD names (a landmark district of the same name), once per name: OSM has
 * two Argigliano nodes and two Monte Borla summits.
 */
export const PLACES: ReadonlyArray<Place> = [
  ...MAP.pois.flatMap((p) => (p.name !== undefined && isPlace(p.kind) ? [place(p.name, p)] : [])),
  ...MAP.pois.flatMap((p) =>
    p.name !== undefined && p.kind === "natural=peak" && districts.has(p.name)
      ? [place(p.name, p)]
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

/** A place's label to place: its rank, its dot's box and the boxes its name may take, best first. */
interface Label {
  readonly rank: number
  readonly dot: Box
  readonly sides: ReadonlyArray<Box>
}

/**
 * The side each label's name takes (an index in its `sides`), or undefined for one left out with
 * its dot. Ranks go in order, and within one the label with the fewest free sides goes next (the
 * earlier on a tie), so a name with room to spare does not take another's last side. A side is free
 * when it overlaps none of the `fixed` boxes (the north arrow, the scale bar), the names and dots
 * placed, its own dot, or the dots its rank has still to place: a name over a dot reads as that
 * place's. A dot under a placed name or dot leaves its label out.
 */
export const placeLabels = (
  labels: ReadonlyArray<Label>,
  fixed: ReadonlyArray<Box> = [],
): Array<number | undefined> => {
  const taken = [...fixed],
    placed: Array<number | undefined> = labels.map(() => undefined)
  let left = labels.map((_, i) => i)
  while (left.length > 0) {
    const rank = Math.min(...left.map((i) => labels[i]!.rank)),
      group = left.filter((i) => labels[i]!.rank === rank)
    const free = (i: number): Array<number> => {
      const { dot, sides } = labels[i]!
      if (!taken.every((b) => apart(dot, b))) return []
      return sides.flatMap((side, s) =>
        taken.every((b) => apart(side, b)) && group.every((j) => apart(side, labels[j]!.dot))
          ? [s]
          : [],
      )
    }
    let next = group[0]!,
      sides = free(next)
    for (const i of group.slice(1)) {
      const s = free(i)
      if (s.length < sides.length) [next, sides] = [i, s]
    }
    left = left.filter((i) => i !== next)
    if (sides[0] !== undefined) {
      placed[next] = sides[0]
      taken.push(labels[next]!.dot, labels[next]!.sides[sides[0]]!)
    }
  }
  return placed
}

const FONT = '"Courier New", ui-monospace, Menlo, Consolas, monospace'
const LABEL = {
  major: { size: 16, dot: 6, hex: PALETTE.signYellow },
  minor: { size: 11, dot: 4, hex: PALETTE.marbleWhite },
} as const
const PAD = 2 // px around a label's box

/** Where the north arrow stands over a map fitted as `fit`: by its top-right corner. */
const northOf = (fit: Fit) => ({
  x: fit.ox + (MAP.bounds.maxX - MAP.bounds.minX) * fit.scale - 20,
  y: fit.oy + 12,
})

/** Where the 1 km scale bar starts under a map fitted as `fit` (below its bottom-left corner), and its length in px. */
const barOf = (fit: Fit) => ({
  x: fit.ox,
  y: fit.oy + (MAP.bounds.maxY - MAP.bounds.minY) * fit.scale + 12,
  length: 1000 * fit.scale,
})

/** A place's name as the full map paints it: its dot's centre, and the name in `box`. */
interface MapLabel {
  readonly name: string
  readonly text: string
  readonly look: (typeof LABEL)[keyof typeof LABEL]
  readonly dotX: number
  readonly dotY: number
  readonly box: Box
}

/**
 * The place names the full map paints over the map fitted as `fit`, `measure` giving a text's
 * width in px at a font size: each centred above its dot, else below it, right or left of it, kept
 * inside the frame across; one with no side free is left out with its dot (`placeLabels`). The
 * place named `first` (the player's district, as the header names it) goes before every other, so
 * a crowded map still names the village the player is in.
 */
export const mapLabels = (
  fit: Fit,
  measure: (text: string, size: number) => number,
  first?: string,
): Array<MapLabel> => {
  const { bounds } = MAP
  const west = fit.ox,
    east = fit.ox + (bounds.maxX - bounds.minX) * fit.scale
  const labels = PLACES.map((p) => {
    const look = p.major ? LABEL.major : LABEL.minor,
      text = p.major ? p.name.toUpperCase() : p.name
    const w = measure(text, look.size),
      h = look.size,
      d = look.dot
    const dotX = fit.ox + (p.x - bounds.minX) * fit.scale,
      dotY = fit.oy + (bounds.maxY - p.y) * fit.scale
    // The name's box centred at (x, y), slid across to stay inside the frame.
    const box = (x: number, y: number): Box => {
      const cx = Math.min(east - w / 2 - PAD, Math.max(west + w / 2 + PAD, x))
      return {
        x0: cx - w / 2 - PAD,
        x1: cx + w / 2 + PAD,
        y0: y - h / 2 - PAD,
        y1: y + h / 2 + PAD,
      }
    }
    return {
      name: p.name,
      text,
      look,
      dotX,
      dotY,
      rank: p.name === first ? -1 : p.rank,
      // The dot's box leaves out its 1 px outline: the names' 2 px padding keeps them clear of it.
      dot: { x0: dotX - d / 2, x1: dotX + d / 2, y0: dotY - d / 2, y1: dotY + d / 2 },
      sides: [
        box(dotX, dotY - d - h / 2),
        box(dotX, dotY + d + h / 2),
        box(dotX + d + w / 2, dotY),
        box(dotX - d - w / 2, dotY),
      ],
    }
  })
  // The north arrow, and the scale bar with its end ticks and "1 km" after it: a name below a dot
  // near the bottom edge can reach down into the bar's margin.
  const n = northOf(fit),
    bar = barOf(fit)
  const placed = placeLabels(labels, [
    { x0: n.x - 6, x1: n.x + 6, y0: n.y - 9, y1: n.y + 14 },
    {
      x0: bar.x,
      x1: bar.x + bar.length + 8 + measure("1 km", 14),
      y0: bar.y - 5,
      y1: bar.y + 9,
    },
  ])
  return labels.flatMap(({ name, text, look, dotX, dotY, sides }, i) => {
    const side = placed[i]
    return side === undefined ? [] : [{ name, text, look, dotX, dotY, box: sides[side]! }]
  })
}

/**
 * The overview's bitmap as the full map holds it: its file downloaded the first time the map opens
 * (`want`; a failed download is tried again at the next opening), decoded at each opening still open
 * when the file is in (so openings while it downloads decode it once), and released when the map
 * closes (`release`), as Lunigiana's decodes to about 56 MB (3410 × 4096 × 4 B). `ready` hears that
 * the bitmap came while the map is still open; one that comes after it closed is let go at once.
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
      const opening = (open = ++openings),
        pending = (file ??= download())
      // A failed download (or decode) is tried again at the next opening, whenever it failed.
      const failed = () => {
        if (file === pending) file = undefined
      }
      pending.then((blob) => {
        // An opening closed before the file came decodes nothing: only the current one does.
        if (open !== opening) return
        decode(blob).then((decoded) => {
          if (open === opening) {
            bitmap = decoded
            ready()
          } else decoded.close()
        }, failed)
      }, failed)
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
  let player = { x: Number.NaN, y: Number.NaN, angle: 0 },
    /** The player's district, which the header names and whose place is labelled first; "" with no position. */
    district = ""

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

    // Place names: a dot on the place, the name beside it; names that would collide are left out.
    ctx.textAlign = "center"
    ctx.textBaseline = "bottom"
    const labels = mapLabels(
      fit,
      (text, size) => {
        ctx.font = `700 ${size}px ${FONT}`
        return ctx.measureText(text).width
      },
      district,
    )
    // A place without its name is just a dot that reads as someone else's: dots go with their labels.
    for (const l of labels) {
      ctx.fillStyle = css(PALETTE.outline)
      ctx.fillRect(
        l.dotX - l.look.dot / 2 - 1,
        l.dotY - l.look.dot / 2 - 1,
        l.look.dot + 2,
        l.look.dot + 2,
      )
      ctx.fillStyle = css(l.look.hex)
      ctx.fillRect(l.dotX - l.look.dot / 2, l.dotY - l.look.dot / 2, l.look.dot, l.look.dot)
      // The name is centred across its box, on the box's bottom less its padding.
      const x = (l.box.x0 + l.box.x1) / 2,
        y = l.box.y1 - PAD
      ctx.font = `700 ${l.look.size}px ${FONT}`
      ctx.lineWidth = 3
      ctx.strokeStyle = css(PALETTE.outline)
      ctx.strokeText(l.text, x, y)
      ctx.fillStyle = css(l.look.hex)
      ctx.fillText(l.text, x, y)
    }

    // North arrow (top right of the map) and a 1 km scale bar (bottom left).
    const { x: nx, y: ny } = northOf(fit)
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
    const { x: bx, y: by, length: bar } = barOf(fit)
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
      district = here.textContent = Number.isFinite(x) ? districtAt(x, y).name : ""
      root.hidden = false
      root.focus({ preventScroll: true }) // the dialog takes focus, so screen readers announce it
      paint()
      overviewMap.want()
      window.addEventListener("resize", onResize)
    },
    /**
     * The play-area point (x east, y north) a click on the map lands on, or undefined off it: in
     * the header, the margins or outside the outline. The click's offset is in the dialog's own
     * box, which both canvases fill (the blinking marker lets clicks through while it is off), so a
     * phone held upright (laid out sideways) reads true.
     */
    pointAt: (event: MouseEvent): { readonly x: number; readonly y: number } | undefined => {
      if (event.target !== canvas && event.target !== marker) return undefined
      const at = mapPointAt(
        MAP.bounds,
        root.clientWidth,
        root.clientHeight,
        event.offsetX,
        event.offsetY,
      )
      return at !== undefined && inPlay(at.x, at.y) ? at : undefined
    },
    hide: (): void => {
      root.hidden = true
      overviewMap.release()
      window.removeEventListener("resize", onResize)
    },
  }
}

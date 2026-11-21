/**
 * The full map (M or a tap on the minimap; Esc or a tap closes it): the whole play area north-up
 * over the screen, the build's overview of it (src/tools/overview.ts, downloaded when the map first
 * opens) scaled to fit, with the frame, the villages and hamlets named, the scale bar and the player
 * as an arrow painted afresh at screen resolution over it. The wheel or a pinch zooms it and a drag
 * pans it (`map-view.ts`). While it is open the host stops ticking the simulation and drawing the
 * world (`main.ts`).
 *
 * @module hud/worldmap
 */
import { mapForSearch } from "../maps.ts"
import { css, PALETTE } from "../render/palette.ts"
import { districtAt, inPlay, MAP } from "../sim/map/index.ts"
import { fetchFile } from "../stream.ts"
import { placeLabels } from "./labels.ts"
import { makeMapDetail } from "./map-detail.ts"
import {
  type Box,
  type Fit,
  fitMap,
  mapGestures,
  mapPointAt,
  panView,
  wholeMap,
  zoomView,
} from "./map-view.ts"
import { paintArrow } from "./minimap.ts"
import { overviewBitmap } from "./overview-bitmap.ts"
import { element } from "./title.ts"

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

/**
 * The kinds of place the full map names, in the order their labels are placed, each with its
 * label's look: the name's size and the dot's, px, and their colour. Towns and villages are yellow
 * capitals, hamlets and peaks smaller and white.
 */
const RANKS = [
  { kind: "place=town", size: 16, dot: 6, hex: PALETTE.signYellow },
  { kind: "place=village", size: 14, dot: 6, hex: PALETTE.signYellow },
  { kind: "place=hamlet", size: 11, dot: 4, hex: PALETTE.marbleWhite },
  { kind: "natural=peak", size: 11, dot: 4, hex: PALETTE.marbleWhite },
] as const
const rankOf = (kind: string) => RANKS.findIndex((r) => r.kind === kind)
/** The village's rank (the first after the towns') and the hamlet's (the first not a major). */
const VILLAGE = rankOf("place=village"),
  HAMLET = rankOf("place=hamlet")

const isPlace = (kind: string) =>
  kind === "place=town" || kind === "place=village" || kind === "place=hamlet"
const place = (
  name: string,
  p: { readonly x: number; readonly y: number; readonly kind: string },
): Place => {
  const rank = rankOf(p.kind)
  return { name, x: p.x, y: p.y, rank, major: rank < HAMLET }
}

/**
 * The towns, villages and hamlets OSM names inside the map (its `place=*` POIs; localities left
 * out), then the peaks the HUD names (inside a landmark district of the same name: Sarzana's Monte
 * Grosso, not Fivizzano's, one of five peaks of that name, issue #20), once per name: OSM has two
 * Argigliano nodes and two Monte Borla summits.
 */
export const PLACES: ReadonlyArray<Place> = [
  ...MAP.pois.flatMap((p) => (p.name !== undefined && isPlace(p.kind) ? [place(p.name, p)] : [])),
  ...MAP.pois.flatMap((p) =>
    p.name !== undefined &&
    p.kind === "natural=peak" &&
    MAP.districts.some((d) => d.name === p.name && Math.hypot(p.x - d.x, p.y - d.y) <= d.r)
      ? [place(p.name, p)]
      : [],
  ),
].filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)

const FONT = '"Courier New", ui-monospace, Menlo, Consolas, monospace'
const PAD = 2 // px around a label's box

/** The most zoom, px/m (1 km 2000 px): a street and its houses across a good part of the screen. */
const MAX_SCALE = 2
/** How long the map holds still before its detail is painted again for where it stands, ms. */
const SETTLE = 120

/** Where the north arrow stands over a map fitted as `fit`: by its frame's top-right corner. */
const northOf = ({ frame }: Fit) => ({ x: frame.x1 - 20, y: frame.y0 + 12 })

/** The scale bar's lengths, m, longest first: the first no longer than BAR_MOST px is drawn. */
const BAR_METRES = [1000, 500, 200, 100, 50] as const
const BAR_MOST = 160

/**
 * Where the scale bar starts under a map fitted as `fit` (below its frame's bottom-left corner),
 * its length in px and its label: 1 km, or as zoomed in the longest of 500, 200, 100 and 50 m no
 * longer than BAR_MOST px.
 */
const barOf = (fit: Fit) => {
  const metres = BAR_METRES.find((m) => m * fit.scale <= BAR_MOST) ?? BAR_METRES.at(-1)!
  return {
    x: fit.frame.x0,
    y: fit.frame.y1 + 12,
    length: metres * fit.scale,
    text: metres === 1000 ? "1 km" : `${metres} m`,
  }
}

/** A place's name as the full map paints it: its dot's centre, and the name in `box`. */
interface MapLabel {
  readonly name: string
  readonly text: string
  readonly look: (typeof RANKS)[number]
  readonly dotX: number
  readonly dotY: number
  readonly box: Box
}

/**
 * The place names the full map paints over the map fitted as `fit`, `measure` giving a text's
 * width in px at a font size: each place whose dot is on the frame (the part of the map on screen)
 * named centred above its dot, else below it, right or left of it, else (a town or a village)
 * above or below it to the right or the left; one with no side free is left out with its dot
 * (`placeLabels`). The place named `first` (the player's district, as the header names it) is
 * named with the towns and villages and before them when not all fit, so a crowded map still
 * names the place the player is in. Every name slides across to stay inside the frame; when that
 * leaves out a town, a village or the player's place and the whole map is narrower than the room
 * within the margins, those names may slide out to the room's sides instead, if that leaves out
 * fewer of them, as on Sarzana's plain by the frame's west edge at 1280 × 720.
 */
export const mapLabels = (
  fit: Fit,
  measure: (text: string, size: number) => number,
  first?: string,
): Array<MapLabel> => {
  const { bounds } = MAP,
    { frame, room } = fit
  /** The labels of the places on the frame, the majors' names slid across inside `across`. */
  const labelsWithin = (across: Box) =>
    PLACES.flatMap((p) => {
      const dotX = fit.ox + (p.x - bounds.minX) * fit.scale,
        dotY = fit.oy + (bounds.maxY - p.y) * fit.scale
      if (dotX < frame.x0 || dotX > frame.x1 || dotY < frame.y0 || dotY > frame.y1) return []
      const look = RANKS[p.rank]!,
        text = p.major ? p.name.toUpperCase() : p.name,
        major = p.major || p.name === first,
        { x0, x1 } = major ? across : frame
      const w = measure(text, look.size),
        h = look.size,
        d = look.dot
      // The name's box centred at (x, y), slid across to stay between x0 and x1.
      const box = (x: number, y: number): Box => {
        const cx = Math.min(x1 - w / 2 - PAD, Math.max(x0 + w / 2 + PAD, x))
        return {
          x0: cx - w / 2 - PAD,
          x1: cx + w / 2 + PAD,
          y0: y - h / 2 - PAD,
          y1: y + h / 2 + PAD,
        }
      }
      const above = dotY - d - h / 2,
        below = dotY + d + h / 2,
        right = dotX + d + w / 2,
        left = dotX - d - w / 2
      return [
        {
          name: p.name,
          text,
          look,
          dotX,
          dotY,
          rank: p.name === first ? -1 : p.rank,
          major,
          first: p.name === first || p.rank < VILLAGE,
          // The dot's box leaves out its 1 px outline: the names' 2 px padding keeps them clear.
          dot: { x0: dotX - d / 2, x1: dotX + d / 2, y0: dotY - d / 2, y1: dotY + d / 2 },
          // A town's or a village's name may also take the corners round its dot, which the dense
          // villages of the plains need to be named together. A hamlet's or a peak's keeps the four
          // sides: with the corners too, more hamlets are named, but round Monzone they take each
          // other's room, and Campiglione, which the user asked for, was left out at 1920 × 1080.
          sides: [
            box(dotX, above),
            box(dotX, below),
            box(right, dotY),
            box(left, dotY),
            ...(p.major
              ? [box(right, above), box(left, above), box(right, below), box(left, below)]
              : []),
          ],
        },
      ]
    })
  // The north arrow, and the scale bar with its end ticks and its length after it: a name below a dot
  // near the bottom edge can reach down into the bar's margin.
  const n = northOf(fit),
    bar = barOf(fit)
  const fixed = [
    { x0: n.x - 6, x1: n.x + 6, y0: n.y - 9, y1: n.y + 14 },
    {
      x0: bar.x,
      x1: bar.x + bar.length + 8 + measure(bar.text, 14),
      y0: bar.y - 5,
      y1: bar.y + 9,
    },
  ]
  const named = (across: Box) => {
    const labels = labelsWithin(across)
    return { labels, placed: placeLabels(labels, fixed) }
  }
  const majorsLeft = ({ labels, placed }: ReturnType<typeof named>) =>
    labels.filter((l, i) => l.major && placed[i] === undefined).length
  let { labels, placed } = named(frame)
  if (majorsLeft({ labels, placed }) > 0 && (frame.x0 > room.x0 || frame.x1 < room.x1)) {
    const wide = named(room)
    if (majorsLeft(wide) < majorsLeft({ labels, placed })) ({ labels, placed } = wide)
  }
  return labels.flatMap(({ name, text, look, dotX, dotY, sides }, i) => {
    const side = placed[i]
    return side === undefined ? [] : [{ name, text, look, dotX, dotY, box: sides[side]! }]
  })
}

/**
 * Binds the full map to its markup (#hud-map). `show` paints it for the player at (x, y) heading
 * `angle` (radians CCW from east), over the overview and, zoomed in, the tiles' detail of `map` (the
 * page's map, `src/maps.ts`).
 */
export const makeWorldMap = (
  document: Document,
  map: { readonly overview: URL; readonly tileUrl: (key: string) => URL } = mapForSearch(
    document.defaultView!.location.search,
  ),
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
    district = "",
    /** How the map is zoomed and panned: the whole map at each opening. */
    view = wholeMap(MAP.bounds),
    /** The repaint `schedule` asked for, until its frame comes. */
    pending = 0,
    /** The detail's painting `refine` waits to make, until the map holds still. */
    settling: ReturnType<typeof setTimeout> | undefined

  // The dialog's own box, not the window's: a phone held upright lays the page out sideways (hud.css).
  const screen = () => ({ bounds: MAP.bounds, width: root.clientWidth, height: root.clientHeight })
  /** The most zoom: MAX_SCALE, as a zoom of the whole map. */
  const most = (): number => MAX_SCALE / fitMap(screen()).scale

  const paint = () => {
    if (ctx === null || mark === null) return
    const s = screen(),
      { width, height } = s,
      dpr = window.devicePixelRatio
    for (const [c, g] of [
      [canvas, ctx],
      [marker, mark],
    ] as const) {
      // Sized only when the box or the pixel ratio changed: a drag repaints every frame.
      const w = Math.round(width * dpr),
        h = Math.round(height * dpr)
      if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h]
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, width, height)
    }
    const { bounds } = MAP
    const fit = fitMap(s, view),
      { frame } = fit
    const px = (x: number) => fit.ox + (x - bounds.minX) * fit.scale,
      py = (y: number) => fit.oy + (bounds.maxY - y) * fit.scale
    // The overview spans the bounds exactly: the part of it under the frame is drawn there,
    // smoothed, as it is drawn smaller than it is (zoomed in, larger: the detail then covers it).
    const image = overviewMap.bitmap
    if (image !== undefined) {
      const ix = image.width / ((bounds.maxX - bounds.minX) * fit.scale),
        iy = image.height / ((bounds.maxY - bounds.minY) * fit.scale)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(
        image,
        (frame.x0 - fit.ox) * ix,
        (frame.y0 - fit.oy) * iy,
        (frame.x1 - frame.x0) * ix,
        (frame.y1 - frame.y0) * iy,
        frame.x0,
        frame.y0,
        frame.x1 - frame.x0,
        frame.y1 - frame.y0,
      )
    }
    detail.draw(ctx, fit, width, height)
    // The frame's corners and the labels' outlines are round, as the map's lines are.
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 2
    ctx.strokeStyle = css(PALETTE.marbleWhite)
    ctx.strokeRect(frame.x0 - 1, frame.y0 - 1, frame.x1 - frame.x0 + 2, frame.y1 - frame.y0 + 2)

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
    const { x: bx, y: by, length: bar, text: barText } = barOf(fit)
    ctx.fillStyle = css(PALETTE.marbleWhite)
    ctx.fillRect(bx, by, bar, 3)
    ctx.fillRect(bx, by - 4, 2, 11)
    ctx.fillRect(bx + bar - 2, by - 4, 2, 11)
    ctx.textAlign = "left"
    ctx.fillText(barText, bx + bar + 8, by - 5)

    // The player, on the blinking canvas above everything, in red: no label is red, so it never
    // melts into a village name. Zoomed away from them, it is not drawn.
    const mx = px(player.x),
      my = py(player.y)
    if (mx >= frame.x0 && mx <= frame.x1 && my >= frame.y0 && my <= frame.y1) {
      mark.translate(Math.round(mx), Math.round(my))
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
  const overviewMap = overviewBitmap(
    async () => (await fetchFile(map.overview)).blob(),
    (file) => createImageBitmap(file),
    paint,
  )
  /** Paints the detail for where the map stands, then the map. */
  const settle = () => {
    settling = undefined
    if (root.hidden) return
    const s = screen()
    detail.paint(fitMap(s, view), s.width, s.height, window.devicePixelRatio)
    paint()
  }
  /** Paints the detail again once the map has held still for SETTLE ms (a tile came, or a gesture moved it). */
  const refine = () => {
    clearTimeout(settling)
    settling = setTimeout(settle, SETTLE)
  }
  const detail = makeMapDetail(document, map.tileUrl, refine)
  const onResize = () => {
    paint()
    refine()
  }
  /** Repaints at the next frame, once however many gestures come before it, and the detail once they stop. */
  const schedule = () => {
    pending ||= window.requestAnimationFrame(() => {
      pending = 0
      if (!root.hidden) paint()
    })
    refine()
  }
  const gestures = mapGestures(root, canvas, (target) => target === canvas || target === marker, {
    pan: (dx, dy) => {
      view = panView(screen(), view, dx, dy)
      schedule()
    },
    zoom: (factor, sx, sy) => {
      view = zoomView(screen(), view, factor, sx, sy, most())
      schedule()
    },
  })

  return {
    get open(): boolean {
      return !root.hidden
    },
    /** Opens the map for the player at (x, y) heading `angle`, the whole of it in view, or repaints it as zoomed when it is open. */
    show: (x: number, y: number, angle: number): void => {
      player = { x, y, angle }
      district = here.textContent = Number.isFinite(x) ? districtAt(x, y).name : ""
      if (root.hidden) view = wholeMap(MAP.bounds)
      root.hidden = false
      root.focus({ preventScroll: true }) // the dialog takes focus, so screen readers announce it
      settle()
      overviewMap.want()
      window.addEventListener("resize", onResize)
    },
    /**
     * The play-area point (x east, y north) a click on the map lands on, as zoomed, or undefined
     * off it: in the header, the margins or outside the outline. The click's offset is in the dialog's own
     * box, which both canvases fill (the blinking marker lets clicks through while it is off), so a
     * phone held upright (laid out sideways) reads true.
     */
    pointAt: (event: MouseEvent): { readonly x: number; readonly y: number } | undefined => {
      if (event.target !== canvas && event.target !== marker) return undefined
      const at = mapPointAt(MAP.bounds, fitMap(screen(), view), event.offsetX, event.offsetY)
      return at !== undefined && inPlay(at.x, at.y) ? at : undefined
    },
    /** Whether the click now heard ends a drag or a pinch of the map, rather than a tap. */
    dragged: gestures.dragged,
    hide: (): void => {
      root.hidden = true
      clearTimeout(settling)
      overviewMap.release()
      detail.release()
      window.removeEventListener("resize", onResize)
    },
  }
}

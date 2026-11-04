/**
 * Where the full map stands on the screen, and the gestures that zoom and pan it: the wheel and a
 * drag with the mouse, a pinch and a drag on a touch screen. `fitMap` places the whole map inside
 * MARGIN at zoom 1; zoomed in, the map overflows that room and shows the part round the view's
 * centre, never past its own edges.
 *
 * @module hud/map-view
 */

/** Screen px kept clear around the map: the header above, the scale bar (and the two-line credits of narrow windows) below. */
const MARGIN = { top: 64, right: 24, bottom: 56, left: 24 } as const

/** A screen box, px. */
export interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** The map's bounds and the `width` × `height` px box the full map is laid out in. */
export interface Screen {
  readonly bounds: Bounds
  readonly width: number
  readonly height: number
}

/** How the full map is zoomed: `zoom` times the whole map's fit (1 shows it all), the map point (x east, y north) at the middle of the room inside MARGIN. */
export interface MapView {
  readonly zoom: number
  readonly x: number
  readonly y: number
}

/** North-up placement: `scale` px per metre, the map's north-west corner at (ox, oy), and `frame`, the part of the map on screen. */
export interface Fit {
  readonly scale: number
  readonly ox: number
  readonly oy: number
  readonly frame: Box
}

/** The room inside MARGIN, at least 1 px each way. */
const roomOf = ({ width, height }: Screen) => ({
  x: MARGIN.left,
  y: MARGIN.top,
  w: Math.max(1, width - MARGIN.left - MARGIN.right),
  h: Math.max(1, height - MARGIN.top - MARGIN.bottom),
})

/** The whole map at zoom 1, centred. */
export const wholeMap = ({ minX, minY, maxX, maxY }: Bounds): MapView => ({
  zoom: 1,
  x: (minX + maxX) / 2,
  y: (minY + maxY) / 2,
})

/** The largest north-up scale that fits the whole map inside MARGIN, px per metre. */
const wholeScale = (screen: Screen): number => {
  const { bounds } = screen,
    room = roomOf(screen)
  return Math.min(room.w / (bounds.maxX - bounds.minX), room.h / (bounds.maxY - bounds.minY))
}

/**
 * `view` with its zoom between 1 and `most` (never below 1), and its centre moved so the map
 * covers the room along each side it overflows, and is centred along each side it does not.
 */
export const clampView = (
  screen: Screen,
  view: MapView,
  most = Number.POSITIVE_INFINITY,
): MapView => {
  const { bounds } = screen,
    room = roomOf(screen)
  const zoom = Math.max(1, Math.min(most, view.zoom)),
    scale = wholeScale(screen) * zoom
  const along = (at: number, min: number, max: number, half: number) =>
    max - min <= 2 * half ? (min + max) / 2 : Math.min(max - half, Math.max(min + half, at))
  return {
    zoom,
    x: along(view.x, bounds.minX, bounds.maxX, room.w / 2 / scale),
    y: along(view.y, bounds.minY, bounds.maxY, room.h / 2 / scale),
  }
}

/** Where the map stands on `screen` for `view` (clamped; the whole map, fitted inside MARGIN and centred, by default). */
export const fitMap = (screen: Screen, view: MapView = wholeMap(screen.bounds)): Fit => {
  const { bounds } = screen,
    room = roomOf(screen),
    v = clampView(screen, view)
  const scale = wholeScale(screen) * v.zoom
  const ox = room.x + room.w / 2 - (v.x - bounds.minX) * scale,
    oy = room.y + room.h / 2 - (bounds.maxY - v.y) * scale
  return {
    scale,
    ox,
    oy,
    frame: {
      x0: Math.max(room.x, ox),
      y0: Math.max(room.y, oy),
      x1: Math.min(room.x + room.w, ox + (bounds.maxX - bounds.minX) * scale),
      y1: Math.min(room.y + room.h, oy + (bounds.maxY - bounds.minY) * scale),
    },
  }
}

/** The map point (x east, y north) painted at (sx, sy) px under `fit`, or undefined off its frame. */
export const mapPointAt = (
  bounds: Bounds,
  fit: Fit,
  sx: number,
  sy: number,
): { readonly x: number; readonly y: number } | undefined => {
  const { frame } = fit
  return sx >= frame.x0 && sx <= frame.x1 && sy >= frame.y0 && sy <= frame.y1
    ? { x: bounds.minX + (sx - fit.ox) / fit.scale, y: bounds.maxY - (sy - fit.oy) / fit.scale }
    : undefined
}

/** `view` zoomed `factor` times about the screen point (sx, sy), which keeps the map point under it, up to `most`. */
export const zoomView = (
  screen: Screen,
  view: MapView,
  factor: number,
  sx: number,
  sy: number,
  most: number,
): MapView => {
  const { bounds } = screen,
    room = roomOf(screen),
    fit = fitMap(screen, view)
  const at = {
    x: bounds.minX + (sx - fit.ox) / fit.scale,
    y: bounds.maxY - (sy - fit.oy) / fit.scale,
  }
  const zoom = Math.max(1, Math.min(most, clampView(screen, view).zoom * factor)),
    scale = wholeScale(screen) * zoom
  return clampView(
    screen,
    {
      zoom,
      x: at.x - (sx - room.x - room.w / 2) / scale,
      y: at.y + (sy - room.y - room.h / 2) / scale,
    },
    most,
  )
}

/** `view` with the map dragged (dx, dy) px across the screen (y down). */
export const panView = (screen: Screen, view: MapView, dx: number, dy: number): MapView => {
  const v = clampView(screen, view),
    scale = wholeScale(screen) * v.zoom
  return clampView(screen, { zoom: v.zoom, x: v.x - dx / scale, y: v.y + dy / scale })
}

/** How far, px, a press may travel and still be a tap (which closes the map) rather than a drag. */
const TAP_SLOP = 6

/** A mouse wheel's line and page, px, for wheels that count in those. */
const WHEEL_STEP = { 1: 16, 2: 400 } as Readonly<Record<number, number>>

type Pointer = Pick<PointerEvent, "pointerId" | "pointerType" | "button" | "offsetX" | "offsetY">
type Wheel = Pick<
  WheelEvent,
  "deltaY" | "deltaMode" | "ctrlKey" | "offsetX" | "offsetY" | "target"
> &
  Pick<Event, "preventDefault">

/**
 * Binds the gestures that move the full map, heard on `root`: a press on the map (`onMap` its
 * target; the main mouse button only) is captured by `surface`, so the offsets of its moves stay in
 * the box both share; one pointer pans, two pan by their midpoint and zoom by their spread about it;
 * the wheel zooms about the cursor (e^(−deltaY / 500) a notch, or e^(−deltaY / 100) for a trackpad's
 * pinch, which the browser sends as a wheel with Ctrl), and is kept from scrolling or zooming the
 * page. `dragged` says whether the press now ending moved more than TAP_SLOP or pinched, so its
 * click is not a tap.
 */
export const mapGestures = (
  root: Pick<EventTarget, "addEventListener">,
  surface: { setPointerCapture(pointerId: number): void },
  onMap: (target: EventTarget | null) => boolean,
  move: {
    readonly pan: (dx: number, dy: number) => void
    readonly zoom: (factor: number, sx: number, sy: number) => void
  },
) => {
  const down = new Map<number, { readonly x: number; readonly y: number }>()
  let travel = 0
  root.addEventListener("pointerdown", (event) => {
    const e = event as unknown as Pointer
    if (!onMap(event.target) || (e.pointerType === "mouse" && e.button !== 0)) return
    if (down.size === 0) travel = 0
    down.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
    surface.setPointerCapture(e.pointerId)
  })
  root.addEventListener("pointermove", (event) => {
    const e = event as unknown as Pointer,
      last = down.get(e.pointerId)
    if (last === undefined) return
    const now = { x: e.offsetX, y: e.offsetY },
      other = [...down].find(([id]) => id !== e.pointerId)?.[1]
    down.set(e.pointerId, now)
    travel += Math.hypot(now.x - last.x, now.y - last.y)
    if (other === undefined) {
      move.pan(now.x - last.x, now.y - last.y)
      return
    }
    travel = Number.POSITIVE_INFINITY
    const mx = (now.x + other.x) / 2,
      my = (now.y + other.y) / 2
    move.pan(mx - (last.x + other.x) / 2, my - (last.y + other.y) / 2)
    const before = Math.hypot(last.x - other.x, last.y - other.y)
    if (before > 0) move.zoom(Math.hypot(now.x - other.x, now.y - other.y) / before, mx, my)
  })
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    root.addEventListener(type, (event) => down.delete((event as unknown as Pointer).pointerId))
  root.addEventListener(
    "wheel",
    (event) => {
      const e = event as unknown as Wheel
      e.preventDefault()
      if (!onMap(e.target)) return
      const dy = e.deltaY * (WHEEL_STEP[e.deltaMode] ?? 1)
      move.zoom(Math.exp(-dy / (e.ctrlKey ? 100 : 500)), e.offsetX, e.offsetY)
    },
    { passive: false },
  )
  return {
    /** Whether the press that made the click now heard dragged or pinched the map. */
    dragged: (): boolean => travel > TAP_SLOP,
  }
}

import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import {
  clampView,
  fitMap,
  mapGestures,
  mapPointAt,
  panView,
  wholeMap,
  zoomView,
} from "../map-view.ts"
import { PLACES } from "../worldmap.ts"

const b = MAP.bounds
const screenOf = (width: number, height: number) => ({ bounds: b, width, height })
const near = (a: number, c: number, what: string) => assert.ok(Math.abs(a - c) < 1e-6, what)
/** The map point painted at (sx, sy) under `fit`, frame or not. */
const under = (fit: ReturnType<typeof fitMap>, sx: number, sy: number) => ({
  x: b.minX + (sx - fit.ox) / fit.scale,
  y: b.maxY - (sy - fit.oy) / fit.scale,
})

test("the map fits the screen inside the margins, centred, with north up and the aspect kept", () => {
  for (const [w, h] of [
    [1280, 720],
    [720, 1280],
    [2560, 1440],
  ] as const) {
    const fit = fitMap(screenOf(w, h))
    const mapW = (b.maxX - b.minX) * fit.scale,
      mapH = (b.maxY - b.minY) * fit.scale
    assert.ok(fit.ox >= 24 - 1e-9 && fit.ox + mapW <= w - 24 + 1e-9, `fits across at ${w}x${h}`)
    assert.ok(fit.oy >= 64 - 1e-9 && fit.oy + mapH <= h - 56 + 1e-9, `fits down at ${w}x${h}`)
    // One side touches its margins: the scale is as large as it can be.
    assert.ok(Math.abs(fit.ox - 24) < 1e-6 || Math.abs(fit.oy - 64) < 1e-6)
    assert.ok(
      Math.abs(fit.ox - (w - fit.ox - mapW)) < 1e-6 ||
        Math.abs(fit.oy - 64 - (h - 56 - fit.oy - mapH)) < 1e-6,
      "centred",
    )
    // The whole map is on screen: its frame is its own box.
    near(fit.frame.x0, fit.ox, "frame west")
    near(fit.frame.x1, fit.ox + mapW, "frame east")
    near(fit.frame.y0, fit.oy, "frame north")
    near(fit.frame.y1, fit.oy + mapH, "frame south")
  }
})

test("a point on the map's screen is the map point painted there; one outside its frame is none", () => {
  for (const [w, h] of [
    [1280, 720],
    [844, 390],
    [1920, 1080],
  ] as const) {
    for (const view of [wholeMap(b), { zoom: 6, x: PLACES[0]!.x, y: PLACES[0]!.y }]) {
      const fit = fitMap(screenOf(w, h), view),
        { frame } = fit
      for (const p of PLACES) {
        const sx = fit.ox + (p.x - b.minX) * fit.scale,
          sy = fit.oy + (b.maxY - p.y) * fit.scale
        const at = mapPointAt(b, fit, sx, sy)
        const on = sx >= frame.x0 && sx <= frame.x1 && sy >= frame.y0 && sy <= frame.y1
        if (on) assert.ok(Math.hypot(at!.x - p.x, at!.y - p.y) < 1e-6, `${p.name} at ${w}x${h}`)
        else assert.equal(at, undefined, `${p.name} off the frame at ${w}x${h}`)
      }
      for (const [sx, sy] of [
        [frame.x0 - 1, frame.y0 + 10],
        [frame.x0 + 10, frame.y0 - 1],
        [frame.x1 + 1, frame.y0 + 10],
        [frame.x0 + 10, frame.y1 + 1],
      ] as const)
        assert.equal(mapPointAt(b, fit, sx, sy), undefined, `off the frame at ${sx},${sy}`)
    }
    // The frame's top-left corner at zoom 1 is the bounds' north-west.
    const fit = fitMap(screenOf(w, h))
    assert.deepEqual(mapPointAt(b, fit, fit.ox, fit.oy), { x: b.minX, y: b.maxY })
  }
})

test("zooming keeps the map point under the cursor, from the whole map up to the most zoom", () => {
  const screen = screenOf(1280, 720)
  // Zoomed in far from the edges, so the clamp leaves the view where the zoom put it.
  let view = { zoom: 4, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  const sx = 700,
    sy = 300,
    p = under(fitMap(screen, view), sx, sy)
  for (let i = 0; i < 4; i++) {
    view = zoomView(screen, view, 1.5, sx, sy, 50)
    const at = under(fitMap(screen, view), sx, sy)
    assert.ok(Math.hypot(at.x - p.x, at.y - p.y) < 1e-6, `the point stays put at zoom ${view.zoom}`)
  }
  near(view.zoom, 4 * 1.5 ** 4, "zoomed in")
  assert.equal(zoomView(screen, view, 100, sx, sy, 50).zoom, 50, "never past the most")
  // Back out to zoom 1, the whole map is centred again, wherever the cursor was.
  assert.deepEqual(zoomView(screen, view, 1e-3, sx, sy, 20), wholeMap(b))
  // With no zoom to spare (the overview not in), the wheel does nothing.
  assert.deepEqual(zoomView(screen, wholeMap(b), 2, sx, sy, 1), wholeMap(b))
})

test("panning moves the map with the drag, never past its edges, and not at all when it fits", () => {
  const screen = screenOf(1280, 720),
    room = { x0: 24, y0: 64, x1: 1280 - 24, y1: 720 - 56 }
  assert.deepEqual(panView(screen, wholeMap(b), 300, -200), wholeMap(b))
  const zoomed = { zoom: 4, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  const fit = fitMap(screen, zoomed),
    moved = fitMap(screen, panView(screen, zoomed, 30, -20))
  near(moved.ox - fit.ox, 30, "dragged east")
  near(moved.oy - fit.oy, -20, "dragged north")
  // Zoomed in, the map fills the room however far it is dragged: its frame is the room.
  for (const [dx, dy] of [
    [1e6, 0],
    [-1e6, 0],
    [0, 1e6],
    [0, -1e6],
  ] as const) {
    const far = fitMap(screen, panView(screen, zoomed, dx, dy))
    assert.deepEqual(far.frame, room, `dragged ${dx},${dy}`)
  }
  // The edge dragged to stays there: west edge at the room's west.
  near(fitMap(screen, panView(screen, zoomed, 1e6, 0)).ox, 24, "west edge")
  // A view left beyond its edges (the window grew) is pulled back.
  const out = clampView(screen, { zoom: 4, x: b.maxX + 1e4, y: b.minY - 1e4 })
  near(fitMap(screen, out).frame.x1, room.x1, "east edge")
})

/** A pointer or wheel event as the browser hands it to the gestures. */
const event = (type: string, fields: Record<string, unknown>) =>
  Object.assign(new Event(type, { cancelable: true }), fields)

/** Gestures bound to a fake map, with every pan and zoom they ask for. */
const bound = () => {
  const root = new EventTarget(),
    captured: Array<number> = [],
    pans: Array<[number, number]> = [],
    zooms: Array<[number, number, number]> = []
  let onMap = true
  const gestures = mapGestures(
    root,
    { setPointerCapture: (id) => captured.push(id) },
    () => onMap,
    { pan: (dx, dy) => pans.push([dx, dy]), zoom: (f, x, y) => zooms.push([f, x, y]) },
  )
  const send = (type: string, fields: Record<string, unknown>) => {
    const e = event(type, { pointerType: "touch", button: 0, ...fields })
    root.dispatchEvent(e)
    return e
  }
  return {
    gestures,
    captured,
    pans,
    zooms,
    send,
    offMap: () => {
      onMap = false
    },
  }
}

test("gestures: a drag pans and is no tap; a press that barely moves is", () => {
  const g = bound()
  g.send("pointerdown", { pointerId: 1, pointerType: "mouse", offsetX: 100, offsetY: 100 })
  assert.deepEqual(g.captured, [1], "the press is captured, so its moves keep the map's offsets")
  g.send("pointermove", { pointerId: 1, offsetX: 103, offsetY: 101 })
  g.send("pointerup", { pointerId: 1 })
  assert.equal(g.gestures.dragged(), false, "a tap")
  g.send("pointerdown", { pointerId: 1, pointerType: "mouse", offsetX: 100, offsetY: 100 })
  g.send("pointermove", { pointerId: 1, offsetX: 110, offsetY: 104 })
  g.send("pointermove", { pointerId: 1, offsetX: 140, offsetY: 90 })
  g.send("pointerup", { pointerId: 1 })
  assert.deepEqual(g.pans, [
    [3, 1],
    [10, 4],
    [30, -14],
  ])
  assert.equal(g.gestures.dragged(), true, "a drag")
  // Moves with no press down, and after it, pan nothing.
  g.send("pointermove", { pointerId: 1, offsetX: 0, offsetY: 0 })
  assert.equal(g.pans.length, 3)
})

test("gestures: two fingers pan by their midpoint and zoom by their spread about it", () => {
  const g = bound()
  g.send("pointerdown", { pointerId: 1, offsetX: 100, offsetY: 100 })
  g.send("pointerdown", { pointerId: 2, offsetX: 200, offsetY: 100 })
  g.send("pointermove", { pointerId: 2, offsetX: 300, offsetY: 100 })
  assert.deepEqual(g.pans, [[50, 0]])
  assert.deepEqual(g.zooms, [[2, 200, 100]])
  // One finger lifted, the other pans alone; the pinch was no tap.
  g.send("pointerup", { pointerId: 2 })
  g.send("pointermove", { pointerId: 1, offsetX: 90, offsetY: 100 })
  assert.deepEqual(g.pans.at(-1), [-10, 0])
  g.send("pointerup", { pointerId: 1 })
  assert.equal(g.gestures.dragged(), true)
})

test("gestures: the wheel zooms about the cursor, a trackpad's pinch faster, and never scrolls the page", () => {
  const g = bound()
  const notch = g.send("wheel", {
    deltaY: -100,
    deltaMode: 0,
    ctrlKey: false,
    offsetX: 5,
    offsetY: 6,
  })
  assert.ok(notch.defaultPrevented)
  g.send("wheel", { deltaY: 3, deltaMode: 1, ctrlKey: false, offsetX: 5, offsetY: 6 })
  g.send("wheel", { deltaY: -10, deltaMode: 0, ctrlKey: true, offsetX: 5, offsetY: 6 })
  near(g.zooms[0]![0], Math.exp(0.2), "a notch in")
  near(g.zooms[1]![0], Math.exp(-48 / 500), "three lines out")
  near(g.zooms[2]![0], Math.exp(0.1), "a trackpad's pinch")
  assert.deepEqual(g.zooms[0]!.slice(1), [5, 6])
})

test("gestures: presses off the map, and the mouse's other buttons, move nothing", () => {
  const g = bound()
  g.send("pointerdown", { pointerId: 1, pointerType: "mouse", button: 2, offsetX: 0, offsetY: 0 })
  g.send("pointermove", { pointerId: 1, offsetX: 50, offsetY: 0 })
  g.offMap()
  g.send("pointerdown", { pointerId: 2, offsetX: 0, offsetY: 0 })
  g.send("pointermove", { pointerId: 2, offsetX: 50, offsetY: 0 })
  const wheel = g.send("wheel", {
    deltaY: 100,
    deltaMode: 0,
    ctrlKey: false,
    offsetX: 0,
    offsetY: 0,
  })
  assert.deepEqual([g.pans, g.zooms, g.captured], [[], [], []])
  assert.ok(wheel.defaultPrevented, "the page does not scroll under the map either")
})

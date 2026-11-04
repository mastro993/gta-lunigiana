import assert from "node:assert/strict"
import { test } from "node:test"

import { districtAt, inPlay, MAP } from "../../sim/map/index.ts"
import { fitMap, mapPointAt, overviewBitmap, PLACES, placeLabels } from "../worldmap.ts"

test("the map fits the screen inside the margins, centred, with north up and the aspect kept", () => {
  const b = MAP.bounds
  for (const [w, h] of [
    [1280, 720],
    [720, 1280],
    [2560, 1440],
  ] as const) {
    const fit = fitMap(b, w, h)
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
  }
})

test("a point on the map's screen is the map point painted there; one outside its frame is none", () => {
  const b = MAP.bounds
  for (const [w, h] of [
    [1280, 720],
    [844, 390],
    [1920, 1080],
  ] as const) {
    const fit = fitMap(b, w, h)
    for (const p of PLACES) {
      const sx = fit.ox + (p.x - b.minX) * fit.scale,
        sy = fit.oy + (b.maxY - p.y) * fit.scale
      const at = mapPointAt(b, w, h, sx, sy)!
      assert.ok(Math.hypot(at.x - p.x, at.y - p.y) < 1e-6, `${p.name} at ${w}x${h}`)
    }
    const mapW = (b.maxX - b.minX) * fit.scale,
      mapH = (b.maxY - b.minY) * fit.scale
    // The frame's top-left corner is the bounds' north-west, and its far corner is on the map.
    assert.deepEqual(mapPointAt(b, w, h, fit.ox, fit.oy), { x: b.minX, y: b.maxY })
    assert.ok(mapPointAt(b, w, h, fit.ox + mapW - 0.5, fit.oy + mapH - 0.5) !== undefined)
    for (const [sx, sy] of [
      [fit.ox - 1, fit.oy + 10],
      [fit.ox + 10, fit.oy - 1],
      [fit.ox + mapW + 1, fit.oy + 10],
      [fit.ox + 10, fit.oy + mapH + 1],
    ] as const)
      assert.equal(mapPointAt(b, w, h, sx, sy), undefined, `off the frame at ${sx},${sy}`)
  }
})

/** A 10 px square label box at (x, y). */
const box = (x: number, y = 0) => ({ x0: x, x1: x + 10, y0: y, y1: y + 10 })
/** A label of `rank`, its dot at x = `dot` on a row of its own, its name taking one of `sides`. */
const label = (rank: number, dot: number, ...sides: Array<ReturnType<typeof box>>) => ({
  rank,
  dot: box(dot, 100),
  sides,
})

test("labels: ranks in order, each name on its first free side, fewest free sides first", () => {
  // The player's place (rank -1, `mapLabels`), the town, then villages, hamlets and peaks, whatever
  // their order.
  assert.deepEqual(
    placeLabels([
      label(3, 0, box(0)),
      label(2, 20, box(0)),
      label(1, 40, box(0)),
      label(-1, 60, box(0)),
      label(0, 80, box(0)),
    ]),
    [undefined, undefined, undefined, 0, undefined],
  )
  // A name taken on its first side goes on its next; touching boxes do not overlap.
  assert.deepEqual(placeLabels([label(0, 0, box(0)), label(1, 20, box(5), box(20))]), [0, 1])
  assert.deepEqual(placeLabels([label(1, 0, box(0)), label(1, 20, box(10))]), [0, 0])
  // Of two with as many free sides, the earlier wins; one with fewer goes first.
  assert.deepEqual(placeLabels([label(1, 0, box(0)), label(1, 20, box(5))]), [0, undefined])
  assert.deepEqual(placeLabels([label(1, 0, box(0), box(20)), label(1, 20, box(5))]), [1, 0])
  // A fixed box (the north arrow, the scale bar) beats every label.
  assert.deepEqual(placeLabels([label(0, 0, box(0)), label(1, 20, box(20))], [box(0)]), [
    undefined,
    0,
  ])
})

test("labels: a name never covers a dot, and a dot under a name goes with its label", () => {
  // Its own dot, a placed one, and one its rank has still to place are all kept clear.
  assert.deepEqual(placeLabels([label(1, 0, box(0, 100), box(20))]), [1])
  assert.deepEqual(placeLabels([label(0, 0, box(20)), label(1, 40, box(0, 100), box(60))]), [0, 1])
  assert.deepEqual(placeLabels([label(1, 0, box(20, 100), box(40)), label(1, 20, box(60))]), [1, 0])
  // A hamlet's dot under a village's name is left out with its name, though its side is free.
  assert.deepEqual(placeLabels([label(1, 0, box(20, 100)), label(2, 20, box(40))]), [0, undefined])
})

test("places: the villages, hamlets and peaks the user asked for, one per name, each in play and in the HUD district of its name", () => {
  // worldmap.map-test.ts checks that the full map draws them.
  const names = new Set(PLACES.map((p) => p.name))
  for (const name of [
    "Monzone",
    "Equi Terme",
    "Gragnola",
    "Colognola",
    "Campiglione",
    "Viano",
    "Vinca",
    "Ugliancaldo",
    "Tenerano",
    "Monte Sagro",
    "Pizzo d'Uccello",
  ])
    assert.ok(names.has(name), name)
  assert.equal(names.size, PLACES.length, "one label per name")
  assert.ok(
    PLACES.filter((p) => p.major)
      .map((p) => p.name)
      .includes("Gragnola"),
    "Gragnola is a village (big label)",
  )
  assert.ok(PLACES.every((p) => inPlay(p.x, p.y)))
  // Every place sits in the HUD district of the same name, so the map and the HUD agree.
  for (const name of [
    "Equi Terme",
    "Gragnola",
    "Colognola",
    "Campiglione",
    "Viano",
    "Vinca",
    "Ugliancaldo",
    "Tenerano",
    "Monte Sagro",
    "Pizzo d'Uccello",
  ]) {
    const p = PLACES.find((q) => q.name === name)!
    assert.equal(districtAt(p.x, p.y).name, name)
  }
})

test("the overview downloads once, is decoded at each opening and let go at each closing, even when it comes late", async () => {
  const heard: Array<number | undefined> = []
  let downloads = 0,
    offline = true
  const bitmaps: Array<{ readonly n: number; closed: boolean; close(): void }> = []
  const overview = overviewBitmap(
    () => {
      downloads++
      return offline ? Promise.reject(new Error("offline")) : Promise.resolve(new Blob(["png"]))
    },
    () => {
      const bitmap = {
        n: bitmaps.length,
        closed: false,
        close() {
          this.closed = true
        },
      }
      bitmaps.push(bitmap)
      return Promise.resolve(bitmap)
    },
    () => heard.push(overview.bitmap?.n),
  )
  const settle = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  overview.want()
  await settle()
  assert.deepEqual([downloads, overview.bitmap, heard], [1, undefined, []], "a failed download")
  overview.release()
  offline = false
  overview.want()
  overview.want() // a repaint while it is open
  await settle()
  assert.deepEqual(
    [downloads, overview.bitmap?.n, heard],
    [2, 0, [0]],
    "tried again when it opens again",
  )
  overview.release()
  assert.deepEqual(
    [overview.bitmap, bitmaps[0]!.closed],
    [undefined, true],
    "let go when it closes",
  )
  overview.want()
  overview.release() // closed before its file came
  await settle()
  assert.deepEqual(
    [overview.bitmap, bitmaps.length, heard],
    [undefined, 1, [0]],
    "an opening closed before the file came decodes nothing",
  )
  overview.want()
  await settle()
  assert.deepEqual([downloads, overview.bitmap?.n, heard], [2, 1, [0, 1]], "downloaded once")
})

test("the overview decodes once for the opening still open when its file comes, and a download that failed while the map was shut is tried again", async () => {
  let arrive: (blob: Blob) => void = () => {},
    fail: (error: Error) => void = () => {},
    downloads = 0,
    decodes = 0
  const overview = overviewBitmap(
    () => {
      downloads++
      return new Promise<Blob>((resolve, reject) => {
        arrive = resolve
        fail = reject
      })
    },
    () => {
      decodes++
      return Promise.resolve({ close() {} })
    },
    () => {},
  )
  const settle = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  // opened and shut three times while the file downloads, then open when it comes
  for (let k = 0; k < 3; k++) {
    overview.want()
    overview.release()
  }
  overview.want()
  arrive(new Blob(["png"]))
  await settle()
  assert.deepEqual([downloads, decodes], [1, 1])
  assert.ok(overview.bitmap !== undefined)
  overview.release()
  // a fresh overview whose download fails after the map has shut
  const late = overviewBitmap(
    () => {
      downloads++
      return new Promise<Blob>((resolve, reject) => {
        arrive = resolve
        fail = reject
      })
    },
    () => Promise.resolve({ close() {} }),
    () => {},
  )
  late.want()
  late.release()
  fail(new Error("offline"))
  await settle()
  late.want()
  arrive(new Blob(["png"]))
  await settle()
  assert.equal(downloads, 3, "downloaded again at the next opening")
  assert.ok(late.bitmap !== undefined)
})

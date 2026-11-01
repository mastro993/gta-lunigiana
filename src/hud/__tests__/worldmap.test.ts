import assert from "node:assert/strict"
import { test } from "node:test"

import { districtAt, inPlay, MAP } from "../../sim/map/index.ts"
import { fitMap, overviewBitmap, PLACES, placeLabels } from "../worldmap.ts"

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

test("labels: villages win over overlapping hamlets, apart labels all stay, order is kept", () => {
  const box = (x: number, major: boolean) => ({ x0: x, x1: x + 50, y0: 0, y1: 10, major })
  assert.deepEqual(placeLabels([box(0, false), box(30, true), box(100, false)]), [1, 2]) // the hamlet at 0 overlaps the village
  assert.deepEqual(placeLabels([box(0, false), box(50, false), box(100, true)]), [0, 1, 2]) // touching edges do not overlap
  assert.deepEqual(placeLabels([box(0, false), box(10, false)]), [0]) // the first hamlet wins a tie
  // A fixed box (the north arrow) beats every label, village or not.
  assert.deepEqual(
    placeLabels([box(0, true), box(100, false)], [{ x0: 40, x1: 52, y0: 0, y1: 20 }]),
    [1],
  )
})

test("places: the villages and hamlets the user asked for are named on the map", () => {
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

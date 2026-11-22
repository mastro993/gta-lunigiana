import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { districtAt, inPlay, MAP } from "../../sim/map/index.ts"
import { fitMap, wholeMap } from "../map-view.ts"
import { mapLabels, PLACES } from "../worldmap.ts"

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

test("zoomed in, the map names only the places on its frame, inside it, and names some the whole map leaves out", () => {
  const screen = { bounds: MAP.bounds, width: 1280, height: 720 }
  const p = PLACES.find((q) => q.name === "Gragnola")!
  const fit = fitMap(screen, { zoom: 8, x: p.x, y: p.y }),
    { frame } = fit
  const labels = mapLabels(fit, (text, size) => (text.length * 1229 * size) / 2048)
  assert.ok(labels.some((l) => l.name === "Gragnola"))
  for (const l of labels) {
    assert.ok(l.dotX >= frame.x0 && l.dotX <= frame.x1, l.name)
    assert.ok(l.dotY >= frame.y0 && l.dotY <= frame.y1, l.name)
    assert.ok(l.box.x0 >= frame.x0 && l.box.x1 <= frame.x1, `${l.name} across`)
  }
  const whole = new Set(
    mapLabels(fitMap(screen, wholeMap(MAP.bounds)), (t, s) => (t.length * 1229 * s) / 2048).map(
      (l) => l.name,
    ),
  )
  assert.ok(labels.some((l) => !whole.has(l.name)))
})

test("the whole map's names stay inside the room within the margins across, a hamlet's or a peak's inside the frame", () => {
  // worldmap.map-test.ts checks where the towns' and villages' names reach past the frame.
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [844, 390],
  ] as const) {
    const fit = fitMap({ bounds: MAP.bounds, width, height }),
      { frame, room } = fit
    for (const l of mapLabels(fit, (text, size) => (text.length * 1229 * size) / 2048)) {
      const within = PLACES.find((p) => p.name === l.name)!.major ? room : frame
      assert.ok(l.box.x0 >= within.x0 && l.box.x1 <= within.x1, `${l.name} at ${width}x${height}`)
    }
  }
})

test("the full map's canvases take no letter-spacing from the HUD, so Chrome lays the names out as wide as the tests measure them", () => {
  // Chrome measures and draws a canvas's text with the canvas's CSS letter-spacing; #hud's 0.06em
  // made each name 0.9 px a letter wider than Courier New's 0.6 em the tests measure (93.0 px for
  // BASTREMOLI at 14 px, not 84.0), so the game named fewer places than the tests check: at
  // 1280 × 720 it left out Valeriano, Ceparana and Piano di Valeriano.
  const css = readFileSync(new URL("../hud.css", import.meta.url), "utf8")
  const rule = /#hud-map canvas\s*\{([^}]*)\}/.exec(css)?.[1] ?? ""
  assert.match(rule, /letter-spacing:\s*(0(px|em)?|normal)\s*;/)
})

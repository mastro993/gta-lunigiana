import assert from "node:assert/strict"
import { test } from "node:test"

import { districtAt, MAP } from "../../sim/map/index.ts"
import { fitMap } from "../map-view.ts"
import { mapLabels, PLACES } from "../worldmap.ts"

// Map check (pnpm test:map): the names the full map draws over the whole map's places, which crowd
// as the map grows; worldmap.test.ts checks how labels are placed on made-up ones.

/** The villages, hamlets and peaks the user asked the full map to name. */
const ASKED = [
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
]

/**
 * The names drawn on a `width` × `height` px screen for a player in the district `here`. Courier
 * New, the labels' font, advances 1229/2048 em a character: Chrome measures the names so, and lays
 * them out as here.
 */
const named = (width: number, height: number, here: string) =>
  new Set(
    mapLabels(
      fitMap({ bounds: MAP.bounds, width, height }),
      (text, size) => (text.length * 1229 * size) / 2048,
      here,
    ).map((l) => l.name),
  )

const majors = PLACES.filter((p) => p.major).map((p) => p.name)

test("the full map names every town and village at 1920 × 1080 and 1280 × 720, and all but four on a phone, Monzone and Gragnola among them", () => {
  // The player at the start, in a district (Monzone's station) that names no place, so no name
  // goes first.
  const start = districtAt(MAP.spawns.player.x, MAP.spawns.player.y).name
  // At 1280 × 720 Colognola and Campiglione, 631 m apart, vie for the same room, and a fraction of
  // a pixel picks which is named (at a flat 0.6 em, Colognola), so neither is asked for there. The
  // villages a phone leaves out are the ones docs/architecture.md lists.
  const crowded = new Set(["Colognola", "Campiglione"])
  for (const [width, height, asked, unnamed] of [
    [1920, 1080, ASKED, []],
    [1280, 720, ASKED.filter((name) => !crowded.has(name)), []],
    [
      844,
      390,
      ["Monzone", "Equi Terme", "Gragnola", "Vinca", "Monte Sagro"],
      ["Casola in Lunigiana", "Casciana", "Pieve San Lorenzo", "Alebbio"],
    ],
  ] as const) {
    const drawn = named(width, height, start)
    assert.deepEqual(
      majors.filter((name) => !drawn.has(name)),
      unnamed,
      `villages left out at ${width}x${height}`,
    )
    for (const name of asked) assert.ok(drawn.has(name), `${name} at ${width}x${height}`)
  }
})

test("a player in a village's or an asked-for place's district finds it named on the full map, even on a phone", () => {
  for (const name of new Set([...majors, ...ASKED])) {
    const p = PLACES.find((q) => q.name === name)!
    const here = districtAt(p.x, p.y).name
    // Monzone's dot lies in Monzone Alto, one of the start's districts that name no place: the test
    // above finds Monzone named for a player in them.
    if (name === "Monzone") assert.equal(here, "Monzone Alto")
    else
      for (const [width, height] of [
        [1920, 1080],
        [1280, 720],
        [844, 390],
      ] as const)
        assert.ok(named(width, height, here).has(name), `${name} at ${width}x${height}`)
  }
})

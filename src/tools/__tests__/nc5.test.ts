// Adapter (c) on the NC5 (nc5.ts) over layer files written here as `fetch-lig` writes them, their
// features' attributes copied from Sarzana's (the cathedral's nave 248082_1707522 among them) and
// their squares placed by Sarzana's cathedral in EPSG:25832.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { gzipSync } from "node:zlib"

import { utm32ToLatLon } from "../crs.ts"
import { centroid, pointInRing, toLocal } from "../geometry.ts"
import { readNc5, referenceOf } from "../nc5.ts"
import type { Rect } from "../region.ts"
import { element5k, localOf, surveyId } from "../survey-ids.ts"

/** A box round every feature: Sarzana lies outside lucido's terrain box, the default. */
const ANYWHERE: Rect = [-1e5, -1e5, 1e5, 1e5]
/** The cathedral's nave, EPSG:25832. */
const E = 577010,
  N = 4884780

/** A closed square ring [e, n, z, …] of side `s` at (e, n), all at height `z`. */
const square = (e: number, n: number, s: number, z: number) => [
  e,
  n,
  z,
  e + s,
  n,
  z,
  e + s,
  n + s,
  z,
  e,
  n + s,
  z,
  e,
  n,
  z,
]

interface Feature {
  readonly properties: Record<string, string | number | null>
  readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
}
/** A part's folder holding `layers` (name → features) as fetch-lig writes them. */
const part = (t: TestContext, layers: Readonly<Record<string, ReadonlyArray<Feature>>>) => {
  const dir = mkdtempSync(join(tmpdir(), "nc5-"))
  t.after(() => rmSync(dir, { recursive: true }))
  mkdirSync(dir, { recursive: true })
  for (const [name, features] of Object.entries(layers))
    writeFileSync(
      join(dir, `${name}.json.gz`),
      gzipSync(JSON.stringify({ layer: `M2052:${name}`, crs: "EPSG:25832", features })),
    )
  return dir
}

const building = (classref: string, a: Record<string, string>, polygons: Feature["polygons"]) => ({
  properties: { classref, edifc_ty: "01", edifc_uso: "01", edifc_stat: "03", edifc_mon: 0, ...a },
  polygons,
})

test("referenceOf: a source reference's 1:5000 element and serial, others refused", () => {
  assert.deepEqual(referenceOf("248082_1707522"), {
    section: element5k("248082"),
    serial: 1707522,
  })
  for (const ref of ["", "248082-1707522", "248082_170752", "24808_1707522"])
    assert.throws(() => referenceOf(ref), /not an NC5 reference/, ref)
})

test("readNc5: a footprint per polygon at its own eave, the kind from the DBT's codes, ids by element and serial", (t) => {
  const dir = part(t, {
    L6871: [
      building("248082_1707522", { edifc_ty: "11", edifc_uso: "05" }, [[square(E, N, 30, 39.04)]]),
      // Stepped eaves: each part of a multipolygon its own building at its own Z.
      building("248082_1707600", {}, [
        [square(E + 50, N, 10, 32.05)],
        [square(E + 60, N, 10, 34.47)],
      ]),
      // A Z that varies along the ring: the highest.
      building("248082_1707601", {}, [
        [[...square(E + 80, N, 10, 37.66).slice(0, 12), E + 80, N, 40.35]],
      ]),
      building("248082_1707602", { edifc_stat: "02" }, [[square(E, N + 50, 10, 20)]]),
      building("248082_1707603", { edifc_uso: "0801" }, [[square(E + 20, N + 50, 10, 25)]]),
      building("248082_1707604", { edifc_uso: "0603" }, [[square(E + 40, N + 50, 10, 25)]]),
      building("248082_1707605", { edifc_ty: "07" }, [[square(E + 60, N + 50, 5, 50)]]),
    ],
    L6870: [
      {
        properties: { classref: "248082_1707606", edi_min_ty: "01", edi_min_st: "03" },
        polygons: [[square(E, N + 100, 4, 23.1)]],
      },
      {
        properties: { classref: "248082_1707607", edi_min_ty: "95", edi_min_st: "02" },
        polygons: [[square(E + 10, N + 100, 4, 23.1)]],
      },
    ],
  })
  const { buildings } = readNc5([dir], ANYWHERE)
  const section = element5k("248082")
  assert.deepEqual(
    buildings.map((b) => [b.id, b.kind, b.style, b.eave, b.h]),
    [
      [surveyId("nc5", section, localOf(1707522, 0)), "church", "church", 39.04, 10],
      [surveyId("nc5", section, localOf(1707600, 0)), "house", undefined, 32.05, 6],
      [surveyId("nc5", section, localOf(1707600, 1)), "house", undefined, 34.47, 6],
      [surveyId("nc5", section, localOf(1707601, 0)), "house", undefined, 40.35, 6],
      [surveyId("nc5", section, localOf(1707602, 0)), "ruins", "ruin", 20, 2.5],
      [surveyId("nc5", section, localOf(1707603, 0)), "industrial", "industrial", 25, 6],
      [surveyId("nc5", section, localOf(1707604, 0)), "train_station", "station", 25, 6],
      [surveyId("nc5", section, localOf(1707605, 0)), "tower", "tower", 50, 12],
      // The minor buildings' ids above 1e9, so a serial both layers use is two ids.
      [surveyId("nc5", section, 1e9 + localOf(1707606, 0)), "shed", undefined, 23.1, 2.5],
      [surveyId("nc5", section, 1e9 + localOf(1707607, 0)), "ruins", "ruin", 23.1, 2.5],
    ],
  )
  // In local metres through the CTR's UTM 32N: the nave's centre is the square's.
  const [x, y] = centroid(buildings[0]!.outer)
  const [cx, cy] = toLocal(...utm32ToLatLon(E + 15, N + 15))
  assert.ok(Math.hypot(x - cx, y - cy) < 0.1, `${x}, ${y} against ${cx}, ${cy}`)
  // The box clips them as the other surveys' are.
  const [ex, ey] = toLocal(...utm32ToLatLon(E - 100, N - 100))
  assert.deepEqual(readNc5([dir], [ex - 10, ey - 10, ex, ey]).buildings, [])
})

test("readNc5: carriageways but those in a tunnel as paved road surfaces, a building in two parts once, every part's mapped area", (t) => {
  const carriageway = (subregid: string, ac_vei_sed: string, e: number) => ({
    properties: { subregid, ac_vei_sed, ac_vei_liv: "02", ac_vei_zon: "01" },
    polygons: [[square(e, N - 50, 8, 20)]],
  })
  const layers = {
    L6871: [building("248082_1707522", {}, [[square(E, N, 30, 39.04)]])],
    L6858: [
      carriageway("248082_1752825", "01", E),
      carriageway("248082_1752826", "02", E + 20), // on a bridge
      carriageway("248082_1752827", "03", E + 40), // in a tunnel
    ],
    L6945: [
      {
        properties: { classid: "LASPEZIA_0000000001" },
        polygons: [[square(E - 500, N - 500, 1000, 0)]],
      },
    ],
  }
  // The next part east: the same buildings and carriageways (on both parts' boxes), and the lot's
  // mapped area as fetch-lig clips it to that part's own box.
  const a = part(t, layers),
    b = part(t, {
      ...layers,
      L6945: [{ ...layers.L6945[0]!, polygons: [[square(E + 500, N - 500, 1000, 0)]] }],
    })
  const one = readNc5([a], ANYWHERE)
  assert.deepEqual(
    one.roadAreas.map((r) => [r.paved, r.name]),
    [
      [true, undefined],
      [true, undefined],
    ],
  )
  assert.equal(one.mapped.length, 1)
  const both = readNc5([a, b], ANYWHERE)
  assert.deepEqual(both.buildings, one.buildings)
  assert.deepEqual(both.roadAreas, one.roadAreas)
  // Each part's piece of the lot is mapped, though both are the one feature `LASPEZIA_0000000001`.
  const east = toLocal(...utm32ToLatLon(E + 1200, N))
  assert.equal(both.mapped.length, 2)
  assert.ok(!one.mapped.some((ring) => pointInRing(east[0], east[1], ring)))
  assert.ok(both.mapped.some((ring) => pointInRing(east[0], east[1], ring)))
  assert.deepEqual(readNc5([join(a, "nowhere")], ANYWHERE), {
    buildings: [],
    roadAreas: [],
    mapped: [],
  })
  const nameless = part(t, { L6871: [building("", {}, [[square(E, N, 30, 39.04)]])] })
  assert.throws(() => readNc5([nameless], ANYWHERE), /L6871: a feature without its classref/)
})

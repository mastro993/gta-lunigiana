import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { gzipSync } from "node:zlib"

import { gaussBoagaToLatLon, latLonToGaussBoaga, latLonToUtm32, utm32ToLatLon } from "../crs.ts"
import { centroid, fromLocal, toLocal } from "../geometry.ts"
import { readUcs } from "../ucs.ts"

/** A closed square ring [e, n, …] of side `s` from (e, n). */
const square = (e: number, n: number, s: number) => [e, n, e + s, n, e + s, n + s, e, n + s, e, n]

/** Writes a land cover file as fetch-rt (`EPSG:3003`) and fetch-lig (`EPSG:25832`) do; its path. */
const file = (
  t: TestContext,
  crs: string,
  polygons: ReadonlyArray<{ id: number; code: string; rings: Array<Array<number>> }>,
): string => {
  const dir = mkdtempSync(join(tmpdir(), "ucs-"))
  t.after(() => rmSync(dir, { recursive: true }))
  const path = join(dir, "cover.json.gz")
  writeFileSync(path, gzipSync(JSON.stringify({ crs, year: 2025, polygons })))
  return path
}

test("readUcs reads Tuscany's EPSG:3003 and Liguria's EPSG:25832 by each file's crs, classes by their first three digits", (t) => {
  // Two 100 m squares inside lucido's box (the default TERRAIN_BOX), one in each CRS.
  const [ge, gn] = latLonToGaussBoaga(...fromLocal(0, 0)),
    [ue, un] = latLonToUtm32(...fromLocal(500, 500))
  const tuscany = file(t, "EPSG:3003", [{ id: 7, code: "332", rings: [square(ge, gn, 100)] }])
  const liguria = file(t, "EPSG:25832", [
    { id: 57712, code: "131", rings: [square(ue, un, 100)] },
    { id: 23568, code: "5121", rings: [square(ue + 200, un, 100)] }, // a natural basin: 512
    { id: 29266, code: "5111", rings: [square(ue + 400, un, 100)] }, // a river's bed: not kept
  ])
  const areas = readUcs([tuscany, liguria])
  assert.deepEqual(
    areas.map((a) => a.kind),
    ["rock", "quarry", "lake"],
  )
  const near = (ring: ReadonlyArray<number>, [x, y]: readonly [number, number]) => {
    const [cx, cy] = centroid(ring)
    return Math.hypot(cx - x, cy - y) < 0.2
  }
  assert.ok(near(areas[0]!.rings[0]!, toLocal(...gaussBoagaToLatLon(ge + 50, gn + 50))))
  assert.ok(near(areas[1]!.rings[0]!, toLocal(...utm32ToLatLon(ue + 50, un + 50))))
  const elsewhere = file(t, "EPSG:4326", [])
  assert.throws(() => readUcs([elsewhere]), /land cover in EPSG:4326/)
})

test("readUcs reads a polygon two parts' files hold once, and every polygon of a multipolygon", (t) => {
  const [e, n] = latLonToUtm32(...fromLocal(0, 0))
  // A multipolygon: one entry a polygon, under the same id.
  const polygons = [
    { id: 1, code: "332", rings: [square(e, n, 100)] },
    { id: 1, code: "332", rings: [square(e + 200, n, 100)] },
    { id: 2, code: "131", rings: [square(e + 400, n, 100)] },
  ]
  // The next part's file: what the WFS gives for its box, the multipolygon whole and one more.
  const a = file(t, "EPSG:25832", polygons),
    b = file(t, "EPSG:25832", [
      ...polygons.slice(0, 2),
      { id: 3, code: "131", rings: [square(e + 600, n, 100)] },
    ])
  assert.equal(readUcs([a]).length, 3)
  assert.equal(readUcs([a, b]).length, 4)
  assert.equal(readUcs([b, a]).length, 4)
  // Tuscany's ids are another file's, in another CRS.
  const [ge, gn] = latLonToGaussBoaga(...fromLocal(0, 0))
  const tuscany = file(t, "EPSG:3003", [{ id: 1, code: "332", rings: [square(ge, gn, 100)] }])
  assert.equal(readUcs([a, tuscany]).length, 4)
})

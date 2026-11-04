import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"

import { manifestPath, readManifest } from "../manifest.ts"

test("lucido's manifest lists its 25 CTR sheets, 85 LiDAR tiles and one 10 m DTM", () => {
  assert.ok(existsSync(manifestPath("lucido")))
  const { ctr, lidar, dtm10 } = readManifest("lucido")
  assert.equal(ctr.length, 25)
  // The 66 its rectangle's crop took, then the 19 its tiles needed once Fivizzano grew the
  // region's box past it (pick-lidar --write, issue #17)
  assert.equal(lidar.length, 85)
  assert.deepEqual(dtm10, ["MS_dtm10x10_epsg3003_md5_f691fc7fe3e6cdcb89d6dd82f65bb408"])
  assert.equal(new Set(ctr).size, ctr.length)
  assert.equal(new Set(lidar).size, lidar.length)
  for (const sheet of ctr) assert.match(sheet, /^\d\dD\d\d$/)
  for (const tile of lidar) assert.match(tile, /^\d\dd\d\d_1x1_dtm_\d{3}_\d{4}_3003_[\da-f]{32}$/)
})

test("lucido's LiDAR tiles put the 2010 flight before the 2012 flight, in each of its two picks", () => {
  const lots = readManifest("lucido").lidar.map((tile) => tile.split("_")[3])
  // pick-lidar --write keeps a manifest's tiles and adds the new picks after them: its rectangle's
  // 66 (47 of 2010, 19 of 2012), then the 19 the grown box added (17 and 2).
  for (const [pick, n2010, n2012] of [
    [lots.slice(0, 66), 47, 19],
    [lots.slice(66), 17, 2],
  ] as const) {
    assert.equal(pick.filter((lot) => lot === "004").length, n2010)
    assert.equal(pick.filter((lot) => lot === "005").length, n2012)
    assert.ok(pick.lastIndexOf("004") < pick.indexOf("005"))
  }
  // The 2010 sliver below Picco di Navola that PR #2's 65 tiles missed, in its place among the
  // 2010 tiles.
  const sliver = readManifest("lucido").lidar.indexOf(
    "22d14_1x1_dtm_004_2010_3003_a348f39b6dd6b4258843d5ada196028d",
  )
  assert.ok(sliver >= 0 && sliver < lots.indexOf("005"), `22d14/004 at ${sliver}`)
})

/** A manifest with every list empty. */
const EMPTY = { ctr: [], lidar: [], dtm10: [], dsm2021: [], ctr2009: [], ctr10k: [], dbt2k: [] }

test("a part without a manifest reads as empty lists", () => {
  assert.ok(!existsSync(manifestPath("no-such-part")))
  assert.deepEqual(readManifest("no-such-part"), EMPTY)
})

test("lucido's manifest lists the 2021 surface model's three elements over its holes", () => {
  // 249063 over the holes its tiles' cells past its rectangle left once Fivizzano grew the box
  assert.deepEqual(readManifest("lucido").dsm2021, ["249062", "249063", "249064"])
})

test("sillara's manifest lists 8 LiDAR tiles of the 2010 flight, Massa-Carrara's 10 m DTM and 5 elements of the 2021 surface model", () => {
  assert.ok(existsSync(manifestPath("sillara")))
  const { lidar, dtm10, dsm2021 } = readManifest("sillara")
  assert.equal(lidar.length, 8)
  assert.equal(new Set(lidar).size, lidar.length)
  for (const tile of lidar) assert.match(tile, /^\d\d[a-d]\d\d_1x1_dtm_004_2010_3003_[\da-f]{32}$/)
  assert.deepEqual(dtm10, ["MS_dtm10x10_epsg3003_md5_f691fc7fe3e6cdcb89d6dd82f65bb408"])
  assert.deepEqual(dsm2021, ["234011", "234012", "234013", "234014", "234051"])
})

test("a manifest written before the 2021 surface model and the older surveys reads them as none", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"))
  t.after(() => rmSync(dir, { recursive: true }))
  writeFileSync(join(dir, "old.json"), JSON.stringify({ ctr: ["23D11"], lidar: [], dtm10: [] }))
  // A key relative to data/parts reaches the temp file, so the test writes nothing there.
  const key = relative(dirname(manifestPath("old")), join(dir, "old"))
  assert.deepEqual(readManifest(key), { ...EMPTY, ctr: ["23D11"] })
})

test("a manifest listing two DBT surveys of one comune is refused", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"))
  t.after(() => rmSync(dir, { recursive: true }))
  // Minucciano's two surveys, as rt-index lists them: fetch-rt pins a comune's layers under its
  // ISTAT code alone, so the second would write over the first.
  const dbt2k = [
    "DBT2K_046019_MINUCCIANO_2011_2011_3003_55abb15279c81a6b3756d9bdfc1f6124",
    "DBT2K_046019_MINUCCIANO_1988_2000_3003_53bfaef25ab5d865864f6b6a281009d9",
  ]
  writeFileSync(join(dir, "twice.json"), JSON.stringify({ ...EMPTY, dbt2k }))
  writeFileSync(join(dir, "once.json"), JSON.stringify({ ...EMPTY, dbt2k: dbt2k.slice(0, 1) }))
  const key = (name: string) => relative(dirname(manifestPath(name)), join(dir, name))
  assert.throws(() => readManifest(key("twice")), /dbt2k lists one comune twice/)
  assert.deepEqual(readManifest(key("once")).dbt2k, dbt2k.slice(0, 1))
})

test("pontremoli-town's manifest lists Pontremoli's DBT 1:2000 of 2010 and nothing else", () => {
  assert.ok(existsSync(manifestPath("pontremoli-town")))
  assert.deepEqual(readManifest("pontremoli-town"), {
    ...EMPTY,
    dbt2k: ["DBT2K_045014_PONTREMOLI_2010_2010_3003_21f45aa3f469081de7f71f76d5913f2b"],
  })
})

test("lucido's manifest lists the 12 sheets of 2009 on the Carrara side whose mapped area meets it, and no CTR 1:10 000 or DBT", () => {
  const { ctr2009, ctr10k, dbt2k } = readManifest("lucido")
  // 22D02–07 and 22D10–15, each mapping 5.6 ha (22D05) to 148.6 ha (22D03) of lucido.
  assert.deepEqual(
    ctr2009,
    [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15].map((n) => `22D${String(n).padStart(2, "0")}`),
  )
  // The CTR 1:10 000 only where a manifest lists it, so lucido keeps OSM's huts beyond the CTR 1:2000.
  assert.deepEqual(ctr10k, [])
  assert.deepEqual(dbt2k, [])
})

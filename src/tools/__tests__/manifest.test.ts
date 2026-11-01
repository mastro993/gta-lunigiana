import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"

import { manifestPath, readManifest } from "../manifest.ts"

test("lucido's manifest lists today's 25 CTR sheets, 66 LiDAR tiles and one 10 m DTM", () => {
  assert.ok(existsSync(manifestPath("lucido")))
  const { ctr, lidar, dtm10 } = readManifest("lucido")
  assert.equal(ctr.length, 25)
  assert.equal(lidar.length, 66)
  assert.deepEqual(dtm10, ["MS_dtm10x10_epsg3003_md5_f691fc7fe3e6cdcb89d6dd82f65bb408"])
  assert.equal(new Set(ctr).size, ctr.length)
  assert.equal(new Set(lidar).size, lidar.length)
  for (const sheet of ctr) assert.match(sheet, /^\d\dD\d\d$/)
  for (const tile of lidar) assert.match(tile, /^\d\dd\d\d_1x1_dtm_\d{3}_\d{4}_3003_[\da-f]{32}$/)
})

test("lucido's LiDAR tiles put the 2010 flight before the 2012 flight", () => {
  const lots = readManifest("lucido").lidar.map((tile) => tile.split("_")[3])
  assert.equal(lots.filter((lot) => lot === "004").length, 47)
  assert.equal(lots.filter((lot) => lot === "005").length, 19)
  assert.ok(lots.lastIndexOf("004") < lots.indexOf("005"))
  // The 2010 sliver below Picco di Navola that PR #2's 65 tiles missed, in its place among the
  // 2010 tiles.
  const sliver = readManifest("lucido").lidar.indexOf(
    "22d14_1x1_dtm_004_2010_3003_a348f39b6dd6b4258843d5ada196028d",
  )
  assert.ok(sliver >= 0 && sliver < lots.indexOf("005"), `22d14/004 at ${sliver}`)
})

test("a part without a manifest reads as empty lists", () => {
  assert.ok(!existsSync(manifestPath("no-such-part")))
  assert.deepEqual(readManifest("no-such-part"), { ctr: [], lidar: [], dtm10: [], dsm2021: [] })
})

test("lucido's manifest lists the 2021 surface model's two elements over its holes", () => {
  assert.deepEqual(readManifest("lucido").dsm2021, ["249062", "249064"])
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

test("a manifest written before the 2021 surface model reads its elements as none", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"))
  t.after(() => rmSync(dir, { recursive: true }))
  writeFileSync(join(dir, "old.json"), JSON.stringify({ ctr: ["23D11"], lidar: [], dtm10: [] }))
  // A key relative to data/parts reaches the temp file, so the test writes nothing there.
  const key = relative(dirname(manifestPath("old")), join(dir, "old"))
  assert.deepEqual(readManifest(key), { ctr: ["23D11"], lidar: [], dtm10: [], dsm2021: [] })
})

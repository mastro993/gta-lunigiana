import assert from "node:assert/strict"
import { existsSync } from "node:fs"
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
  assert.deepEqual(readManifest("no-such-part"), { ctr: [], lidar: [], dtm10: [] })
})

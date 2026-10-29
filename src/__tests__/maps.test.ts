import assert from "node:assert/strict"
import { existsSync, statSync } from "node:fs"
import { test } from "node:test"

import { mapForSearch } from "../maps.ts"
import { tileKey } from "../sim/map/kinds.ts"
import { decodeMap, readMapFile } from "../sim/map/packed.ts"

test("Lunigiana remains the default map", () => {
  assert.equal(mapForSearch("?seed=42").id, "lunigiana")
  assert.ok(mapForSearch("").url.pathname.endsWith("monzone.bin"))
})

test("Cesena selects a separate bundled map and title", () => {
  const map = mapForSearch("?map=cesena&seed=42")
  assert.equal(map.name, "Cesena")
  assert.ok(map.url.pathname.endsWith("cesena.bin"))
})

test("unknown maps produce a useful error instead of silently loading the wrong city", () => {
  assert.throws(() => mapForSearch("?map=missing"), /Unknown map/)
})

test("every tile each map's global file lists has a file at its tile URL, in the map's own directory, of at most 0.7 MB", () => {
  for (const search of ["?map=lunigiana", "?map=cesena"]) {
    const map = mapForSearch(search)
    const { name, tiles } = decodeMap(readMapFile(map.url))
    assert.ok(tiles.length > 0, map.id)
    for (const { i, j } of tiles) {
      const url = map.tileUrl(tileKey(i, j))
      assert.ok(url.pathname.endsWith(`/${name}/${tileKey(i, j)}.bin`), url.pathname)
      assert.ok(existsSync(url), `${map.id}: ${url.pathname}`)
      // Issue #3's scale checks (#18, #21–#23): a tile download stays small.
      assert.ok(
        statSync(url).size <= 700_000,
        `${map.id}: ${url.pathname} is ${statSync(url).size} B`,
      )
    }
  }
})

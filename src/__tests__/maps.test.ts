import assert from "node:assert/strict"
import { existsSync } from "node:fs"
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

// maps.map-test.ts checks every tile of both maps and its size.
test("a tile each map's global file lists has its file at its tile URL, in the map's own directory", () => {
  for (const search of ["?map=lunigiana", "?map=cesena"]) {
    const map = mapForSearch(search)
    const { name, tiles } = decodeMap(readMapFile(map.url))
    assert.ok(tiles.length > 0, map.id)
    const { i, j } = tiles[0]!,
      url = map.tileUrl(tileKey(i, j))
    assert.ok(url.pathname.endsWith(`/${name}/${tileKey(i, j)}.bin`), url.pathname)
    assert.ok(existsSync(url), `${map.id}: ${url.pathname}`)
  }
})

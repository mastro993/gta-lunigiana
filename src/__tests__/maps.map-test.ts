import assert from "node:assert/strict"
import { existsSync, statSync } from "node:fs"
import { test } from "node:test"

import { mapForSearch } from "../maps.ts"
import { decodeMap } from "../sim/map/format/global-file.ts"
import { tileKey } from "../sim/map/kinds.ts"
import { readMapFile } from "../sim/map/source.ts"

// Map check (pnpm test:map): every tile of both maps; maps.test.ts checks one of each.
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

test("each map's global file opens with a JSON line of at most 8 MB", () => {
  for (const search of ["?map=lunigiana", "?map=cesena"]) {
    const map = mapForSearch(search)
    const line = readMapFile(map.url).indexOf(10)
    // Issue #5's scale check (map.json ≤ 8 MB, #18): the game reads the line with JSON.parse at
    // load, its slowest step, so the bulk arrays travel as sections after it (format/global-file.ts).
    assert.ok(line <= 8_000_000, `${map.id}: the global file's JSON line is ${line} B`)
  }
})

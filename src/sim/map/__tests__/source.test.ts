// One map per process (docs/adr/0002-one-map-per-process.md): a map handed over once the map is
// decoded would leave the run on the map it had, believing it on the other, so it throws instead.
import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../index.ts"
import { MAP_URL, provideMap, readMapFile, useDiskMap } from "../source.ts"

test("a map handed over once the map is decoded throws, naming the import order", () => {
  const cesena = new URL("cesena.bin", MAP_URL)
  const order = /handed over after the map was decoded; hand it over before anything imports/
  assert.throws(() => provideMap(readMapFile(cesena)), order)
  assert.throws(() => useDiskMap(cesena), order)
  assert.equal(MAP.name, "monzone")
})

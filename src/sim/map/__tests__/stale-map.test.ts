// A map whose tiles were cut with another halo than the game's (`HALO`) still decodes, but a lookup
// at a point reads the point's tile alone, trusting it to hold every road and river within the halo:
// the game must refuse the map by name, not answer wrongly beside a seam.
import assert from "node:assert/strict"
import { test } from "node:test"

import { editMap } from "./edit-map.ts"

editMap((json) => ({ ...json, vectors: { ...json.vectors, halo: 16 } }))

test("the game refuses a map cut with another halo, saying to build the maps again", async () => {
  await assert.rejects(
    import("../global.ts"),
    /cut with a 16 m halo, the game reads 32 m; run pnpm maps/,
  )
})

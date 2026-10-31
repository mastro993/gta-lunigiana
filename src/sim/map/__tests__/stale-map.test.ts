// A global file built before the play area's outline (issue #7) still decodes, as version 3, but
// the game reads its outline everywhere (teleports, bolts, herds, the maps) and its Carabinieri's
// spawn: it must refuse the file by name, not fail later on a missing outline.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { MonzoneMapJson } from "../index.ts"
import { editMap } from "./edit-map.ts"

editMap((json) => {
  const { outline: _, ...old } = json
  return old as MonzoneMapJson
})

test("the game refuses a map built before its play area's outline, saying to build the maps again", async () => {
  await assert.rejects(
    import("../global.ts"),
    /built before its play area's outline; run pnpm maps/,
  )
})

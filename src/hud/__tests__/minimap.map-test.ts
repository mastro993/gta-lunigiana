import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { checkTilePaint } from "./tile-paint.ts"

// Map check (pnpm test:map): the minimap's tiles against the whole map painted; minimap.test.ts
// checks Monzone's tile against the tiles round it.
test("a tile's canvas, painted from only that tile's vectors, gets every fill and stroke the whole map would draw on it, in order and alike", () => {
  // Monzone's tile, and the one east of it across the x = 0 seam.
  for (const [i, j] of [
    [-1, 0],
    [0, 0],
  ] as const)
    checkTilePaint(i, j, wholeMap())
})

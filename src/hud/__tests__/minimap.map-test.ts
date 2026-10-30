import { test } from "node:test"

import { checkTilePaint } from "./tile-paint.ts"

// Map check (pnpm test:map): the minimap's tiles against the whole map painted; minimap.test.ts
// checks Monzone's tile against the features within 1 km of it.
test("a tile's canvas, painted from only the features near it, gets every path the whole map would draw on it, in order", () => {
  // Monzone's tile, and the one east of it across the x = 0 seam.
  for (const [i, j] of [
    [-1, 0],
    [0, 0],
  ] as const)
    checkTilePaint(i, j)
})

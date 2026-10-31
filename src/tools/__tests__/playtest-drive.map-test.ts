// The playtest bot's default drive on the map as built: it chains the SP59's lines, which the
// tiles hold, from the whole map (playtest-drive.test.ts, in pnpm test, checks the rest).
import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE } from "../../sim/map/kinds.ts"
import { wholeMap } from "../map-file.ts"
import { defaultRoute } from "../playtest-drive.ts"

test("defaultRoute: the SP59 from Monzone to Vinca, across the x = 0, y = 0, y = -2000 and x = 2000 seams", () => {
  const route = defaultRoute()
  const [x0, y0] = route,
    [x1, y1] = route.slice(-2)
  const { spawns, districts } = wholeMap()
  const start = spawns.player,
    vinca = districts.find((d) => d.name === "Vinca")!
  assert.ok(Math.hypot(x0! - start.x, y0! - start.y) < 600, `starts at ${x0}, ${y0}`)
  assert.ok(Math.hypot(x1! - vinca.x, y1! - vinca.y) < 500, `ends at ${x1}, ${y1}`)
  const seams = new Set<string>()
  for (let k = 2; k < route.length; k += 2)
    for (const [axis, a, b] of [
      ["x", route[k - 2]!, route[k]!],
      ["y", route[k - 1]!, route[k + 1]!],
    ] as const)
      if (Math.floor(a / TILE) !== Math.floor(b / TILE))
        seams.add(`${axis}${TILE * Math.max(Math.floor(a / TILE), Math.floor(b / TILE))}`)
  for (const seam of ["x0", "y0", "y-2000", "x2000"]) assert.ok(seams.has(seam), seam)
})

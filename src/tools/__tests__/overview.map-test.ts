// Map check (pnpm test:map): each built map's overview (`<map>/overview.png` beside its tiles: the
// two shipped maps', and the test regions' in test-maps/, the L's and the coast's) is the image its
// whole map paints now, so a stale one fails as a stale bake does. Without a test region's build its
// check is skipped, but in CI, which builds them with the maps (`pnpm maps`), a missing build fails.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

import { MAP_URL } from "../../sim/map/source.ts"
import { readWholeMap } from "../map-file.ts"
import { OVERVIEW_SIDE, paintOverview } from "../overview.ts"
import { filteredRgba, pngData } from "../png.ts"
import { skipUnbuilt, TEST_MAPS } from "./test-maps.ts"

for (const [label, url, skip] of [
  ["Lunigiana", new URL("monzone.bin", MAP_URL), !existsSync(new URL("monzone.bin", MAP_URL))],
  ["Cesena", new URL("cesena.bin", MAP_URL), !existsSync(new URL("cesena.bin", MAP_URL))],
  ...TEST_MAPS.map(([name, at]) => [name, at, skipUnbuilt(name, at)] as const),
] as const)
  test(`${label}'s overview is the image its whole map paints`, { skip }, () => {
    const whole = readWholeMap(url)
    const { width, height, data } = pngData(
      readFileSync(new URL(`${whole.name}/overview.png`, url)),
    )
    const painted = paintOverview(whole, whole.bounds)
    assert.deepEqual([width, height], [painted.width, painted.height])
    assert.ok(
      Math.max(width, height) <= OVERVIEW_SIDE && width * height < 16.7e6,
      `${width} × ${height}`,
    )
    assert.ok(data.equals(filteredRgba(width, height, painted.rgba)), "the same pixels")
  })

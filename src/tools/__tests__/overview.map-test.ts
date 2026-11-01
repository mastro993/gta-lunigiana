// Map check (pnpm test:map): each built map's overview (`<map>/overview.png` beside its tiles: the
// two shipped maps', and the L test region's in test-maps/) is the image its whole map paints now,
// so a stale one fails as a stale bake does. Without the L's build its check is skipped, but in CI,
// which builds it with the maps (`pnpm maps`), a missing build fails.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

import { MAP_URL } from "../../sim/map/packed.ts"
import { builtMapUrl, readWholeMap } from "../map-file.ts"
import { OVERVIEW_SIDE, paintOverview } from "../overview.ts"
import { filteredRgba, pngData } from "../png.ts"
import { regionFromArgs } from "../region.ts"

const L = builtMapUrl(regionFromArgs(["--region", "lunigiana-l"]))
// GitHub Actions sets CI=true.
if (!existsSync(L) && process.env.CI === "true")
  throw new Error("no lunigiana-l build in test-maps")

for (const [label, url] of [
  ["Lunigiana", new URL("monzone.bin", MAP_URL)],
  ["Cesena", new URL("cesena.bin", MAP_URL)],
  ["the L", L],
] as const)
  test(`${label}'s overview is the image its whole map paints`, { skip: !existsSync(url) }, () => {
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

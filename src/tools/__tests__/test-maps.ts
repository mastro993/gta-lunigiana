// The test regions `pnpm maps` builds into test-maps/, which the whole-map checks read beside
// Lunigiana and Cesena: the L (`lunigiana-l`) and the coast (`magra-coast`). Without a region's
// build its checks are left out, but in CI, which builds them, a missing build fails: a skip there
// would pass with nothing checked.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import type { TestContext } from "node:test"

import { builtMapUrl } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"

/** Each test region's name in the checks' lines and its build's global file. */
export const TEST_MAPS: ReadonlyArray<readonly [string, URL]> = [
  ["the L", builtMapUrl(regionFromArgs(["--region", "lunigiana-l"]))],
  ["the coast", builtMapUrl(regionFromArgs(["--region", "magra-coast"]))],
]

/** Why a check of the region built at `url` is skipped (no build), or false; in CI (CI=true) a missing build throws. */
export const skipUnbuilt = (name: string, url: URL): string | false => {
  if (existsSync(url)) return false
  const why = `no build of ${name} in test-maps: run pnpm maps`
  // GitHub Actions sets CI=true.
  if (process.env.CI === "true") throw new Error(why)
  return why
}

/** The test regions built, by name and global file: one not built fails in CI and is left out elsewhere, with a diagnostic on `t`. */
export const builtTestMaps = (t: TestContext): Array<readonly [string, URL]> =>
  TEST_MAPS.filter(([name, url]) => {
    if (existsSync(url)) return true
    // GitHub Actions sets CI=true.
    assert.notEqual(process.env.CI, "true", `no build of ${name} in test-maps`)
    t.diagnostic(`no build of ${name} in test-maps: it is not checked`)
    return false
  })

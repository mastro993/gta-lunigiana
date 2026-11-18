// The built regions the checks over every map read: Lunigiana, Cesena and the L, whose build lives
// in test-maps/ (`pnpm maps`): without it its checks are skipped, but in CI, which builds it, a
// missing build fails.
import { existsSync } from "node:fs"

import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../../../tools/map-file.ts"
import { regionFromArgs } from "../../../tools/region.ts"

const L = regionFromArgs(["--region", "lunigiana-l"])
const URL_L = builtMapUrl(L)
const noL = existsSync(URL_L)
  ? false
  : `no ${L.key} build in test-maps: run node src/tools/build-map.ts --region ${L.key}`
// GitHub Actions sets CI=true.
if (noL !== false && process.env.CI === "true") throw new Error(noL)

/** Each built region: its key, its map whole (read when called), and why its checks skip (false: they run). */
export const REGIONS: ReadonlyArray<readonly [string, () => JoinedMap, string | false]> = [
  ["lunigiana", () => wholeMap(), false],
  ["cesena", () => wholeMap("cesena"), false],
  ["lunigiana-l", () => readWholeMap(URL_L), noL],
]

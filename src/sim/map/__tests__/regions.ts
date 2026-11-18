// The built regions the checks over every map read: Lunigiana, Cesena and the test regions, whose
// builds live in test-maps/ (`pnpm maps`, `TEST_MAPS`): without one its checks are skipped, but in
// CI, which builds them, a missing build fails.
import { skipUnbuilt, TEST_MAPS } from "../../../tools/__tests__/test-maps.ts"
import { type JoinedMap, readWholeMap, wholeMap } from "../../../tools/map-file.ts"

/** Each built region: its name, its map whole (read when called), and why its checks skip (false: they run). */
export const REGIONS: ReadonlyArray<readonly [string, () => JoinedMap, string | false]> = [
  ["lunigiana", () => wholeMap(), false],
  ["cesena", () => wholeMap("cesena"), false],
  ...TEST_MAPS.map(
    ([name, url]) => [name, () => readWholeMap(url), skipUnbuilt(name, url)] as const,
  ),
]

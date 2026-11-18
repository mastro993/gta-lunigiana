// Every joint of a path or steps at grade with a path's or steps' bridge or tunnel, on every built
// region (Lunigiana, Cesena and the L): the way at grade is the deck's approach
// (src/tools/path-approaches.ts) and meets it at its level, so a walker comes onto the deck or into
// the bore from it (under-decks.ts walks onto the bridges). Fitted at the terrain's level, Aulla
// Lunigiana station's steps stood 4.1–5.8 m over its underpass at their joints, the sidewalk and the
// footway off two footbridges standing on the SS62's deck 7.7 and 9.9 m under them, and paths off
// footbridges over streams 2.5–3.6 m under them, in the bank's carve. The L's build lives in
// test-maps/ (`pnpm maps`): without it its check is skipped, but in CI, which builds it, a missing
// build fails.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../../../tools/map-file.ts"
import { regionFromArgs } from "../../../tools/region.ts"

/** How far apart two levels of one node may ship, m: the profiles' 0.1 m rounding of one level. */
const ROUNDING = 0.05

/** A joint whose two ways ship apart: the OSM ids of the way at grade and the deck, and a line saying where. */
interface Step {
  readonly path: number
  readonly deck: number
  readonly line: string
}

const isPath = (r: { readonly cls: string }) => r.cls === "path" || r.cls === "steps"
const lifted = (r: { readonly bridge?: boolean; readonly tunnel?: boolean }) =>
  r.bridge === true || r.tunnel === true

/** Every vertex a path or steps at grade of `map` shares with a path's or steps' deck, where the two stand more than ROUNDING apart. */
const steps = (map: JoinedMap): { readonly joints: number; readonly steps: Array<Step> } => {
  const decks = new Map<string, Array<{ readonly id: number; readonly z: number }>>()
  for (const r of map.roads)
    if (isPath(r) && lifted(r))
      for (let k = 0; k < r.z.length; k++) {
        const at = `${r.pts[2 * k]},${r.pts[2 * k + 1]}`
        decks.set(at, [...(decks.get(at) ?? []), { id: r.id, z: r.z[k]! }])
      }
  let joints = 0
  const out: Array<Step> = []
  for (const r of map.roads)
    if (isPath(r) && !lifted(r))
      for (let k = 0; k < r.z.length; k++) {
        const at = `${r.pts[2 * k]},${r.pts[2 * k + 1]}`
        for (const d of decks.get(at) ?? []) {
          joints++
          if (Math.abs(r.z[k]! - d.z) > ROUNDING)
            out.push({
              path: r.id,
              deck: d.id,
              line: `${r.cls} ${r.id} at ${r.z[k]} m meets ${d.id} at ${d.z} m at (${at})`,
            })
        }
      }
  return { joints, steps: out }
}

/**
 * Joints a region's build keeps apart, by the OSM ids of the way at grade and the deck: Cesena's
 * Sottopasso del Mare (23605012) ends under the rail at its clearance under it, 5.2 m under the
 * unclassified road 201119224 meeting it there, and the path 587877842 meets the road's level.
 * Each must still stand apart, so a fix drops it from here.
 */
const KNOWN: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  cesena: [[587877842, 23605012]],
}

const L = regionFromArgs(["--region", "lunigiana-l"])
const URL_L = builtMapUrl(L)
const noL = existsSync(URL_L)
  ? false
  : `no ${L.key} build in test-maps: run node src/tools/build-map.ts --region ${L.key}`
// GitHub Actions sets CI=true.
if (noL !== false && process.env.CI === "true") throw new Error(noL)

const REGIONS: ReadonlyArray<readonly [string, () => JoinedMap, string | false]> = [
  ["lunigiana", () => wholeMap(), false],
  ["cesena", () => wholeMap("cesena"), false],
  ["lunigiana-l", () => readWholeMap(URL_L), noL],
]

for (const [region, read, skip] of REGIONS)
  test(
    `approaches: on ${region}, every path or steps at grade meets a path's or steps' bridge or tunnel at its level`,
    { skip },
    () => {
      const found = steps(read()),
        known = KNOWN[region] ?? []
      assert.ok(found.joints > 0, "no joint to check")
      const isKnown = (s: Step) => known.some(([path, deck]) => s.path === path && s.deck === deck)
      assert.deepEqual(
        found.steps.filter((s) => !isKnown(s)).map((s) => s.line),
        [],
      )
      for (const [path, deck] of known)
        assert.ok(
          found.steps.some((s) => s.path === path && s.deck === deck),
          `${path} meets ${deck} at its level now: drop it from KNOWN`,
        )
    },
  )

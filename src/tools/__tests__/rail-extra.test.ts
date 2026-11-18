import assert from "node:assert/strict"
import { test } from "node:test"

import { buildExtras } from "../rail-extra.ts"
import { lineOf } from "../rail-match.ts"
import { surveyId } from "../survey-ids.ts"

// Regression: the extra tracks' ids read only sheets of section 23D, so the build threw on Aulla's
// yard in 24C, and two sections' sheets of one number would have shared their tracks' ids.
test("buildExtras numbers each extra track by its sheet's section, record and part", () => {
  const pts = (y: number) => [[0, y] as const, [50, y] as const]
  const tracks = [
    { src: ["23D11 VLI#2.0"], pts: pts(0) },
    { src: ["24C11 VLI#2.0"], pts: pts(10) },
  ]
  const { pieces } = buildExtras({
    tracks,
    lines: tracks.map((t) => lineOf(t.pts)),
    extra: [0, 1],
    hosts: [],
    bridges: [],
    away: [],
    roads: [],
    osmRoads: [],
    moves: new Map(),
  })
  // 23D is section 23·26 + 3, 24C 24·26 + 2; the local number is sheet·1e5 + 9e4 + record·10 + part.
  assert.deepEqual(
    pieces.map((p) => p.id),
    [surveyId("ctr2019", 601, 1190020), surveyId("ctr2019", 626, 1190020)],
  )
})

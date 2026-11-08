import assert from "node:assert/strict"
import { test } from "node:test"

import type { Road } from "../../sim/map/index.ts"
import { endsOf, type Mouth } from "../mouths/__tests__/mouth-checks.ts"
import {
  bakedAt,
  CASOLA,
  PATH,
  PIEVE,
  SR445,
  TRACK,
  tunnelAt,
} from "../mouths/__tests__/tunnels.ts"
import { PALETTE } from "../palette.ts"
import { checkHeadWall, checkNoPortal, checkPortal } from "./portal-checks.ts"
import { checkBore, checkRibbon } from "./tunnel-checks.ts"

// Road tunnels as drawn, found by geometry (src/render/mouths/__tests__/tunnels.ts): the SR445's
// 172 m tunnel by Groppoli, west of Gragnola, the 196 m track tunnel south-east of Equi Terme, the
// 87 m path under the line at Equi Terme, Pieve San Lorenzo's 29 m underpass under the station and
// Via Casola's building passage in Casola; where their portals stand is render/mouths' test
// (mouths.test.ts), and the tunnels map tests check every road tunnel of each built region.

test("the SR445's tunnel by Groppoli: its road drawn through the hill at its floor, between dark walls that never stand out of it", () => {
  const [road] = tunnelAt(SR445)
  assert.equal(road.cls, "primary")
  assert.ok(checkRibbon(road) > 80)
  const walls = checkBore(road)
  assert.ok(walls > 100, `${walls} wall triangles`)
})

test("both mouths of the SR445's tunnel by Groppoli: a concrete portal, its dark mouth facing out of the hill", () => {
  const [road, id] = tunnelAt(SR445)
  for (const mouth of endsOf(road, id)) checkPortal(road, mouth, PALETTE.plasterGrey)
})

test("both mouths of the 196 m track's tunnel: an old stone portal, its dark mouth facing out of the hill", () => {
  const [road, id] = tunnelAt(TRACK)
  assert.equal(road.cls, "track")
  for (const mouth of endsOf(road, id)) checkPortal(road, mouth, PALETTE.stoneMid)
})

test("the 87 m path under the line at Equi Terme: an old stone portal where each stands, its dark mouth facing out of the hill", () => {
  const [road, id] = tunnelAt(PATH)
  for (const end of endsOf(road, id)) checkPortal(road, bakedAt(end, id), PALETTE.stoneMid)
})

test("Pieve San Lorenzo's underpass under the station: an old stone head wall at its south mouth, its opening at the road's clear height facing out of the bank; no portal at its north mouth", () => {
  const [road, id] = tunnelAt(PIEVE)
  const [south, north] = endsOf(road, id).sort((a, b) => a.y - b.y) as [Mouth, Mouth]
  checkHeadWall(road, south, PALETTE.stoneMid)
  checkNoPortal(north.x, north.y)
})

test("Via Casola's building passage: its road drawn on under the house at its floor, with no walls and no portal", () => {
  const [road, id] = tunnelAt(CASOLA)
  assert.equal(road.name, "Via Casola")
  checkRibbon(road)
  assert.equal(checkBore(road), 0)
  for (const { x, y } of endsOf(road, id)) checkNoPortal(x, y)
})

// Regression: Giucano's path under its houses (OSM 1326730181), 12% down through an 85° turn, drew
// its ribbon 3 cm under its profile past the bend: a mitred section holds one height across a line
// that slopes along it, and a whole quad's two triangles there tilt off the profile.
const turning = (flag: "tunnel" | "bridge"): Road => ({
  id: 1,
  cls: "path",
  w: 1.5,
  surface: "unpaved",
  [flag]: true,
  pts: [0, 0, -2.1, 0.9, -2.9, -0.6],
  z: [309.1, 308.9, 308.7],
})

test("a ribbon on its profile (a tunnel's, a deck's) holds it along its line through a sharp bend on a slope", () => {
  assert.equal(checkRibbon(turning("tunnel")), 7)
  assert.equal(checkRibbon(turning("bridge")), 7)
})

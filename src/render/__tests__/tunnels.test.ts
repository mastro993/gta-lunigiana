import assert from "node:assert/strict"
import { test } from "node:test"

import { segDist2 } from "../../sim/collide.ts"
import { MAP, type Road } from "../../sim/map/index.ts"
import { PALETTE } from "../palette.ts"
import { bakeMouths } from "../portals.ts"
import { vectorsAround } from "../testing.ts"
import { checkBore, checkNoPortal, checkPortal, checkRibbon, endsOf } from "./tunnel-checks.ts"

// Road tunnels as drawn, found by geometry: the SR445's 172 m tunnel by Groppoli, west of Gragnola,
// the 196 m track tunnel south-east of Equi Terme and Via Casola's building passage in Casola;
// the tunnels map tests check every road tunnel of each built region.

/** Inside each: the SR445's tunnel, the track's and Via Casola's passage. */
const SR445 = { x: -2330, y: 4420 },
  TRACK = { x: 2855, y: 65 },
  CASOLA = { x: 3577, y: 4152 }
/** The roads of the tiles round them (every one within 300 m). */
const ROADS = vectorsAround([SR445, TRACK, CASOLA], 300).roads

/** The road in a tunnel whose line passes nearest `at`, within 20 m, and its index in the whole map's roads. */
const tunnelAt = (at: { readonly x: number; readonly y: number }): readonly [Road, number] => {
  let best = 20 ** 2,
    found: readonly [Road, number] | undefined
  ROADS.items.forEach((road, k) => {
    if (road.tunnel !== true) return
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const { d2 } = segDist2(
        at.x,
        at.y,
        road.pts[i]!,
        road.pts[i + 1]!,
        road.pts[i + 2]!,
        road.pts[i + 3]!,
      )
      if (d2 < best) [best, found] = [d2, [road, ROADS.ids[k]!]]
    }
  })
  assert.ok(found !== undefined, `a road in a tunnel by (${at.x}, ${at.y})`)
  return found
}

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

test("Via Casola's building passage: its road drawn on under the house at its floor, with no walls and no portal", () => {
  const [road, id] = tunnelAt(CASOLA)
  assert.equal(road.name, "Via Casola")
  checkRibbon(road)
  assert.equal(checkBore(road), 0)
  for (const { x, y } of endsOf(road, id)) checkNoPortal(x, y)
})

/** As the map file holds it: JSON keeps no −0 and no undefined. */
const saved = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// The whole map's mouths are bake.map-test.ts's: a mouth's tunnel can reach past the tiles round it.
test("the SR445's and the track's mouths are baked as the game's code bakes them now, each with a portal (run pnpm map when this fails)", () => {
  const roads = new Set([tunnelAt(SR445)[1], tunnelAt(TRACK)[1]]),
    fresh = bakeMouths(ROADS).filter((mouth) => roads.has(mouth.road))
  assert.equal(fresh.length, 4)
  assert.ok(fresh.every((mouth) => !("open" in mouth)))
  assert.deepEqual(saved(fresh), saved(MAP.derived.mouths.filter((mouth) => roads.has(mouth.road))))
})

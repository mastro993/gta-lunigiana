import assert from "node:assert/strict"
import { test } from "node:test"

import { segDist2 } from "../../sim/collide.ts"
import { MAP, type Road } from "../../sim/map/index.ts"
import { PALETTE } from "../palette.ts"
import { bakeMouths } from "../portals.ts"
import { vectorsAround } from "../testing.ts"
import { checkClear, checkNoPortal, checkPortal, checkStoodBack, endsOf } from "./mouth-checks.ts"
import { checkBore, checkRibbon } from "./tunnel-checks.ts"

// Road tunnels as drawn, found by geometry: the SR445's 172 m tunnel by Groppoli, west of Gragnola,
// the 196 m track tunnel south-east of Equi Terme, the 87 m path under the line at Equi Terme and
// Via Casola's building passage in Casola; the tunnels map tests check every road tunnel of each
// built region.

/** Inside each: the SR445's tunnel, the track's, the path's and Via Casola's passage. */
const SR445 = { x: -2330, y: 4420 },
  TRACK = { x: 2855, y: 65 },
  PATH = { x: 1969, y: 920 },
  CASOLA = { x: 3577, y: 4152 }
/** The roads of the tiles round them (every one within 300 m). */
const ROADS = vectorsAround([SR445, TRACK, PATH, CASOLA], 300).roads

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

test("both mouths of the SR445's tunnel by Groppoli: a concrete portal, its dark mouth facing out of the hill, on no other road", () => {
  const [road, id] = tunnelAt(SR445)
  for (const mouth of endsOf(road, id)) {
    checkPortal(road, mouth, PALETTE.plasterGrey)
    checkClear(ROADS, mouth, mouth)
  }
})

test("both mouths of the 196 m track's tunnel: an old stone portal, its dark mouth facing out of the hill, on no other road", () => {
  const [road, id] = tunnelAt(TRACK)
  assert.equal(road.cls, "track")
  for (const mouth of endsOf(road, id)) {
    checkPortal(road, mouth, PALETTE.stoneMid)
    checkClear(ROADS, mouth, mouth)
  }
})

/** Where the build stood the portal at road `id`'s mouth `end`, and how far back into the tunnel. */
const bakedAt = (end: { readonly x: number; readonly y: number }, id: number) => {
  const baked = MAP.derived.mouths.find(
    (mouth) =>
      mouth.road === id && !("open" in mouth) && Math.hypot(mouth.x - end.x, mouth.y - end.y) < 45,
  )
  assert.ok(
    baked !== undefined && !("open" in baked),
    `a portal at road ${id}'s mouth (${end.x}, ${end.y})`,
  )
  return baked
}

test("the 87 m path under the line at Equi Terme: its portals stand clear of the tertiary road its south mouth opens onto and of the track over its north throat", () => {
  const [road, id] = tunnelAt(PATH)
  assert.equal(road.cls, "path")
  for (const end of endsOf(road, id)) {
    const at = bakedAt(end, id)
    checkPortal(road, at, PALETTE.stoneMid)
    checkClear(ROADS, end, at)
    // The south mouth is a vertex of the tertiary road, which crosses it: the portal stands back.
    if (end.y < PATH.y) assert.ok(at.back >= 5, `stood back ${at.back} m`)
    if (at.back > 0) checkStoodBack(road, end, at, at.back)
  }
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

// The whole map's mouths are bake.map-test.ts's: a mouth's tunnel, and the roads round it, can reach
// past the tiles round it.
test("the SR445's, the track's and the path's mouths are baked as the game's code bakes them now, each with a portal (run pnpm map when this fails)", () => {
  const roads = new Set([tunnelAt(SR445)[1], tunnelAt(TRACK)[1], tunnelAt(PATH)[1]]),
    fresh = bakeMouths(ROADS).filter((mouth) => roads.has(mouth.road))
  assert.equal(fresh.length, 6)
  assert.ok(fresh.every((mouth) => !("open" in mouth)))
  assert.deepEqual(saved(fresh), saved(MAP.derived.mouths.filter((mouth) => roads.has(mouth.road))))
})
